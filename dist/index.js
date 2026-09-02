import { useCallback as e, useEffect as t, useLayoutEffect as n, useRef as r, useState as i } from "react";
import { jsx as a } from "react/jsx-runtime";
//#region src/shaders.ts
var o = "\nstruct Parameters {\n  outputSize: vec2u,\n  sourceSize: vec2u,\n  fit: u32,\n  invert: u32,\n  threshold: f32,\n  randomness: f32,\n  seed: u32,\n  alphaBackground: f32,\n  padding0: u32,\n  padding1: u32,\n}\n\nstruct Band {\n  firstRow: u32,\n  rowCount: u32,\n  padding0: u32,\n  padding1: u32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read_write> outputBits: array<u32>;\n@group(0) @binding(2) var<storage, read_write> errorBuffer: array<f32>;\n@group(0) @binding(3) var<uniform> band: Band;\n@group(0) @binding(4) var sourceTexture: texture_2d<f32>;\n\nfn hashValue(cell: vec2u, seed: u32) -> f32 {\n  var value = cell.x * 0x9e3779b9u + cell.y * 0x85ebca6bu + seed;\n  value = (value ^ (value >> 16u)) * 0x7feb352du;\n  value = (value ^ (value >> 15u)) * 0x846ca68bu;\n  value = value ^ (value >> 16u);\n  return f32(value) / 4294967295.0;\n}\n\nfn fittedUv(cell: vec2u) -> vec3f {\n  let outputSize = vec2f(parameters.outputSize);\n  let sourceSize = vec2f(parameters.sourceSize);\n  let outputAspect = outputSize.x / outputSize.y;\n  let sourceAspect = sourceSize.x / sourceSize.y;\n  var uv = (vec2f(cell) + vec2f(0.5)) / outputSize;\n\n  if (parameters.fit == 1u) {\n    // Cover: crop the longer source axis.\n    if (sourceAspect > outputAspect) {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    } else {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    }\n  } else if (parameters.fit == 2u) {\n    // Contain: map the letterboxed output area outside the source UV range.\n    if (sourceAspect > outputAspect) {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    } else {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    }\n  }\n\n  let inside = select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));\n  return vec3f(uv, inside);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let fitted = fittedUv(cell);\n  var luminance = parameters.alphaBackground;\n\n  if (fitted.z > 0.5) {\n    let maxPosition = vec2i(parameters.sourceSize) - vec2i(1);\n    let position = clamp(vec2i(fitted.xy * vec2f(parameters.sourceSize)), vec2i(0), maxPosition);\n    let color = textureLoad(sourceTexture, position, 0);\n    let imageLuminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));\n    luminance = mix(parameters.alphaBackground, imageLuminance, color.a);\n  }\n\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@compute @workgroup_size(256)\nfn main(@builtin(local_invocation_index) localRow: u32) {\n  let row = band.firstRow + localRow;\n  let activeRow = localRow < band.rowCount && row < parameters.outputSize.y;\n  var phaseCount = parameters.outputSize.x;\n  if (band.rowCount > 0u) {\n    phaseCount += 3u * (band.rowCount - 1u);\n  }\n\n  for (var phase = 0u; phase < phaseCount; phase += 1u) {\n    let rowDelay = 3u * localRow;\n    if (activeRow && phase >= rowDelay) {\n      let x = phase - rowDelay;\n      if (x < parameters.outputSize.x) {\n        let cell = vec2u(x, row);\n        let index = row * parameters.outputSize.x + x;\n        let value = clamp(sourceValue(cell) + errorBuffer[index], 0.0, 1.0);\n        let bit = select(0u, 1u, value >= parameters.threshold);\n        let error = value - f32(bit);\n        outputBits[index] = bit;\n\n        let r1 = (hashValue(cell, parameters.seed) * 2.0 - 1.0) * (5.0 / 16.0);\n        let r2 = (hashValue(cell, parameters.seed ^ 0xa511e9b3u) * 2.0 - 1.0) * (1.0 / 16.0);\n        let rightWeight = 7.0 / 16.0 + parameters.randomness * r1;\n        let downWeight = 5.0 / 16.0 - parameters.randomness * r1;\n        let downLeftWeight = 3.0 / 16.0 + parameters.randomness * r2;\n        let downRightWeight = 1.0 / 16.0 - parameters.randomness * r2;\n\n        if (x + 1u < parameters.outputSize.x) {\n          errorBuffer[index + 1u] += error * rightWeight;\n        }\n        if (row + 1u < parameters.outputSize.y) {\n          let below = index + parameters.outputSize.x;\n          if (x > 0u) {\n            errorBuffer[below - 1u] += error * downLeftWeight;\n          }\n          errorBuffer[below] += error * downWeight;\n          if (x + 1u < parameters.outputSize.x) {\n            errorBuffer[below + 1u] += error * downRightWeight;\n          }\n        }\n      }\n    }\n    storageBarrier();\n  }\n}\n", s = "\nstruct DisplayParameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: DisplayParameters;\n@group(0) @binding(1) var<storage, read> outputBits: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let bit = outputBits[cell.y * safeLogicalSize.x + cell.x];\n  return select(parameters.dark, parameters.light, bit != 0u);\n}\n", c = "\nstruct Parameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  patternArea: u32,\n  invert: u32,\n  time: f32,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let size = max(vec2f(parameters.logicalSize), vec2f(1.0));\n  var point = (vec2f(cell) + vec2f(0.5)) / size - vec2f(0.5);\n  point.x *= size.x / size.y;\n\n  let time = parameters.time * 0.5;\n  let broadWave = sin(point.x * 5.0 + point.y * 2.2 - time * 0.75);\n  let crossWave = sin(point.y * 6.0 - point.x * 2.6 + time * 0.48);\n  let driftingGlow = cos(distance(point, vec2f(sin(time * 0.19) * 0.3, cos(time * 0.16) * 0.2)) * 6.0 - time * 0.32);\n  let rawLuminance = clamp(0.5 + broadWave * 0.2 + crossWave * 0.11 + driftingGlow * 0.14, 0.0, 1.0);\n  let luminance = smoothstep(0.32, 0.68, rawLuminance);\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternArea);\n  return select(parameters.dark, parameters.light, sourceValue(cell) >= threshold);\n}\n", l = "\nstruct Parameters {\n  size: vec2u,\n  deltaTime: f32,\n  seed: u32,\n  pointer: vec2f,\n  pointerVelocity: vec2f,\n  pointerActive: f32,\n  interactionRadius: f32,\n  time: f32,\n  padding: f32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var previousState: texture_2d<f32>;\n@group(0) @binding(2) var linearSampler: sampler;\n@group(0) @binding(3) var nextState: texture_storage_2d<rgba16float, write>;\n@group(0) @binding(4) var secondaryState: texture_2d<f32>;\n\nfn simulationUv(cell: vec2u) -> vec2f {\n  return (vec2f(cell) + vec2f(0.5)) / vec2f(parameters.size);\n}\n\nfn isBoundary(cell: vec2u) -> bool {\n  return cell.x == 0u || cell.y == 0u || cell.x + 1u == parameters.size.x || cell.y + 1u == parameters.size.y;\n}\n\nfn random01(value: u32) -> f32 {\n  var bits = value ^ parameters.seed;\n  bits = bits ^ (bits >> 16u);\n  bits = bits * 0x7feb352du;\n  bits = bits ^ (bits >> 15u);\n  bits = bits * 0x846ca68bu;\n  bits = bits ^ (bits >> 16u);\n  return f32(bits & 0x00ffffffu) / 16777216.0;\n}\n\nfn plateTemperature(cell: vec2u) -> f32 {\n  let irregularity = random01(cell.x) * 2.0 - 1.0;\n  let broadVariation = sin(f32(cell.x) * 0.19 + f32(parameters.seed & 1023u) * 0.013);\n  return clamp(0.91 + irregularity * 0.055 + broadVariation * 0.035, 0.78, 1.0);\n}\n\n@compute @workgroup_size(8, 8)\nfn initialize(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n\n  let uv = simulationUv(id.xy);\n  var temperature = exp(-(1.0 - uv.y) * 42.0) * plateTemperature(id.xy);\n  if (id.y == 0u) {\n    temperature = 0.0;\n  }\n  if (id.y + 1u == parameters.size.y) {\n    temperature = plateTemperature(id.xy);\n  }\n  textureStore(nextState, vec2i(id.xy), vec4f(0.0, 0.0, 0.0, temperature));\n}\n\n@compute @workgroup_size(8, 8)\nfn clearScalar(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  textureStore(nextState, vec2i(id.xy), vec4f(0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn resample(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let uv = simulationUv(id.xy);\n  let sampled = textureSampleLevel(previousState, linearSampler, uv, 0.0);\n  textureStore(nextState, vec2i(id.xy), sampled);\n}\n\n@compute @workgroup_size(8, 8)\nfn advect(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n\n  let cell = id.xy;\n  let uv = simulationUv(cell);\n  let texel = 1.0 / vec2f(parameters.size);\n  let current = textureLoad(previousState, vec2i(cell), 0);\n\n  if (isBoundary(cell)) {\n    var boundaryTemperature = current.w * exp(-parameters.deltaTime * 0.035);\n    if (cell.y == 0u) {\n      boundaryTemperature = 0.0;\n    }\n    if (cell.y + 1u == parameters.size.y) {\n      boundaryTemperature = plateTemperature(cell);\n    }\n    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, boundaryTemperature));\n    return;\n  }\n\n  let backUv = clamp(uv - current.xy * parameters.deltaTime, texel * 1.5, vec2f(1.0) - texel * 1.5);\n  let advected = textureSampleLevel(previousState, linearSampler, backUv, 0.0);\n  var velocity = advected.xy;\n\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0);\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0);\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0);\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0);\n  let neighborTemperature = (left.w + right.w + up.w + down.w) * 0.25;\n  var temperature = mix(advected.w, neighborTemperature, min(parameters.deltaTime * 0.9, 0.08));\n  temperature *= exp(-parameters.deltaTime * 0.035);\n\n  let plateBand = smoothstep(0.94, 0.995, uv.y);\n  temperature = max(temperature, plateBand * plateTemperature(cell));\n  temperature *= smoothstep(0.0, 0.075, uv.y);\n\n  // Boussinesq-style buoyancy: hot fluid rises and cool fluid settles.\n  // Texture-space Y points downward, so rising velocity is negative.\n  velocity.y -= (temperature - 0.16) * parameters.deltaTime * 0.58;\n  let fixedPerturbation = random01(cell.x * 1664525u + cell.y * 1013904223u) * 2.0 - 1.0;\n  velocity.x += fixedPerturbation * plateBand * parameters.deltaTime * 0.022;\n\n  if (parameters.pointerActive > 0.5) {\n    let offset = uv - parameters.pointer;\n    let falloff = exp(-dot(offset, offset) / max(0.0001, parameters.interactionRadius * parameters.interactionRadius));\n    let tangent = vec2f(-offset.y, offset.x);\n    velocity += (parameters.pointerVelocity * 1.4 + tangent * 0.4) * falloff * parameters.deltaTime;\n  }\n\n  velocity *= exp(-parameters.deltaTime * 0.12);\n  let speed = length(velocity);\n  if (speed > 0.75) {\n    velocity *= 0.75 / speed;\n  }\n\n  textureStore(nextState, vec2i(cell), vec4f(velocity, 0.0, clamp(temperature, 0.0, 1.0)));\n}\n\n@compute @workgroup_size(8, 8)\nfn divergence(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let cell = id.xy;\n  if (isBoundary(cell)) {\n    textureStore(nextState, vec2i(cell), vec4f(0.0));\n    return;\n  }\n\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).xy;\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).xy;\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).xy;\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).xy;\n  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));\n  let value = 0.5 * reciprocalCellSize * ((right.x - left.x) + (down.y - up.y));\n  textureStore(nextState, vec2i(cell), vec4f(value, 0.0, 0.0, 0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn solvePressure(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let cell = id.xy;\n  if (isBoundary(cell)) {\n    let interior = clamp(vec2i(cell), vec2i(1), vec2i(parameters.size) - vec2i(2));\n    let pressure = textureLoad(previousState, interior, 0).x;\n    textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));\n    return;\n  }\n\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).x;\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).x;\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).x;\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).x;\n  let source = textureLoad(secondaryState, vec2i(cell), 0).x;\n  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));\n  let cellSizeSquared = 1.0 / (reciprocalCellSize * reciprocalCellSize);\n  let pressure = (left + right + up + down - source * cellSizeSquared) * 0.25;\n  textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn project(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let cell = id.xy;\n  let advected = textureLoad(previousState, vec2i(cell), 0);\n  var temperature = advected.w;\n\n  if (isBoundary(cell)) {\n    if (cell.y == 0u) {\n      temperature = 0.0;\n    }\n    if (cell.y + 1u == parameters.size.y) {\n      temperature = plateTemperature(cell);\n    }\n    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, temperature));\n    return;\n  }\n\n  let left = textureLoad(secondaryState, vec2i(cell) + vec2i(-1, 0), 0).x;\n  let right = textureLoad(secondaryState, vec2i(cell) + vec2i(1, 0), 0).x;\n  let up = textureLoad(secondaryState, vec2i(cell) + vec2i(0, -1), 0).x;\n  let down = textureLoad(secondaryState, vec2i(cell) + vec2i(0, 1), 0).x;\n  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));\n  var velocity = advected.xy - 0.5 * reciprocalCellSize * vec2f(right - left, down - up);\n\n  // Prevent the cells beside the perimeter from carrying flow through a wall.\n  if (cell.x == 1u && velocity.x < 0.0) { velocity.x = 0.0; }\n  if (cell.x + 2u == parameters.size.x && velocity.x > 0.0) { velocity.x = 0.0; }\n  if (cell.y == 1u && velocity.y < 0.0) { velocity.y = 0.0; }\n  if (cell.y + 2u == parameters.size.y && velocity.y > 0.0) { velocity.y = 0.0; }\n\n  textureStore(nextState, vec2i(cell), vec4f(velocity, 0.0, temperature));\n}\n", u = "\nstruct Parameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  patternArea: u32,\n  invert: u32,\n  contrast: f32,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n@group(0) @binding(2) var fluidState: texture_2d<f32>;\n@group(0) @binding(3) var linearSampler: sampler;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(safeLogicalSize);\n  let velocity = textureSampleLevel(fluidState, linearSampler, uv, 0.0).xy;\n  var luminance = smoothstep(0.015, 0.16, length(velocity));\n  // Expand or collapse the colored areas by pushing luminance away from or\n  // toward its midpoint before the blue-noise threshold comparison.\n  luminance = clamp((luminance - 0.5) * parameters.contrast + 0.5, 0.0, 1.0);\n  let source = select(luminance, 1.0 - luminance, parameters.invert != 0u);\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternArea);\n  return select(parameters.dark, parameters.light, source >= threshold);\n}\n", d;
function f() {
	return typeof navigator < "u" && "gpu" in navigator;
}
async function p(e) {
	if (!f()) throw Error("WebGPU is not available in this browser.");
	return d ||= navigator.gpu.requestAdapter({ powerPreference: e }).then(async (e) => {
		if (!e) throw Error("No compatible WebGPU adapter was found.");
		let t = await e.requestDevice();
		return t.lost.then(() => {
			d = void 0;
		}), t;
	}), d;
}
async function m(e, t, n) {
	let r = e.createShaderModule({
		label: t,
		code: n
	}), i = (await r.getCompilationInfo()).messages.filter((e) => e.type === "error");
	if (i.length > 0) throw Error(i.map((e) => `${t}: ${e.message}`).join("\n"));
	return r;
}
//#endregion
//#region src/FloydSteinberg.tsx
var h = 256, g = [
	0,
	0,
	0,
	1
], _ = [
	1,
	1,
	1,
	1
], v, y = /* @__PURE__ */ new WeakMap();
function b() {
	return f();
}
function x(e, t) {
	let n = y.get(e);
	n || (n = /* @__PURE__ */ new Map(), y.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([m(e, "Stochastic Floyd–Steinberg WGSL", o), m(e, "Floyd–Steinberg display WGSL", s)]), i = e.createBindGroupLayout({
			label: "Floyd–Steinberg bindings",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "uniform" }
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" }
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" }
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					buffer: {
						type: "uniform",
						hasDynamicOffset: !0,
						minBindingSize: 16
					}
				},
				{
					binding: 4,
					visibility: GPUShaderStage.COMPUTE,
					texture: { sampleType: "float" }
				}
			]
		});
		return {
			compute: e.createComputePipeline({
				label: "Stochastic Floyd–Steinberg wavefront",
				layout: e.createPipelineLayout({ bindGroupLayouts: [i] }),
				compute: {
					module: n,
					entryPoint: "main"
				}
			}),
			computeLayout: i,
			display: e.createRenderPipeline({
				label: "Floyd–Steinberg display",
				layout: "auto",
				vertex: {
					module: r,
					entryPoint: "vertexMain"
				},
				fragment: {
					module: r,
					entryPoint: "fragmentMain",
					targets: [{ format: t }]
				},
				primitive: { topology: "triangle-list" }
			})
		};
	})(), n.set(t, r)), r;
}
function S(e) {
	return typeof HTMLImageElement < "u" && e instanceof HTMLImageElement ? {
		width: e.naturalWidth,
		height: e.naturalHeight
	} : {
		width: e.width,
		height: e.height
	};
}
async function C(e, t) {
	if (typeof e == "string") {
		let n = new Image();
		return n.crossOrigin = t ?? "anonymous", n.decoding = "async", n.src = e, await n.decode(), {
			source: n,
			width: n.naturalWidth,
			height: n.naturalHeight
		};
	}
	if (e instanceof Blob) {
		let t = await createImageBitmap(e);
		return {
			source: t,
			width: t.width,
			height: t.height,
			dispose: () => t.close()
		};
	}
	typeof HTMLImageElement < "u" && e instanceof HTMLImageElement && !e.complete && await e.decode();
	let { width: n, height: r } = S(e);
	return {
		source: e,
		width: n,
		height: r
	};
}
function w(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function T(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function E(e, t, n, r) {
	if (n !== void 0 && r !== void 0) return {
		width: T(n, e),
		height: T(r, t)
	};
	if (n !== void 0) {
		let r = T(n, e);
		return {
			width: r,
			height: T(r * t / e, t)
		};
	}
	if (r !== void 0) {
		let n = T(r, t);
		return {
			width: T(n * e / t, e),
			height: n
		};
	}
	return {
		width: T(e, 1),
		height: T(t, 1)
	};
}
function D(e) {
	let t = e.trim();
	if (!v) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, v = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!v) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	v.fillStyle = "#010203", v.fillStyle = t;
	let n = v.fillStyle;
	if (v.fillStyle = "#040506", v.fillStyle = t, !t || v.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	v.clearRect(0, 0, 1, 1), v.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = v.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function O(e) {
	return typeof e == "string" ? D(e) : [
		w(e[0], 0, 1, 0),
		w(e[1], 0, 1, 0),
		w(e[2], 0, 1, 0),
		w(e[3] ?? 1, 0, 1, 1)
	];
}
function k(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function A(e) {
	e && (e.output.destroy(), e.errors.destroy(), e.computeParameters.destroy(), e.displayParameters.destroy(), e.bandParameters.destroy(), e.sourceTexture.destroy());
}
function j(e, t, n) {
	let r = /* @__PURE__ */ new ArrayBuffer(48), i = new DataView(r);
	i.setUint32(0, n.logicalWidth, !0), i.setUint32(4, n.logicalHeight, !0), i.setUint32(8, n.sourceWidth, !0), i.setUint32(12, n.sourceHeight, !0), i.setUint32(16, {
		stretch: 0,
		cover: 1,
		contain: 2
	}[n.fit], !0), i.setUint32(20, +!!n.invert, !0), i.setFloat32(24, n.threshold, !0), i.setFloat32(28, n.randomness, !0), i.setUint32(32, n.seed >>> 0, !0), i.setFloat32(36, n.alphaBackground, !0), e.queue.writeBuffer(t, 0, r);
}
function M(e, t, n, r, i, a, o, s) {
	let c = /* @__PURE__ */ new ArrayBuffer(48), l = new DataView(c);
	l.setUint32(0, n, !0), l.setUint32(4, r, !0), l.setFloat32(8, i, !0), l.setFloat32(12, a, !0);
	let u = new Float32Array(c, 16, 8);
	u.set(O(o), 0), u.set(O(s), 4), e.queue.writeBuffer(t, 0, c);
}
function N({ src: n, width: o, height: s, pixelScale: c = 1, randomness: l = .35, threshold: u = .5, fit: d = "contain", invert: f = !1, seed: m = 1592594996, alphaBackground: v = 1, dark: y = g, light: b = _, crossOrigin: S = "anonymous", powerPreference: D = "high-performance", onReady: O, onError: N, ref: P, "aria-label": F = "Floyd–Steinberg dithered image", ...I }) {
	let L = r(null), R = r(O), z = r(N), [B, V] = i(), [H, U] = i(), ee = k(y), W = k(b);
	R.current = O, z.current = N;
	let [G, K] = i("loading"), q = e((e) => {
		L.current = e, typeof P == "function" ? P(e) : P && (P.current = e);
	}, [P]);
	t(() => {
		let e = !1;
		return K("loading"), V(void 0), U(void 0), C(n, S).then((t) => {
			if (e) {
				t.dispose?.();
				return;
			}
			if (t.width < 1 || t.height < 1) throw t.dispose?.(), Error("The source image has no drawable pixels.");
			V(t);
		}).catch((t) => {
			if (e) return;
			let n = t instanceof Error ? t : Error(String(t));
			K("error"), z.current?.(n);
		}), () => {
			e = !0;
		};
	}, [n, S]);
	let J = B ? E(B.width, B.height, o, s) : {
		width: T(o, 300),
		height: T(s, 150)
	};
	return t(() => {
		U(void 0);
	}, [o, s]), t(() => {
		let e = L.current;
		if (!e || !B) return;
		let t = 0, n = 0, r, i = (e = t, r = n) => {
			if (e = Math.round(e * 64) / 64, r = Math.round(r * 64) / 64, e <= 0 || r <= 0) return;
			t = e, n = r;
			let i = Math.max(.01, window.devicePixelRatio || 1), a = {
				width: Math.max(1, Math.round(e * i)),
				height: Math.max(1, Math.round(r * i)),
				cssWidth: e,
				cssHeight: r,
				devicePixelRatio: i
			};
			U((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
		}, a = new ResizeObserver(([e]) => {
			e && i(e.contentRect.width, e.contentRect.height);
		});
		a.observe(e);
		let o = () => {
			i(), r?.removeEventListener("change", o), r = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`), r.addEventListener("change", o, { once: !0 });
		};
		return window.addEventListener("resize", o), o(), () => {
			a.disconnect(), window.removeEventListener("resize", o), r?.removeEventListener("change", o);
		};
	}, [
		B,
		J.width,
		J.height
	]), t(() => {
		let e = L.current;
		if (!e || !B || !H) return;
		let t = !1, n;
		return K("loading"), (async () => {
			let r = T(c, 1), i = Math.ceil(H.cssWidth / r), a = Math.ceil(H.cssHeight / r), o = r * H.width / H.cssWidth, s = r * H.height / H.cssHeight, g = await p(D);
			if (t) return;
			let _ = g.limits.maxTextureDimension2D;
			if (B.width > _ || B.height > _ || H.width > _ || H.height > _) throw Error(`The source or output exceeds this device's ${_}px texture limit.`);
			let S = Math.max(4, i * a * 4);
			if (S > g.limits.maxStorageBufferBindingSize) throw Error("The requested output exceeds this device's storage-buffer limit. Increase pixelScale.");
			let C = e.getContext("webgpu");
			if (!C) throw Error("The canvas could not create a WebGPU context.");
			let E = navigator.gpu.getPreferredCanvasFormat();
			C.configure({
				device: g,
				format: E,
				alphaMode: "premultiplied"
			});
			let O = await x(g, E);
			if (t) return;
			let k = g.createBuffer({
				label: "Floyd–Steinberg output",
				size: S,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), A = g.createBuffer({
				label: "Floyd–Steinberg errors",
				size: S,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), N = g.createBuffer({
				label: "Floyd–Steinberg parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), P = g.createBuffer({
				label: "Floyd–Steinberg display parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), F = Math.ceil(a / h), I = g.limits.minUniformBufferOffsetAlignment, L = new ArrayBuffer(I * F), z = new DataView(L);
			for (let e = 0; e < F; e += 1) {
				let t = e * h;
				z.setUint32(e * I, t, !0), z.setUint32(e * I + 4, Math.min(h, a - t), !0);
			}
			let V = g.createBuffer({
				label: "Floyd–Steinberg band parameters",
				size: L.byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), U = g.createTexture({
				label: "Floyd–Steinberg source image",
				size: [B.width, B.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
			});
			n = {
				output: k,
				errors: A,
				computeParameters: N,
				displayParameters: P,
				bandParameters: V,
				sourceTexture: U
			}, g.queue.copyExternalImageToTexture({ source: B.source }, { texture: U }, [B.width, B.height]), g.queue.writeBuffer(V, 0, L), j(g, N, {
				logicalWidth: i,
				logicalHeight: a,
				sourceWidth: B.width,
				sourceHeight: B.height,
				fit: d,
				invert: f,
				threshold: w(u, 0, 1, .5),
				randomness: w(l, 0, 2, .35),
				seed: m,
				alphaBackground: w(v, 0, 1, 1)
			}), M(g, P, i, a, o, s, y, b);
			let ee = g.createBindGroup({
				label: "Floyd–Steinberg compute bind group",
				layout: O.computeLayout,
				entries: [
					{
						binding: 0,
						resource: { buffer: N }
					},
					{
						binding: 1,
						resource: { buffer: k }
					},
					{
						binding: 2,
						resource: { buffer: A }
					},
					{
						binding: 3,
						resource: {
							buffer: V,
							size: 16
						}
					},
					{
						binding: 4,
						resource: U.createView()
					}
				]
			}), W = g.createBindGroup({
				label: "Floyd–Steinberg display bind group",
				layout: O.display.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: P }
				}, {
					binding: 1,
					resource: { buffer: k }
				}]
			}), G = g.createCommandEncoder({ label: "Floyd–Steinberg render" });
			G.clearBuffer(A);
			for (let e = 0; e < F; e += 1) {
				let t = G.beginComputePass({ label: `Floyd–Steinberg band ${e}` });
				t.setPipeline(O.compute), t.setBindGroup(0, ee, [e * I]), t.dispatchWorkgroups(1), t.end();
			}
			let q = G.beginRenderPass({
				label: "Floyd–Steinberg display pass",
				colorAttachments: [{
					view: C.getCurrentTexture().createView(),
					clearValue: {
						r: 0,
						g: 0,
						b: 0,
						a: 0
					},
					loadOp: "clear",
					storeOp: "store"
				}]
			});
			q.setPipeline(O.display), q.setBindGroup(0, W), q.draw(3), q.end(), g.queue.submit([G.finish()]), await g.queue.onSubmittedWorkDone(), !t && (K("ready"), R.current?.({
				canvas: e,
				device: g,
				...H,
				logicalWidth: i,
				logicalHeight: a
			}));
		})().catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			K("error"), z.current?.(n);
		}), () => {
			t = !0, A(n);
		};
	}, [
		B,
		H,
		c,
		l,
		u,
		d,
		f,
		m,
		v,
		ee,
		W,
		D
	]), t(() => () => {
		B?.dispose?.();
	}, [B]), /* @__PURE__ */ a("canvas", {
		...I,
		ref: q,
		width: H?.width ?? J.width,
		height: H?.height ?? J.height,
		"aria-label": F,
		"data-webgpu-status": G
	});
}
//#endregion
//#region src/blueNoise.ts
var P = /* @__PURE__ */ new Map(), F = 8, I = 6;
function L(e, t) {
	let n = new Float64Array(e), r = t >>> 0 || 1;
	for (let t = 0; t < e; t += 1) r ^= r << 13, r ^= r >>> 17, r ^= r << 5, n[t] = (r >>> 0) / 4294967296;
	return n;
}
function R(e, t) {
	let n = new Float64Array(t * 2 + 1), r = 0;
	for (let i = -t; i <= t; i += 1) {
		let a = Math.exp(-(i * i) / (2 * e * e));
		n[i + t] = a, r += a;
	}
	for (let e = 0; e < n.length; e += 1) n[e] /= r;
	return n;
}
function z(e, t, n, r, i) {
	let a = (i.length - 1) / 2, o = new Float64Array(e.length), s = new Float64Array(e.length);
	for (let s = 0; s < t; s += 1) for (let c = 0; c < t; c += 1) {
		let l = 0;
		for (let o = -a; o <= a; o += 1) {
			let u = (c + o + t) % t, d = e[s * t + u];
			(r ? d < n : d >= n) && (l += i[o + a]);
		}
		o[s * t + c] = l;
	}
	for (let e = 0; e < t; e += 1) for (let n = 0; n < t; n += 1) {
		let r = 0;
		for (let s = -a; s <= a; s += 1) {
			let c = (e + s + t) % t;
			r += o[c * t + n] * i[s + a];
		}
		s[e * t + n] = r;
	}
	return s;
}
function B(e, t, n, r) {
	let i = (r.length - 1) / 2, a = e % n, o = Math.floor(e / n), s = t % n, c = Math.floor(t / n), l = Math.min(Math.abs(a - s), n - Math.abs(a - s)), u = Math.min(Math.abs(o - c), n - Math.abs(o - c));
	return l > i || u > i ? 0 : r[i + l] * r[i + u];
}
function V(e, t, n, r) {
	let i = t % n, a = Math.floor(t / n);
	for (let t = -r; t <= r; t += 1) for (let o = -r; o <= r; o += 1) {
		let r = (i + o + n) % n, s = (a + t + n) % n;
		e[s * n + r] = 1;
	}
}
function H(e, t, n, r, i) {
	let a = e.length, o = r / a, s = o <= .5, c = Math.min(o, 1 - o), l = Math.min(2.25, Math.max(.8, .38 / Math.sqrt(c))), u = Math.min(7, Math.floor((t - 1) / 2), Math.ceil(l * 3)), d = R(l, u), f = d[u] * d[u], p = Math.max(1, Math.floor(Math.min(r - n, i - r) / 64));
	for (let o = 0; o < F; o += 1) {
		let o = z(e, t, r, s, d), c = [], l = [];
		for (let t = 0; t < a; t += 1) {
			let a = e[t];
			s ? a >= n && a < r ? c.push(t) : a >= r && a < i && l.push(t) : a >= r && a < i ? c.push(t) : a >= n && a < r && l.push(t);
		}
		c.sort((e, t) => o[t] - o[e]), l.sort((e, t) => o[e] - o[t]);
		let m = new Uint8Array(a), h = 0, g = 0, _ = 0;
		for (; _ < p && h < c.length && g < l.length;) {
			let n = c[h++];
			if (m[n]) continue;
			let r = l[g++];
			for (; m[r] && g < l.length;) r = l[g++];
			if (m[r]) break;
			let i = o[n] - f;
			if (o[r] - B(n, r, t, d) >= i) break;
			let a = e[n];
			e[n] = e[r], e[r] = a, V(m, n, t, u), V(m, r, t, u), _ += 1;
		}
		if (_ === 0) break;
	}
}
function U(e, t) {
	let n = e.length, r = Math.min(I, Math.floor(Math.log2(t)));
	for (let i = 1; i <= r; i += 1) {
		let r = 2 ** i;
		for (let i = 1; i < r; i += 2) H(e, t, Math.floor((i - 1) * n / r), Math.floor(i * n / r), Math.floor((i + 1) * n / r));
	}
}
function ee(e, t) {
	let n = `${e}:${t >>> 0}`, r = P.get(n);
	if (r) return r;
	let i = e * e, a = L(i, t), o = new Float64Array(i), s = new Float64Array(i), c = [
		.06136,
		.24477,
		.38774,
		.24477,
		.06136
	];
	for (let t = 0; t < e; t += 1) for (let n = 0; n < e; n += 1) {
		let r = 0;
		for (let i = -2; i <= 2; i += 1) {
			let o = (n + i + e) % e;
			r += a[t * e + o] * c[i + 2];
		}
		o[t * e + n] = r;
	}
	for (let t = 0; t < e; t += 1) for (let n = 0; n < e; n += 1) {
		let r = 0;
		for (let i = -2; i <= 2; i += 1) {
			let a = (t + i + e) % e;
			r += o[a * e + n] * c[i + 2];
		}
		let i = t * e + n;
		s[i] = a[i] - r;
	}
	let l = Array.from({ length: i }, (e, t) => t);
	l.sort((e, t) => s[e] - s[t]);
	let u = new Uint32Array(i);
	for (let e = 0; e < i; e += 1) u[l[e]] = e;
	return U(u, e), P.set(n, u), u;
}
//#endregion
//#region src/BlueNoiseWave.tsx
var W = 1e3 / 60, G = [
	0,
	0,
	0,
	1
], K = [
	1,
	1,
	1,
	1
], q, J = /* @__PURE__ */ new WeakMap();
function Y(e, t) {
	let n = J.get(e);
	n || (n = /* @__PURE__ */ new Map(), J.set(e, n));
	let r = n.get(t);
	return r || (r = m(e, "Blue-noise wave WGSL", c).then((n) => e.createRenderPipeline({
		label: "Blue-noise wave",
		layout: "auto",
		vertex: {
			module: n,
			entryPoint: "vertexMain"
		},
		fragment: {
			module: n,
			entryPoint: "fragmentMain",
			targets: [{ format: t }]
		},
		primitive: { topology: "triangle-list" }
	})), n.set(t, r)), r;
}
function X(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function te(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function ne(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: te(e, 900),
		height: te(t, 600)
	};
	if (e !== void 0) {
		let t = te(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = te(t, 600);
		return {
			width: Math.max(1, Math.round(e * 3 / 2)),
			height: e
		};
	}
	return {
		width: 900,
		height: 600
	};
}
function re(e) {
	let t = e.trim();
	if (!q) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, q = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!q) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	q.fillStyle = "#010203", q.fillStyle = t;
	let n = q.fillStyle;
	if (q.fillStyle = "#040506", q.fillStyle = t, !t || q.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	q.clearRect(0, 0, 1, 1), q.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = q.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function ie(e) {
	return typeof e == "string" ? re(e) : [
		X(e[0], 0, 1, 0),
		X(e[1], 0, 1, 0),
		X(e[2], 0, 1, 0),
		X(e[3] ?? 1, 0, 1, 1)
	];
}
function ae(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function oe(e) {
	e?.parameters.destroy(), e?.pattern.destroy();
}
function se({ width: o, height: s, pixelScale: c = 2, patternSize: l = 64, invert: u = !1, seed: d = 1592594996, dark: f = G, light: m = K, powerPreference: h = "high-performance", onReady: g, onError: _, ref: v, "aria-label": y = "Blue-noise dithered wave", ...b }) {
	let x = r(null), S = r(g), C = r(_), [w, T] = i(), [E, D] = i("loading"), O = ne(o, s), k = ae(f), A = ae(m);
	S.current = g, C.current = _;
	let j = e((e) => {
		x.current = e, typeof v == "function" ? v(e) : v && (v.current = e);
	}, [v]);
	return t(() => {
		T(void 0);
	}, [o, s]), t(() => {
		let e = x.current;
		if (!e) return;
		let t = 0, n = 0, r, i = (e = t, r = n) => {
			if (e = Math.round(e * 64) / 64, r = Math.round(r * 64) / 64, e <= 0 || r <= 0) return;
			t = e, n = r;
			let i = Math.max(.01, window.devicePixelRatio || 1), a = {
				width: Math.max(1, Math.round(e * i)),
				height: Math.max(1, Math.round(r * i)),
				cssWidth: e,
				cssHeight: r,
				devicePixelRatio: i
			};
			T((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
		}, a = new ResizeObserver(([e]) => {
			e && i(e.contentRect.width, e.contentRect.height);
		});
		a.observe(e);
		let o = () => {
			i(), r?.removeEventListener("change", o), r = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`), r.addEventListener("change", o, { once: !0 });
		};
		return window.addEventListener("resize", o), o(), () => {
			a.disconnect(), window.removeEventListener("resize", o), r?.removeEventListener("change", o);
		};
	}, [O.width, O.height]), n(() => {
		let e = x.current;
		if (!e || !w) return;
		let t = !1, n = 0, r;
		D("loading");
		let i = (e) => {
			t || (t = !0, n && cancelAnimationFrame(n), oe(r), r = void 0, D("error"), C.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = te(c, 1), o = Math.round(X(l, 8, 128, 64)), s = Math.ceil(w.cssWidth / a), g = Math.ceil(w.cssHeight / a), _ = a * w.width / w.cssWidth, v = a * w.height / w.cssHeight, y = ee(o, d), b = await p(h);
			if (t) return;
			let x = b.limits.maxTextureDimension2D;
			if (w.width > x || w.height > x) throw Error(`The output exceeds this device's ${x}px texture limit.`);
			if (y.byteLength > b.limits.maxStorageBufferBindingSize) throw Error("The blue-noise pattern exceeds this device's storage-buffer limit.");
			let C = e.getContext("webgpu");
			if (!C) throw Error("The canvas could not create a WebGPU context.");
			let T = navigator.gpu.getPreferredCanvasFormat();
			C.configure({
				device: b,
				format: T,
				alphaMode: "premultiplied"
			});
			let E = await Y(b, T);
			if (t) return;
			let O = b.createBuffer({
				label: "Blue-noise wave parameters",
				size: 64,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), k = b.createBuffer({
				label: "Tileable blue-noise ranks",
				size: y.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			});
			r = {
				parameters: O,
				pattern: k
			}, b.queue.writeBuffer(k, 0, y);
			let A = /* @__PURE__ */ new ArrayBuffer(64), j = new DataView(A);
			j.setUint32(0, s, !0), j.setUint32(4, g, !0), j.setFloat32(8, _, !0), j.setFloat32(12, v, !0), j.setUint32(16, o, !0), j.setUint32(20, o * o, !0), j.setUint32(24, +!!u, !0);
			let M = new Float32Array(A, 32, 8);
			M.set(ie(f), 0), M.set(ie(m), 4);
			let N = b.createBindGroup({
				label: "Blue-noise wave bind group",
				layout: E.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: O }
				}, {
					binding: 1,
					resource: { buffer: k }
				}]
			}), P = performance.now(), F = P - W, I = !1, L = (r) => {
				if (t) return;
				let a = r - F;
				if (a < W) {
					n = requestAnimationFrame(L);
					return;
				}
				F = r - a % W;
				try {
					j.setFloat32(28, (r - P) / 1e3, !0), b.queue.writeBuffer(O, 0, A);
					let a = b.createCommandEncoder({ label: "Blue-noise wave" }), o = a.beginRenderPass({
						label: "Blue-noise wave pass",
						colorAttachments: [{
							view: C.getCurrentTexture().createView(),
							clearValue: {
								r: 0,
								g: 0,
								b: 0,
								a: 0
							},
							loadOp: "clear",
							storeOp: "store"
						}]
					});
					o.setPipeline(E), o.setBindGroup(0, N), o.draw(3), o.end(), b.queue.submit([a.finish()]), I || (I = !0, b.queue.onSubmittedWorkDone().then(() => {
						if (t) return;
						D("ready");
						let n = {
							canvas: e,
							device: b,
							...w,
							logicalWidth: s,
							logicalHeight: g
						};
						S.current?.(n);
					}, i)), n = requestAnimationFrame(L);
				} catch (e) {
					i(e);
				}
			};
			L(performance.now());
		})().catch(i), () => {
			t = !0, n && cancelAnimationFrame(n), oe(r);
		};
	}, [
		w,
		c,
		l,
		u,
		d,
		k,
		A,
		h
	]), /* @__PURE__ */ a("canvas", {
		...b,
		ref: j,
		width: w?.width ?? O.width,
		height: w?.height ?? O.height,
		"aria-label": y,
		"data-webgpu-status": E
	});
}
//#endregion
//#region src/BlueNoiseFluid.tsx
var ce = 1e3 / 60, le = .5, ue = 16, de = [
	0,
	0,
	0,
	1
], Z = [
	1,
	1,
	1,
	1
], Q, fe = /* @__PURE__ */ new WeakMap();
function pe(e, t) {
	let n = fe.get(e);
	n || (n = /* @__PURE__ */ new Map(), fe.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([m(e, "Fluid simulation WGSL", l), m(e, "Blue-noise fluid WGSL", u)]), i = e.createBindGroupLayout({
			label: "Fluid simulation bindings",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "uniform" }
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					texture: { sampleType: "float" }
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					sampler: { type: "filtering" }
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					storageTexture: {
						access: "write-only",
						format: "rgba16float"
					}
				},
				{
					binding: 4,
					visibility: GPUShaderStage.COMPUTE,
					texture: { sampleType: "float" }
				}
			]
		}), a = e.createPipelineLayout({ bindGroupLayouts: [i] });
		return {
			initialize: e.createComputePipeline({
				label: "Initialize fluid",
				layout: a,
				compute: {
					module: n,
					entryPoint: "initialize"
				}
			}),
			clearScalar: e.createComputePipeline({
				label: "Clear fluid scalar field",
				layout: a,
				compute: {
					module: n,
					entryPoint: "clearScalar"
				}
			}),
			resample: e.createComputePipeline({
				label: "Resample fluid state",
				layout: a,
				compute: {
					module: n,
					entryPoint: "resample"
				}
			}),
			advect: e.createComputePipeline({
				label: "Advect fluid",
				layout: a,
				compute: {
					module: n,
					entryPoint: "advect"
				}
			}),
			divergence: e.createComputePipeline({
				label: "Measure fluid divergence",
				layout: a,
				compute: {
					module: n,
					entryPoint: "divergence"
				}
			}),
			solvePressure: e.createComputePipeline({
				label: "Solve fluid pressure",
				layout: a,
				compute: {
					module: n,
					entryPoint: "solvePressure"
				}
			}),
			project: e.createComputePipeline({
				label: "Project fluid velocity",
				layout: a,
				compute: {
					module: n,
					entryPoint: "project"
				}
			}),
			computeLayout: i,
			display: e.createRenderPipeline({
				label: "Blue-noise fluid display",
				layout: "auto",
				vertex: {
					module: r,
					entryPoint: "vertexMain"
				},
				fragment: {
					module: r,
					entryPoint: "fragmentMain",
					targets: [{ format: t }]
				},
				primitive: { topology: "triangle-list" }
			})
		};
	})(), n.set(t, r)), r;
}
function $(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function me(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function he(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: me(e, 900),
		height: me(t, 600)
	};
	if (e !== void 0) {
		let t = me(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = me(t, 600);
		return {
			width: Math.max(1, Math.round(e * 3 / 2)),
			height: e
		};
	}
	return {
		width: 900,
		height: 600
	};
}
function ge(e) {
	let t = e.trim();
	if (!Q) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, Q = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!Q) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	Q.fillStyle = "#010203", Q.fillStyle = t;
	let n = Q.fillStyle;
	if (Q.fillStyle = "#040506", Q.fillStyle = t, !t || Q.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	Q.clearRect(0, 0, 1, 1), Q.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = Q.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function _e(e) {
	return typeof e == "string" ? ge(e) : [
		$(e[0], 0, 1, 0),
		$(e[1], 0, 1, 0),
		$(e[2], 0, 1, 0),
		$(e[3] ?? 1, 0, 1, 1)
	];
}
function ve(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function ye(e) {
	e?.simulationParameters.destroy(), e?.displayParameters.destroy(), e?.pattern.destroy(), e?.state.destroy(), e?.advectedState.destroy(), e?.divergence.destroy(), e?.pressureA.destroy(), e?.pressureB.destroy();
}
function be({ width: o, height: s, pixelScale: c = 2, patternSize: l = 64, simulationSize: u = 192, interactionRadius: d = .05, contrast: f = 1, invert: m = !1, seed: h = 1592594996, dark: g = de, light: _ = Z, powerPreference: v = "high-performance", onReady: y, onError: b, ref: x, style: S, "aria-label": C = "Interactive blue-noise fluid simulation", ...w }) {
	let T = r(null), E = r({
		x: .5,
		y: .5,
		velocityX: 0,
		velocityY: 0,
		lastEventTime: 0,
		lastMoveTime: -Infinity
	}), D = r(y), O = r(b), [k, A] = i(), [j, M] = i("loading"), N = he(o, s), P = ve(g), F = ve(_);
	D.current = y, O.current = b;
	let I = r(void 0), L = r({
		pixelScale: c,
		patternSize: l,
		simulationSize: u,
		interactionRadius: d,
		contrast: f,
		invert: m,
		darkDependency: P,
		lightDependency: F,
		seed: h,
		powerPreference: v,
		dark: g,
		light: _
	});
	L.current = {
		pixelScale: c,
		patternSize: l,
		simulationSize: u,
		interactionRadius: d,
		contrast: f,
		invert: m,
		darkDependency: P,
		lightDependency: F,
		seed: h,
		powerPreference: v,
		dark: g,
		light: _
	}, r(void 0);
	let R = r(N);
	R.current = N;
	let z = e((e) => {
		T.current = e, typeof x == "function" ? x(e) : x && (x.current = e);
	}, [x]);
	return t(() => {
		A(void 0);
	}, [o, s]), t(() => {
		let e = T.current;
		if (!e) return;
		let t = 0, n = 0, r, i = (e = t, r = n) => {
			if (e = Math.round(e * 64) / 64, r = Math.round(r * 64) / 64, e <= 0 || r <= 0) return;
			t = e, n = r;
			let i = Math.max(.01, window.devicePixelRatio || 1), a = {
				width: Math.max(1, Math.round(e * i)),
				height: Math.max(1, Math.round(r * i)),
				cssWidth: e,
				cssHeight: r,
				devicePixelRatio: i
			};
			I.current = a, A((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
		}, a = new ResizeObserver(([e]) => {
			e && i(e.contentRect.width, e.contentRect.height);
		});
		a.observe(e);
		let o = () => {
			i(), r?.removeEventListener("change", o), r = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`), r.addEventListener("change", o, { once: !0 });
		};
		return window.addEventListener("resize", o), o(), () => {
			a.disconnect(), window.removeEventListener("resize", o), r?.removeEventListener("change", o);
		};
	}, [N.width, N.height]), t(() => {
		let e = T.current;
		if (!e) return;
		let t = (t) => {
			let n = e.getBoundingClientRect();
			E.current.x = $((t.clientX - n.left) / n.width, 0, 1, .5), E.current.y = $((t.clientY - n.top) / n.height, 0, 1, .5), E.current.velocityX = 0, E.current.velocityY = 0, E.current.lastEventTime = t.timeStamp;
		}, n = (t) => {
			let n = e.getBoundingClientRect(), r = $((t.clientX - n.left) / n.width, 0, 1, .5), i = $((t.clientY - n.top) / n.height, 0, 1, .5), a = E.current, o = Math.max(1 / 240, (t.timeStamp - a.lastEventTime) / 1e3);
			a.velocityX = $((r - a.x) / o, -3, 3, 0), a.velocityY = $((i - a.y) / o, -3, 3, 0), a.x = r, a.y = i, a.lastEventTime = t.timeStamp, a.lastMoveTime = performance.now();
		}, r = () => {
			E.current.lastMoveTime = -Infinity;
		}, i = (n) => {
			t(n), E.current.lastMoveTime = performance.now(), e.setPointerCapture(n.pointerId);
		};
		return e.addEventListener("pointerenter", t), e.addEventListener("pointermove", n), e.addEventListener("pointerleave", r), e.addEventListener("pointerdown", i), () => {
			e.removeEventListener("pointerenter", t), e.removeEventListener("pointermove", n), e.removeEventListener("pointerleave", r), e.removeEventListener("pointerdown", i);
		};
	}, []), n(() => {
		let e = T.current;
		if (!e) return;
		let t = !1, n = 0, r;
		M("loading");
		let i = (e) => {
			t || (t = !0, n && cancelAnimationFrame(n), ye(r), r = void 0, M("error"), O.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = L.current, o = Math.round($(a.simulationSize, 32, 384, 192)), s = Math.round($(a.patternSize, 8, 128, 64)), c = I.current ?? {
				width: e.width,
				height: e.height,
				cssWidth: e.clientWidth || R.current.width,
				cssHeight: e.clientHeight || R.current.height,
				devicePixelRatio: window.devicePixelRatio || 1
			}, l = c.cssWidth / c.cssHeight, u = l >= 1 ? o : Math.max(16, Math.round(o * l)), d = l >= 1 ? Math.max(16, Math.round(o / l)) : o, f = Math.ceil(c.cssWidth / Math.max(1, Math.round(a.pixelScale))), m = Math.ceil(c.cssHeight / Math.max(1, Math.round(a.pixelScale))), h = ee(s, a.seed), g = await p(a.powerPreference);
			if (t) return;
			let _ = g.limits.maxTextureDimension2D;
			if (c.width > _ || c.height > _ || u > _ || d > _) throw Error(`The output or simulation exceeds this device's ${_}px texture limit.`);
			let v = e.getContext("webgpu");
			if (!v) throw Error("The canvas could not create a WebGPU context.");
			let y = navigator.gpu.getPreferredCanvasFormat();
			v.configure({
				device: g,
				format: y,
				alphaMode: "premultiplied"
			});
			let b = await pe(g, y);
			if (t) return;
			let x = g.createBuffer({
				label: "Fluid simulation parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), S = g.createBuffer({
				label: "Blue-noise fluid display parameters",
				size: 64,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), C = g.createBuffer({
				label: "Tileable blue-noise ranks",
				size: 65536,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), w = {
				size: [u, d],
				format: "rgba16float",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
			}, T = g.createTexture({
				...w,
				label: "Fluid state"
			}), O = g.createTexture({
				...w,
				label: "Advected fluid state"
			}), k = g.createTexture({
				...w,
				label: "Fluid divergence"
			}), A = g.createTexture({
				...w,
				label: "Fluid pressure A"
			}), j = g.createTexture({
				...w,
				label: "Fluid pressure B"
			}), N = g.createSampler({
				label: "Fluid linear sampler",
				magFilter: "linear",
				minFilter: "linear",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge"
			});
			r = {
				simulationParameters: x,
				displayParameters: S,
				pattern: C,
				state: T,
				advectedState: O,
				divergence: k,
				pressureA: A,
				pressureB: j,
				sampler: N
			}, g.queue.writeBuffer(C, 0, h);
			let P = /* @__PURE__ */ new ArrayBuffer(48), F = new DataView(P);
			F.setUint32(0, u, !0), F.setUint32(4, d, !0), F.setUint32(12, a.seed >>> 0, !0), F.setFloat32(36, $(a.interactionRadius, .01, .3, .05), !0), g.queue.writeBuffer(x, 0, P);
			let z = /* @__PURE__ */ new ArrayBuffer(64), B = new DataView(z), V = Math.max(1, Math.round(a.pixelScale));
			B.setUint32(0, f, !0), B.setUint32(4, m, !0), B.setFloat32(8, V * c.width / c.cssWidth, !0), B.setFloat32(12, V * c.height / c.cssHeight, !0), B.setUint32(16, s, !0), B.setUint32(20, s * s, !0), B.setUint32(24, +!!a.invert, !0), B.setFloat32(28, $(a.contrast, .25, 8, 1), !0);
			let H = {
				key: `${a.darkDependency}|${a.lightDependency}`,
				dark: _e(a.dark),
				light: _e(a.light)
			}, U = new Float32Array(z, 32, 8);
			U.set(H.dark, 0), U.set(H.light, 4), g.queue.writeBuffer(S, 0, z);
			let W = T.createView(), G = O.createView(), K = k.createView(), q = A.createView(), J = j.createView(), Y = (e, t, n, r) => g.createBindGroup({
				label: e,
				layout: b.computeLayout,
				entries: [
					{
						binding: 0,
						resource: { buffer: x }
					},
					{
						binding: 1,
						resource: t
					},
					{
						binding: 2,
						resource: N
					},
					{
						binding: 3,
						resource: n
					},
					{
						binding: 4,
						resource: r
					}
				]
			}), X = Y("Initialize fluid state", G, W, K), te = Y("Clear fluid pressure A", W, q, K), ne = Y("Clear fluid pressure B", W, J, K), re = Y("Advect fluid state", W, G, K), ie = Y("Measure fluid divergence", G, K, q), ae = [Y("Solve pressure A to B", q, J, K), Y("Solve pressure B to A", J, q, K)], oe = Y("Project fluid velocity", G, W, q), se = g.createBindGroup({
				label: "Blue-noise fluid display",
				layout: b.display.getBindGroupLayout(0),
				entries: [
					{
						binding: 0,
						resource: { buffer: S }
					},
					{
						binding: 1,
						resource: { buffer: C }
					},
					{
						binding: 2,
						resource: W
					},
					{
						binding: 3,
						resource: N
					}
				]
			}), de = g.createCommandEncoder({ label: "Initialize fluid" }), Z = de.beginComputePass();
			Z.setPipeline(b.initialize), Z.setBindGroup(0, X), Z.dispatchWorkgroups(Math.ceil(u / 8), Math.ceil(d / 8)), Z.setPipeline(b.clearScalar), Z.setBindGroup(0, te), Z.dispatchWorkgroups(Math.ceil(u / 8), Math.ceil(d / 8)), Z.setBindGroup(0, ne), Z.dispatchWorkgroups(Math.ceil(u / 8), Math.ceil(d / 8)), Z.end(), g.queue.submit([de.finish()]);
			let Q = performance.now(), fe = Q - ce, me = Q, he = !1, ge = (e, t) => {
				let n = {
					size: [e, t],
					format: "rgba16float",
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
				}, i = g.createTexture({
					...n,
					label: "Fluid state"
				}), a = g.createTexture({
					...n,
					label: "Advected fluid state"
				}), o = g.createTexture({
					...n,
					label: "Fluid divergence"
				}), s = g.createTexture({
					...n,
					label: "Fluid pressure A"
				}), c = g.createTexture({
					...n,
					label: "Fluid pressure B"
				}), l = i.createView(), f = a.createView(), p = o.createView(), m = s.createView(), h = c.createView();
				F.setUint32(0, e, !0), F.setUint32(4, t, !0), g.queue.writeBuffer(x, 0, P);
				let _ = Y("Resample fluid state", W, l, W), v = g.createCommandEncoder({ label: "Resample fluid state" }), y = v.beginComputePass();
				y.setPipeline(b.resample), y.setBindGroup(0, _), y.dispatchWorkgroups(Math.ceil(e / 8), Math.ceil(t / 8)), y.end(), g.queue.submit([v.finish()]), T.destroy(), O.destroy(), k.destroy(), A.destroy(), j.destroy(), T = i, O = a, k = o, A = s, j = c, r && (r.state = i, r.advectedState = a, r.divergence = o, r.pressureA = s, r.pressureB = c), W = l, G = f, K = p, q = m, J = h, u = e, d = t, re = Y("Advect fluid state", W, G, K), ie = Y("Measure fluid divergence", G, K, q), ae = [Y("Solve pressure A to B", q, J, K), Y("Solve pressure B to A", J, q, K)], oe = Y("Project fluid velocity", G, W, q), se = g.createBindGroup({
					label: "Blue-noise fluid display",
					layout: b.display.getBindGroupLayout(0),
					entries: [
						{
							binding: 0,
							resource: { buffer: S }
						},
						{
							binding: 1,
							resource: { buffer: C }
						},
						{
							binding: 2,
							resource: W
						},
						{
							binding: 3,
							resource: N
						}
					]
				});
			}, ve = (r) => {
				if (t) return;
				let a = r - fe;
				if (a < ce) {
					n = requestAnimationFrame(ve);
					return;
				}
				fe = r - a % ce;
				try {
					let a = L.current, l = I.current;
					if (l && l.cssWidth > 0 && l.cssHeight > 0) {
						let e = l.cssWidth / l.cssHeight, t = e >= 1 ? o : Math.max(16, Math.round(o * e)), n = e >= 1 ? Math.max(16, Math.round(o / e)) : o;
						(t !== u || n !== d) && ge(t, n);
					}
					let p = Math.round($(a.patternSize, 8, 128, 64));
					p !== s && (s = p, g.queue.writeBuffer(C, 0, ee(p, a.seed)));
					let h = $((r - me) / 1e3, 1 / 240, 1 / 30, 1 / 60) * le;
					me = r;
					let _ = E.current, y = performance.now() - _.lastMoveTime < 120;
					if (F.setFloat32(8, h, !0), F.setFloat32(16, _.x, !0), F.setFloat32(20, _.y, !0), F.setFloat32(24, _.velocityX, !0), F.setFloat32(28, _.velocityY, !0), F.setFloat32(32, +!!y, !0), F.setFloat32(36, $(a.interactionRadius, .01, .3, .05), !0), F.setFloat32(40, (r - Q) / 1e3, !0), g.queue.writeBuffer(x, 0, P), _.velocityX *= .72, _.velocityY *= .72, l) {
						let e = Math.max(1, Math.round(a.pixelScale));
						f = Math.ceil(l.cssWidth / e), m = Math.ceil(l.cssHeight / e), B.setFloat32(8, e * l.width / l.cssWidth, !0), B.setFloat32(12, e * l.height / l.cssHeight, !0);
					}
					B.setUint32(0, f, !0), B.setUint32(4, m, !0), B.setUint32(16, s, !0), B.setUint32(20, s * s, !0), B.setUint32(24, +!!a.invert, !0), B.setFloat32(28, $(a.contrast, .25, 8, 1), !0);
					let w = `${a.darkDependency}|${a.lightDependency}`;
					H.key !== w && (H = {
						key: w,
						dark: _e(a.dark),
						light: _e(a.light)
					});
					let T = new Float32Array(z, 32, 8);
					T.set(H.dark, 0), T.set(H.light, 4), g.queue.writeBuffer(S, 0, z);
					let O = g.createCommandEncoder({ label: "Fluid simulation frame" }), k = (e, t, n) => {
						let r = O.beginComputePass({ label: e });
						r.setPipeline(t), r.setBindGroup(0, n), r.dispatchWorkgroups(Math.ceil(u / 8), Math.ceil(d / 8)), r.end();
					};
					k("Advect and heat fluid", b.advect, re), k("Measure fluid divergence", b.divergence, ie);
					for (let e = 0; e < ue; e += 1) k(`Solve fluid pressure ${e + 1}`, b.solvePressure, ae[e % 2]);
					k("Project fluid velocity", b.project, oe);
					let A = O.beginRenderPass({
						label: "Blue-noise fluid display pass",
						colorAttachments: [{
							view: v.getCurrentTexture().createView(),
							clearValue: {
								r: 0,
								g: 0,
								b: 0,
								a: 0
							},
							loadOp: "clear",
							storeOp: "store"
						}]
					});
					A.setPipeline(b.display), A.setBindGroup(0, se), A.draw(3), A.end(), g.queue.submit([O.finish()]), he || (he = !0, g.queue.onSubmittedWorkDone().then(() => {
						if (t) return;
						M("ready");
						let n = {
							canvas: e,
							device: g,
							...I.current ?? c,
							logicalWidth: f,
							logicalHeight: m
						};
						D.current?.(n);
					}, i)), n = requestAnimationFrame(ve);
				} catch (e) {
					i(e);
				}
			};
			ve(performance.now());
		})().catch(i), () => {
			t = !0, n && cancelAnimationFrame(n), ye(r);
		};
	}, [
		u,
		h,
		v
	]), /* @__PURE__ */ a("canvas", {
		...w,
		ref: z,
		width: k?.width ?? N.width,
		height: k?.height ?? N.height,
		style: {
			touchAction: "none",
			...S
		},
		"aria-label": C,
		"data-webgpu-status": j
	});
}
//#endregion
export { be as BlueNoiseFluid, se as BlueNoiseWave, N as FloydSteinberg, s as displayShader, o as floydSteinbergShader, b as isWebGpuSupported };
