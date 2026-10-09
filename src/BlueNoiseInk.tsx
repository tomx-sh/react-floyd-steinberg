import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { generateBlueNoisePattern } from "./blueNoise";
import { clamp, colorDependency, normalizedColor, positiveInteger } from "./canvasUtils";
import type { BlueNoiseFluidProps } from "./BlueNoiseFluid";
import type { FloydSteinbergRenderInfo } from "./FloydSteinberg";
import { installStirInput } from "./inkPointer";
import { createInkSimulation, getInkPipelines } from "./inkSimulation";
import { getSharedDevice } from "./webgpu";

export interface BlueNoiseInkProps extends Omit<BlueNoiseFluidProps, "quantity" | "viscosity"> {
  /** Longest velocity-grid dimension. Defaults to 128; clamped to 32–384.
   * The grid is 16:9, as in the reference, with dye at four times its resolution. */
  simulationSize?: number;
  /** Pointer splat radius in normalized canvas-height units. Defaults to sqrt(0.002). */
  interactionRadius?: number;
  /** Contrast before dithering. Defaults to 1.75; clamped to 0.25–8. */
  contrast?: number;
  /** Simulated time per real-time second. Defaults to 0.6; clamped to 0–2.
   * 0 pauses the fluid while rendering continues; 0.5 gives half-speed motion. */
  simulationSpeed?: number;
  /** Velocity diffusion strength. Defaults to 20; clamped to 0–20.
   * Higher values smooth neighboring velocities and suppress fine turbulence. */
  viscosity?: number;
}

interface CanvasSize {
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
}

