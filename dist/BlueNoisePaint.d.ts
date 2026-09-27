import { BlueNoiseFluidProps } from './BlueNoiseFluid';
export type BlueNoisePaintQuantity = "pigment" | "velocity";
export interface BlueNoisePaintProps extends Omit<BlueNoiseFluidProps, "quantity"> {
    /** Pigment shows advected paint; velocity shows the flow. Defaults to "pigment". */
    quantity?: BlueNoisePaintQuantity;
    /** Strength of the wandering vortices. Defaults to 1; clamped to 0–3. */
    swirlStrength?: number;
}
/** Blue-noise paint stirred inside a closed box, without thermal buoyancy. */
export declare function BlueNoisePaint({ quantity, viscosity, "aria-label": ariaLabel, ...props }: BlueNoisePaintProps): import('react').JSX.Element;
