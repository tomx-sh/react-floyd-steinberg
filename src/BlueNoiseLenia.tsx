import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { generateBlueNoisePattern } from "./blueNoise";
import type {
  FloydSteinbergColor,
  FloydSteinbergProps,
  FloydSteinbergRenderInfo,
} from "./FloydSteinberg";
import { createLeniaInitialState } from "./leniaSeed";
import {
  DEFAULT_LENIA_SPECIES,
  getLeniaScenePreset,
  getLeniaSpeciesPreset,
  type LeniaScenePresetId,
  type LeniaSpeciesId,
} from "./leniaPresets";
import { blueNoiseLeniaShader, leniaShader } from "./shaders";
import { createCheckedModule, getSharedDevice } from "./webgpu";

const FRAME_INTERVAL = 1000 / 60;
// Run the catalogued dynamics slowly, then interpolate the two latest states
// at display rate so the creatures remain stable without visibly jumping.
const SIMULATION_INTERVAL = 1000 / 4;
const DEFAULT_DARK: FloydSteinbergColor = [0, 0, 0, 1];
const DEFAULT_LIGHT: FloydSteinbergColor = [1, 1, 1, 1];
let cssColorContext: CanvasRenderingContext2D | undefined;

export interface BlueNoiseLeniaProps
  extends Omit<
    FloydSteinbergProps,
    "alphaBackground" | "crossOrigin" | "fit" | "randomness" | "src" | "threshold"
  > {
  /** Width and height of the square blue-noise tile in dither cells. Defaults to 64. */
  patternSize?: number;
  /** Longest automaton-grid dimension. Defaults to 256; clamped to 64–384. */
  simulationSize?: number;
  /** Catalogued Lenia species used to initialize the field. */
  species?: LeniaSpeciesId;
  /** Optional scene preset that controls both species and initial placement. */
  preset?: LeniaScenePresetId;
  /** Pointer injection radius in normalized canvas units. Defaults to 0.05. */
  interactionRadius?: number;
  /**
   * Contrast applied to the automaton state before dithering. Values above 1
   * grow the light areas; values below 1 shrink them toward noise. Defaults
   * to 1; clamped to 0.25–8.
   */
  contrast?: number;
}

interface Pipelines {
  initialize: GPUComputePipeline;
  resample: GPUComputePipeline;
  step: GPUComputePipeline;
  computeLayout: GPUBindGroupLayout;
  display: GPURenderPipeline;
}

interface RenderSize {
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
}

interface RenderResources {
  parameters: GPUBuffer;
  pattern: GPUBuffer;
  initialState: GPUBuffer;
  stateA: GPUTexture;
  stateB: GPUTexture;
  sampler: GPUSampler;
}

interface PointerState {
  x: number;
  y: number;
  lastMoveTime: number;
}

const pipelineCache = new WeakMap<GPUDevice, Map<GPUTextureFormat, Promise<Pipelines>>>();

function getPipelines(device: GPUDevice, format: GPUTextureFormat): Promise<Pipelines> {
  let formats = pipelineCache.get(device);
  if (!formats) {
    formats = new Map();
    pipelineCache.set(device, formats);
  }

  let pending = formats.get(format);
  if (!pending) {
    pending = (async () => {
      const [simulationModule, displayModule] = await Promise.all([
        createCheckedModule(device, "Lenia simulation WGSL", leniaShader),
        createCheckedModule(device, "Blue-noise Lenia WGSL", blueNoiseLeniaShader),
      ]);
      const computeLayout = device.createBindGroupLayout({
        label: "Lenia bindings",
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: "write-only", format: "rgba16float" },
          },
          { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: "filtering" } },
          {
            binding: 4,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
        ],
      });
      const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
      return {
        initialize: device.createComputePipeline({
          label: "Initialize Lenia state",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "initialize" },
        }),
        resample: device.createComputePipeline({
          label: "Resample Lenia state",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "resample" },
        }),
        step: device.createComputePipeline({
          label: "Step Lenia state",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "advance" },
        }),
        computeLayout,
        display: device.createRenderPipeline({
          label: "Blue-noise Lenia display",
          layout: "auto",
          vertex: { module: displayModule, entryPoint: "vertexMain" },
          fragment: { module: displayModule, entryPoint: "fragmentMain", targets: [{ format }] },
          primitive: { topology: "triangle-list" },
        }),
      };
    })();
    formats.set(format, pending);
  }
  return pending;
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.round(Number.isFinite(value) ? (value as number) : fallback));
}

