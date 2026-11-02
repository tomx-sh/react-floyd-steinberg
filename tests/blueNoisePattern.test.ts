import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { generateBlueNoisePattern } from "../src/blueNoise";
import {
  getBlueNoisePattern,
  MAX_BLUE_NOISE_PATTERN_SIZE,
} from "../src/blueNoisePattern";
import { generateVoidAndCluster } from "../scripts/void-and-cluster";
import metadata from "./blue-noise-metadata.json";

const seed = 0x5eed1234;

function packedRanks(ranks: Uint32Array) {
  const bytes = new Uint8Array(ranks.length * 2);
  const view = new DataView(bytes.buffer);
  ranks.forEach((rank, index) => view.setUint16(index * 2, rank, true));
  return bytes;
}

function neighborhoodVariance(
  ranks: Uint32Array,
  size: number,
  coverage: number,
) {
  const threshold = Math.round(ranks.length * coverage);
  const mean = threshold / ranks.length;
  let variance = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let count = 0;
      for (let dy = 0; dy < 8; dy += 1) {
        for (let dx = 0; dx < 8; dx += 1) {
          if (ranks[((y + dy) % size) * size + ((x + dx) % size)] < threshold)
            count += 1;
        }
      }
      variance += (count / 64 - mean) ** 2;
    }
  }
  return variance / ranks.length;
}

function adjacentPairs(ranks: Uint32Array, size: number, coverage: number) {
  const threshold = Math.round(ranks.length * coverage);
  let count = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (ranks[y * size + x] >= threshold) continue;
      if (ranks[y * size + ((x + 1) % size)] < threshold) count += 1;
      if (ranks[((y + 1) % size) * size + x] < threshold) count += 1;
    }
  }
  return count / ranks.length;
}

describe("offline blue-noise patterns", () => {
  for (const tile of metadata.tiles) {
    test(`${tile.size}px tile preserves every rank and matches its generated checksum`, () => {
      const actual = getBlueNoisePattern(tile.size, seed);
      expect(actual.length).toBe(tile.size ** 2);
      expect(new Set(actual).size).toBe(actual.length);
      expect(actual.every((rank) => rank < actual.length)).toBe(true);
      expect(
        createHash("sha256").update(packedRanks(actual)).digest("hex"),
      ).toBe(tile.sha256);
      expect(getBlueNoisePattern(tile.size, seed)).toBe(actual);
      expect(getBlueNoisePattern(tile.size, seed + 0x100000000)).toBe(actual);
    });
  }

  test("offline generation reproduces the committed tile", () => {
    expect(generateVoidAndCluster(64, seed).ranks).toEqual(
      getBlueNoisePattern(64, seed),
    );
    expect(MAX_BLUE_NOISE_PATTERN_SIZE).toBe(256);
  });

  test("indexed heaps agree with exhaustive cluster and void searches", () => {
    for (const size of [8, 16, 32]) {
      expect(generateVoidAndCluster(size, 42)).toEqual(
        generateVoidAndCluster(size, 42, { referenceScan: true }),
      );
    }
  });

  test("the new tiles reduce broad density clumping and touching pixels", () => {
    // Same dimensions isolate generator quality from the larger tile's repeat period.
    const size = 128;
    const original = generateBlueNoisePattern(size, seed);
    const improved = getBlueNoisePattern(size, seed);
    for (const coverage of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(neighborhoodVariance(improved, size, coverage)).toBeLessThan(
        neighborhoodVariance(original, size, coverage) * 0.75,
      );
    }
    for (const coverage of [0.25, 0.5]) {
      expect(adjacentPairs(improved, size, coverage)).toBeLessThan(
        adjacentPairs(original, size, coverage),
      );
    }
  });

  test("invalid generation settings fail instead of emitting a bad tile", () => {
    expect(() => generateVoidAndCluster(257, seed)).toThrow();
    expect(() => generateVoidAndCluster(9, seed)).toThrow();
    expect(() =>
      generateVoidAndCluster(16, seed, { sigma: Number.NaN }),
    ).toThrow();
  });

  test("custom seeds and sizes retain the runtime generator", () => {
    expect(getBlueNoisePattern(64, 42)).toBe(generateBlueNoisePattern(64, 42));
    expect(getBlueNoisePattern(64, 42)).not.toEqual(
      getBlueNoisePattern(64, seed),
    );
    expect(getBlueNoisePattern(16, seed)).toBe(
      generateBlueNoisePattern(16, seed),
    );
  });
});
