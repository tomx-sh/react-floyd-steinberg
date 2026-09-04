export const floydSteinbergShader = /* wgsl */ `
struct Parameters {
  outputSize: vec2u,
  sourceSize: vec2u,
  fit: u32,
  invert: u32,
  threshold: f32,
  randomness: f32,
  seed: u32,
  alphaBackground: f32,
  padding0: u32,
  padding1: u32,
}

struct Band {
  firstRow: u32,
  rowCount: u32,
  padding0: u32,
  padding1: u32,
}

@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var<storage, read_write> outputBits: array<u32>;
@group(0) @binding(2) var<storage, read_write> errorBuffer: array<f32>;
@group(0) @binding(3) var<uniform> band: Band;
@group(0) @binding(4) var sourceTexture: texture_2d<f32>;

fn hashValue(cell: vec2u, seed: u32) -> f32 {
  var value = cell.x * 0x9e3779b9u + cell.y * 0x85ebca6bu + seed;
  value = (value ^ (value >> 16u)) * 0x7feb352du;
  value = (value ^ (value >> 15u)) * 0x846ca68bu;
  value = value ^ (value >> 16u);
  return f32(value) / 4294967295.0;
}

fn fittedUv(cell: vec2u) -> vec3f {
  let outputSize = vec2f(parameters.outputSize);
  let sourceSize = vec2f(parameters.sourceSize);
  let outputAspect = outputSize.x / outputSize.y;
  let sourceAspect = sourceSize.x / sourceSize.y;
  var uv = (vec2f(cell) + vec2f(0.5)) / outputSize;

  if (parameters.fit == 1u) {
    // Cover: crop the longer source axis.
    if (sourceAspect > outputAspect) {
      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;
    } else {
      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;
    }
  } else if (parameters.fit == 2u) {
    // Contain: map the letterboxed output area outside the source UV range.
    if (sourceAspect > outputAspect) {
      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;
    } else {
      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;
    }
  }

  let inside = select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));
  return vec3f(uv, inside);
}

fn sourceValue(cell: vec2u) -> f32 {
  let fitted = fittedUv(cell);
  var luminance = parameters.alphaBackground;

  if (fitted.z > 0.5) {
    let maxPosition = vec2i(parameters.sourceSize) - vec2i(1);
    let position = clamp(vec2i(fitted.xy * vec2f(parameters.sourceSize)), vec2i(0), maxPosition);
    let color = textureLoad(sourceTexture, position, 0);
    let imageLuminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    luminance = mix(parameters.alphaBackground, imageLuminance, color.a);
  }

  return select(luminance, 1.0 - luminance, parameters.invert != 0u);
}

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) localRow: u32) {
  let row = band.firstRow + localRow;
  let activeRow = localRow < band.rowCount && row < parameters.outputSize.y;
  var phaseCount = parameters.outputSize.x;
  if (band.rowCount > 0u) {
    phaseCount += 3u * (band.rowCount - 1u);
  }

  for (var phase = 0u; phase < phaseCount; phase += 1u) {
    let rowDelay = 3u * localRow;
    if (activeRow && phase >= rowDelay) {
      let x = phase - rowDelay;
      if (x < parameters.outputSize.x) {
        let cell = vec2u(x, row);
        let index = row * parameters.outputSize.x + x;
        let value = clamp(sourceValue(cell) + errorBuffer[index], 0.0, 1.0);
        let bit = select(0u, 1u, value >= parameters.threshold);
        let error = value - f32(bit);
        outputBits[index] = bit;

        let r1 = (hashValue(cell, parameters.seed) * 2.0 - 1.0) * (5.0 / 16.0);
        let r2 = (hashValue(cell, parameters.seed ^ 0xa511e9b3u) * 2.0 - 1.0) * (1.0 / 16.0);
        let rightWeight = 7.0 / 16.0 + parameters.randomness * r1;
        let downWeight = 5.0 / 16.0 - parameters.randomness * r1;
        let downLeftWeight = 3.0 / 16.0 + parameters.randomness * r2;
        let downRightWeight = 1.0 / 16.0 - parameters.randomness * r2;

        if (x + 1u < parameters.outputSize.x) {
          errorBuffer[index + 1u] += error * rightWeight;
        }
        if (row + 1u < parameters.outputSize.y) {
          let below = index + parameters.outputSize.x;
          if (x > 0u) {
            errorBuffer[below - 1u] += error * downLeftWeight;
          }
          errorBuffer[below] += error * downWeight;
          if (x + 1u < parameters.outputSize.x) {
            errorBuffer[below + 1u] += error * downRightWeight;
          }
        }
      }
    }
    storageBarrier();
  }
}
`;

