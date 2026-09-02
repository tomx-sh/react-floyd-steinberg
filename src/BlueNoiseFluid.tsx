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
import { blueNoiseFluidShader, fluidSimulationShader } from "./shaders";
import { createCheckedModule, getSharedDevice } from "./webgpu";

const FRAME_INTERVAL = 1000 / 60;
const SIMULATION_SPEED = 0.5;
const PRESSURE_ITERATIONS = 16;
const DEFAULT_DARK: FloydSteinbergColor = [0, 0, 0, 1];
const DEFAULT_LIGHT: FloydSteinbergColor = [1, 1, 1, 1];
let cssColorContext: CanvasRenderingContext2D | undefined;

export type BlueNoiseFluidQuantity = "velocity" | "temperature";

export interface BlueNoiseFluidProps
  extends Omit<
    FloydSteinbergProps,
    "alphaBackground" | "crossOrigin" | "fit" | "randomness" | "src" | "threshold"
  > {
  /** Width and height of the square blue-noise tile in dither cells. Defaults to 64. */
  patternSize?: number;
  /** Maximum fluid-grid dimension. Defaults to 192; clamped to 32–384. */
  simulationSize?: number;
  /** Pointer injection radius in normalized canvas units. Defaults to 0.05. */
  interactionRadius?: number;
  /**
   * Fluid quantity used for brightness and pointer interaction. Velocity mode
   * stirs the flow; temperature mode injects heat. Defaults to "velocity".
   */
  quantity?: BlueNoiseFluidQuantity;
  /**
   * Contrast applied to the selected quantity's luminance before dithering.
   * Values above 1 grow the colored (light) areas; values below 1 shrink
   * them toward noise. Defaults to 1; clamped to 0.25–8.
   */
  contrast?: number;
}

interface Pipelines {
  initialize: GPUComputePipeline;
  clearScalar: GPUComputePipeline;
  resample: GPUComputePipeline;
  advect: GPUComputePipeline;
  divergence: GPUComputePipeline;
  solvePressure: GPUComputePipeline;
  project: GPUComputePipeline;
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
  simulationParameters: GPUBuffer;
  displayParameters: GPUBuffer;
  pattern: GPUBuffer;
  state: GPUTexture;
  advectedState: GPUTexture;
  divergence: GPUTexture;
  pressureA: GPUTexture;
  pressureB: GPUTexture;
  sampler: GPUSampler;
}

