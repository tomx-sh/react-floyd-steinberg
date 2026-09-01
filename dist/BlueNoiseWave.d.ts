import { FloydSteinbergProps } from './FloydSteinberg';
export interface BlueNoiseWaveProps extends Omit<FloydSteinbergProps, "alphaBackground" | "crossOrigin" | "fit" | "randomness" | "src" | "threshold"> {
    /** Width and height of the square, tileable threshold pattern in dither cells. Defaults to 64; clamped to 8–256. */
    patternSize?: number;
}
export declare const BlueNoiseWave: import('react').ForwardRefExoticComponent<BlueNoiseWaveProps & import('react').RefAttributes<HTMLCanvasElement>>;
