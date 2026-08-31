import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CanvasHTMLAttributes,
  type ForwardedRef,
} from "react";
import { displayShader, floydSteinbergShader } from "./shaders";

const BAND_ROWS = 256;
const DEFAULT_DARK: FloydSteinbergColor = [0, 0, 0, 1];
const DEFAULT_LIGHT: FloydSteinbergColor = [1, 1, 1, 1];

export type FloydSteinbergColor = readonly [number, number, number] | readonly [number, number, number, number];
export type FloydSteinbergFit = "stretch" | "cover" | "contain";
export type FloydSteinbergSource = string | Blob | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

export interface FloydSteinbergRenderInfo {
  canvas: HTMLCanvasElement;
  device: GPUDevice;
  /** Canvas backing-buffer width in device pixels. */
  width: number;
  /** Canvas backing-buffer height in device pixels. */
  height: number;
  /** Rendered canvas content width in CSS pixels. */
  cssWidth: number;
  /** Rendered canvas content height in CSS pixels. */
  cssHeight: number;
  /** Device-pixel ratio used for the backing buffer. */
  devicePixelRatio: number;
  logicalWidth: number;
  logicalHeight: number;
}

export interface FloydSteinbergProps
  extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, "children" | "height" | "onError" | "width"> {
  /** A URL, Blob/File, ImageBitmap, image element, or canvas containing the source image. */
  src: FloydSteinbergSource;
  /** Intrinsic canvas width in CSS pixels. Defaults to the source width. CSS may override it. */
  width?: number;
  /** Intrinsic canvas height in CSS pixels. Defaults to the source height. CSS may override it. */
  height?: number;
  /** Size of each dither cell in CSS pixels. */
  pixelScale?: number;
  /** Perturbs paired diffusion coefficients without changing their total. 0 is classic Floyd–Steinberg. */
  randomness?: number;
  /** Binary quantization threshold from 0 to 1. */
  threshold?: number;
  /** How the source image maps into an explicitly sized output. */
  fit?: FloydSteinbergFit;
  /** Inverts source luminance before dithering. */
  invert?: boolean;
  /** Deterministic seed used by stochastic coefficient perturbation. */
  seed?: number;
  /** Luminance behind transparent source pixels, from 0 to 1. */
  alphaBackground?: number;
  /** RGBA values in the 0–1 range for dark output pixels. */
  dark?: FloydSteinbergColor;
  /** RGBA values in the 0–1 range for light output pixels. */
  light?: FloydSteinbergColor;
  /** Cross-origin mode used when src is a URL. */
  crossOrigin?: "" | "anonymous" | "use-credentials";
  /** Adapter power preference. */
  powerPreference?: GPUPowerPreference;
  /** Called once the submitted GPU work has completed. */
  onReady?: (info: FloydSteinbergRenderInfo) => void;
  /** Called when image loading, WebGPU setup, shader compilation, or rendering fails. */
  onError?: (error: Error) => void;
}

interface LoadedSource {
  source: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  dispose?: () => void;
}

interface Pipelines {
  compute: GPUComputePipeline;
  computeLayout: GPUBindGroupLayout;
  display: GPURenderPipeline;
}

interface RenderResources {
  output: GPUBuffer;
  errors: GPUBuffer;
  computeParameters: GPUBuffer;
  displayParameters: GPUBuffer;
  bandParameters: GPUBuffer;
  sourceTexture: GPUTexture;
}

interface RenderSize {
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
}

let sharedDevicePromise: Promise<GPUDevice> | undefined;
const pipelineCache = new WeakMap<GPUDevice, Map<GPUTextureFormat, Promise<Pipelines>>>();

export function isWebGpuSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

async function getSharedDevice(powerPreference: GPUPowerPreference): Promise<GPUDevice> {
  if (!isWebGpuSupported()) {
    throw new Error("WebGPU is not available in this browser.");
  }

  if (!sharedDevicePromise) {
    sharedDevicePromise = navigator.gpu.requestAdapter({ powerPreference }).then(async (adapter) => {
      if (!adapter) throw new Error("No compatible WebGPU adapter was found.");
      const device = await adapter.requestDevice();
      device.lost.then(() => {
        sharedDevicePromise = undefined;
      });
      return device;
    });
  }

  return sharedDevicePromise;
}

async function createCheckedModule(device: GPUDevice, label: string, code: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((message) => message.type === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((error) => `${label}: ${error.message}`).join("\n"));
  }
  return module;
}

