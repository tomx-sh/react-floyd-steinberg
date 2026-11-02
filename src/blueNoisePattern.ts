import { generateBlueNoisePattern } from "./blueNoise";
import {
  PRECOMPUTED_BLUE_NOISE_SEED,
  precomputedBlueNoise,
} from "./blueNoisePatterns";

export const MAX_BLUE_NOISE_PATTERN_SIZE = 256;

const decodedPatterns = new Map<number, Uint32Array>();

/** Decode the offline-refined default tiles without running generation on mount. */
export function getBlueNoisePattern(size: number, seed: number): Uint32Array {
  const encoded =
    seed >>> 0 === PRECOMPUTED_BLUE_NOISE_SEED
      ? precomputedBlueNoise[size]
      : undefined;
  if (!encoded) return generateBlueNoisePattern(size, seed);

  let ranks = decodedPatterns.get(size);
  if (!ranks) {
    const bytes = atob(encoded);
    ranks = new Uint32Array(size * size);
    for (let index = 0; index < ranks.length; index += 1) {
      ranks[index] =
        bytes.charCodeAt(index * 2) | (bytes.charCodeAt(index * 2 + 1) << 8);
    }
    decodedPatterns.set(size, ranks);
  }
  return ranks;
}
