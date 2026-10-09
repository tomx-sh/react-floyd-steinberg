import { BlueNoiseFluidProps } from './BlueNoiseFluid';
export interface BlueNoiseInkProps extends Omit<BlueNoiseFluidProps, "quantity" | "viscosity"> {
    /** Longest velocity-grid dimension. Defaults to 128; clamped to 32–384.
     * The grid is 16:9, as in the reference, with dye at four times its resolution. */
    simulationSize?: number;
    /** Pointer splat radius in normalized canvas-height units. Defaults to sqrt(0.002). */
    interactionRadius?: number;
}
/** The vgpu fluid simulation with scalar ink and a fixed blue-noise threshold tile. */
export declare function BlueNoiseInk({ width, height, pixelScale, patternSize, simulationSize, interactionRadius, contrast, invert, seed, dark, light, powerPreference, onReady, onError, ref, style, "aria-label": ariaLabel, ...canvasProps }: BlueNoiseInkProps): import('react').JSX.Element;
