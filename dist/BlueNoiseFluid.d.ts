import { FloydSteinbergProps } from './FloydSteinberg';
export interface BlueNoiseFluidProps extends Omit<FloydSteinbergProps, "alphaBackground" | "crossOrigin" | "fit" | "randomness" | "src" | "threshold"> {
    /** Width and height of the square blue-noise tile in dither cells. Defaults to 64. */
    patternSize?: number;
    /** Maximum fluid-grid dimension. Defaults to 192; clamped to 32–384. */
    simulationSize?: number;
    /** Pointer injection radius in normalized canvas units. Defaults to 0.05. */
    interactionRadius?: number;
}
export declare const BlueNoiseFluid: import('react').ForwardRefExoticComponent<BlueNoiseFluidProps & import('react').RefAttributes<HTMLCanvasElement>>;