export const displayShader = /* wgsl */ `
struct DisplayParameters {
  logicalSize: vec2u,
  cellSize: vec2f,
  dark: vec4f,
  light: vec4f,
}

@group(0) @binding(0) var<uniform> parameters: DisplayParameters;
@group(0) @binding(1) var<storage, read> outputBits: array<u32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));
  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));
  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));
  let bit = outputBits[cell.y * safeLogicalSize.x + cell.x];
  return select(parameters.dark, parameters.light, bit != 0u);
}
`;

export const blueNoiseWaveShader = /* wgsl */ `
struct Parameters {
  logicalSize: vec2u,
  cellSize: vec2f,
  patternSize: u32,
  patternArea: u32,
  invert: u32,
  time: f32,
  dark: vec4f,
  light: vec4f,
}

@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

fn sourceValue(cell: vec2u) -> f32 {
  let size = max(vec2f(parameters.logicalSize), vec2f(1.0));
  var point = (vec2f(cell) + vec2f(0.5)) / size - vec2f(0.5);
  point.x *= size.x / size.y;

  let time = parameters.time * 0.5;
  let broadWave = sin(point.x * 5.0 + point.y * 2.2 - time * 0.75);
  let crossWave = sin(point.y * 6.0 - point.x * 2.6 + time * 0.48);
  let driftingGlow = cos(distance(point, vec2f(sin(time * 0.19) * 0.3, cos(time * 0.16) * 0.2)) * 6.0 - time * 0.32);
  let rawLuminance = clamp(0.5 + broadWave * 0.2 + crossWave * 0.11 + driftingGlow * 0.14, 0.0, 1.0);
  let luminance = smoothstep(0.32, 0.68, rawLuminance);
  return select(luminance, 1.0 - luminance, parameters.invert != 0u);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));
  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));
  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));
  let patternCell = cell % vec2u(parameters.patternSize);
  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];
  let threshold = (f32(rank) + 0.5) / f32(parameters.patternArea);
  return select(parameters.dark, parameters.light, sourceValue(cell) >= threshold);
}
`;

