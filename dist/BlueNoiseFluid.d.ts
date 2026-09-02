import { FloydSteinbergProps } from './FloydSteinberg';
export type BlueNoiseFluidQuantity = "velocity" | "temperature";
export interface BlueNoiseFluidProps extends Omit<FloydSteinbergProps, "alphaBackground" | "crossOrigin" | "fit" | "randomness" | "src" | "threshold"> {
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
export declare function BlueNoiseFluid({ width, height, pixelScale, patternSize, simulationSize, interactionRadius, quantity, contrast, invert, seed, dark, light, powerPreference, onReady, onError, ref, style, "aria-label": ariaLabel, ...canvasProps }: BlueNoiseFluidProps): import("react").JSX.Element;
