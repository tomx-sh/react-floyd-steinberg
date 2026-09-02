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
import { blueNoiseWaveShader } from "./shaders";
import { createCheckedModule, getSharedDevice } from "./webgpu";

const FRAME_INTERVAL = 1000 / 60;
const DEFAULT_DARK: FloydSteinbergColor = [0, 0, 0, 1];
const DEFAULT_LIGHT: FloydSteinbergColor = [1, 1, 1, 1];
let cssColorContext: CanvasRenderingContext2D | undefined;

export interface BlueNoiseWaveProps
  extends Omit<
    FloydSteinbergProps,
    "alphaBackground" | "crossOrigin" | "fit" | "randomness" | "src" | "threshold"
  > {
  /** Width and height of the square, tileable threshold pattern in dither cells. Defaults to 64; clamped to 8–128. */
  patternSize?: number;
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
}

const pipelineCache = new WeakMap<GPUDevice, Map<GPUTextureFormat, Promise<GPURenderPipeline>>>();

function getPipeline(device: GPUDevice, format: GPUTextureFormat): Promise<GPURenderPipeline> {
  let formats = pipelineCache.get(device);
  if (!formats) {
    formats = new Map();
    pipelineCache.set(device, formats);
  }

  let pending = formats.get(format);
  if (!pending) {
    pending = createCheckedModule(device, "Blue-noise wave WGSL", blueNoiseWaveShader).then((module) =>
      device.createRenderPipeline({
        label: "Blue-noise wave",
        layout: "auto",
        vertex: { module, entryPoint: "vertexMain" },
        fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      }),
    );
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
}

export function BlueNoiseWave(
  {
    width,
    height,
    pixelScale = 2,
    patternSize = 64,
    invert = false,
    seed = 0x5eed1234,
    dark = DEFAULT_DARK,
    light = DEFAULT_LIGHT,
    powerPreference = "high-performance",
    onReady,
    onError,
    ref,
    "aria-label": ariaLabel = "Blue-noise dithered wave",
    ...canvasProps
  }: BlueNoiseWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
      const logicalWidth = Math.ceil(renderSize.cssWidth / resolvedScale);
      const logicalHeight = Math.ceil(renderSize.cssHeight / resolvedScale);
      const cellWidth = (resolvedScale * renderSize.width) / renderSize.cssWidth;
      const cellHeight = (resolvedScale * renderSize.height) / renderSize.cssHeight;
      const pattern = generateBlueNoisePattern(resolvedPatternSize, seed);
      const device = await getSharedDevice(powerPreference);
      if (cancelled) return;

      const maxDimension = device.limits.maxTextureDimension2D;
      if (renderSize.width > maxDimension || renderSize.height > maxDimension) {
        throw new Error(`The output exceeds this device's ${maxDimension}px texture limit.`);
      }
      if (pattern.byteLength > device.limits.maxStorageBufferBindingSize) {
        throw new Error("The blue-noise pattern exceeds this device's storage-buffer limit.");
      }

      const context = canvas.getContext("webgpu");
      if (!context) throw new Error("The canvas could not create a WebGPU context.");
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });
      const pipeline = await getPipeline(device, format);
      if (cancelled) return;

      const parameterBuffer = device.createBuffer({
        label: "Blue-noise wave parameters",
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const patternBuffer = device.createBuffer({
        label: "Tileable blue-noise ranks",
        size: pattern.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      resources = { parameters: parameterBuffer, pattern: patternBuffer };
      device.queue.writeBuffer(patternBuffer, 0, pattern);

      const parameterData = new ArrayBuffer(64);
      const parameterView = new DataView(parameterData);
      parameterView.setUint32(0, logicalWidth, true);
      parameterView.setUint32(4, logicalHeight, true);
      parameterView.setFloat32(8, cellWidth, true);
      parameterView.setFloat32(12, cellHeight, true);
      parameterView.setUint32(16, resolvedPatternSize, true);
      parameterView.setUint32(20, resolvedPatternSize * resolvedPatternSize, true);
      parameterView.setUint32(24, invert ? 1 : 0, true);
      const colors = new Float32Array(parameterData, 32, 8);
      colors.set(normalizedColor(dark), 0);
      colors.set(normalizedColor(light), 4);

      const bindGroup = device.createBindGroup({
        label: "Blue-noise wave bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: parameterBuffer } },
          { binding: 1, resource: { buffer: patternBuffer } },
        ],
      });

      const startTime = performance.now();
      let previousFrameTime = startTime - FRAME_INTERVAL;
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
          parameterView.setFloat32(28, (timestamp - startTime) / 1000, true);
          device.queue.writeBuffer(parameterBuffer, 0, parameterData);

          const encoder = device.createCommandEncoder({ label: "Blue-noise wave" });
          const pass = encoder.beginRenderPass({
            label: "Blue-noise wave pass",
            colorAttachments: [
              {
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: "clear",
                storeOp: "store",
              },
            ],
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(3);
          pass.end();
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
      aria-label={ariaLabel}
      data-webgpu-status={status}
    />
  );
}