export const fluidSimulationShader = /* wgsl */ `
struct Parameters {
  size: vec2u,
  deltaTime: f32,
  seed: u32,
  pointer: vec2f,
  pointerVelocity: vec2f,
  pointerActive: f32,
  interactionRadius: f32,
  time: f32,
  quantity: u32,
  viscosity: f32,
}

@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var previousState: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var nextState: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var secondaryState: texture_2d<f32>;

fn simulationUv(cell: vec2u) -> vec2f {
  return (vec2f(cell) + vec2f(0.5)) / vec2f(parameters.size);
}

fn isBoundary(cell: vec2u) -> bool {
  return cell.x == 0u || cell.y == 0u || cell.x + 1u == parameters.size.x || cell.y + 1u == parameters.size.y;
}

fn random01(value: u32) -> f32 {
  var bits = value ^ parameters.seed;
  bits = bits ^ (bits >> 16u);
  bits = bits * 0x7feb352du;
  bits = bits ^ (bits >> 15u);
  bits = bits * 0x846ca68bu;
  bits = bits ^ (bits >> 16u);
  return f32(bits & 0x00ffffffu) / 16777216.0;
}

fn plateTemperature(cell: vec2u) -> f32 {
  let irregularity = random01(cell.x) * 2.0 - 1.0;
  let broadVariation = sin(f32(cell.x) * 0.19 + f32(parameters.seed & 1023u) * 0.013);
  return clamp(0.91 + irregularity * 0.055 + broadVariation * 0.035, 0.78, 1.0);
}

fn wallTemperature(cell: vec2u) -> f32 {
  let verticalPosition = f32(cell.y) / f32(max(parameters.size.y - 1u, 1u));
  return verticalPosition * plateTemperature(cell);
}

@compute @workgroup_size(8, 8)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }

  let uv = simulationUv(id.xy);
  var temperature = exp(-(1.0 - uv.y) * 42.0) * plateTemperature(id.xy);
  if (isBoundary(id.xy)) {
    temperature = wallTemperature(id.xy);
  }
  textureStore(nextState, vec2i(id.xy), vec4f(0.0, 0.0, 0.0, temperature));
}

@compute @workgroup_size(8, 8)
fn clearScalar(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }
  textureStore(nextState, vec2i(id.xy), vec4f(0.0));
}

@compute @workgroup_size(8, 8)
fn resample(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }
  let uv = simulationUv(id.xy);
  let sampled = textureSampleLevel(previousState, linearSampler, uv, 0.0);
  textureStore(nextState, vec2i(id.xy), sampled);
}

@compute @workgroup_size(8, 8)
fn advect(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }

  let cell = id.xy;
  let uv = simulationUv(cell);
  let texel = 1.0 / vec2f(parameters.size);
  let current = textureLoad(previousState, vec2i(cell), 0);

  if (isBoundary(cell)) {
    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, wallTemperature(cell)));
    return;
  }

  let backUv = clamp(uv - current.xy * parameters.deltaTime, texel * 1.5, vec2f(1.0) - texel * 1.5);
  let advected = textureSampleLevel(previousState, linearSampler, backUv, 0.0);
  var velocity = advected.xy;

  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0);
  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0);
  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0);
  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0);
  let neighborVelocity = (left.xy + right.xy + up.xy + down.xy) * 0.25;
  let neighborTemperature = (left.w + right.w + up.w + down.w) * 0.25;
  // Viscosity diffuses velocity gradients, removing small eddies while
  // preserving the large-scale convection. Exponential decay keeps this
  // stable across varying frame times.
  let viscousMix = 1.0 - exp(-parameters.viscosity * parameters.deltaTime);
  velocity = mix(velocity, neighborVelocity, viscousMix);
  var temperature = mix(advected.w, neighborTemperature, min(parameters.deltaTime * 0.9, 0.08));
  temperature *= exp(-parameters.deltaTime * 0.035);

  let plateBand = smoothstep(0.94, 0.995, uv.y);
  temperature = max(temperature, plateBand * plateTemperature(cell));
  temperature *= smoothstep(0.0, 0.075, uv.y);

  // Boussinesq-style buoyancy: hot fluid rises and cool fluid settles.
  // Texture-space Y points downward, so rising velocity is negative.
  velocity.y -= (temperature - 0.16) * parameters.deltaTime * 0.58;
  let fixedPerturbation = random01(cell.x * 1664525u + cell.y * 1013904223u) * 2.0 - 1.0;
  velocity.x += fixedPerturbation * plateBand * parameters.deltaTime * 0.022;

  if (parameters.pointerActive > 0.5) {
    let offset = uv - parameters.pointer;
    let falloff = exp(-dot(offset, offset) / max(0.0001, parameters.interactionRadius * parameters.interactionRadius));
    if (parameters.quantity == 0u) {
      let tangent = vec2f(-offset.y, offset.x);
      velocity += (parameters.pointerVelocity * 1.4 + tangent * 0.4) * falloff * parameters.deltaTime;
    } else {
      temperature += falloff * parameters.deltaTime * 2.5;
    }
  }

  velocity *= exp(-parameters.deltaTime * 0.12);
  let speed = length(velocity);
  if (speed > 0.75) {
    velocity *= 0.75 / speed;
  }

  textureStore(nextState, vec2i(cell), vec4f(velocity, 0.0, clamp(temperature, 0.0, 1.0)));
}

@compute @workgroup_size(8, 8)
fn divergence(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }
  let cell = id.xy;
  if (isBoundary(cell)) {
    textureStore(nextState, vec2i(cell), vec4f(0.0));
    return;
  }

  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).xy;
  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).xy;
  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).xy;
  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).xy;
  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));
  let value = 0.5 * reciprocalCellSize * ((right.x - left.x) + (down.y - up.y));
  textureStore(nextState, vec2i(cell), vec4f(value, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn solvePressure(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }
  let cell = id.xy;
  if (isBoundary(cell)) {
    let interior = clamp(vec2i(cell), vec2i(1), vec2i(parameters.size) - vec2i(2));
    let pressure = textureLoad(previousState, interior, 0).x;
    textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));
    return;
  }

  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).x;
  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).x;
  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).x;
  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).x;
  let source = textureLoad(secondaryState, vec2i(cell), 0).x;
  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));
  let cellSizeSquared = 1.0 / (reciprocalCellSize * reciprocalCellSize);
  let pressure = (left + right + up + down - source * cellSizeSquared) * 0.25;
  textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn project(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }
  let cell = id.xy;
  let advected = textureLoad(previousState, vec2i(cell), 0);
  var temperature = advected.w;

  if (isBoundary(cell)) {
    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, wallTemperature(cell)));
    return;
  }

  let left = textureLoad(secondaryState, vec2i(cell) + vec2i(-1, 0), 0).x;
  let right = textureLoad(secondaryState, vec2i(cell) + vec2i(1, 0), 0).x;
  let up = textureLoad(secondaryState, vec2i(cell) + vec2i(0, -1), 0).x;
  let down = textureLoad(secondaryState, vec2i(cell) + vec2i(0, 1), 0).x;
  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));
  var velocity = advected.xy - 0.5 * reciprocalCellSize * vec2f(right - left, down - up);

  // Prevent the cells beside the perimeter from carrying flow through a wall.
  if (cell.x == 1u && velocity.x < 0.0) { velocity.x = 0.0; }
  if (cell.x + 2u == parameters.size.x && velocity.x > 0.0) { velocity.x = 0.0; }
  if (cell.y == 1u && velocity.y < 0.0) { velocity.y = 0.0; }
  if (cell.y + 2u == parameters.size.y && velocity.y > 0.0) { velocity.y = 0.0; }

  textureStore(nextState, vec2i(cell), vec4f(velocity, 0.0, temperature));
}
`;

