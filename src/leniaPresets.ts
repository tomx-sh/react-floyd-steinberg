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

function rows(...values: string[]): string {
  return values.join("$");
}

export const LENIA_SPECIES_PRESETS = [
  {
    id: "orbium-unicaudatus",
    name: "Orbium unicaudatus",
    radius: 13,
    timeResolution: 10,
    mu: 0.15,
    sigma: 0.015,
    kernelPeaks: [1],
    kernelCore: "bump4",
    growthFunction: "gaussian",
    cells: rows(
      "7.MD6.qL",
      "6.pKqEqFURpApBRAqQ",
      "5.VqTrSsBrOpXpWpTpWpUpCrQ",
      "4.CQrQsTsWsApITNPpGqGvL",
      "3.IpIpWrOsGsBqXpJ4.LsFrL",
      "A.DpKpSpJpDqOqUqSqE5.ExD",
      "qL.pBpTT2.qCrGrVrWqM5.sTpP",
      ".pGpWpD3.qUsMtItQtJ6.tL",
      ".uFqGH3.pXtOuR2vFsK5.sM",
      ".tUqL4.GuNwAwVxBwNpC4.qXpA",
      "2.uH5.vBxGyEyMyHtW4.qIpL",
      "2.wV5.tIyG3yOxQqW2.FqHpJ",
      "2.tUS4.rM2yOyJyOyHtVpPMpFqNV",
      "2.HsR4.pUxAyOxLxDxEuVrMqBqGqKJ",
      "3.sLpE3.pEuNxHwRwGvUuLsHrCqTpR",
      "3.TrMS2.pFsLvDvPvEuPtNsGrGqIP",
      "4.pRqRpNpFpTrNtGtVtStGsMrNqNpF",
      "5.pMqKqLqRrIsCsLsIrTrFqJpHE",
      "6.RpSqJqPqVqWqRqKpRXE",
      "8.OpBpIpJpFTK",
    ),
  },
  {
    id: "orbium-bicaudatus",
    name: "Orbium bicaudatus",
    radius: 13,
    timeResolution: 10,
    mu: 0.15,
    sigma: 0.014,
    kernelPeaks: [1],
    kernelCore: "bump4",
    growthFunction: "gaussian",
    cells: rows(
      "13.pK",
      "14.qV",
      "6.VpA.MpEpKpITqV",
      "4.BpPpNrIrEqDpWpOpLpUqNvT",
      "4.IqRrNsPsKqHJ3.GqOuC",
      "4.TrLsTrPrLpS6.uUD",
      "3.SpWqNrBqLpRqPqE6.vA",
      "2.FpTpMLpHqPqHrVsPrS5.qUqA",
      "K.pCpRG.ErFsRsVuSuPqN4.CrR",
      "pA.pTU3.rWuBuRvXwTwKpF4.rCH",
      ".tPqHH3.qFvAwUwVyJyKwNL2.DqLR",
      ".pGsGA4.vPxSyDxE2yOuHS.XqJT",
      "2.xIE4.sCyHyOvLvRyFxCsGpVpXqGP",
      "2.VsU4.DxQyOvVuSwDwQuBrMqSqCF",
      "3.vG5.tEyKwVvIvKvMtVrXqTpM",
      "4.sU4.qFvDwMvNuUuDsUrKqDO",
      "4.qCrDJ2.pPsKuGuHtOsQrNqKpC",
      "5.pTqTpVpNqFrJsGsKrVrDqFpFD",
      "6.QqCqJqPqVqXqRqHpOTC",
      "8.LWpFpEXPG",
    ),
  },
  {
    id: "gyrorbium-gyrans",
    name: "Gyrorbium gyrans",
    radius: 13,
    timeResolution: 10,
    mu: 0.156,
    sigma: 0.0224,
    kernelPeaks: [1],
    kernelCore: "bump4",
    growthFunction: "gaussian",
    cells: rows(
      "10.EL2QLE",
      "7.TpU2qHqCpXpUpNpFL",
      "4.JrVtTuKuPuKtLrXqTqHqCpPpDG",
      "3.qWtDqRpKqEsMuXvBtGrApXpUpSpIO",
      "2.rQrN4.pAuAvRtTrIpUpIpKpFO",
      ".pSsM6.tJwFuNsPsFrVpPpDL",
      ".uFB6.tJ2yO2yLyOyDsKL",
      "pDuC6.pFxW3yOwIwD2xPqH",
      "rNtV5.EsMxCyIyOwXtJsMtJwFuX",
      "sHuSV3.EpDvOwFxEwQsRqR2qHsFvWE",
      "rQvJsWpPQpKpSqCvEvBuCpD3.BpDtGrQ",
      "pXuKvMuPtLsWsCrIuCtBrS6.qWrQ",
      "EsKvEwXyBwLtVrVsCrDqH6.pXrG",
      ".qHtVxJyOwQrQpNqJpPV6.qJqE",
      ".JsUxMyOrX10.pFqRJ",
      "2.rQxPwIpI9.pKqJT",
      "2.qJxEuPpKB7.qCpP",
      "2.EvOvMpPO5.TrGqH",
      "3.sCyOqEpIOEBOqHqEsRtG",
      "4.xMsMqJqCpXqJqRpIqOuCtBsF",
      "5.xPrAqTqMpSE.rSsMrLqRqHV.TpS",
      "6.vErDE2.VpPB",
      "7.pIrNqHpKQ",
    ),
  },
  {
    id: "tricircium-inversus",
    name: "Tricircium inversus",
    radius: 18,
    timeResolution: 10,
    mu: 0.25,
    sigma: 0.03,
    kernelPeaks: [1, 1 / 3],
    kernelCore: "quad4",
    growthFunction: "quad4",
    cells: rows(
      "6.VrQ2tJrQT",
      "5.sUxH3yOxWuUpU",
      "4.tOyG7yOqW",
      "3.rDxC9yOxR",
      "3.tD3yOxRwLwAwDwX4yO",
      "3.vW2yOwSuXuKuFtTtB2.vO2yO",
      "3.2yOxPuItO2tQtB4.E2yO",
      "2.pI2yOuFLrDtGuCtO5.yB2yOB",
      "2.wLyOvT3.qWyGxPqO4.qJ2yOvRpA",
      "2.2yO4.pPtVvMrVqO3.rQxR2yOuFJ",
      "2.2yO4.pFsPuCtOsHtL.qWtQwI2yOxRrN",
      "2.2yO4.pSsRtVuCvTyOuStQuCvT3yOtV",
      ".qE2yOqH3.pDtVtLsWtQyGuKtVuIvW3yOuN",
      ".sR2yOwDrXqErQtJqOqMpPpKJsRtLuKwQ3yOtO",
      "OuF2yOxEuItLtJtLqC5.tGvByG3yOrA",
      "pDvO2yOyDvMuItTtD6.uAxJ3yOvO",
      "OvR3yOxEvJuNtT6.yG2yOyBvRqH",
      ".tV4yOxRwSwDvG3.pD3yOxRsMpK",
      ".pXxE13yOqH",
      "2.rSxP9yOvR",
      "3.rAvTyByIxRxHuUrG",
      "4.JqTsHsCqH",
    ),
  },
] as const satisfies readonly LeniaSpeciesPreset[];

