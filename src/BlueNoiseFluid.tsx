import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ForwardedRef,
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
}

interface Pipelines {
  initialize: GPUComputePipeline;
  clearScalar: GPUComputePipeline;
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

function setForwardedRef(ref: ForwardedRef<HTMLCanvasElement>, node: HTMLCanvasElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const BlueNoiseFluid = forwardRef<HTMLCanvasElement, BlueNoiseFluidProps>(function BlueNoiseFluid(
  {
    width,
    height,
    pixelScale = 2,
    patternSize = 64,
    simulationSize = 192,
    interactionRadius = 0.05,
    invert = false,
    seed = 0x5eed1234,
    dark = DEFAULT_DARK,
    light = DEFAULT_LIGHT,
    powerPreference = "high-performance",
    onReady,
    onError,
    style,
    "aria-label": ariaLabel = "Interactive blue-noise fluid simulation",
    ...canvasProps
  },
  forwardedRef,
) {
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

  const assignRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      setForwardedRef(forwardedRef, node);
    },
    [forwardedRef],
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
    if (!canvas || !renderSize) return;
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
      const resolvedScale = positiveInteger(pixelScale, 1);
      const resolvedPatternSize = Math.round(clamp(patternSize, 8, 128, 64));
      const resolvedSimulationSize = Math.round(clamp(simulationSize, 32, 384, 192));
      const logicalWidth = Math.ceil(renderSize.cssWidth / resolvedScale);
      const logicalHeight = Math.ceil(renderSize.cssHeight / resolvedScale);
      const cellWidth = (resolvedScale * renderSize.width) / renderSize.cssWidth;
      const cellHeight = (resolvedScale * renderSize.height) / renderSize.cssHeight;
      const aspect = renderSize.cssWidth / renderSize.cssHeight;
      const simulationWidth = aspect >= 1 ? resolvedSimulationSize : Math.max(16, Math.round(resolvedSimulationSize * aspect));
      const simulationHeight = aspect >= 1 ? Math.max(16, Math.round(resolvedSimulationSize / aspect)) : resolvedSimulationSize;
      const pattern = generateBlueNoisePattern(resolvedPatternSize, seed);
      const device = await getSharedDevice(powerPreference);
      if (cancelled) return;

      const maxDimension = device.limits.maxTextureDimension2D;
      if (
        renderSize.width > maxDimension ||
        renderSize.height > maxDimension ||
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
        size: pattern.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const textureDescriptor: GPUTextureDescriptor = {
        size: [simulationWidth, simulationHeight],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      };
      const state = device.createTexture({ ...textureDescriptor, label: "Fluid state" });
      const advectedState = device.createTexture({ ...textureDescriptor, label: "Advected fluid state" });
      const divergence = device.createTexture({ ...textureDescriptor, label: "Fluid divergence" });
      const pressureA = device.createTexture({ ...textureDescriptor, label: "Fluid pressure A" });
      const pressureB = device.createTexture({ ...textureDescriptor, label: "Fluid pressure B" });
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
      simulationView.setUint32(12, seed >>> 0, true);
      simulationView.setFloat32(36, clamp(interactionRadius, 0.01, 0.3, 0.05), true);
      device.queue.writeBuffer(simulationParameters, 0, simulationData);

      const displayData = new ArrayBuffer(64);
      const displayView = new DataView(displayData);
      displayView.setUint32(0, logicalWidth, true);
      displayView.setUint32(4, logicalHeight, true);
      displayView.setFloat32(8, cellWidth, true);
      displayView.setFloat32(12, cellHeight, true);
      displayView.setUint32(16, resolvedPatternSize, true);
      displayView.setUint32(20, resolvedPatternSize * resolvedPatternSize, true);
      displayView.setUint32(24, invert ? 1 : 0, true);
      const colors = new Float32Array(displayData, 32, 8);
      colors.set(normalizedColor(dark), 0);
      colors.set(normalizedColor(light), 4);
      device.queue.writeBuffer(displayParameters, 0, displayData);

      const stateView = state.createView();
      const advectedView = advectedState.createView();
      const divergenceView = divergence.createView();
      const pressureAView = pressureA.createView();
      const pressureBView = pressureB.createView();
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
      const advectBindGroup = createComputeBindGroup(
        "Advect fluid state",
        stateView,
        advectedView,
        divergenceView,
      );
      const divergenceBindGroup = createComputeBindGroup(
        "Measure fluid divergence",
        advectedView,
        divergenceView,
        pressureAView,
      );
      const pressureBindGroups = [
        createComputeBindGroup("Solve pressure A to B", pressureAView, pressureBView, divergenceView),
        createComputeBindGroup("Solve pressure B to A", pressureBView, pressureAView, divergenceView),
      ];
      const finalPressureView = PRESSURE_ITERATIONS % 2 === 0 ? pressureAView : pressureBView;
      const projectBindGroup = createComputeBindGroup(
        "Project fluid velocity",
        advectedView,
        stateView,
        finalPressureView,
      );
      const displayBindGroup = device.createBindGroup({
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

      const drawFrame = (timestamp: number) => {
        if (cancelled) return;
        const elapsed = timestamp - previousFrameTime;
        if (elapsed < FRAME_INTERVAL) {
          animationFrame = requestAnimationFrame(drawFrame);
          return;
        }
        previousFrameTime = timestamp - (elapsed % FRAME_INTERVAL);

        try {
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
          simulationView.setFloat32(40, (timestamp - startTime) / 1000, true);
          device.queue.writeBuffer(simulationParameters, 0, simulationData);
          pointer.velocityX *= 0.72;
          pointer.velocityY *= 0.72;

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
                ...renderSize,
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
  }, [
    renderSize,
    pixelScale,
    patternSize,
    simulationSize,
    interactionRadius,
    invert,
    seed,
    darkDependency,
    lightDependency,
    powerPreference,
  ]);

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
});