export const blueNoiseFluidShader = /* wgsl */ `
struct Parameters {
  logicalSize: vec2u,
  cellSize: vec2f,
  patternSize: u32,
  quantity: u32,
  invert: u32,
  contrast: f32,
  dark: vec4f,
  light: vec4f,
}

@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;
@group(0) @binding(2) var fluidState: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));
  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));
  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));
  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(safeLogicalSize);
  let fluid = textureSampleLevel(fluidState, linearSampler, uv, 0.0);
  let velocityLuminance = smoothstep(0.015, 0.16, length(fluid.xy));
  let temperatureLuminance = smoothstep(0.0, 0.85, fluid.w);
  var luminance = select(velocityLuminance, temperatureLuminance, parameters.quantity != 0u);
  // Expand or collapse the colored areas by pushing luminance away from or
  // toward its midpoint before the blue-noise threshold comparison.
  luminance = clamp((luminance - 0.5) * parameters.contrast + 0.5, 0.0, 1.0);
  let source = select(luminance, 1.0 - luminance, parameters.invert != 0u);
  let patternCell = cell % vec2u(parameters.patternSize);
  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];
  let threshold = (f32(rank) + 0.5) / f32(parameters.patternSize * parameters.patternSize);
  return select(parameters.dark, parameters.light, source >= threshold);
}
`;

