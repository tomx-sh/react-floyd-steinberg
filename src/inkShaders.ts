// Adapted from https://vgpu.sh/examples/fluid; MIT, Copyright (c) 2025 Vercel, Inc.
// See THIRD_PARTY_NOTICES.md. Physics constants and pass order follow the source.

const common = /* wgsl */ `struct Grid {
  size: vec2u,
  dye_size: vec2u,
}

struct Input {
  step: u32,
  pointer_active: f32,
  pointer_from: vec2f,
  pointer_to: vec2f,
  pointer_velocity: vec2f,
  idle_a: vec4f,
  idle_b: vec4f,
  pointer_radius_squared: f32,
}

fn index_of(p: vec2i, size: vec2u) -> u32 {
  let q = clamp(p, vec2i(0), vec2i(size) - 1);
  return u32(q.y) * size.x + u32(q.x);
}

fn cell_uv(p: vec2i, size: vec2u) -> vec2f {
  return (vec2f(p) + 0.5) / vec2f(size);
}

fn segment_weight(
  p: vec2f,
  a: vec2f,
  b: vec2f,
  radius_squared: f32,
  aspect: f32,
) -> f32 {
  let scale = vec2f(aspect, 1.0);
  let point = p * scale;
  let origin = a * scale;
  let delta = (b - a) * scale;
  let t = clamp(dot(point - origin, delta) / max(dot(delta, delta), 1e-7), 0.0, 1.0);
  let d = point - (origin + t * delta);
  return exp(-dot(d, d) / radius_squared);
}

fn emitter_weight(p: vec2f, emitter: vec4f, aspect: f32) -> f32 {
  let d = (p - emitter.xy) * vec2f(aspect, 1.0);
  return exp(-dot(d, d) / emitter.w) * emitter.z;
}
`;

export const blueNoiseInkShader = /* wgsl */ `
struct Grid {
  size: vec2u,
  dye_size: vec2u,
}
struct Display {
  logicalSize: vec2u,
  cellSize: vec2f,
  patternSize: u32,
  invert: u32,
  contrast: f32,
  padding: f32,
  dark: vec4f,
  light: vec4f,
}
@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<uniform> display: Display;
@group(0) @binding(2) var<storage, read> dye: array<f32>;
@group(0) @binding(3) var<storage, read> noiseRanks: array<u32>;

fn index_of(p: vec2i) -> u32 {
  let q = clamp(p, vec2i(0), vec2i(grid.dye_size) - 1);
  return u32(q.y) * grid.dye_size.x + u32(q.x);
}
fn sample_dye(uv: vec2f) -> f32 {
  let coord = clamp(uv * vec2f(grid.dye_size) - 0.5, vec2f(0), vec2f(grid.dye_size) - 1.0);
  let cell = vec2i(floor(coord));
  let f = fract(coord);
  let bottom = mix(dye[index_of(cell)], dye[index_of(cell + vec2i(1, 0))], f.x);
  let top = mix(dye[index_of(cell + vec2i(0, 1))], dye[index_of(cell + vec2i(1, 1))], f.x);
  return mix(bottom, top, f.y);
}
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let x = f32((index << 1u) & 2u);
  let y = f32(index & 2u);
  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}
@fragment
fn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = max(display.logicalSize, vec2u(1u));
  let cell = min(vec2u(position.xy / max(display.cellSize, vec2f(0.0001))), size - vec2u(1u));
  var uv = (vec2f(cell) + 0.5) / vec2f(size);
  uv.y = 1.0 - uv.y;
  let density = sample_dye(uv);
  let vignette = 0.68 + 0.32 * pow(max(0.0, 1.0 - dot(uv - 0.5, uv - 0.5) * 1.9), 1.5);
  var luminance = (1.0 - exp(-density * 1.35)) * vignette;
  luminance = clamp((luminance - 0.5) * display.contrast + 0.5, 0.0, 1.0);
  luminance = select(luminance, 1.0 - luminance, display.invert != 0u);
  let patternCell = cell % vec2u(display.patternSize);
  let rank = noiseRanks[patternCell.y * display.patternSize + patternCell.x];
  let threshold = (f32(rank) + 0.5) / f32(display.patternSize * display.patternSize);
  return select(display.dark, display.light, luminance >= threshold);
}
`;

