/**
 * Offline progressive void-and-cluster ranks (Ulichney, 1993).
 * https://cv.ulichney.com/papers/1993-void-cluster.pdf
 * Fixed-point Gaussian energies avoid accumulated floating-point drift.
 * This module is build tooling only and must not enter the browser bundle.
 */
export const VOID_CLUSTER_SIGMA = 1.0;
const ENERGY_SCALE = 2 ** 32;

interface KernelEntry {
  dx: number;
  dy: number;
  weight: number;
}

function gaussianKernel(size: number, sigma: number): KernelEntry[] {
  const radius = Math.min(
    Math.floor(size / 2),
    Math.ceil(sigma * Math.sqrt(2 * Math.log(ENERGY_SCALE))),
  );
  const kernel: KernelEntry[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    if (dy === size / 2) continue;
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === size / 2) continue;
      const weight = Math.round(
        Math.exp(-(dx * dx + dy * dy) / (2 * sigma ** 2)) * ENERGY_SCALE,
      );
      if (weight > 0) kernel.push({ dx, dy, weight });
    }
  }
  return kernel;
}

/** Indexed heap: update changed Gaussian neighborhoods without scanning the tile. */
class DensityHeap {
  private indices: Int32Array;
  private positions: Int32Array;
  constructor(
    private occupied: Uint8Array,
    private density: Float64Array,
    private cluster: boolean,
  ) {
    this.indices = Int32Array.from(
      { length: occupied.length },
      (_, index) => index,
    );
    this.positions = this.indices.slice();
    for (let index = (occupied.length >> 1) - 1; index >= 0; index -= 1)
      this.down(index);
  }
  private before(a: number, b: number): boolean {
    const eligibleA = this.occupied[a] === (this.cluster ? 1 : 0);
    const eligibleB = this.occupied[b] === (this.cluster ? 1 : 0);
    if (eligibleA !== eligibleB) return eligibleA;
    if (eligibleA && this.density[a] !== this.density[b]) {
      return this.cluster
        ? this.density[a] > this.density[b]
        : this.density[a] < this.density[b];
    }
    return a < b;
  }
  private swap(a: number, b: number) {
    const first = this.indices[a],
      second = this.indices[b];
    this.indices[a] = second;
    this.indices[b] = first;
    this.positions[first] = b;
    this.positions[second] = a;
  }
  private down(position: number) {
    for (;;) {
      const left = position * 2 + 1;
      if (left >= this.indices.length) return;
      const right = left + 1;
      const next =
        right < this.indices.length &&
        this.before(this.indices[right], this.indices[left])
          ? right
          : left;
      if (!this.before(this.indices[next], this.indices[position])) return;
      this.swap(position, next);
      position = next;
    }
  }
  update(index: number) {
    let position = this.positions[index];
    if (position > 0 && this.before(index, this.indices[(position - 1) >> 1])) {
      while (position > 0) {
        const parent = (position - 1) >> 1;
        if (!this.before(index, this.indices[parent])) break;
        this.swap(position, parent);
        position = parent;
      }
    } else this.down(position);
  }
  get first(): number {
    return this.indices[0];
  }
}

export interface VoidClusterResult {
  ranks: Uint32Array;
  relaxationSwaps: number;
}

export function generateVoidAndCluster(
  size: number,
  seed: number,
  { sigma = VOID_CLUSTER_SIGMA, referenceScan = false } = {},
): VoidClusterResult {
  if (!Number.isInteger(size) || size < 8 || size > 256 || size % 2 !== 0) {
    throw new Error(
      "Offline blue-noise size must be an even integer from 8 to 256.",
    );
  }
  if (!Number.isFinite(sigma) || sigma < 1 || sigma > 1.5) {
    throw new Error("Void-and-cluster sigma must be between 1 and 1.5.");
  }
  const area = size * size;
  const initialCount = Math.max(1, Math.floor(area * 0.1));
  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const shuffled = Uint32Array.from({ length: area }, (_, index) => index);
  const occupied = new Uint8Array(area);
  for (let index = 0; index < initialCount; index += 1) {
    const next = index + Math.floor(random() * (area - index));
    [shuffled[index], shuffled[next]] = [shuffled[next], shuffled[index]];
    occupied[shuffled[index]] = 1;
  }
  const kernel = gaussianKernel(size, sigma);
  let density = new Float64Array(area);
  let heaps: DensityHeap[] = [];
  const visit = (index: number, change: number, update: boolean) => {
    const x = index % size,
      y = Math.floor(index / size);
    for (const { dx, dy, weight } of kernel) {
      const neighbor =
        ((y + dy + size) % size) * size + ((x + dx + size) % size);
      density[neighbor] += weight * change;
      if (update) for (const heap of heaps) heap.update(neighbor);
    }
  };
  const rebuild = (cluster: boolean, both = false) => {
    density = new Float64Array(area);
    for (let index = 0; index < area; index += 1)
      if (occupied[index]) visit(index, 1, false);
    heaps = referenceScan ? [] : [new DensityHeap(occupied, density, cluster)];
    if (both && !referenceScan)
      heaps.push(new DensityHeap(occupied, density, !cluster));
  };
  const select = (cluster: boolean, heapIndex = 0) => {
    if (!referenceScan) return heaps[heapIndex].first;
    let best = -1;
    for (let index = 0; index < area; index += 1) {
      if (occupied[index] !== (cluster ? 1 : 0)) continue;
      if (
        best < 0 ||
        (cluster
          ? density[index] > density[best]
          : density[index] < density[best])
      )
        best = index;
    }
    return best;
  };
  const set = (index: number, value: number) => {
    const change = value - occupied[index];
    occupied[index] = value;
    for (const heap of heaps) heap.update(index);
    visit(index, change, true);
  };

  // Relax the initial 10% binary slice until no cluster-to-void move improves it.
  rebuild(true, true);
  let relaxationSwaps = 0;
  for (;;) {
    const cluster = select(true);
    set(cluster, 0);
    const destination = select(false, 1);
    if (density[destination] >= density[cluster]) {
      set(cluster, 1);
      break;
    }
    set(destination, 1);
    relaxationSwaps += 1;
    if (relaxationSwaps >= area * 64)
      throw new Error("Void-and-cluster relaxation did not converge.");
  }
  const initial = occupied.slice();
  const ranks = new Uint32Array(area);
  // Phase I: progressively remove clusters down to a single isolated point.
  rebuild(true);
  for (let rank = initialCount - 1; rank >= 0; rank -= 1) {
    const cluster = select(true);
    ranks[cluster] = rank;
    set(cluster, 0);
  }
  // Phase II: restore the relaxed slice, then fill its largest voids up to 50%.
  occupied.set(initial);
  rebuild(false);
  for (let rank = initialCount; rank < area / 2; rank += 1) {
    const destination = select(false);
    ranks[destination] = rank;
    set(destination, 1);
  }
  // Phase III: zeros are now the minority. Remove their clusters through 100%.
  for (let index = 0; index < area; index += 1)
    occupied[index] = 1 - occupied[index];
  rebuild(true);
  for (let rank = area / 2; rank < area; rank += 1) {
    const cluster = select(true);
    ranks[cluster] = rank;
    set(cluster, 0);
  }
  return { ranks, relaxationSwaps };
}