function resolveIntrinsicSize(width?: number, height?: number): { width: number; height: number } {
  if (width !== undefined && height !== undefined) {
    return { width: positiveInteger(width, 900), height: positiveInteger(height, 600) };
  }
  if (width !== undefined) {
    const resolvedWidth = positiveInteger(width, 900);
    return { width: resolvedWidth, height: Math.max(1, Math.round((resolvedWidth * 2) / 3)) };
  }
  if (height !== undefined) {
    const resolvedHeight = positiveInteger(height, 600);
    return { width: Math.max(1, Math.round((resolvedHeight * 3) / 2)), height: resolvedHeight };
  }
  return { width: 900, height: 600 };
}

function normalizedCssColor(color: string): readonly [number, number, number, number] {
  const value = color.trim();
  if (!cssColorContext) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    cssColorContext = canvas.getContext("2d", { willReadFrequently: true }) ?? undefined;
  }
  if (!cssColorContext) {
    throw new Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
  }

  cssColorContext.fillStyle = "#010203";
  cssColorContext.fillStyle = value;
  const firstResult = cssColorContext.fillStyle;
  cssColorContext.fillStyle = "#040506";
  cssColorContext.fillStyle = value;
  if (!value || cssColorContext.fillStyle !== firstResult) {
    throw new Error(`Invalid CSS color: ${JSON.stringify(color)}.`);
  }

  cssColorContext.clearRect(0, 0, 1, 1);
  cssColorContext.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = cssColorContext.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255, alpha / 255];
}

function normalizedColor(color: FloydSteinbergColor): readonly [number, number, number, number] {
  if (typeof color === "string") return normalizedCssColor(color);
  return [
    clamp(color[0], 0, 1, 0),
    clamp(color[1], 0, 1, 0),
    clamp(color[2], 0, 1, 0),
    clamp(color[3] ?? 1, 0, 1, 1),
  ];
}

function colorDependency(color: FloydSteinbergColor): string {
  return typeof color === "string" ? `css:${color}` : `tuple:${color.join(",")}`;
}

function destroyResources(resources: RenderResources | undefined) {
  resources?.parameters.destroy();
  resources?.pattern.destroy();
  resources?.initialState.destroy();
  resources?.stateA.destroy();
  resources?.stateB.destroy();
}