export const inkAdvectVelocityShader = common + /* wgsl */ `@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<uniform> input: Input;
@group(0) @binding(2) var<storage, read> src: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec2f>;

fn sample_velocity(p: vec2f) -> vec2f {
  let coord = clamp(p * vec2f(grid.size) - 0.5, vec2f(0), vec2f(grid.size) - 1.0);
  let cell = vec2i(floor(coord));
  let f = fract(coord);
  let bottom = mix(src[index_of(cell, grid.size)], src[index_of(cell + vec2i(1, 0), grid.size)], f.x);
  let top = mix(src[index_of(cell + vec2i(0, 1), grid.size)], src[index_of(cell + vec2i(1, 1), grid.size)], f.x);
  return mix(bottom, top, f.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let cell = vec2i(id.xy);
  let p = cell_uv(cell, grid.size);
  let aspect = f32(grid.size.x) / f32(grid.size.y);
  let dt = 1.0 / 60.0;
  let source_velocity = src[index_of(cell, grid.size)];
  let backtrace = clamp(p - dt * source_velocity, 0.5 / vec2f(grid.size), 1.0 - 0.5 / vec2f(grid.size));
  var velocity = 0.98 * sample_velocity(backtrace);

  let weight_a = emitter_weight(p, input.idle_a, aspect);
  let weight_b = emitter_weight(p, input.idle_b, aspect);
  let time = f32(input.step) / 60.0;
  let tangent_a = vec2f(0.28 * 0.73 * cos(0.73 * time), 0.22 * 1.09 * cos(1.09 * time + 0.4));
  let tangent_b = vec2f(0.26 * 0.61 * cos(0.61 * time + 3.14159265), 0.24 * 0.97 * cos(0.97 * time + 2.1));
  velocity += dt * (weight_a * (2.6 * tangent_a + 2.0 * vec2f(-tangent_a.y, tangent_a.x))
                  + weight_b * (2.6 * tangent_b - 2.0 * vec2f(-tangent_b.y, tangent_b.x)));

  if (input.pointer_active > 0.0) {
    let weight = segment_weight(p, input.pointer_from, input.pointer_to, input.pointer_radius_squared, aspect);
    velocity += weight * input.pointer_velocity * 0.8;
  }

  let speed = length(velocity);
  if (speed > 2.5) { velocity *= 2.5 / speed; }
  dst[index_of(cell, grid.size)] = velocity;
}
`;

export const inkCurlShader = common + /* wgsl */ `@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<storage, read> velocity: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> curl: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  let left = velocity[index_of(p - vec2i(1, 0), grid.size)].y;
  let right = velocity[index_of(p + vec2i(1, 0), grid.size)].y;
  let top = velocity[index_of(p + vec2i(0, 1), grid.size)].x;
  let bottom = velocity[index_of(p - vec2i(0, 1), grid.size)].x;
  curl[index_of(p, grid.size)] = 0.5 * (right - left - top + bottom);
}
`;

export const inkVorticityShader = common + /* wgsl */ `@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read> curl: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec2f>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  let left = abs(curl[index_of(p - vec2i(1, 0), grid.size)]);
  let right = abs(curl[index_of(p + vec2i(1, 0), grid.size)]);
  let top = abs(curl[index_of(p + vec2i(0, 1), grid.size)]);
  let bottom = abs(curl[index_of(p - vec2i(0, 1), grid.size)]);
  let center = curl[index_of(p, grid.size)];

  var force = 0.5 * vec2f(top - bottom, right - left);
  force /= length(force) + 0.0001;
  force *= 20.0 * center;
  force.y *= -1.0;

  var velocity = src[index_of(p, grid.size)] + force / 60.0;
  let speed = length(velocity);
  if (speed > 2.5) { velocity *= 2.5 / speed; }
  dst[index_of(p, grid.size)] = velocity;
}
`;

export const inkDivergenceShader = common + /* wgsl */ `@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<storage, read> velocity: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> divergence: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  let last = vec2i(grid.size) - 1;
  let l = select(velocity[index_of(p - vec2i(1, 0), grid.size)].x, 0.0, p.x == 0);
  let r = select(velocity[index_of(p + vec2i(1, 0), grid.size)].x, 0.0, p.x == last.x);
  let b = select(velocity[index_of(p - vec2i(0, 1), grid.size)].y, 0.0, p.y == 0);
  let t = select(velocity[index_of(p + vec2i(0, 1), grid.size)].y, 0.0, p.y == last.y);
  divergence[index_of(p, grid.size)] =
    (r - l)*.5*f32(grid.size.x) + (t - b)*.5*f32(grid.size.y);
}
`;

