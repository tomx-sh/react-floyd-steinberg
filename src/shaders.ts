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
