import { BlueNoiseFluidProps } from './BlueNoiseFluid';
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
/** The vgpu fluid simulation with scalar ink and a fixed blue-noise threshold tile. */
export declare function BlueNoiseInk({ width, height, pixelScale, patternSize, simulationSize, simulationSpeed, viscosity, interactionRadius, contrast, invert, seed, dark, light, powerPreference, onReady, onError, ref, style, "aria-label": ariaLabel, ...canvasProps }: BlueNoiseInkProps): import('react').JSX.Element;
