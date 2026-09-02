import type {
  LeniaScenePlacement,
  LeniaScenePreset,
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
): Float32Array {
  const state = new Float32Array(width * height);
  const cells = decodeLeniaRle(preset.cells);
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

  for (const placement of placements) {
    const rotatedCells = rotateCells(cells, placement.rotation);
    const rotatedWidth = rotatedCells[0]?.length ?? 0;
    const rotatedHeight = rotatedCells.length;
    const jitter = scene ? 0 : 0.05;
    const centerX = (placement.x ?? 0.5) + (random() - 0.5) * jitter;
    const centerY = (placement.y ?? 0.5) + (random() - 0.5) * jitter;
    const margin = placement.margin ?? 0;
    const originX =
      placement.anchor === "bottom-right"
        ? width - rotatedWidth - margin
        : Math.round(centerX * width - rotatedWidth / 2);
    const originY =
      placement.anchor === "bottom-right"
        ? height - rotatedHeight - margin
        : Math.round(centerY * height - rotatedHeight / 2);

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