/** The vgpu fluid simulation with scalar ink and a fixed blue-noise threshold tile. */
export function BlueNoiseInk({
  width,
  height,
  pixelScale = 2,
  patternSize = 64,
  simulationSize = 128,
  simulationSpeed = 0.6,
  viscosity = 20,
  interactionRadius = Math.sqrt(0.002),
  contrast = 1.75,
  invert = false,
  seed = 0x5eed1234,
  dark = "black",
  light = "white",
  powerPreference = "high-performance",
  onReady,
  onError,
  ref,
  style,
  "aria-label": ariaLabel = "Interactive blue-noise ink simulation",
  ...canvasProps
}: BlueNoiseInkProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<CanvasSize | undefined>(undefined);
  const [renderSize, setRenderSize] = useState<CanvasSize>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const intrinsicWidth = positiveInteger(width, height === undefined ? 960 : positiveInteger(height, 540) * 16 / 9);
  const intrinsicHeight = positiveInteger(height, intrinsicWidth * 9 / 16);
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  const propsRef = useRef({ pixelScale, patternSize, interactionRadius, simulationSpeed, viscosity, contrast, invert, seed, dark, light });
  propsRef.current = { pixelScale, patternSize, interactionRadius, simulationSpeed, viscosity, contrast, invert, seed, dark, light };
  const assignRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cssWidth = 0;
    let cssHeight = 0;
    let resolutionQuery: MediaQueryList | undefined;
    const update = () => {
      if (cssWidth <= 0 || cssHeight <= 0) return;
      const devicePixelRatio = Math.max(0.01, window.devicePixelRatio || 1);
      const next = {
        width: Math.max(1, Math.round(cssWidth * devicePixelRatio)),
        height: Math.max(1, Math.round(cssHeight * devicePixelRatio)),
        cssWidth, cssHeight, devicePixelRatio,
      };
      sizeRef.current = next;
      setRenderSize(current => current && Object.keys(next).every(key =>
        current[key as keyof CanvasSize] === next[key as keyof CanvasSize]) ? current : next);
    };
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      cssWidth = Math.round(entry.contentRect.width * 64) / 64;
      cssHeight = Math.round(entry.contentRect.height * 64) / 64;
      update();
    });
    observer.observe(canvas);
    const resolutionChanged = () => {
      update();
      resolutionQuery?.removeEventListener("change", resolutionChanged);
      resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolutionQuery.addEventListener("change", resolutionChanged, { once: true });
    };
    window.addEventListener("resize", resolutionChanged);
    resolutionChanged();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resolutionChanged);
      resolutionQuery?.removeEventListener("change", resolutionChanged);
    };
  }, [intrinsicWidth, intrinsicHeight]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let animationFrame = 0;
    let simulation: ReturnType<typeof createInkSimulation> | undefined;
    let pointer: ReturnType<typeof installStirInput> | undefined;
    let device: GPUDevice | undefined;
    let context: GPUCanvasContext | undefined;
    setStatus("loading");
    const dispose = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      pointer?.dispose();
      simulation?.dispose();
      device?.removeEventListener("uncapturederror", gpuError);
      context?.unconfigure();
    };
    const fail = (reason: unknown) => {
      if (cancelled) return;
      cancelled = true;
      dispose();
      setStatus("error");
      callbacks.current.onError?.(reason instanceof Error ? reason : new Error(String(reason)));
    };
    const gpuError = (event: GPUUncapturedErrorEvent) => fail(new Error(event.error.message));
    const initialize = async () => {
      const nextDevice = await getSharedDevice(powerPreference);
      if (cancelled) return;
      const format = navigator.gpu.getPreferredCanvasFormat();
      const pipelines = await getInkPipelines(nextDevice, format);
      if (cancelled) return;
      device = nextDevice;
      device.addEventListener("uncapturederror", gpuError);
      void device.lost.then(info => fail(new Error(`WebGPU device lost: ${info.message}`)));
      context = canvas.getContext("webgpu") ?? undefined;
      if (!context) throw new Error("The canvas could not create a WebGPU context.");
      context.configure({ device, format, alphaMode: "premultiplied" });
      simulation = createInkSimulation(device, pipelines, simulationSize);
      pointer = installStirInput(canvas);
      const displayData = new ArrayBuffer(64);
      const display = new DataView(displayData);
      const colors = new Float32Array(displayData, 32, 8);
      let colorKey = "";
      let currentPatternSize = 0;
      let previous = performance.now();
      let accumulator = 0;
      let readyPending = false;
      const tick = (now: number) => {
        if (cancelled || !simulation || !pointer || !device || !context) return;
        const elapsed = Math.min((now - previous) / 1000, 1 / 30);
        previous = now;
        if (document.hidden) {
          accumulator = 0;
          animationFrame = requestAnimationFrame(tick);
          return;
        }
        try {
          const props = propsRef.current;
          const size = sizeRef.current ?? {
            width: canvas.width, height: canvas.height,
            cssWidth: canvas.clientWidth || intrinsicWidth,
            cssHeight: canvas.clientHeight || intrinsicHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
          };
          if (size.width > device.limits.maxTextureDimension2D || size.height > device.limits.maxTextureDimension2D) {
            throw new Error(`The canvas exceeds this device's ${device.limits.maxTextureDimension2D}px texture limit.`);
          }
          const scale = positiveInteger(props.pixelScale, 2);
          const logicalWidth = Math.ceil(size.cssWidth / scale);
          const logicalHeight = Math.ceil(size.cssHeight / scale);
          const nextPatternSize = Math.round(clamp(props.patternSize, 8, 128, 64));
          if (nextPatternSize !== currentPatternSize) {
            device.queue.writeBuffer(simulation.pattern, 0, generateBlueNoisePattern(nextPatternSize, props.seed));
            currentPatternSize = nextPatternSize;
          }
          const nextColorKey = `${colorDependency(props.dark)}|${colorDependency(props.light)}`;
          if (nextColorKey !== colorKey) {
            colors.set(normalizedColor(props.dark), 0);
            colors.set(normalizedColor(props.light), 4);
            colorKey = nextColorKey;
          }
          display.setUint32(0, logicalWidth, true);
          display.setUint32(4, logicalHeight, true);
          display.setFloat32(8, scale * size.width / size.cssWidth, true);
          display.setFloat32(12, scale * size.height / size.cssHeight, true);
          display.setUint32(16, currentPatternSize, true);
          display.setUint32(20, props.invert ? 1 : 0, true);
          display.setFloat32(24, clamp(props.contrast, 0.25, 8, 1.75), true);
          device.queue.writeBuffer(simulation.displayParameters, 0, displayData);
          accumulator += elapsed;
          let steps = 0;
          while (accumulator >= 1 / 60 && steps < 2) {
            simulation.step(pointer, props.interactionRadius, props.simulationSpeed, props.viscosity);
            accumulator -= 1 / 60;
            steps++;
          }
          if (steps === 2) accumulator = 0;
          simulation.render(context);
          if (!readyPending) {
            readyPending = true;
            const info: FloydSteinbergRenderInfo = { canvas, device, ...size, logicalWidth, logicalHeight };
            void device.queue.onSubmittedWorkDone().then(() => {
              if (cancelled) return;
              setStatus("ready");
              callbacks.current.onReady?.(info);
            }, fail);
          }
          animationFrame = requestAnimationFrame(tick);
        } catch (error) { fail(error); }
      };
      animationFrame = requestAnimationFrame(tick);
    };
    void initialize().catch(fail);
    return () => { cancelled = true; dispose(); };
  }, [simulationSize, seed, powerPreference]);

  return <canvas
    {...canvasProps}
    ref={assignRef}
    width={renderSize?.width ?? intrinsicWidth}
    height={renderSize?.height ?? intrinsicHeight}
    style={{ touchAction: "none", ...style }}
    aria-label={ariaLabel}
    data-webgpu-status={status}
  />;
}
