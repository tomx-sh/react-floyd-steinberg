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