export const inkPressureShader = common + /* wgsl */ `struct PressureParams {
  decay: f32,
}
@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<uniform> params: PressureParams;
@group(0) @binding(2) var<storage, read> src: array<f32>;
@group(0) @binding(3) var<storage, read> divergence: array<f32>;
@group(0) @binding(4) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  let i = index_of(p, grid.size);
  let center = src[i];
  let last = vec2i(grid.size) - 1;
  let left = select(src[index_of(p - vec2i(1, 0), grid.size)], center, p.x == 0) * params.decay;
  let right = select(src[index_of(p + vec2i(1, 0), grid.size)], center, p.x == last.x) * params.decay;
  let bottom = select(src[index_of(p - vec2i(0, 1), grid.size)], center, p.y == 0) * params.decay;
  let top = select(src[index_of(p + vec2i(0, 1), grid.size)], center, p.y == last.y) * params.decay;
  let wx = f32(grid.size.x * grid.size.x);
  let wy = f32(grid.size.y * grid.size.y);
  dst[i] = ((left + right) * wx + (bottom + top) * wy - divergence[i]) / (2.0 * wx + 2.0 * wy);
}
`;

export const inkProjectShader = common + /* wgsl */ `@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<storage, read> src: array<vec2f>;
@group(0) @binding(2) var<storage, read> pressure: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec2f>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.size)) { return; }
  let p = vec2i(id.xy);
  let last = vec2i(grid.size) - 1;
  let c = pressure[index_of(p, grid.size)];
  let l = select(pressure[index_of(p - vec2i(1, 0), grid.size)], c, p.x == 0);
  let r = select(pressure[index_of(p + vec2i(1, 0), grid.size)], c, p.x == last.x);
  let b = select(pressure[index_of(p - vec2i(0, 1), grid.size)], c, p.y == 0);
  let t = select(pressure[index_of(p + vec2i(0, 1), grid.size)], c, p.y == last.y);
  var u = src[index_of(p, grid.size)] - vec2f(
    (r - l)*.5*f32(grid.size.x),
    (t - b)*.5*f32(grid.size.y),
  );
  if (p.x == 0 && u.x < 0.0) { u.x = 0.0; }
  if (p.x == last.x && u.x > 0.0) { u.x = 0.0; }
  if (p.y == 0 && u.y < 0.0) { u.y = 0.0; }
  if (p.y == last.y && u.y > 0.0) { u.y = 0.0; }
  let s = length(u);
  if (s > 2.5) { u *= 2.5 / s; }
  dst[index_of(p, grid.size)] = u;
}
`;

export const inkAdvectDyeShader = common + /* wgsl */ `@group(0) @binding(0) var<uniform> grid: Grid;
@group(0) @binding(1) var<uniform> input: Input;
@group(0) @binding(2) var<storage, read> src: array<f32>;
@group(0) @binding(3) var<storage, read> velocity: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> dst: array<f32>;

fn sample_dye(p: vec2f) -> f32 {
  let coord = clamp(p * vec2f(grid.dye_size) - 0.5, vec2f(0), vec2f(grid.dye_size) - 1.0);
  let cell = vec2i(floor(coord));
  let f = fract(coord);
  let bottom = mix(src[index_of(cell, grid.dye_size)], src[index_of(cell + vec2i(1, 0), grid.dye_size)], f.x);
  let top = mix(
    src[index_of(cell + vec2i(0, 1), grid.dye_size)],
    src[index_of(cell + vec2i(1, 1), grid.dye_size)],
    f.x,
  );
  return mix(bottom, top, f.y);
}

fn sample_velocity(p: vec2f) -> vec2f {
  let coord = clamp(p * vec2f(grid.size) - 0.5, vec2f(0), vec2f(grid.size) - 1.0);
  let cell = vec2i(floor(coord));
  let f = fract(coord);
  let bottom = mix(velocity[index_of(cell, grid.size)], velocity[index_of(cell + vec2i(1, 0), grid.size)], f.x);
  let top = mix(
    velocity[index_of(cell + vec2i(0, 1), grid.size)],
    velocity[index_of(cell + vec2i(1, 1), grid.size)],
    f.x,
  );
  return mix(bottom, top, f.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= grid.dye_size)) { return; }
  let cell = vec2i(id.xy);
  let p = cell_uv(cell, grid.dye_size);
  let aspect = f32(grid.size.x) / f32(grid.size.y);
  let backtrace = clamp(p - sample_velocity(p) / 60.0, 0.5 / vec2f(grid.dye_size), 1.0 - 0.5 / vec2f(grid.dye_size));
  var density = 0.97 * sample_dye(backtrace);

  density += emitter_weight(p, input.idle_a, aspect) * 0.12;
  density += emitter_weight(p, input.idle_b, aspect) * 0.115;
  if (input.pointer_active > 0.0) {
    let weight = segment_weight(p, input.pointer_from, input.pointer_to, input.pointer_radius_squared, aspect);
    density += weight * 0.35;
  }

  dst[index_of(cell, grid.dye_size)] = clamp(density, 0.0, 4.0);
}
`;
