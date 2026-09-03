export interface LeniaSpeciesPreset {
    /** Stable identifier accepted by the BlueNoiseLenia species prop. */
    id: string;
    /** Display name for the species. */
    name: string;
    /** Kernel radius in simulation cells. */
    radius: number;
    /** Number of integration steps per unit of Lenia time. */
    timeResolution: number;
    /** Center of the growth function. */
    mu: number;
    /** Width of the growth function. */
    sigma: number;
    /** Relative strength of up to four concentric kernel bands, inner to outer. */
    kernelPeaks: readonly [number, number?, number?, number?];
    /** Shape applied inside each kernel band. */
    kernelCore: "bump4" | "quad4";
    /** Shape of the response around mu. */
    growthFunction: "gaussian" | "quad4";
    /** Lenia's compact 8-bit RLE representation of the initial cells. */
    cells: string;
}
export interface LeniaPosition {
    /** Horizontal center in normalized canvas coordinates (0 = left, 1 = right). */
    x: number;
    /** Vertical center in normalized canvas coordinates (0 = top, 1 = bottom). */
    y: number;
}
export interface LeniaScenePlacement {
    /** Placement mode; corner anchoring accounts for the rotated seed bounds. */
    anchor: "bottom-right" | "normalized";
    /** Normalized center used by normalized placement. */
    x?: number;
    /** Normalized center used by normalized placement. */
    y?: number;
    /** Clockwise degrees applied to the catalogued seed. */
    rotation: number;
    /** Minimum empty simulation cells between the seed and each edge. */
    margin?: number;
}
export interface LeniaScenePreset {
    id: string;
    name: string;
    species: LeniaSpeciesId;
    placements: readonly LeniaScenePlacement[];
}
export declare const LENIA_SPECIES_PRESETS: readonly [{
    readonly id: "orbium-unicaudatus";
    readonly name: "Orbium unicaudatus";
    readonly radius: 13;
    readonly timeResolution: 10;
    readonly mu: 0.15;
    readonly sigma: 0.015;
    readonly kernelPeaks: readonly [1];
    readonly kernelCore: "bump4";
    readonly growthFunction: "gaussian";
    readonly cells: string;
}, {
    readonly id: "orbium-bicaudatus";
    readonly name: "Orbium bicaudatus";
    readonly radius: 13;
    readonly timeResolution: 10;
    readonly mu: 0.15;
    readonly sigma: 0.014;
    readonly kernelPeaks: readonly [1];
    readonly kernelCore: "bump4";
    readonly growthFunction: "gaussian";
    readonly cells: string;
}, {
    readonly id: "gyrorbium-gyrans";
    readonly name: "Gyrorbium gyrans";
    readonly radius: 13;
    readonly timeResolution: 10;
    readonly mu: 0.156;
    readonly sigma: 0.0224;
    readonly kernelPeaks: readonly [1];
    readonly kernelCore: "bump4";
    readonly growthFunction: "gaussian";
    readonly cells: string;
}, {
    readonly id: "tricircium-inversus";
    readonly name: "Tricircium inversus";
    readonly radius: 18;
    readonly timeResolution: 10;
    readonly mu: 0.25;
    readonly sigma: 0.03;
    readonly kernelPeaks: readonly [1, number];
    readonly kernelCore: "quad4";
    readonly growthFunction: "quad4";
    readonly cells: string;
}];
export type LeniaSpeciesId = (typeof LENIA_SPECIES_PRESETS)[number]["id"];
export declare const DEFAULT_LENIA_SPECIES: LeniaSpeciesId;
export declare const LENIA_SCENE_PRESETS: readonly [{
    readonly id: "orbium-unicaudatus-solo-up";
    readonly name: "Solo upward Orbium";
    readonly species: "orbium-unicaudatus";
    readonly placements: readonly [{
        readonly anchor: "bottom-right";
        readonly rotation: 200;
        readonly margin: 4;
    }];
}, {
    readonly id: "tricircium-inversus-solo";
    readonly name: "Solo Tricircium inversus";
    readonly species: "tricircium-inversus";
    readonly placements: readonly [{
        readonly anchor: "normalized";
        readonly x: 0.5;
        readonly y: 0.5;
        readonly rotation: 0;
        readonly margin: 2;
    }];
}];
export type LeniaScenePresetId = (typeof LENIA_SCENE_PRESETS)[number]["id"];
export declare function getLeniaSpeciesPreset(id: LeniaSpeciesId): (typeof LENIA_SPECIES_PRESETS)[number];
export declare function getLeniaScenePreset(id: LeniaScenePresetId): (typeof LENIA_SCENE_PRESETS)[number];
