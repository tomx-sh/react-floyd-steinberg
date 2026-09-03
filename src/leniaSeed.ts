import type {
  LeniaScenePlacement,
  LeniaScenePreset,
  LeniaPosition,
  LeniaSpeciesPreset,
} from "./leniaPresets";

export function decodeLeniaRle(value: string): number[][] {
  const rows: number[][] = [[]];
  let count = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character >= "0" && character <= "9") {
      count += character;
      continue;
    }
    if (character === "$") {
      const repetitions = count ? Number(count) : 1;
      for (let repetition = 0; repetition < repetitions; repetition += 1) rows.push([]);
      count = "";
      continue;
    }

    let encoded = character;
    if (character >= "p" && character <= "y") {
      encoded += value[index + 1];
      index += 1;
    }
    const decoded =
      encoded === "." || encoded === "b"
        ? 0
        : encoded === "o"
          ? 255
          : encoded.length === 1
            ? encoded.charCodeAt(0) - 64
            : (encoded.charCodeAt(0) - 112) * 24 + (encoded.charCodeAt(1) - 65 + 25);
    const repetitions = count ? Number(count) : 1;
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      rows[rows.length - 1].push(decoded / 255);
    }
    count = "";
  }
  return rows;
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function normalizedCoordinate(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value as number)) : fallback;
}

export function resolveLeniaSpatialScale(value: number): number {
  return Number.isFinite(value) ? Math.min(3, Math.max(0.5, value)) : 1;
}

function scaleCells(cells: number[][], scale: number): number[][] {
  if (scale === 1) return cells;
  const sourceHeight = cells.length;
  const sourceWidth = Math.max(...cells.map((row) => row.length));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const sample = (x: number, y: number) => cells[y]?.[x] ?? 0;

  return Array.from({ length: height }, (_, targetY) =>
    Array.from({ length: width }, (_, targetX) => {
      const sourceX = ((targetX + 0.5) * sourceWidth) / width - 0.5;
      const sourceY = ((targetY + 0.5) * sourceHeight) / height - 0.5;
      const left = Math.floor(sourceX);
      const top = Math.floor(sourceY);
      const fractionX = sourceX - left;
      const fractionY = sourceY - top;
      return (
        sample(left, top) * (1 - fractionX) * (1 - fractionY) +
        sample(left + 1, top) * fractionX * (1 - fractionY) +
        sample(left, top + 1) * (1 - fractionX) * fractionY +
        sample(left + 1, top + 1) * fractionX * fractionY
      );
    }),
  );
}

function rotateCells(cells: number[][], degrees: number): number[][] {
  const sourceHeight = cells.length;
  const sourceWidth = Math.max(...cells.map((row) => row.length));
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const width = Math.ceil(Math.abs(sourceWidth * cosine) + Math.abs(sourceHeight * sine));
  const height = Math.ceil(Math.abs(sourceWidth * sine) + Math.abs(sourceHeight * cosine));
  const sourceCenterX = (sourceWidth - 1) / 2;
  const sourceCenterY = (sourceHeight - 1) / 2;
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;

  const sample = (x: number, y: number) => cells[y]?.[x] ?? 0;
  return Array.from({ length: height }, (_, targetY) =>
    Array.from({ length: width }, (_, targetX) => {
      const offsetX = targetX - centerX;
      const offsetY = targetY - centerY;
      const sourceX = cosine * offsetX + sine * offsetY + sourceCenterX;
      const sourceY = -sine * offsetX + cosine * offsetY + sourceCenterY;
      const left = Math.floor(sourceX);
      const top = Math.floor(sourceY);
      const fractionX = sourceX - left;
      const fractionY = sourceY - top;
      return (
        sample(left, top) * (1 - fractionX) * (1 - fractionY) +
        sample(left + 1, top) * fractionX * (1 - fractionY) +
        sample(left, top + 1) * (1 - fractionX) * fractionY +
        sample(left + 1, top + 1) * fractionX * fractionY
      );
    }),
  );
}

export function createLeniaInitialState(
  width: number,
  height: number,
  preset: LeniaSpeciesPreset,
  seed: number,
  scene?: LeniaScenePreset,
  position?: LeniaPosition,
  spatialScale = 1,
): Float32Array {
  const state = new Float32Array(width * height);
  const cells = scaleCells(decodeLeniaRle(preset.cells), resolveLeniaSpatialScale(spatialScale));
  const random = createRandom(seed);
  const commonRotation = Math.floor(random() * 4) * 90;
  const defaultPlacements: readonly LeniaScenePlacement[] =
    Math.min(width, height) >= 64
      ? [
          { anchor: "normalized", x: 0.2, y: 0.25, rotation: commonRotation },
          { anchor: "normalized", x: 0.6, y: 0.25, rotation: commonRotation },
          { anchor: "normalized", x: 0.4, y: 0.55, rotation: commonRotation },
        ]
      : [{ anchor: "normalized", x: 0.5, y: 0.5, rotation: commonRotation }];
  const placements = scene?.placements ?? defaultPlacements;

  for (const [placementIndex, placement] of placements.entries()) {
    const rotatedCells = rotateCells(cells, placement.rotation);
    const rotatedWidth = rotatedCells[0]?.length ?? 0;
    const rotatedHeight = rotatedCells.length;
    const jitter = scene ? 0 : 0.05;
    const positionOverride = placementIndex === 0 ? position : undefined;
    const centerX =
      normalizedCoordinate(positionOverride?.x ?? placement.x, 0.5) + (random() - 0.5) * jitter;
    const centerY =
      normalizedCoordinate(positionOverride?.y ?? placement.y, 0.5) + (random() - 0.5) * jitter;
    const margin = placement.margin ?? 0;
    const requestedOriginX =
      placement.anchor === "bottom-right" && !positionOverride
        ? width - rotatedWidth - margin
        : Math.round(centerX * width - rotatedWidth / 2);
    const requestedOriginY =
      placement.anchor === "bottom-right" && !positionOverride
        ? height - rotatedHeight - margin
        : Math.round(centerY * height - rotatedHeight / 2);
    const maxOriginX = Math.max(0, width - rotatedWidth);
    const maxOriginY = Math.max(0, height - rotatedHeight);
    const minimumX = Math.min(margin, maxOriginX);
    const minimumY = Math.min(margin, maxOriginY);
    const maximumX = Math.max(minimumX, maxOriginX - margin);
    const maximumY = Math.max(minimumY, maxOriginY - margin);
    const originX = Math.min(maximumX, Math.max(minimumX, requestedOriginX));
    const originY = Math.min(maximumY, Math.max(minimumY, requestedOriginY));

    for (let sourceY = 0; sourceY < rotatedHeight; sourceY += 1) {
      const row = rotatedCells[sourceY];
      for (let sourceX = 0; sourceX < rotatedWidth; sourceX += 1) {
        const targetX = originX + sourceX;
        const targetY = originY + sourceY;
        if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
        const targetIndex = targetY * width + targetX;
        state[targetIndex] = Math.max(state[targetIndex], row[sourceX]);
      }
    }
  }

  return state;
}
