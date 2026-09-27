export const paintSimulationShader = /* wgsl */ `
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
  swirlStrength: f32,
}

@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var previousState: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var nextState: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var secondaryState: texture_2d<f32>;

// Velocity is measured in shorter-side lengths per second, so eddies stay
// circular and pressure uses square cells in both portrait and landscape.
fn gridScale() -> f32 { return f32(min(parameters.size.x, parameters.size.y)); }
fn domainSize() -> vec2f { return vec2f(parameters.size) / gridScale(); }
fn simulationUv(cell: vec2u) -> vec2f {
  return (vec2f(cell) + vec2f(0.5)) / vec2f(parameters.size);
}
fn isBoundary(cell: vec2u) -> bool {
  return any(cell == vec2u(0u)) || any(cell + vec2u(1u) == parameters.size);
}
fn nearestInterior(cell: vec2u) -> vec2i {
  return clamp(vec2i(cell), vec2i(1), vec2i(parameters.size) - vec2i(2));
}
fn random01(value: u32) -> f32 {
  var bits = value ^ parameters.seed;
  bits = (bits ^ (bits >> 16u)) * 0x7feb352du;
  bits = (bits ^ (bits >> 15u)) * 0x846ca68bu;
  bits = bits ^ (bits >> 16u);
  return f32(bits & 0x00ffffffu) / 16777216.0;
}
fn vortexCenter(index: u32) -> vec2f {
  let phase = random01(index * 7u + 1u) * 6.2831853;
  let base = vec2f(0.24 + 0.52 * random01(index * 7u + 2u),
                   0.24 + 0.52 * random01(index * 7u + 3u));
  return base + vec2f(sin(parameters.time * 0.13 + phase),
                     cos(parameters.time * 0.11 + phase * 1.7)) * 0.1;
}
fn stirringVelocity(uv: vec2f) -> vec2f {
  var velocity = vec2f(0.0);
  for (var i = 0u; i < 6u; i += 1u) {
    let offset = (uv - vortexCenter(i)) * domainSize();
    let radius = 0.18 + random01(i * 7u + 4u) * 0.16;
    let falloff = exp(-dot(offset, offset) / (radius * radius));
    let direction = select(-1.0, 1.0, i % 2u == 0u);
    let pulse = 0.8 + 0.2 * sin(parameters.time * 0.17 + f32(i) * 2.1);
    velocity += vec2f(-offset.y, offset.x) / radius * falloff * direction * pulse * 0.42;
  }
  return velocity * parameters.swirlStrength;
}
fn confinedVelocity(cell: vec2u, value: vec2f) -> vec2f {
  var velocity = value;
  let first = 1u;
  let last = parameters.size - vec2u(2u);
  if (cell.x <= first && velocity.x < 0.0) { velocity.x = 0.0; }
  if (cell.x >= last.x && velocity.x > 0.0) { velocity.x = 0.0; }
  if (cell.y <= first && velocity.y < 0.0) { velocity.y = 0.0; }
  if (cell.y >= last.y && velocity.y > 0.0) { velocity.y = 0.0; }
  let speed = length(velocity);
  return velocity * min(1.0, 0.65 / max(speed, 0.00001));
}

@compute @workgroup_size(8, 8)
fn initialize(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) { return; }
  // Begin empty and at rest; the sources build the scene over time.
  textureStore(nextState, vec2i(id.xy), vec4f(0.0));
}

@compute @workgroup_size(8, 8)
fn clearScalar(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) { return; }
  textureStore(nextState, vec2i(id.xy), vec4f(0.0));
}

@compute @workgroup_size(8, 8)
fn resample(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) { return; }
  let state = textureSampleLevel(previousState, linearSampler, simulationUv(id.xy), 0.0);
  var velocity = confinedVelocity(id.xy, state.xy);
  if (isBoundary(id.xy)) {
    velocity = vec2f(0.0);
  }
  textureStore(nextState, vec2i(id.xy), vec4f(velocity, 0.0, state.w));
}

@compute @workgroup_size(8, 8)
fn advect(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) { return; }
  let cell = id.xy;
  if (isBoundary(cell)) {
    // Solid walls stop motion, but pigment can reach them without being erased.
    let pigment = textureLoad(previousState, nearestInterior(cell), 0).w;
    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, pigment));
    return;
  }
  let uv = simulationUv(cell);
  let current = textureLoad(previousState, vec2i(cell), 0);
  let sampleMin = vec2f(1.5) / vec2f(parameters.size);
  let backUv = clamp(uv - current.xy * parameters.deltaTime / domainSize(), sampleMin, vec2f(1.0) - sampleMin);
  let advected = textureSampleLevel(previousState, linearSampler, backUv, 0.0);
  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0);
  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0);
  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0);
  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0);
  let neighborVelocity = (left.xy + right.xy + up.xy + down.xy) * 0.25;
  var velocity = mix(advected.xy, neighborVelocity, 1.0 - exp(-parameters.viscosity * parameters.deltaTime));

  // A changing mixture of clockwise and counterclockwise eddies supplies
  // energy throughout the box. There is no gravity or preferred direction.
  // Ease in automatic stirring and pigment over the first two seconds.
  let startup = smoothstep(0.0, 2.0, parameters.time);
  velocity = mix(velocity, stirringVelocity(uv) * startup, 1.0 - exp(-parameters.deltaTime * 0.65));
  var pigment = advected.w * exp(-parameters.deltaTime * 0.045);
  // Slowly replenish paint in the interior so a long-running scene does not
  // diffuse to a uniform field. These sources travel with the stirring centers.
  for (var i = 0u; i < 3u; i += 1u) {
    let offset = (uv - vortexCenter(i * 2u)) * domainSize();
    let source = exp(-dot(offset, offset) / 0.012);
    pigment += source * (1.0 - pigment) * parameters.deltaTime * 0.3 * startup;
  }

  if (parameters.pointerActive > 0.5) {
    let offset = (uv - parameters.pointer) * domainSize();
    let radius = max(0.01, parameters.interactionRadius);
    let falloff = exp(-dot(offset, offset) / (radius * radius));
    velocity += parameters.pointerVelocity * domainSize() * falloff * parameters.deltaTime * 1.8;
    if (parameters.quantity != 0u) {
      pigment += falloff * parameters.deltaTime * 2.5;
    }
  }

  textureStore(nextState, vec2i(cell), vec4f(confinedVelocity(cell, velocity), 0.0, clamp(pigment, 0.0, 1.0)));
}

@compute @workgroup_size(8, 8)
fn divergence(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) { return; }
  let cell = id.xy;
  if (isBoundary(cell)) {
    textureStore(nextState, vec2i(cell), vec4f(0.0));
    return;
  }
  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).xy;
  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).xy;
  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).xy;
  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).xy;
  let value = 0.5 * gridScale() * (right.x - left.x + down.y - up.y);
  textureStore(nextState, vec2i(cell), vec4f(value, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn solvePressure(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) { return; }
  let cell = id.xy;
  if (isBoundary(cell)) {
    // Neumann pressure at the canvas walls: copy the nearest fluid cell.
    let pressure = textureLoad(previousState, nearestInterior(cell), 0).x;
    textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));
    return;
  }
  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).x;
  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).x;
  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).x;
  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).x;
  let source = textureLoad(secondaryState, vec2i(cell), 0).x;
  let pressure = (left + right + up + down - source / (gridScale() * gridScale())) * 0.25;
  textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn project(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= parameters.size)) { return; }
  let cell = id.xy;
  let advected = textureLoad(previousState, vec2i(cell), 0);
  if (isBoundary(cell)) {
    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, advected.w));
    return;
  }
  let left = textureLoad(secondaryState, vec2i(cell) + vec2i(-1, 0), 0).x;
  let right = textureLoad(secondaryState, vec2i(cell) + vec2i(1, 0), 0).x;
  let up = textureLoad(secondaryState, vec2i(cell) + vec2i(0, -1), 0).x;
  let down = textureLoad(secondaryState, vec2i(cell) + vec2i(0, 1), 0).x;
  let velocity = advected.xy - 0.5 * gridScale() * vec2f(right - left, down - up);
  textureStore(nextState, vec2i(cell), vec4f(confinedVelocity(cell, velocity), 0.0, advected.w));
}
`;

export const blueNoisePaintShader = /* wgsl */ `
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
  let size = max(parameters.logicalSize, vec2u(1u));
  let cell = min(vec2u(position.xy / max(parameters.cellSize, vec2f(0.0001))), size - vec2u(1u));
  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(size);
  let fluid = textureSampleLevel(fluidState, linearSampler, uv, 0.0);
  let pigment = smoothstep(0.06, 0.72, fluid.w);
  let speed = smoothstep(0.008, 0.2, length(fluid.xy));
  var luminance = select(speed, pigment, parameters.quantity != 0u);
  luminance = clamp((luminance - 0.5) * parameters.contrast + 0.5, 0.0, 1.0);
  luminance = select(luminance, 1.0 - luminance, parameters.invert != 0u);
  let patternCell = cell % vec2u(parameters.patternSize);
  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];
  let threshold = (f32(rank) + 0.5) / f32(parameters.patternSize * parameters.patternSize);
  return select(parameters.dark, parameters.light, luminance >= threshold);
}
`;