export const leniaShader = /* wgsl */ `
struct Parameters {
  size: vec2u,
  deltaTime: f32,
  seed: u32,
  pointer: vec2f,
  pointerActive: f32,
  interactionRadius: f32,
  time: f32,
  mu: f32,
  sigma: f32,
  contrast: f32,
  invert: u32,
  kernelRadius: u32,
  logicalSize: vec2u,
  cellSize: vec2f,
  patternSize: u32,
  kernelConfig: u32,
  dark: vec4f,
  light: vec4f,
  kernelPeaks: vec4f,
}

@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var previousState: texture_2d<f32>;
@group(0) @binding(2) var nextState: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var<storage, read> initialState: array<f32>;

fn kernelPeak(index: u32) -> f32 {
  if (index == 0u) { return parameters.kernelPeaks.x; }
  if (index == 1u) { return parameters.kernelPeaks.y; }
  if (index == 2u) { return parameters.kernelPeaks.z; }
  return parameters.kernelPeaks.w;
}

// Catalog presets can combine up to four concentric bump4 or quad4 bands.
fn kernelWeight(distance: f32) -> f32 {
  let r = distance / f32(parameters.kernelRadius);
  if (r <= 0.0 || r >= 1.0) {
    return 0.0;
  }
  let peakCount = max(parameters.kernelConfig & 0xffu, 1u);
  let bandPosition = r * f32(peakCount);
  let bandIndex = min(u32(floor(bandPosition)), peakCount - 1u);
  let bandR = fract(bandPosition);
  let core = select(
    exp(4.0 - 1.0 / (bandR * (1.0 - bandR))),
    pow(4.0 * bandR * (1.0 - bandR), 4.0),
    (parameters.kernelConfig & 0x100u) != 0u,
  );
  return kernelPeak(bandIndex) * core;
}

@compute @workgroup_size(8, 8)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }

  let value = initialState[id.y * parameters.size.x + id.x];
  textureStore(nextState, vec2i(id.xy), vec4f(value, 0.0, 0.0, 1.0));
}

@compute @workgroup_size(8, 8)
fn resample(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }
  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(parameters.size);
  textureStore(nextState, vec2i(id.xy), textureSampleLevel(previousState, linearSampler, uv, 0.0));
}

@compute @workgroup_size(8, 8)
fn advance(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) {
    return;
  }

  let cell = vec2i(id.xy);
  let extent = i32(parameters.kernelRadius);
  var potential = 0.0;
  var normalization = 0.0;
  for (var dy = -extent; dy <= extent; dy += 1) {
    for (var dx = -extent; dx <= extent; dx += 1) {
      let weight = kernelWeight(length(vec2f(f32(dx), f32(dy))));
      if (weight > 0.0) {
        let sampleX = (cell.x + dx + i32(parameters.size.x)) % i32(parameters.size.x);
        let sampleY = (cell.y + dy + i32(parameters.size.y)) % i32(parameters.size.y);
        potential += weight * textureLoad(previousState, vec2i(sampleX, sampleY), 0).x;
        normalization += weight;
      }
    }
  }
  potential /= normalization;

  let deviation = potential - parameters.mu;
  let gaussianGrowth = exp(-deviation * deviation / (2.0 * parameters.sigma * parameters.sigma));
  let polynomialBase = max(0.0, 1.0 - deviation * deviation / (9.0 * parameters.sigma * parameters.sigma));
  let polynomialGrowth = pow(polynomialBase, 4.0);
  let growth = 2.0 * select(
    gaussianGrowth,
    polynomialGrowth,
    (parameters.kernelConfig & 0x200u) != 0u,
  ) - 1.0;
  var state = textureLoad(previousState, cell, 0).x + parameters.deltaTime * growth;

  // Pointer interaction injects a soft creature-sized blob.
  if (parameters.pointerActive > 0.5) {
    let offset = (vec2f(cell) + vec2f(0.5)) / vec2f(parameters.size) - parameters.pointer;
    let scaled = offset * vec2f(f32(parameters.size.x), f32(parameters.size.y));
    let sigmaCells = parameters.interactionRadius * f32(parameters.size.y);
    let gaussian = 0.95 * exp(-dot(scaled, scaled) / (2.0 * sigmaCells * sigmaCells));
    state = max(state, gaussian);
  }

  textureStore(nextState, cell, vec4f(clamp(state, 0.0, 1.0), 0.0, 0.0, 1.0));
}
`;