export function BlueNoiseLenia(
  {
    width,
    height,
    pixelScale = 2,
    patternSize = 64,
    simulationSize = 256,
    species = DEFAULT_LENIA_SPECIES,
    preset,
    interactionRadius = 0.05,
    contrast = 1,
    invert = false,
    seed = 0x5eed1234,
    dark = DEFAULT_DARK,
    light = DEFAULT_LIGHT,
    powerPreference = "high-performance",
    onReady,
    onError,
    ref,
    style,
    "aria-label": ariaLabel = "Interactive blue-noise Lenia automaton",
    ...canvasProps
  }: BlueNoiseLeniaProps,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<PointerState>({
    x: 0.5,
    y: 0.5,
    lastMoveTime: Number.NEGATIVE_INFINITY,
  });
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const [renderSize, setRenderSize] = useState<RenderSize>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const intrinsicSize = resolveIntrinsicSize(width, height);
  const darkDependency = colorDependency(dark);
  const lightDependency = colorDependency(light);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  const sizeRef = useRef<RenderSize | undefined>(undefined);
  const propsRef = useRef<
    Required<Pick<BlueNoiseLeniaProps, "pixelScale" | "patternSize" | "simulationSize" | "species" | "interactionRadius" | "contrast" | "invert" | "seed" | "powerPreference">> & {
      darkDependency: string;
      lightDependency: string;
      preset: LeniaScenePresetId | undefined;
      dark: FloydSteinbergColor;
      light: FloydSteinbergColor;
    }
  >({
    pixelScale,
    patternSize,
    simulationSize,
    species,
    preset,
    interactionRadius,
    contrast,
    invert,
    darkDependency,
    lightDependency,
    seed,
    powerPreference,
    dark,
    light,
  });
  propsRef.current = {
    pixelScale,
    patternSize,
    simulationSize,
    species,
    preset,
    interactionRadius,
    contrast,
    invert,
    darkDependency,
    lightDependency,
    seed,
    powerPreference,
    dark,
    light,
  };
  const intrinsicRef = useRef(intrinsicSize);
  intrinsicRef.current = intrinsicSize;

  const assignRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useEffect(() => {
    setRenderSize(undefined);
  }, [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let lastCssWidth = 0;
    let lastCssHeight = 0;
    let resolutionQuery: MediaQueryList | undefined;

    const updateSize = (cssWidth = lastCssWidth, cssHeight = lastCssHeight) => {
      cssWidth = Math.round(cssWidth * 64) / 64;
      cssHeight = Math.round(cssHeight * 64) / 64;
      if (cssWidth <= 0 || cssHeight <= 0) return;
      lastCssWidth = cssWidth;
      lastCssHeight = cssHeight;
      const devicePixelRatio = Math.max(0.01, window.devicePixelRatio || 1);
      const nextSize: RenderSize = {
        width: Math.max(1, Math.round(cssWidth * devicePixelRatio)),
        height: Math.max(1, Math.round(cssHeight * devicePixelRatio)),
        cssWidth,
        cssHeight,
        devicePixelRatio,
      };
      sizeRef.current = nextSize;
      setRenderSize((current) =>
        current &&
        current.width === nextSize.width &&
        current.height === nextSize.height &&
        current.cssWidth === nextSize.cssWidth &&
        current.cssHeight === nextSize.cssHeight &&
        current.devicePixelRatio === nextSize.devicePixelRatio
          ? current
          : nextSize,
      );
    };

    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(canvas);

    const handleResolutionChange = () => {
      updateSize();
      resolutionQuery?.removeEventListener("change", handleResolutionChange);
      resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolutionQuery.addEventListener("change", handleResolutionChange, { once: true });
    };
    window.addEventListener("resize", handleResolutionChange);
    handleResolutionChange();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResolutionChange);
      resolutionQuery?.removeEventListener("change", handleResolutionChange);
    };
  }, [intrinsicSize.width, intrinsicSize.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const movePointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerRef.current.x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1, 0.5);
      pointerRef.current.y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1, 0.5);
      pointerRef.current.lastMoveTime = performance.now();
    };
    const leavePointer = () => {
      pointerRef.current.lastMoveTime = Number.NEGATIVE_INFINITY;
    };

    canvas.addEventListener("pointermove", movePointer);
    canvas.addEventListener("pointerleave", leavePointer);
    return () => {
      canvas.removeEventListener("pointermove", movePointer);
      canvas.removeEventListener("pointerleave", leavePointer);
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let animationFrame = 0;
    let resources: RenderResources | undefined;
    setStatus("loading");

    const fail = (reason: unknown) => {
      if (cancelled) return;
      cancelled = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      destroyResources(resources);
      resources = undefined;
      setStatus("error");
      onErrorRef.current?.(reason instanceof Error ? reason : new Error(String(reason)));
    };

    const setup = async () => {
      const props = propsRef.current;
      const scenePreset = props.preset ? getLeniaScenePreset(props.preset) : undefined;
      const speciesPreset = getLeniaSpeciesPreset(scenePreset?.species ?? props.species);
      const resolvedSimulationSize = Math.round(clamp(props.simulationSize, 64, 384, 256));
      let resolvedPatternSize = Math.round(clamp(props.patternSize, 8, 128, 64));
      const initialSize = sizeRef.current ?? {
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.clientWidth || intrinsicRef.current.width,
        cssHeight: canvas.clientHeight || intrinsicRef.current.height,
        devicePixelRatio: window.devicePixelRatio || 1,
      };
      const aspect = initialSize.cssWidth / initialSize.cssHeight;
      let simulationWidth = aspect >= 1 ? resolvedSimulationSize : Math.max(24, Math.round(resolvedSimulationSize * aspect));
      let simulationHeight = aspect >= 1 ? Math.max(24, Math.round(resolvedSimulationSize / aspect)) : resolvedSimulationSize;
      let logicalWidth = Math.ceil(initialSize.cssWidth / Math.max(1, Math.round(props.pixelScale)));
      let logicalHeight = Math.ceil(initialSize.cssHeight / Math.max(1, Math.round(props.pixelScale)));

      const pattern = generateBlueNoisePattern(resolvedPatternSize, props.seed);
      const device = await getSharedDevice(props.powerPreference);
      if (cancelled) return;

      const maxDimension = device.limits.maxTextureDimension2D;
      if (
        initialSize.width > maxDimension ||
        initialSize.height > maxDimension ||
        simulationWidth > maxDimension ||
        simulationHeight > maxDimension
      ) {
        throw new Error(`The output or simulation exceeds this device's ${maxDimension}px texture limit.`);
      }

      const context = canvas.getContext("webgpu");
      if (!context) throw new Error("The canvas could not create a WebGPU context.");
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });
      const pipelines = await getPipelines(device, format);
      if (cancelled) return;

      const parameters = device.createBuffer({
        label: "Lenia parameters",
        size: 112,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const patternBuffer = device.createBuffer({
        label: "Tileable blue-noise ranks",
        size: 128 * 128 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const initialStateData = createLeniaInitialState(
        simulationWidth,
        simulationHeight,
        speciesPreset,
        props.seed,
        scenePreset,
      );
      const initialStateBuffer = device.createBuffer({
        label: `${speciesPreset.name} initial state`,
        size: initialStateData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const textureDescriptor: GPUTextureDescriptor = {
        size: [simulationWidth, simulationHeight],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      };
      let stateA = device.createTexture({ ...textureDescriptor, label: "Lenia state A" });
      let stateB = device.createTexture({ ...textureDescriptor, label: "Lenia state B" });
      const sampler = device.createSampler({
        label: "Lenia linear sampler",
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });
      resources = {
        parameters,
        pattern: patternBuffer,
        initialState: initialStateBuffer,
        stateA,
        stateB,
        sampler,
      };
      device.queue.writeBuffer(patternBuffer, 0, pattern);
      device.queue.writeBuffer(initialStateBuffer, 0, initialStateData);

      const parameterData = new ArrayBuffer(112);
      const parameterView = new DataView(parameterData);
      parameterView.setUint32(0, simulationWidth, true);
      parameterView.setUint32(4, simulationHeight, true);
      parameterView.setFloat32(8, 1 / speciesPreset.timeResolution, true);
      parameterView.setUint32(12, props.seed >>> 0, true);
      parameterView.setFloat32(32, 0, true);
      parameterView.setFloat32(36, speciesPreset.mu, true);
      parameterView.setFloat32(40, speciesPreset.sigma, true);
      parameterView.setUint32(52, speciesPreset.radius, true);
      parameterView.setUint32(72, resolvedPatternSize, true);
      device.queue.writeBuffer(parameters, 0, parameterData);

      let stateAView = stateA.createView();
      let stateBView = stateB.createView();
      const createComputeBindGroup = (label: string, previous: GPUTextureView, next: GPUTextureView) =>
        device.createBindGroup({
          label,
          layout: pipelines.computeLayout,
          entries: [
            { binding: 0, resource: { buffer: parameters } },
            { binding: 1, resource: previous },
            { binding: 2, resource: next },
            { binding: 3, resource: sampler },
            { binding: 4, resource: { buffer: initialStateBuffer } },
          ],
        });
      const createDisplayBindGroup = (
        label: string,
        currentState: GPUTextureView,
        previousState: GPUTextureView,
      ) =>
        device.createBindGroup({
          label,
          layout: pipelines.display.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: parameters } },
            { binding: 1, resource: { buffer: patternBuffer } },
            { binding: 2, resource: currentState },
            { binding: 3, resource: sampler },
            { binding: 4, resource: previousState },
          ],
        });

      let initializeBindGroup = createComputeBindGroup("Initialize Lenia state", stateAView, stateBView);
      let stepBindGroups = [
        createComputeBindGroup("Step Lenia A to B", stateAView, stateBView),
        createComputeBindGroup("Step Lenia B to A", stateBView, stateAView),
      ];
      let displayBindGroups = [
        createDisplayBindGroup("Display Lenia state A", stateAView, stateBView),
        createDisplayBindGroup("Display Lenia state B", stateBView, stateAView),
      ];

      const initializeEncoder = device.createCommandEncoder({ label: "Initialize Lenia" });
      const initializePass = initializeEncoder.beginComputePass();
      initializePass.setPipeline(pipelines.initialize);
      initializePass.setBindGroup(0, initializeBindGroup);
      initializePass.dispatchWorkgroups(Math.ceil(simulationWidth / 8), Math.ceil(simulationHeight / 8));
      initializePass.end();
      device.queue.submit([initializeEncoder.finish()]);

      let colorCache = {
        key: `${props.darkDependency}|${props.lightDependency}`,
        dark: normalizedColor(props.dark),
        light: normalizedColor(props.light),
      };

      const startTime = performance.now();
      let previousFrameTime = startTime - FRAME_INTERVAL;
      let previousSimulationTime = startTime - SIMULATION_INTERVAL;
      let readyPending = false;
      let front = 1;

      const rebuildSimulation = (nextWidth: number, nextHeight: number) => {
        // Resample the live front buffer into a fresh pair, preserving the front index.
        const previousView = front === 0 ? stateAView : stateBView;
        const nextStateA = device.createTexture({
          label: "Lenia state A",
          size: [nextWidth, nextHeight],
          format: "rgba16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        });
        const nextStateB = device.createTexture({
          label: "Lenia state B",
          size: [nextWidth, nextHeight],
          format: "rgba16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        });
        const nextStateAView = nextStateA.createView();
        const nextStateBView = nextStateB.createView();

        parameterView.setUint32(0, nextWidth, true);
        parameterView.setUint32(4, nextHeight, true);
        device.queue.writeBuffer(parameters, 0, parameterData);

        const resampleBindGroup = createComputeBindGroup("Resample Lenia state", previousView, nextStateAView);
        const resampleEncoder = device.createCommandEncoder({ label: "Resample Lenia state" });
        const resamplePass = resampleEncoder.beginComputePass();
        resamplePass.setPipeline(pipelines.resample);
        resamplePass.setBindGroup(0, resampleBindGroup);
        resamplePass.dispatchWorkgroups(Math.ceil(nextWidth / 8), Math.ceil(nextHeight / 8));
        resamplePass.end();
        device.queue.submit([resampleEncoder.finish()]);

        stateA.destroy();
        stateB.destroy();
        stateA = nextStateA;
        stateB = nextStateB;
        stateAView = nextStateAView;
        stateBView = nextStateBView;
        if (resources) {
          resources.stateA = nextStateA;
          resources.stateB = nextStateB;
        }
        simulationWidth = nextWidth;
        simulationHeight = nextHeight;
        stepBindGroups = [
          createComputeBindGroup("Step Lenia A to B", stateAView, stateBView),
          createComputeBindGroup("Step Lenia B to A", stateBView, stateAView),
        ];
        displayBindGroups = [
          createDisplayBindGroup("Display Lenia state A", stateAView, stateBView),
          createDisplayBindGroup("Display Lenia state B", stateBView, stateAView),
        ];
        front = 0;
      };

      const drawFrame = (timestamp: number) => {
        if (cancelled) return;
        const elapsed = timestamp - previousFrameTime;
        if (elapsed < FRAME_INTERVAL) {
          animationFrame = requestAnimationFrame(drawFrame);
          return;
        }
        previousFrameTime = timestamp - (elapsed % FRAME_INTERVAL);
        const simulationElapsed = timestamp - previousSimulationTime;
        const shouldAdvance = simulationElapsed >= SIMULATION_INTERVAL;
        let interpolation = Math.min(1, simulationElapsed / SIMULATION_INTERVAL);
        if (shouldAdvance) {
          previousSimulationTime = timestamp - (simulationElapsed % SIMULATION_INTERVAL);
          interpolation = 0;
        }

        try {
          const props = propsRef.current;
          const size = sizeRef.current;
          if (size && size.cssWidth > 0 && size.cssHeight > 0) {
            const nextAspect = size.cssWidth / size.cssHeight;
            const nextWidth = nextAspect >= 1 ? resolvedSimulationSize : Math.max(24, Math.round(resolvedSimulationSize * nextAspect));
            const nextHeight = nextAspect >= 1 ? Math.max(24, Math.round(resolvedSimulationSize / nextAspect)) : resolvedSimulationSize;
            if (nextWidth !== simulationWidth || nextHeight !== simulationHeight) {
              rebuildSimulation(nextWidth, nextHeight);
            }
          }
          const nextPatternSize = Math.round(clamp(props.patternSize, 8, 128, 64));
          if (nextPatternSize !== resolvedPatternSize) {
            resolvedPatternSize = nextPatternSize;
            parameterView.setUint32(72, resolvedPatternSize, true);
            device.queue.writeBuffer(patternBuffer, 0, generateBlueNoisePattern(nextPatternSize, props.seed));
          }

          const pointer = pointerRef.current;
          const pointerActive = performance.now() - pointer.lastMoveTime < 120;
          parameterView.setFloat32(16, pointer.x, true);
          parameterView.setFloat32(20, pointer.y, true);
          parameterView.setFloat32(24, pointerActive ? 1 : 0, true);
          parameterView.setFloat32(28, clamp(props.interactionRadius, 0.005, 0.3, 0.05), true);
          parameterView.setFloat32(32, interpolation, true);
          if (size) {
            const resolvedScale = Math.max(1, Math.round(props.pixelScale));
            logicalWidth = Math.ceil(size.cssWidth / resolvedScale);
            logicalHeight = Math.ceil(size.cssHeight / resolvedScale);
            parameterView.setFloat32(64, (resolvedScale * size.width) / size.cssWidth, true);
            parameterView.setFloat32(68, (resolvedScale * size.height) / size.cssHeight, true);
          }
          parameterView.setUint32(56, logicalWidth, true);
          parameterView.setUint32(60, logicalHeight, true);
          parameterView.setUint32(72, resolvedPatternSize, true);
          parameterView.setFloat32(44, clamp(props.contrast, 0.25, 8, 1), true);
          parameterView.setUint32(48, props.invert ? 1 : 0, true);
          const colorKey = `${props.darkDependency}|${props.lightDependency}`;
          if (colorCache.key !== colorKey) {
            colorCache = { key: colorKey, dark: normalizedColor(props.dark), light: normalizedColor(props.light) };
          }
          const colors = new Float32Array(parameterData, 80, 8);
          colors.set(colorCache.dark, 0);
          colors.set(colorCache.light, 4);
          device.queue.writeBuffer(parameters, 0, parameterData);

          const encoder = device.createCommandEncoder({ label: "Lenia frame" });
          if (shouldAdvance) {
            const stepPass = encoder.beginComputePass({ label: "Step Lenia automaton" });
            stepPass.setPipeline(pipelines.step);
            stepPass.setBindGroup(0, stepBindGroups[front]);
            stepPass.dispatchWorkgroups(Math.ceil(simulationWidth / 8), Math.ceil(simulationHeight / 8));
            stepPass.end();
            front = 1 - front;
          }

          const renderPass = encoder.beginRenderPass({
            label: "Blue-noise Lenia display pass",
            colorAttachments: [
              {
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          });
          renderPass.setPipeline(pipelines.display);
          renderPass.setBindGroup(0, displayBindGroups[front]);
          renderPass.draw(3);
          renderPass.end();
          device.queue.submit([encoder.finish()]);

          if (!readyPending) {
            readyPending = true;
            void device.queue.onSubmittedWorkDone().then(() => {
              if (cancelled) return;
              setStatus("ready");
              const info: FloydSteinbergRenderInfo = {
                canvas,
                device,
                ...(sizeRef.current ?? initialSize),
                logicalWidth,
                logicalHeight,
              };
              onReadyRef.current?.(info);
            }, fail);
          }
          animationFrame = requestAnimationFrame(drawFrame);
        } catch (error) {
          fail(error);
        }
      };

      drawFrame(performance.now());
    };

    setup().catch(fail);

    return () => {
      cancelled = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      destroyResources(resources);
    };
  }, [simulationSize, species, preset, seed, powerPreference]);

  return (
    <canvas
      {...canvasProps}
      ref={assignRef}
      width={renderSize?.width ?? intrinsicSize.width}
      height={renderSize?.height ?? intrinsicSize.height}
      style={{ touchAction: "none", ...style }}
      aria-label={ariaLabel}
      data-webgpu-status={status}
    />
  );
}
