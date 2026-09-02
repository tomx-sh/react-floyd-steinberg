export interface LeniaSpeciesPreset {
    /** Stable identifier accepted by the BlueNoiseLenia species prop. */
    id: string;
    /** Display name for the species. */
    name: string;
    /** Kernel radius in simulation cells. */
    radius: number;
    /** Number of integration steps per unit of Lenia time. */
    timeResolution: number;
    /** Center of the Gaussian growth function. */
    mu: number;
    /** Width of the Gaussian growth function. */
    sigma: number;
    /** Lenia's compact 8-bit RLE representation of the initial cells. */
    cells: string;
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
    /** Empty simulation cells between a corner-anchored seed and each edge. */
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
    readonly cells: string;
}, {
    readonly id: "orbium-bicaudatus";
    readonly name: "Orbium bicaudatus";
    readonly radius: 13;
    readonly timeResolution: 10;
    readonly mu: 0.15;
    readonly sigma: 0.014;
    readonly cells: string;
}, {
    readonly id: "gyrorbium-gyrans";
    readonly name: "Gyrorbium gyrans";
    readonly radius: 13;
    readonly timeResolution: 10;
    readonly mu: 0.156;
    readonly sigma: 0.0224;
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
}];
export type LeniaScenePresetId = (typeof LENIA_SCENE_PRESETS)[number]["id"];
export declare function getLeniaSpeciesPreset(id: LeniaSpeciesId): (typeof LENIA_SPECIES_PRESETS)[number];
export declare function getLeniaScenePreset(id: LeniaScenePresetId): (typeof LENIA_SCENE_PRESETS)[number];