export const blueNoiseLeniaShader = /* wgsl */ `
struct Parameters {
  size: vec2u,
  deltaTime: f32,
  seed: u32,
  pointer: vec2f,
  pointerActive: f32,
  interactionRadius: f32,
  time: f32,
  mu: f32,
  sigma: f32,
  contrast: f32,
  invert: u32,
  kernelRadius: u32,
  logicalSize: vec2u,
  cellSize: vec2f,
  patternSize: u32,
  kernelConfig: u32,
  dark: vec4f,
  light: vec4f,
  kernelPeaks: vec4f,
}

@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;
@group(0) @binding(2) var leniaState: texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var previousLeniaState: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

fn mitchellWeight(distance: f32) -> f32 {
  let x = abs(distance);
  if (x <= 1.0) {
    return (7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0) / 6.0;
  }
  if (x < 2.0) {
    return ((-7.0 / 3.0 * x + 12.0) * x * x - 20.0 * x + 32.0 / 3.0) / 6.0;
  }
  return 0.0;
}

fn sampleBicubic(stateTexture: texture_2d<f32>, uv: vec2f) -> f32 {
  let textureSize = vec2i(textureDimensions(stateTexture));
  let position = uv * vec2f(textureSize) - vec2f(0.5);
  let base = vec2i(floor(position));
  let fraction = fract(position);
  var value = 0.0;
  var totalWeight = 0.0;

  for (var y = -1; y <= 2; y += 1) {
    let weightY = mitchellWeight(f32(y) - fraction.y);
    for (var x = -1; x <= 2; x += 1) {
      let weight = mitchellWeight(f32(x) - fraction.x) * weightY;
      let cell = clamp(base + vec2i(x, y), vec2i(0), textureSize - vec2i(1));
      value += textureLoad(stateTexture, cell, 0).x * weight;
      totalWeight += weight;
    }
  }
  return clamp(value / max(totalWeight, 0.0001), 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));
  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));
  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));
  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(safeLogicalSize);
  let ditherDisabled = (parameters.kernelConfig & 0x400u) != 0u;
  var currentState = textureSampleLevel(leniaState, linearSampler, uv, 0.0).x;
  var previousState = textureSampleLevel(previousLeniaState, linearSampler, uv, 0.0).x;
  if (ditherDisabled) {
    currentState = sampleBicubic(leniaState, uv);
    previousState = sampleBicubic(previousLeniaState, uv);
  }
  let state = mix(previousState, currentState, clamp(parameters.time, 0.0, 1.0));
  // Preserve faint densities in source-debug mode; the dithered presentation
  // keeps its tighter curve so the blue-noise pattern remains well defined.
  var luminance = select(smoothstep(0.04, 0.5, state), pow(clamp(state, 0.0, 1.0), 0.8), ditherDisabled);
  luminance = clamp((luminance - 0.5) * parameters.contrast + 0.5, 0.0, 1.0);
  let source = select(luminance, 1.0 - luminance, parameters.invert != 0u);
  if (ditherDisabled) {
    return mix(parameters.dark, parameters.light, source);
  }
  let patternCell = cell % vec2u(parameters.patternSize);
  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];
  let threshold = (f32(rank) + 0.5) / f32(parameters.patternSize * parameters.patternSize);
  return select(parameters.dark, parameters.light, source >= threshold);
}
`;