interface PointerState {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  lastEventTime: number;
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
        createCheckedModule(device, "Fluid simulation WGSL", fluidSimulationShader),
        createCheckedModule(device, "Blue-noise fluid WGSL", blueNoiseFluidShader),
      ]);
      const computeLayout = device.createBindGroupLayout({
        label: "Fluid simulation bindings",
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: "filtering" } },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: "write-only", format: "rgba16float" },
          },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        ],
      });
      const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
      return {
        initialize: device.createComputePipeline({
          label: "Initialize fluid",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "initialize" },
        }),
        clearScalar: device.createComputePipeline({
          label: "Clear fluid scalar field",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "clearScalar" },
        }),
        resample: device.createComputePipeline({
          label: "Resample fluid state",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "resample" },
        }),
        advect: device.createComputePipeline({
          label: "Advect fluid",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "advect" },
        }),
        divergence: device.createComputePipeline({
          label: "Measure fluid divergence",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "divergence" },
        }),
        solvePressure: device.createComputePipeline({
          label: "Solve fluid pressure",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "solvePressure" },
        }),
        project: device.createComputePipeline({
          label: "Project fluid velocity",
          layout: computePipelineLayout,
          compute: { module: simulationModule, entryPoint: "project" },
        }),
        computeLayout,
        display: device.createRenderPipeline({
          label: "Blue-noise fluid display",
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
  resources?.simulationParameters.destroy();
  resources?.displayParameters.destroy();
  resources?.pattern.destroy();
  resources?.state.destroy();
  resources?.advectedState.destroy();
  resources?.divergence.destroy();
  resources?.pressureA.destroy();
  resources?.pressureB.destroy();
}

export function BlueNoiseFluid(
  {
    width,
    height,
    pixelScale = 2,
    patternSize = 64,
    simulationSize = 192,
    interactionRadius = 0.05,
    quantity = "velocity",
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
    "aria-label": ariaLabel = "Interactive blue-noise fluid simulation",
    ...canvasProps
  }: BlueNoiseFluidProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<PointerState>({
    x: 0.5,
    y: 0.5,
    velocityX: 0,
    velocityY: 0,
    lastEventTime: 0,
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
  const propsRef = useRef<Required<Pick<BlueNoiseFluidProps, "pixelScale" | "patternSize" | "simulationSize" | "interactionRadius" | "quantity" | "contrast" | "invert" | "seed" | "powerPreference">> & {
    darkDependency: string;
    lightDependency: string;
    dark: FloydSteinbergColor;
    light: FloydSteinbergColor;
  }>({
    pixelScale,
    patternSize,
    simulationSize,
    interactionRadius,
    quantity,
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
    interactionRadius,
    quantity,
    contrast,
    invert,
    darkDependency,
    lightDependency,
    seed,
    powerPreference,
    dark,
    light,
  };
  const colorCacheRef = useRef<{
    key: string;
    dark: readonly [number, number, number, number];
    light: readonly [number, number, number, number];
  } | undefined>(undefined);
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

    const setInitialPointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerRef.current.x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1, 0.5);
      pointerRef.current.y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1, 0.5);
      pointerRef.current.velocityX = 0;
      pointerRef.current.velocityY = 0;
      pointerRef.current.lastEventTime = event.timeStamp;
    };
    const movePointer = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      const x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1, 0.5);
      const y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1, 0.5);
      const pointer = pointerRef.current;
      const deltaTime = Math.max(1 / 240, (event.timeStamp - pointer.lastEventTime) / 1000);
      pointer.velocityX = clamp((x - pointer.x) / deltaTime, -3, 3, 0);
      pointer.velocityY = clamp((y - pointer.y) / deltaTime, -3, 3, 0);
      pointer.x = x;
      pointer.y = y;
      pointer.lastEventTime = event.timeStamp;
      pointer.lastMoveTime = performance.now();
    };
    const leavePointer = () => {
      pointerRef.current.lastMoveTime = Number.NEGATIVE_INFINITY;
    };
    const capturePointer = (event: PointerEvent) => {
      setInitialPointer(event);
      pointerRef.current.lastMoveTime = performance.now();
      canvas.setPointerCapture(event.pointerId);
    };

    canvas.addEventListener("pointerenter", setInitialPointer);
    canvas.addEventListener("pointermove", movePointer);
    canvas.addEventListener("pointerleave", leavePointer);
    canvas.addEventListener("pointerdown", capturePointer);
    return () => {
      canvas.removeEventListener("pointerenter", setInitialPointer);
      canvas.removeEventListener("pointermove", movePointer);
      canvas.removeEventListener("pointerleave", leavePointer);
      canvas.removeEventListener("pointerdown", capturePointer);
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
      const resolvedSimulationSize = Math.round(clamp(props.simulationSize, 32, 384, 192));
      let resolvedPatternSize = Math.round(clamp(props.patternSize, 8, 128, 64));
      const initialSize = sizeRef.current ?? {
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.clientWidth || intrinsicRef.current.width,
        cssHeight: canvas.clientHeight || intrinsicRef.current.height,
        devicePixelRatio: window.devicePixelRatio || 1,
      };
      const aspect = initialSize.cssWidth / initialSize.cssHeight;
      let simulationWidth = aspect >= 1 ? resolvedSimulationSize : Math.max(16, Math.round(resolvedSimulationSize * aspect));
      let simulationHeight = aspect >= 1 ? Math.max(16, Math.round(resolvedSimulationSize / aspect)) : resolvedSimulationSize;
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

      const simulationParameters = device.createBuffer({
        label: "Fluid simulation parameters",
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const displayParameters = device.createBuffer({
        label: "Blue-noise fluid display parameters",
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const patternBuffer = device.createBuffer({
        label: "Tileable blue-noise ranks",
        size: 128 * 128 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const textureDescriptor: GPUTextureDescriptor = {
        size: [simulationWidth, simulationHeight],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      };
      let state = device.createTexture({ ...textureDescriptor, label: "Fluid state" });
      let advectedState = device.createTexture({ ...textureDescriptor, label: "Advected fluid state" });
      let divergence = device.createTexture({ ...textureDescriptor, label: "Fluid divergence" });
      let pressureA = device.createTexture({ ...textureDescriptor, label: "Fluid pressure A" });
      let pressureB = device.createTexture({ ...textureDescriptor, label: "Fluid pressure B" });
      const sampler = device.createSampler({
        label: "Fluid linear sampler",
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });
      resources = {
        simulationParameters,
        displayParameters,
        pattern: patternBuffer,
        state,
        advectedState,
        divergence,
        pressureA,
        pressureB,
        sampler,
      };
      device.queue.writeBuffer(patternBuffer, 0, pattern);

      const simulationData = new ArrayBuffer(48);
      const simulationView = new DataView(simulationData);
      simulationView.setUint32(0, simulationWidth, true);
      simulationView.setUint32(4, simulationHeight, true);
      simulationView.setUint32(12, props.seed >>> 0, true);
      simulationView.setFloat32(36, clamp(props.interactionRadius, 0.01, 0.3, 0.05), true);
      simulationView.setUint32(44, props.quantity === "temperature" ? 1 : 0, true);
      device.queue.writeBuffer(simulationParameters, 0, simulationData);

      const displayData = new ArrayBuffer(64);
      const displayView = new DataView(displayData);
      const initialScale = Math.max(1, Math.round(props.pixelScale));
      displayView.setUint32(0, logicalWidth, true);
      displayView.setUint32(4, logicalHeight, true);
      displayView.setFloat32(8, (initialScale * initialSize.width) / initialSize.cssWidth, true);
      displayView.setFloat32(12, (initialScale * initialSize.height) / initialSize.cssHeight, true);
      displayView.setUint32(16, resolvedPatternSize, true);
      displayView.setUint32(20, props.quantity === "temperature" ? 1 : 0, true);
      displayView.setUint32(24, props.invert ? 1 : 0, true);
      displayView.setFloat32(28, clamp(props.contrast, 0.25, 8, 1), true);
      let colorCache = { key: `${props.darkDependency}|${props.lightDependency}`, dark: normalizedColor(props.dark), light: normalizedColor(props.light) };
      const colors = new Float32Array(displayData, 32, 8);
      colors.set(colorCache.dark, 0);
      colors.set(colorCache.light, 4);
      device.queue.writeBuffer(displayParameters, 0, displayData);

      let stateView = state.createView();
      let advectedView = advectedState.createView();
      let divergenceView = divergence.createView();
      let pressureAView = pressureA.createView();
      let pressureBView = pressureB.createView();
      const createComputeBindGroup = (
        label: string,
        primary: GPUTextureView,
        output: GPUTextureView,
        secondary: GPUTextureView,
      ) =>
        device.createBindGroup({
          label,
          layout: pipelines.computeLayout,
          entries: [
            { binding: 0, resource: { buffer: simulationParameters } },
            { binding: 1, resource: primary },
            { binding: 2, resource: sampler },
            { binding: 3, resource: output },
            { binding: 4, resource: secondary },
          ],
        });

      const initializeBindGroup = createComputeBindGroup(
        "Initialize fluid state",
        advectedView,
        stateView,
        divergenceView,
      );
      const clearPressureABindGroup = createComputeBindGroup(
        "Clear fluid pressure A",
        stateView,
        pressureAView,
        divergenceView,
      );
      const clearPressureBBindGroup = createComputeBindGroup(
        "Clear fluid pressure B",
        stateView,
        pressureBView,
        divergenceView,
      );
      let advectBindGroup = createComputeBindGroup(
        "Advect fluid state",
        stateView,
        advectedView,
        divergenceView,
      );
      let divergenceBindGroup = createComputeBindGroup(
        "Measure fluid divergence",
        advectedView,
        divergenceView,
        pressureAView,
      );
      let pressureBindGroups = [
        createComputeBindGroup("Solve pressure A to B", pressureAView, pressureBView, divergenceView),
        createComputeBindGroup("Solve pressure B to A", pressureBView, pressureAView, divergenceView),
      ];
      const finalPressureView = PRESSURE_ITERATIONS % 2 === 0 ? pressureAView : pressureBView;
      let projectBindGroup = createComputeBindGroup(
        "Project fluid velocity",
        advectedView,
        stateView,
        finalPressureView,
      );
      let displayBindGroup = device.createBindGroup({
        label: "Blue-noise fluid display",
        layout: pipelines.display.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: displayParameters } },
          { binding: 1, resource: { buffer: patternBuffer } },
          { binding: 2, resource: stateView },
          { binding: 3, resource: sampler },
        ],
      });

      const initializeEncoder = device.createCommandEncoder({ label: "Initialize fluid" });
      const initializePass = initializeEncoder.beginComputePass();
      initializePass.setPipeline(pipelines.initialize);
      initializePass.setBindGroup(0, initializeBindGroup);
      initializePass.dispatchWorkgroups(Math.ceil(simulationWidth / 8), Math.ceil(simulationHeight / 8));
      initializePass.setPipeline(pipelines.clearScalar);
      initializePass.setBindGroup(0, clearPressureABindGroup);
      initializePass.dispatchWorkgroups(Math.ceil(simulationWidth / 8), Math.ceil(simulationHeight / 8));
      initializePass.setBindGroup(0, clearPressureBBindGroup);
      initializePass.dispatchWorkgroups(Math.ceil(simulationWidth / 8), Math.ceil(simulationHeight / 8));
      initializePass.end();
      device.queue.submit([initializeEncoder.finish()]);

      const startTime = performance.now();
      let previousFrameTime = startTime - FRAME_INTERVAL;
      let previousSimulationTime = startTime;
      let readyPending = false;

      const rebuildSimulation = (nextWidth: number, nextHeight: number) => {
        const nextDescriptor: GPUTextureDescriptor = {
          size: [nextWidth, nextHeight],
          format: "rgba16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        };
        const nextState = device.createTexture({ ...nextDescriptor, label: "Fluid state" });
        const nextAdvectedState = device.createTexture({ ...nextDescriptor, label: "Advected fluid state" });
        const nextDivergence = device.createTexture({ ...nextDescriptor, label: "Fluid divergence" });
        const nextPressureA = device.createTexture({ ...nextDescriptor, label: "Fluid pressure A" });
        const nextPressureB = device.createTexture({ ...nextDescriptor, label: "Fluid pressure B" });
        const nextStateView = nextState.createView();
        const nextAdvectedView = nextAdvectedState.createView();
        const nextDivergenceView = nextDivergence.createView();
        const nextPressureAView = nextPressureA.createView();
        const nextPressureBView = nextPressureB.createView();

        simulationView.setUint32(0, nextWidth, true);
        simulationView.setUint32(4, nextHeight, true);
        device.queue.writeBuffer(simulationParameters, 0, simulationData);

        const resampleBindGroup = createComputeBindGroup(
          "Resample fluid state",
          stateView,
          nextStateView,
          stateView,
        );
        const resampleEncoder = device.createCommandEncoder({ label: "Resample fluid state" });
        const resamplePass = resampleEncoder.beginComputePass();
        resamplePass.setPipeline(pipelines.resample);
        resamplePass.setBindGroup(0, resampleBindGroup);
        resamplePass.dispatchWorkgroups(Math.ceil(nextWidth / 8), Math.ceil(nextHeight / 8));
        resamplePass.end();
        device.queue.submit([resampleEncoder.finish()]);

        state.destroy();
        advectedState.destroy();
        divergence.destroy();
        pressureA.destroy();
        pressureB.destroy();

        state = nextState;
        advectedState = nextAdvectedState;
        divergence = nextDivergence;
        pressureA = nextPressureA;
        pressureB = nextPressureB;
        if (resources) {
          resources.state = nextState;
          resources.advectedState = nextAdvectedState;
          resources.divergence = nextDivergence;
          resources.pressureA = nextPressureA;
          resources.pressureB = nextPressureB;
        }

        stateView = nextStateView;
        advectedView = nextAdvectedView;
        divergenceView = nextDivergenceView;
        pressureAView = nextPressureAView;
        pressureBView = nextPressureBView;
        simulationWidth = nextWidth;
        simulationHeight = nextHeight;
        advectBindGroup = createComputeBindGroup("Advect fluid state", stateView, advectedView, divergenceView);
        divergenceBindGroup = createComputeBindGroup("Measure fluid divergence", advectedView, divergenceView, pressureAView);
        pressureBindGroups = [
          createComputeBindGroup("Solve pressure A to B", pressureAView, pressureBView, divergenceView),
          createComputeBindGroup("Solve pressure B to A", pressureBView, pressureAView, divergenceView),
        ];
        projectBindGroup = createComputeBindGroup(
          "Project fluid velocity",
          advectedView,
          stateView,
          PRESSURE_ITERATIONS % 2 === 0 ? pressureAView : pressureBView,
        );
        displayBindGroup = device.createBindGroup({
          label: "Blue-noise fluid display",
          layout: pipelines.display.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: displayParameters } },
            { binding: 1, resource: { buffer: patternBuffer } },
            { binding: 2, resource: stateView },
            { binding: 3, resource: sampler },
          ],
        });
      };

      const drawFrame = (timestamp: number) => {
        if (cancelled) return;
        const elapsed = timestamp - previousFrameTime;
        if (elapsed < FRAME_INTERVAL) {
          animationFrame = requestAnimationFrame(drawFrame);
          return;
        }
        previousFrameTime = timestamp - (elapsed % FRAME_INTERVAL);

        try {
          const props = propsRef.current;
          const size = sizeRef.current;
          if (size && size.cssWidth > 0 && size.cssHeight > 0) {
            const nextAspect = size.cssWidth / size.cssHeight;
            const nextWidth = nextAspect >= 1 ? resolvedSimulationSize : Math.max(16, Math.round(resolvedSimulationSize * nextAspect));
            const nextHeight = nextAspect >= 1 ? Math.max(16, Math.round(resolvedSimulationSize / nextAspect)) : resolvedSimulationSize;
            if (nextWidth !== simulationWidth || nextHeight !== simulationHeight) {
              rebuildSimulation(nextWidth, nextHeight);
            }
          }
          const nextPatternSize = Math.round(clamp(props.patternSize, 8, 128, 64));
          if (nextPatternSize !== resolvedPatternSize) {
            resolvedPatternSize = nextPatternSize;
            device.queue.writeBuffer(patternBuffer, 0, generateBlueNoisePattern(nextPatternSize, props.seed));
          }

          const deltaTime =
            clamp((timestamp - previousSimulationTime) / 1000, 1 / 240, 1 / 30, 1 / 60) * SIMULATION_SPEED;
          previousSimulationTime = timestamp;
          const pointer = pointerRef.current;
          const pointerActive = performance.now() - pointer.lastMoveTime < 120;
          simulationView.setFloat32(8, deltaTime, true);
          simulationView.setFloat32(16, pointer.x, true);
          simulationView.setFloat32(20, pointer.y, true);
          simulationView.setFloat32(24, pointer.velocityX, true);
          simulationView.setFloat32(28, pointer.velocityY, true);
          simulationView.setFloat32(32, pointerActive ? 1 : 0, true);
          simulationView.setFloat32(36, clamp(props.interactionRadius, 0.01, 0.3, 0.05), true);
          simulationView.setFloat32(40, (timestamp - startTime) / 1000, true);
          simulationView.setUint32(44, props.quantity === "temperature" ? 1 : 0, true);
          device.queue.writeBuffer(simulationParameters, 0, simulationData);
          pointer.velocityX *= 0.72;
          pointer.velocityY *= 0.72;

          if (size) {
            const resolvedScale = Math.max(1, Math.round(props.pixelScale));
            logicalWidth = Math.ceil(size.cssWidth / resolvedScale);
            logicalHeight = Math.ceil(size.cssHeight / resolvedScale);
            displayView.setFloat32(8, (resolvedScale * size.width) / size.cssWidth, true);
            displayView.setFloat32(12, (resolvedScale * size.height) / size.cssHeight, true);
          }
          displayView.setUint32(0, logicalWidth, true);
          displayView.setUint32(4, logicalHeight, true);
          displayView.setUint32(16, resolvedPatternSize, true);
          displayView.setUint32(20, props.quantity === "temperature" ? 1 : 0, true);
          displayView.setUint32(24, props.invert ? 1 : 0, true);
          displayView.setFloat32(28, clamp(props.contrast, 0.25, 8, 1), true);
          const colorKey = `${props.darkDependency}|${props.lightDependency}`;
          if (colorCache.key !== colorKey) {
            colorCache = { key: colorKey, dark: normalizedColor(props.dark), light: normalizedColor(props.light) };
          }
          const colors = new Float32Array(displayData, 32, 8);
          colors.set(colorCache.dark, 0);
          colors.set(colorCache.light, 4);
          device.queue.writeBuffer(displayParameters, 0, displayData);

          const encoder = device.createCommandEncoder({ label: "Fluid simulation frame" });
          const dispatchCompute = (
            label: string,
            pipeline: GPUComputePipeline,
            bindGroup: GPUBindGroup,
          ) => {
            const pass = encoder.beginComputePass({ label });
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(Math.ceil(simulationWidth / 8), Math.ceil(simulationHeight / 8));
            pass.end();
          };

          dispatchCompute("Advect and heat fluid", pipelines.advect, advectBindGroup);
          dispatchCompute("Measure fluid divergence", pipelines.divergence, divergenceBindGroup);
          for (let iteration = 0; iteration < PRESSURE_ITERATIONS; iteration += 1) {
            dispatchCompute(
              `Solve fluid pressure ${iteration + 1}`,
              pipelines.solvePressure,
              pressureBindGroups[iteration % 2],
            );
          }
          dispatchCompute("Project fluid velocity", pipelines.project, projectBindGroup);

          const renderPass = encoder.beginRenderPass({
            label: "Blue-noise fluid display pass",
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
          renderPass.setBindGroup(0, displayBindGroup);
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
  }, [simulationSize, seed, powerPreference]);

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
