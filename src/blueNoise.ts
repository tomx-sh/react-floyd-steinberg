const patternCache = new Map<string, Uint32Array>();
const REFINEMENT_ROUNDS = 8;
const MAX_THRESHOLD_LEVELS = 6;

function randomValues(length: number, seed: number): Float64Array {
  const values = new Float64Array(length);
  let state = seed >>> 0 || 1;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    values[index] = (state >>> 0) / 0x100000000;
  }
  return values;
}

function gaussianWeights(sigma: number, radius: number): Float64Array {
  const weights = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    weights[offset + radius] = weight;
    total += weight;
  }
  for (let index = 0; index < weights.length; index += 1) weights[index] /= total;
  return weights;
}

function minorityDensity(
  ranks: Uint32Array,
  size: number,
  thresholdRank: number,
  minorityIsLow: boolean,
  weights: Float64Array,
): Float64Array {
  const radius = (weights.length - 1) / 2;
  const horizontal = new Float64Array(ranks.length);
  const density = new Float64Array(ranks.length);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const wrappedX = (x + offset + size) % size;
        const rank = ranks[y * size + wrappedX];
        const occupied = minorityIsLow ? rank < thresholdRank : rank >= thresholdRank;
        if (occupied) value += weights[offset + radius];
      }
      horizontal[y * size + x] = value;
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const wrappedY = (y + offset + size) % size;
        value += horizontal[wrappedY * size + x] * weights[offset + radius];
      }
      density[y * size + x] = value;
    }
  }
  return density;
}

function wrappedContribution(
  first: number,
  second: number,
  size: number,
  weights: Float64Array,
): number {
  const radius = (weights.length - 1) / 2;
  const firstX = first % size;
  const firstY = Math.floor(first / size);
  const secondX = second % size;
  const secondY = Math.floor(second / size);
  const dx = Math.min(Math.abs(firstX - secondX), size - Math.abs(firstX - secondX));
  const dy = Math.min(Math.abs(firstY - secondY), size - Math.abs(firstY - secondY));
  if (dx > radius || dy > radius) return 0;
  return weights[radius + dx] * weights[radius + dy];
}

function blockNeighborhood(blocked: Uint8Array, index: number, size: number, radius: number) {
  const centerX = index % size;
  const centerY = Math.floor(index / size);
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      const wrappedX = (centerX + x + size) % size;
      const wrappedY = (centerY + y + size) % size;
      blocked[wrappedY * size + wrappedX] = 1;
    }
  }
}

function refineThreshold(
  ranks: Uint32Array,
  size: number,
  lowerRank: number,
  thresholdRank: number,
  upperRank: number,
) {
  const area = ranks.length;
  const threshold = thresholdRank / area;
  const minorityIsLow = threshold <= 0.5;
  const occupancy = Math.min(threshold, 1 - threshold);
  const sigma = Math.min(2.25, Math.max(0.8, 0.38 / Math.sqrt(occupancy)));
  const radius = Math.min(7, Math.floor((size - 1) / 2), Math.ceil(sigma * 3));
  const weights = gaussianWeights(sigma, radius);
  const centerContribution = weights[radius] * weights[radius];
  const swapsPerRound = Math.max(
    1,
    Math.floor(Math.min(thresholdRank - lowerRank, upperRank - thresholdRank) / 64),
  );

  for (let round = 0; round < REFINEMENT_ROUNDS; round += 1) {
    const density = minorityDensity(ranks, size, thresholdRank, minorityIsLow, weights);
    const sources: number[] = [];
    const destinations: number[] = [];
    for (let index = 0; index < area; index += 1) {
      const rank = ranks[index];
      if (minorityIsLow) {
        if (rank >= lowerRank && rank < thresholdRank) sources.push(index);
        else if (rank >= thresholdRank && rank < upperRank) destinations.push(index);
      } else {
        if (rank >= thresholdRank && rank < upperRank) sources.push(index);
        else if (rank >= lowerRank && rank < thresholdRank) destinations.push(index);
      }
    }
    sources.sort((left, right) => density[right] - density[left]);
    destinations.sort((left, right) => density[left] - density[right]);

    const blocked = new Uint8Array(area);
    let sourceOffset = 0;
    let destinationOffset = 0;
    let accepted = 0;
    while (
      accepted < swapsPerRound &&
      sourceOffset < sources.length &&
      destinationOffset < destinations.length
    ) {
      const source = sources[sourceOffset++];
      if (blocked[source]) continue;

      let destination = destinations[destinationOffset++];
      while (blocked[destination] && destinationOffset < destinations.length) {
        destination = destinations[destinationOffset++];
      }
      if (blocked[destination]) break;

      const before = density[source] - centerContribution;
      const after = density[destination] - wrappedContribution(source, destination, size, weights);
      if (after >= before) break;

      const rank = ranks[source];
      ranks[source] = ranks[destination];
      ranks[destination] = rank;
      blockNeighborhood(blocked, source, size, radius);
      blockNeighborhood(blocked, destination, size, radius);
      accepted += 1;
    }
    if (accepted === 0) break;
  }
}

function refineProgressiveThresholds(ranks: Uint32Array, size: number) {
  const area = ranks.length;
  const levelCount = Math.min(MAX_THRESHOLD_LEVELS, Math.floor(Math.log2(size)));
  for (let level = 1; level <= levelCount; level += 1) {
    const denominator = 2 ** level;
    for (let numerator = 1; numerator < denominator; numerator += 2) {
      const lowerRank = Math.floor(((numerator - 1) * area) / denominator);
      const thresholdRank = Math.floor((numerator * area) / denominator);
      const upperRank = Math.floor(((numerator + 1) * area) / denominator);
      refineThreshold(ranks, size, lowerRank, thresholdRank, upperRank);
    }
  }
}

/** Creates a deterministic, tileable blue-noise threshold map containing every rank exactly once. */
export function generateBlueNoisePattern(size: number, seed: number): Uint32Array {
  const cacheKey = `${size}:${seed >>> 0}`;
  const cached = patternCache.get(cacheKey);
  if (cached) return cached;

  const area = size * size;
  const source = randomValues(area, seed);
  const horizontal = new Float64Array(area);
  const filtered = new Float64Array(area);
  const weights = [0.06136, 0.24477, 0.38774, 0.24477, 0.06136] as const;

  // The blur wraps on both axes. Subtracting it removes low frequencies while
  // making the first and last rows/columns true neighbors on a torus.
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const wrappedX = (x + offset + size) % size;
        value += source[y * size + wrappedX] * weights[offset + 2];
      }
      horizontal[y * size + x] = value;
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 0;
      for (let offset = -2; offset <= 2; offset += 1) {
        const wrappedY = (y + offset + size) % size;
        value += horizontal[wrappedY * size + x] * weights[offset + 2];
      }
      const index = y * size + x;
      filtered[index] = source[index] - value;
    }
  }

  const orderedIndices = Array.from({ length: area }, (_, index) => index);
  orderedIndices.sort((left, right) => filtered[left] - filtered[right]);
  const ranks = new Uint32Array(area);
  for (let rank = 0; rank < area; rank += 1) {
    ranks[orderedIndices[rank]] = rank;
  }

  // Improve nested binary slices, not just the continuous field. Each level
  // swaps ranks only inside its parent band, preserving coarser thresholds.
  refineProgressiveThresholds(ranks, size);

  patternCache.set(cacheKey, ranks);
  return ranks;
}
