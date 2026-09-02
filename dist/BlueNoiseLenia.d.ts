import { FloydSteinbergProps } from './FloydSteinberg';
import { LeniaScenePresetId, LeniaSpeciesId } from './leniaPresets';
export interface BlueNoiseLeniaProps extends Omit<FloydSteinbergProps, "alphaBackground" | "crossOrigin" | "fit" | "randomness" | "src" | "threshold"> {
    /** Width and height of the square blue-noise tile in dither cells. Defaults to 64. */
    patternSize?: number;
    /** Longest automaton-grid dimension. Defaults to 256; clamped to 64–384. */
    simulationSize?: number;
    /** Catalogued Lenia species used to initialize the field. */
    species?: LeniaSpeciesId;
    /** Optional scene preset that controls both species and initial placement. */
    preset?: LeniaScenePresetId;
    /** Pointer injection radius in normalized canvas units. Defaults to 0.05. */
    interactionRadius?: number;
    /**
     * Contrast applied to the automaton state before dithering. Values above 1
     * grow the light areas; values below 1 shrink them toward noise. Defaults
     * to 1; clamped to 0.25–8.
     */
    contrast?: number;
}
export declare function BlueNoiseLenia({ width, height, pixelScale, patternSize, simulationSize, species, preset, interactionRadius, contrast, invert, seed, dark, light, powerPreference, onReady, onError, ref, style, "aria-label": ariaLabel, ...canvasProps }: BlueNoiseLeniaProps): import("react").JSX.Element;