function getPipelines(device: GPUDevice, format: GPUTextureFormat): Promise<Pipelines> {
  let formats = pipelineCache.get(device);
  if (!formats) {
    formats = new Map();
    pipelineCache.set(device, formats);
  }

  let pending = formats.get(format);
  if (!pending) {
    pending = (async () => {
      const [computeModule, displayModule] = await Promise.all([
        createCheckedModule(device, "Stochastic Floyd–Steinberg WGSL", floydSteinbergShader),
        createCheckedModule(device, "Floyd–Steinberg display WGSL", displayShader),
      ]);
      const computeLayout = device.createBindGroupLayout({
        label: "Floyd–Steinberg bindings",
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
          { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
          { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
          {
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 16 },
          },
          { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        ],
      });
      const compute = device.createComputePipeline({
        label: "Stochastic Floyd–Steinberg wavefront",
        layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
        compute: { module: computeModule, entryPoint: "main" },
      });
      const display = device.createRenderPipeline({
        label: "Floyd–Steinberg display",
        layout: "auto",
        vertex: { module: displayModule, entryPoint: "vertexMain" },
        fragment: { module: displayModule, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      return { compute, computeLayout, display };
    })();
    formats.set(format, pending);
  }
  return pending;
}

function sourceDimensions(source: LoadedSource["source"]): { width: number; height: number } {
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

async function loadSource(
  src: FloydSteinbergSource,
  crossOrigin: FloydSteinbergProps["crossOrigin"],
): Promise<LoadedSource> {
  if (typeof src === "string") {
    const image = new Image();
    image.crossOrigin = crossOrigin ?? "anonymous";
    image.decoding = "async";
    image.src = src;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  }

  if (src instanceof Blob) {
    const bitmap = await createImageBitmap(src);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, dispose: () => bitmap.close() };
  }

  if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement && !src.complete) {
    await src.decode();
  }
  const { width, height } = sourceDimensions(src);
  return { source: src, width, height };
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.round(Number.isFinite(value) ? (value as number) : fallback));
}

function resolveOutputSize(sourceWidth: number, sourceHeight: number, width?: number, height?: number) {
  if (width !== undefined && height !== undefined) {
    return { width: positiveInteger(width, sourceWidth), height: positiveInteger(height, sourceHeight) };
  }
  if (width !== undefined) {
    const resolvedWidth = positiveInteger(width, sourceWidth);
    return { width: resolvedWidth, height: positiveInteger((resolvedWidth * sourceHeight) / sourceWidth, sourceHeight) };
  }
  if (height !== undefined) {
    const resolvedHeight = positiveInteger(height, sourceHeight);
    return { width: positiveInteger((resolvedHeight * sourceWidth) / sourceHeight, sourceWidth), height: resolvedHeight };
  }
  return { width: positiveInteger(sourceWidth, 1), height: positiveInteger(sourceHeight, 1) };
}

function normalizedColor(color: FloydSteinbergColor): [number, number, number, number] {
  return [
    clamp(color[0], 0, 1, 0),
    clamp(color[1], 0, 1, 0),
    clamp(color[2], 0, 1, 0),
    clamp(color[3] ?? 1, 0, 1, 1),
  ];
}

function destroyResources(resources: RenderResources | undefined) {
  if (!resources) return;
  resources.output.destroy();
  resources.errors.destroy();
  resources.computeParameters.destroy();
  resources.displayParameters.destroy();
  resources.bandParameters.destroy();
  resources.sourceTexture.destroy();
}

function writeComputeParameters(
  device: GPUDevice,
  buffer: GPUBuffer,
  values: {
    logicalWidth: number;
    logicalHeight: number;
    sourceWidth: number;
    sourceHeight: number;
    fit: FloydSteinbergFit;
    invert: boolean;
    threshold: number;
    randomness: number;
    seed: number;
    alphaBackground: number;
  },
) {
  const data = new ArrayBuffer(48);
  const view = new DataView(data);
  view.setUint32(0, values.logicalWidth, true);
  view.setUint32(4, values.logicalHeight, true);
  view.setUint32(8, values.sourceWidth, true);
  view.setUint32(12, values.sourceHeight, true);
  view.setUint32(16, { stretch: 0, cover: 1, contain: 2 }[values.fit], true);
  view.setUint32(20, values.invert ? 1 : 0, true);
  view.setFloat32(24, values.threshold, true);
  view.setFloat32(28, values.randomness, true);
  view.setUint32(32, values.seed >>> 0, true);
  view.setFloat32(36, values.alphaBackground, true);
  device.queue.writeBuffer(buffer, 0, data);
}

function writeDisplayParameters(
  device: GPUDevice,
  buffer: GPUBuffer,
  logicalWidth: number,
  logicalHeight: number,
  cellWidth: number,
  cellHeight: number,
  dark: FloydSteinbergColor,
  light: FloydSteinbergColor,
) {
  const data = new ArrayBuffer(48);
  const view = new DataView(data);
  view.setUint32(0, logicalWidth, true);
  view.setUint32(4, logicalHeight, true);
  view.setFloat32(8, cellWidth, true);
  view.setFloat32(12, cellHeight, true);
  const colors = new Float32Array(data, 16, 8);
  colors.set(normalizedColor(dark), 0);
  colors.set(normalizedColor(light), 4);
  device.queue.writeBuffer(buffer, 0, data);
}

function setForwardedRef(ref: ForwardedRef<HTMLCanvasElement>, node: HTMLCanvasElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const FloydSteinberg = forwardRef<HTMLCanvasElement, FloydSteinbergProps>(function FloydSteinberg(
  {
    src,
    width,
    height,
    pixelScale = 1,
    randomness = 0.35,
    threshold = 0.5,
    fit = "contain",
    invert = false,
    seed = 0x5eed1234,
    alphaBackground = 1,
    dark = DEFAULT_DARK,
    light = DEFAULT_LIGHT,
    crossOrigin = "anonymous",
    powerPreference = "high-performance",
    onReady,
    onError,
    "aria-label": ariaLabel = "Floyd–Steinberg dithered image",
    ...canvasProps
  },
  forwardedRef,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  const [loadedSource, setLoadedSource] = useState<LoadedSource>();
  const [renderSize, setRenderSize] = useState<RenderSize>();
  onReadyRef.current = onReady;
  onErrorRef.current = onError;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const assignRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      setForwardedRef(forwardedRef, node);
    },
    [forwardedRef],
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setLoadedSource(undefined);
    setRenderSize(undefined);

    loadSource(src, crossOrigin)
      .then((source) => {
        if (cancelled) {
          source.dispose?.();
          return;
        }
        if (source.width < 1 || source.height < 1) {
          source.dispose?.();
          throw new Error("The source image has no drawable pixels.");
        }
        setLoadedSource(source);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        setStatus("error");
        onErrorRef.current?.(error);
      });

    return () => {
      cancelled = true;
    };
  }, [src, crossOrigin]);

  const intrinsicSize = loadedSource
    ? resolveOutputSize(loadedSource.width, loadedSource.height, width, height)
    : { width: positiveInteger(width, 300), height: positiveInteger(height, 150) };

  useEffect(() => {
    setRenderSize(undefined);
  }, [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loadedSource) return;
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
  }, [loadedSource, intrinsicSize.width, intrinsicSize.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loadedSource || !renderSize) return;
    let cancelled = false;
    let resources: RenderResources | undefined;
    setStatus("loading");

    const render = async () => {
      const resolvedScale = positiveInteger(pixelScale, 1);
      const logicalWidth = Math.ceil(renderSize.cssWidth / resolvedScale);
      const logicalHeight = Math.ceil(renderSize.cssHeight / resolvedScale);
      const cellWidth = (resolvedScale * renderSize.width) / renderSize.cssWidth;
      const cellHeight = (resolvedScale * renderSize.height) / renderSize.cssHeight;

      const device = await getSharedDevice(powerPreference);
      if (cancelled) return;
      const maxDimension = device.limits.maxTextureDimension2D;
      if (
        loadedSource.width > maxDimension ||
        loadedSource.height > maxDimension ||
        renderSize.width > maxDimension ||
        renderSize.height > maxDimension
      ) {
        throw new Error(`The source or output exceeds this device's ${maxDimension}px texture limit.`);
      }
      const storageBytes = Math.max(4, logicalWidth * logicalHeight * 4);
      if (storageBytes > device.limits.maxStorageBufferBindingSize) {
        throw new Error("The requested output exceeds this device's storage-buffer limit. Increase pixelScale.");
      }

      const context = canvas.getContext("webgpu");
      if (!context) throw new Error("The canvas could not create a WebGPU context.");
      const format = navigator.gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: "premultiplied" });
      const pipelines = await getPipelines(device, format);
      if (cancelled) return;

      const outputBuffer = device.createBuffer({
        label: "Floyd–Steinberg output",
        size: storageBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const errorBuffer = device.createBuffer({
        label: "Floyd–Steinberg errors",
        size: storageBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      const computeParameters = device.createBuffer({
        label: "Floyd–Steinberg parameters",
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const displayParameters = device.createBuffer({
        label: "Floyd–Steinberg display parameters",
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const bandCount = Math.ceil(logicalHeight / BAND_ROWS);
      const bandStride = device.limits.minUniformBufferOffsetAlignment;
      const bandData = new ArrayBuffer(bandStride * bandCount);
      const bandView = new DataView(bandData);
      for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
        const firstRow = bandIndex * BAND_ROWS;
        bandView.setUint32(bandIndex * bandStride, firstRow, true);
        bandView.setUint32(bandIndex * bandStride + 4, Math.min(BAND_ROWS, logicalHeight - firstRow), true);
      }
      const bandParameters = device.createBuffer({
        label: "Floyd–Steinberg band parameters",
        size: bandData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const sourceTexture = device.createTexture({
        label: "Floyd–Steinberg source image",
        size: [loadedSource.width, loadedSource.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      resources = {
        output: outputBuffer,
        errors: errorBuffer,
        computeParameters,
        displayParameters,
        bandParameters,
        sourceTexture,
      };

      device.queue.copyExternalImageToTexture(
        { source: loadedSource.source as GPUCopyExternalImageSource },
        { texture: sourceTexture },
        [loadedSource.width, loadedSource.height],
      );
      device.queue.writeBuffer(bandParameters, 0, bandData);
      writeComputeParameters(device, computeParameters, {
        logicalWidth,
        logicalHeight,
        sourceWidth: loadedSource.width,
        sourceHeight: loadedSource.height,
        fit,
        invert,
        threshold: clamp(threshold, 0, 1, 0.5),
        randomness: clamp(randomness, 0, 2, 0.35),
        seed,
        alphaBackground: clamp(alphaBackground, 0, 1, 1),
      });
      writeDisplayParameters(device, displayParameters, logicalWidth, logicalHeight, cellWidth, cellHeight, dark, light);

      const computeBindGroup = device.createBindGroup({
        label: "Floyd–Steinberg compute bind group",
        layout: pipelines.computeLayout,
        entries: [
          { binding: 0, resource: { buffer: computeParameters } },
          { binding: 1, resource: { buffer: outputBuffer } },
          { binding: 2, resource: { buffer: errorBuffer } },
          { binding: 3, resource: { buffer: bandParameters, size: 16 } },
          { binding: 4, resource: sourceTexture.createView() },
        ],
      });
      const displayBindGroup = device.createBindGroup({
        label: "Floyd–Steinberg display bind group",
        layout: pipelines.display.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: displayParameters } },
          { binding: 1, resource: { buffer: outputBuffer } },
        ],
      });

      const encoder = device.createCommandEncoder({ label: "Floyd–Steinberg render" });
      encoder.clearBuffer(errorBuffer);
      for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
        const pass = encoder.beginComputePass({ label: `Floyd–Steinberg band ${bandIndex}` });
        pass.setPipeline(pipelines.compute);
        pass.setBindGroup(0, computeBindGroup, [bandIndex * bandStride]);
        pass.dispatchWorkgroups(1);
        pass.end();
      }
      const renderPass = encoder.beginRenderPass({
        label: "Floyd–Steinberg display pass",
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
      await device.queue.onSubmittedWorkDone();
      if (cancelled) return;

      setStatus("ready");
      onReadyRef.current?.({ canvas, device, ...renderSize, logicalWidth, logicalHeight });
    };

    render().catch((reason: unknown) => {
      if (cancelled) return;
      const error = reason instanceof Error ? reason : new Error(String(reason));
      setStatus("error");
      onErrorRef.current?.(error);
    });

    return () => {
      cancelled = true;
      destroyResources(resources);
    };
  }, [
    loadedSource,
    renderSize,
    pixelScale,
    randomness,
    threshold,
    fit,
    invert,
    seed,
    alphaBackground,
    dark[0],
    dark[1],
    dark[2],
    dark[3],
    light[0],
    light[1],
    light[2],
    light[3],
    powerPreference,
  ]);

  useEffect(
    () => () => {
      loadedSource?.dispose?.();
    },
    [loadedSource],
  );

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
});
