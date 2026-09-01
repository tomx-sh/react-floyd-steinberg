const patternCache = new Map<string, Uint32Array>();

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

  patternCache.set(cacheKey, ranks);
  return ranks;
}
