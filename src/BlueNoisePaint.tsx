import { FluidCanvas, type BlueNoiseFluidProps } from "./BlueNoiseFluid";

export type BlueNoisePaintQuantity = "pigment" | "velocity";

export interface BlueNoisePaintProps extends Omit<BlueNoiseFluidProps, "quantity"> {
  /** Pigment shows advected paint; velocity shows the flow. Defaults to "pigment". */
  quantity?: BlueNoisePaintQuantity;
  /** Strength of the wandering vortices. Defaults to 1; clamped to 0–3. */
  swirlStrength?: number;
}

/** Blue-noise paint stirred inside a closed box, without thermal buoyancy. */
export function BlueNoisePaint({
  quantity = "pigment",
  viscosity = 2,
  "aria-label": ariaLabel = "Interactive blue-noise paint in a box",
  ...props
}: BlueNoisePaintProps) {
  return (
    <FluidCanvas
      {...props}
      setup="paint"
      quantity={quantity === "velocity" ? "velocity" : "temperature"}
      viscosity={viscosity}
      aria-label={ariaLabel}
    />
  );
}
