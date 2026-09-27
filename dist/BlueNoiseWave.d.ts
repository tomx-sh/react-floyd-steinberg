import { FloydSteinbergProps } from './FloydSteinberg';
export interface BlueNoiseWaveProps extends Omit<FloydSteinbergProps, "alphaBackground" | "crossOrigin" | "fit" | "randomness" | "src" | "threshold"> {
    /** Width and height of the square, tileable threshold pattern in dither cells. Defaults to 64; clamped to 8–128. */
    patternSize?: number;
}
export declare function BlueNoiseWave({ width, height, pixelScale, patternSize, invert, seed, dark, light, powerPreference, onReady, onError, ref, "aria-label": ariaLabel, ...canvasProps }: BlueNoiseWaveProps): import('react').JSX.Element;