export type LeniaSpeciesId = (typeof LENIA_SPECIES_PRESETS)[number]["id"];

export const DEFAULT_LENIA_SPECIES: LeniaSpeciesId = "orbium-unicaudatus";

export const LENIA_SCENE_PRESETS = [
  {
    id: "orbium-unicaudatus-solo-up",
    name: "Solo upward Orbium",
    species: "orbium-unicaudatus",
    placements: [{ anchor: "bottom-right", rotation: 200, margin: 4 }],
  },
  {
    id: "tricircium-inversus-solo",
    name: "Solo Tricircium inversus",
    species: "tricircium-inversus",
    placements: [{ anchor: "normalized", x: 0.5, y: 0.5, rotation: 0, margin: 2 }],
  },
] as const satisfies readonly LeniaScenePreset[];

export type LeniaScenePresetId = (typeof LENIA_SCENE_PRESETS)[number]["id"];

const presetsById = new Map<LeniaSpeciesId, (typeof LENIA_SPECIES_PRESETS)[number]>(
  LENIA_SPECIES_PRESETS.map((preset) => [preset.id, preset]),
);

const scenesById = new Map<LeniaScenePresetId, (typeof LENIA_SCENE_PRESETS)[number]>(
  LENIA_SCENE_PRESETS.map((preset) => [preset.id, preset]),
);

export function getLeniaSpeciesPreset(id: LeniaSpeciesId): (typeof LENIA_SPECIES_PRESETS)[number] {
  return presetsById.get(id) ?? LENIA_SPECIES_PRESETS[0];
}

export function getLeniaScenePreset(
  id: LeniaScenePresetId,
): (typeof LENIA_SCENE_PRESETS)[number] {
  return scenesById.get(id) ?? LENIA_SCENE_PRESETS[0];
}
