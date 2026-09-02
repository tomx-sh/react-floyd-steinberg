import { forwardRef as e, useCallback as t, useEffect as n, useLayoutEffect as r, useRef as i, useState as a } from "react";
import { jsx as o } from "react/jsx-runtime";
//#region src/shaders.ts
var s = "\nstruct Parameters {\n  outputSize: vec2u,\n  sourceSize: vec2u,\n  fit: u32,\n  invert: u32,\n  threshold: f32,\n  randomness: f32,\n  seed: u32,\n  alphaBackground: f32,\n  padding0: u32,\n  padding1: u32,\n}\n\nstruct Band {\n  firstRow: u32,\n  rowCount: u32,\n  padding0: u32,\n  padding1: u32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read_write> outputBits: array<u32>;\n@group(0) @binding(2) var<storage, read_write> errorBuffer: array<f32>;\n@group(0) @binding(3) var<uniform> band: Band;\n@group(0) @binding(4) var sourceTexture: texture_2d<f32>;\n\nfn hashValue(cell: vec2u, seed: u32) -> f32 {\n  var value = cell.x * 0x9e3779b9u + cell.y * 0x85ebca6bu + seed;\n  value = (value ^ (value >> 16u)) * 0x7feb352du;\n  value = (value ^ (value >> 15u)) * 0x846ca68bu;\n  value = value ^ (value >> 16u);\n  return f32(value) / 4294967295.0;\n}\n\nfn fittedUv(cell: vec2u) -> vec3f {\n  let outputSize = vec2f(parameters.outputSize);\n  let sourceSize = vec2f(parameters.sourceSize);\n  let outputAspect = outputSize.x / outputSize.y;\n  let sourceAspect = sourceSize.x / sourceSize.y;\n  var uv = (vec2f(cell) + vec2f(0.5)) / outputSize;\n\n  if (parameters.fit == 1u) {\n    // Cover: crop the longer source axis.\n    if (sourceAspect > outputAspect) {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    } else {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    }\n  } else if (parameters.fit == 2u) {\n    // Contain: map the letterboxed output area outside the source UV range.\n    if (sourceAspect > outputAspect) {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    } else {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    }\n  }\n\n  let inside = select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));\n  return vec3f(uv, inside);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let fitted = fittedUv(cell);\n  var luminance = parameters.alphaBackground;\n\n  if (fitted.z > 0.5) {\n    let maxPosition = vec2i(parameters.sourceSize) - vec2i(1);\n    let position = clamp(vec2i(fitted.xy * vec2f(parameters.sourceSize)), vec2i(0), maxPosition);\n    let color = textureLoad(sourceTexture, position, 0);\n    let imageLuminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));\n    luminance = mix(parameters.alphaBackground, imageLuminance, color.a);\n  }\n\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@compute @workgroup_size(256)\nfn main(@builtin(local_invocation_index) localRow: u32) {\n  let row = band.firstRow + localRow;\n  let activeRow = localRow < band.rowCount && row < parameters.outputSize.y;\n  var phaseCount = parameters.outputSize.x;\n  if (band.rowCount > 0u) {\n    phaseCount += 3u * (band.rowCount - 1u);\n  }\n\n  for (var phase = 0u; phase < phaseCount; phase += 1u) {\n    let rowDelay = 3u * localRow;\n    if (activeRow && phase >= rowDelay) {\n      let x = phase - rowDelay;\n      if (x < parameters.outputSize.x) {\n        let cell = vec2u(x, row);\n        let index = row * parameters.outputSize.x + x;\n        let value = clamp(sourceValue(cell) + errorBuffer[index], 0.0, 1.0);\n        let bit = select(0u, 1u, value >= parameters.threshold);\n        let error = value - f32(bit);\n        outputBits[index] = bit;\n\n        let r1 = (hashValue(cell, parameters.seed) * 2.0 - 1.0) * (5.0 / 16.0);\n        let r2 = (hashValue(cell, parameters.seed ^ 0xa511e9b3u) * 2.0 - 1.0) * (1.0 / 16.0);\n        let rightWeight = 7.0 / 16.0 + parameters.randomness * r1;\n        let downWeight = 5.0 / 16.0 - parameters.randomness * r1;\n        let downLeftWeight = 3.0 / 16.0 + parameters.randomness * r2;\n        let downRightWeight = 1.0 / 16.0 - parameters.randomness * r2;\n\n        if (x + 1u < parameters.outputSize.x) {\n          errorBuffer[index + 1u] += error * rightWeight;\n        }\n        if (row + 1u < parameters.outputSize.y) {\n          let below = index + parameters.outputSize.x;\n          if (x > 0u) {\n            errorBuffer[below - 1u] += error * downLeftWeight;\n          }\n          errorBuffer[below] += error * downWeight;\n          if (x + 1u < parameters.outputSize.x) {\n            errorBuffer[below + 1u] += error * downRightWeight;\n          }\n        }\n      }\n    }\n    storageBarrier();\n  }\n}\n", c = "\nstruct DisplayParameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: DisplayParameters;\n@group(0) @binding(1) var<storage, read> outputBits: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let bit = outputBits[cell.y * safeLogicalSize.x + cell.x];\n  return select(parameters.dark, parameters.light, bit != 0u);\n}\n", l = "\nstruct Parameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  patternArea: u32,\n  invert: u32,\n  time: f32,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let size = max(vec2f(parameters.logicalSize), vec2f(1.0));\n  var point = (vec2f(cell) + vec2f(0.5)) / size - vec2f(0.5);\n  point.x *= size.x / size.y;\n\n  let time = parameters.time * 0.5;\n  let broadWave = sin(point.x * 5.0 + point.y * 2.2 - time * 0.75);\n  let crossWave = sin(point.y * 6.0 - point.x * 2.6 + time * 0.48);\n  let driftingGlow = cos(distance(point, vec2f(sin(time * 0.19) * 0.3, cos(time * 0.16) * 0.2)) * 6.0 - time * 0.32);\n  let rawLuminance = clamp(0.5 + broadWave * 0.2 + crossWave * 0.11 + driftingGlow * 0.14, 0.0, 1.0);\n  let luminance = smoothstep(0.32, 0.68, rawLuminance);\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternArea);\n  return select(parameters.dark, parameters.light, sourceValue(cell) >= threshold);\n}\n", u = "\nstruct Parameters {\n  size: vec2u,\n  deltaTime: f32,\n  seed: u32,\n  pointer: vec2f,\n  pointerVelocity: vec2f,\n  pointerActive: f32,\n  interactionRadius: f32,\n  time: f32,\n  padding: f32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var previousState: texture_2d<f32>;\n@group(0) @binding(2) var linearSampler: sampler;\n@group(0) @binding(3) var nextState: texture_storage_2d<rgba16float, write>;\n@group(0) @binding(4) var secondaryState: texture_2d<f32>;\n\nfn simulationUv(cell: vec2u) -> vec2f {\n  return (vec2f(cell) + vec2f(0.5)) / vec2f(parameters.size);\n}\n\nfn isBoundary(cell: vec2u) -> bool {\n  return cell.x == 0u || cell.y == 0u || cell.x + 1u == parameters.size.x || cell.y + 1u == parameters.size.y;\n}\n\nfn random01(value: u32) -> f32 {\n  var bits = value ^ parameters.seed;\n  bits = bits ^ (bits >> 16u);\n  bits = bits * 0x7feb352du;\n  bits = bits ^ (bits >> 15u);\n  bits = bits * 0x846ca68bu;\n  bits = bits ^ (bits >> 16u);\n  return f32(bits & 0x00ffffffu) / 16777216.0;\n}\n\nfn plateTemperature(cell: vec2u) -> f32 {\n  let irregularity = random01(cell.x) * 2.0 - 1.0;\n  let broadVariation = sin(f32(cell.x) * 0.19 + f32(parameters.seed & 1023u) * 0.013);\n  return clamp(0.91 + irregularity * 0.055 + broadVariation * 0.035, 0.78, 1.0);\n}\n\n@compute @workgroup_size(8, 8)\nfn initialize(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n\n  let uv = simulationUv(id.xy);\n  var temperature = exp(-(1.0 - uv.y) * 42.0) * plateTemperature(id.xy);\n  if (id.y == 0u) {\n    temperature = 0.0;\n  }\n  if (id.y + 1u == parameters.size.y) {\n    temperature = plateTemperature(id.xy);\n  }\n  textureStore(nextState, vec2i(id.xy), vec4f(0.0, 0.0, 0.0, temperature));\n}\n\n@compute @workgroup_size(8, 8)\nfn clearScalar(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  textureStore(nextState, vec2i(id.xy), vec4f(0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn advect(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n\n  let cell = id.xy;\n  let uv = simulationUv(cell);\n  let texel = 1.0 / vec2f(parameters.size);\n  let current = textureLoad(previousState, vec2i(cell), 0);\n\n  if (isBoundary(cell)) {\n    var boundaryTemperature = current.w * exp(-parameters.deltaTime * 0.035);\n    if (cell.y == 0u) {\n      boundaryTemperature = 0.0;\n    }\n    if (cell.y + 1u == parameters.size.y) {\n      boundaryTemperature = plateTemperature(cell);\n    }\n    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, boundaryTemperature));\n    return;\n  }\n\n  let backUv = clamp(uv - current.xy * parameters.deltaTime, texel * 1.5, vec2f(1.0) - texel * 1.5);\n  let advected = textureSampleLevel(previousState, linearSampler, backUv, 0.0);\n  var velocity = advected.xy;\n\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0);\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0);\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0);\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0);\n  let neighborTemperature = (left.w + right.w + up.w + down.w) * 0.25;\n  var temperature = mix(advected.w, neighborTemperature, min(parameters.deltaTime * 0.9, 0.08));\n  temperature *= exp(-parameters.deltaTime * 0.035);\n\n  let plateBand = smoothstep(0.94, 0.995, uv.y);\n  temperature = max(temperature, plateBand * plateTemperature(cell));\n  temperature *= smoothstep(0.0, 0.075, uv.y);\n\n  // Boussinesq-style buoyancy: hot fluid rises and cool fluid settles.\n  // Texture-space Y points downward, so rising velocity is negative.\n  velocity.y -= (temperature - 0.16) * parameters.deltaTime * 0.58;\n  let fixedPerturbation = random01(cell.x * 1664525u + cell.y * 1013904223u) * 2.0 - 1.0;\n  velocity.x += fixedPerturbation * plateBand * parameters.deltaTime * 0.022;\n\n  if (parameters.pointerActive > 0.5) {\n    let offset = uv - parameters.pointer;\n    let falloff = exp(-dot(offset, offset) / max(0.0001, parameters.interactionRadius * parameters.interactionRadius));\n    let tangent = vec2f(-offset.y, offset.x);\n    velocity += (parameters.pointerVelocity * 1.4 + tangent * 0.4) * falloff * parameters.deltaTime;\n  }\n\n  velocity *= exp(-parameters.deltaTime * 0.12);\n  let speed = length(velocity);\n  if (speed > 0.75) {\n    velocity *= 0.75 / speed;\n  }\n\n  textureStore(nextState, vec2i(cell), vec4f(velocity, 0.0, clamp(temperature, 0.0, 1.0)));\n}\n\n@compute @workgroup_size(8, 8)\nfn divergence(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let cell = id.xy;\n  if (isBoundary(cell)) {\n    textureStore(nextState, vec2i(cell), vec4f(0.0));\n    return;\n  }\n\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).xy;\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).xy;\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).xy;\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).xy;\n  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));\n  let value = 0.5 * reciprocalCellSize * ((right.x - left.x) + (down.y - up.y));\n  textureStore(nextState, vec2i(cell), vec4f(value, 0.0, 0.0, 0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn solvePressure(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let cell = id.xy;\n  if (isBoundary(cell)) {\n    let interior = clamp(vec2i(cell), vec2i(1), vec2i(parameters.size) - vec2i(2));\n    let pressure = textureLoad(previousState, interior, 0).x;\n    textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));\n    return;\n  }\n\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).x;\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).x;\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).x;\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).x;\n  let source = textureLoad(secondaryState, vec2i(cell), 0).x;\n  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));\n  let cellSizeSquared = 1.0 / (reciprocalCellSize * reciprocalCellSize);\n  let pressure = (left + right + up + down - source * cellSizeSquared) * 0.25;\n  textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn project(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let cell = id.xy;\n  let advected = textureLoad(previousState, vec2i(cell), 0);\n  var temperature = advected.w;\n\n  if (isBoundary(cell)) {\n    if (cell.y == 0u) {\n      temperature = 0.0;\n    }\n    if (cell.y + 1u == parameters.size.y) {\n      temperature = plateTemperature(cell);\n    }\n    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, temperature));\n    return;\n  }\n\n  let left = textureLoad(secondaryState, vec2i(cell) + vec2i(-1, 0), 0).x;\n  let right = textureLoad(secondaryState, vec2i(cell) + vec2i(1, 0), 0).x;\n  let up = textureLoad(secondaryState, vec2i(cell) + vec2i(0, -1), 0).x;\n  let down = textureLoad(secondaryState, vec2i(cell) + vec2i(0, 1), 0).x;\n  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));\n  var velocity = advected.xy - 0.5 * reciprocalCellSize * vec2f(right - left, down - up);\n\n  // Prevent the cells beside the perimeter from carrying flow through a wall.\n  if (cell.x == 1u && velocity.x < 0.0) { velocity.x = 0.0; }\n  if (cell.x + 2u == parameters.size.x && velocity.x > 0.0) { velocity.x = 0.0; }\n  if (cell.y == 1u && velocity.y < 0.0) { velocity.y = 0.0; }\n  if (cell.y + 2u == parameters.size.y && velocity.y > 0.0) { velocity.y = 0.0; }\n\n  textureStore(nextState, vec2i(cell), vec4f(velocity, 0.0, temperature));\n}\n", d = "\nstruct Parameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  patternArea: u32,\n  invert: u32,\n  padding: u32,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n@group(0) @binding(2) var fluidState: texture_2d<f32>;\n@group(0) @binding(3) var linearSampler: sampler;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(safeLogicalSize);\n  let velocity = textureSampleLevel(fluidState, linearSampler, uv, 0.0).xy;\n  let luminance = smoothstep(0.015, 0.16, length(velocity));\n  let source = select(luminance, 1.0 - luminance, parameters.invert != 0u);\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternArea);\n  return select(parameters.dark, parameters.light, source >= threshold);\n}\n", f;
function p() {
	return typeof navigator < "u" && "gpu" in navigator;
}
async function m(e) {
	if (!p()) throw Error("WebGPU is not available in this browser.");
	return f ||= navigator.gpu.requestAdapter({ powerPreference: e }).then(async (e) => {
		if (!e) throw Error("No compatible WebGPU adapter was found.");
		let t = await e.requestDevice();
		return t.lost.then(() => {
			f = void 0;
		}), t;
	}), f;
}
async function h(e, t, n) {
	let r = e.createShaderModule({
		label: t,
		code: n
	}), i = (await r.getCompilationInfo()).messages.filter((e) => e.type === "error");
	if (i.length > 0) throw Error(i.map((e) => `${t}: ${e.message}`).join("\n"));
	return r;
}
//#endregion
//#region src/FloydSteinberg.tsx
var g = 256, _ = [
	0,
	0,
	0,
	1
], v = [
	1,
	1,
	1,
	1
], y, b = /* @__PURE__ */ new WeakMap();
function x() {
	return p();
}
function S(e, t) {
	let n = b.get(e);
	n || (n = /* @__PURE__ */ new Map(), b.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([h(e, "Stochastic Floyd–Steinberg WGSL", s), h(e, "Floyd–Steinberg display WGSL", c)]), i = e.createBindGroupLayout({
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
function C(e) {
	return typeof HTMLImageElement < "u" && e instanceof HTMLImageElement ? {
		width: e.naturalWidth,
		height: e.naturalHeight
	} : {
		width: e.width,
		height: e.height
	};
}
async function w(e, t) {
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
	let { width: n, height: r } = C(e);
	return {
		source: e,
		width: n,
		height: r
	};
}
function T(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function E(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function D(e, t, n, r) {
	if (n !== void 0 && r !== void 0) return {
		width: E(n, e),
		height: E(r, t)
	};
	if (n !== void 0) {
		let r = E(n, e);
		return {
			width: r,
			height: E(r * t / e, t)
		};
	}
	if (r !== void 0) {
		let n = E(r, t);
		return {
			width: E(n * e / t, e),
			height: n
		};
	}
	return {
		width: E(e, 1),
		height: E(t, 1)
	};
}
function O(e) {
	let t = e.trim();
	if (!y) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, y = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!y) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	y.fillStyle = "#010203", y.fillStyle = t;
	let n = y.fillStyle;
	if (y.fillStyle = "#040506", y.fillStyle = t, !t || y.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	y.clearRect(0, 0, 1, 1), y.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = y.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function k(e) {
	return typeof e == "string" ? O(e) : [
		T(e[0], 0, 1, 0),
		T(e[1], 0, 1, 0),
		T(e[2], 0, 1, 0),
		T(e[3] ?? 1, 0, 1, 1)
	];
}
function A(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function j(e) {
	e && (e.output.destroy(), e.errors.destroy(), e.computeParameters.destroy(), e.displayParameters.destroy(), e.bandParameters.destroy(), e.sourceTexture.destroy());
}
function M(e, t, n) {
	let r = /* @__PURE__ */ new ArrayBuffer(48), i = new DataView(r);
	i.setUint32(0, n.logicalWidth, !0), i.setUint32(4, n.logicalHeight, !0), i.setUint32(8, n.sourceWidth, !0), i.setUint32(12, n.sourceHeight, !0), i.setUint32(16, {
		stretch: 0,
		cover: 1,
		contain: 2
	}[n.fit], !0), i.setUint32(20, +!!n.invert, !0), i.setFloat32(24, n.threshold, !0), i.setFloat32(28, n.randomness, !0), i.setUint32(32, n.seed >>> 0, !0), i.setFloat32(36, n.alphaBackground, !0), e.queue.writeBuffer(t, 0, r);
}
function ee(e, t, n, r, i, a, o, s) {
	let c = /* @__PURE__ */ new ArrayBuffer(48), l = new DataView(c);
	l.setUint32(0, n, !0), l.setUint32(4, r, !0), l.setFloat32(8, i, !0), l.setFloat32(12, a, !0);
	let u = new Float32Array(c, 16, 8);
	u.set(k(o), 0), u.set(k(s), 4), e.queue.writeBuffer(t, 0, c);
}
function N(e, t) {
	typeof e == "function" ? e(t) : e && (e.current = t);
}
var P = e(function({ src: e, width: r, height: s, pixelScale: c = 1, randomness: l = .35, threshold: u = .5, fit: d = "contain", invert: f = !1, seed: p = 1592594996, alphaBackground: h = 1, dark: y = _, light: b = v, crossOrigin: x = "anonymous", powerPreference: C = "high-performance", onReady: O, onError: k, "aria-label": P = "Floyd–Steinberg dithered image", ...F }, I) {
	let L = i(null), te = i(O), R = i(k), [z, B] = a(), [V, H] = a(), ne = A(y), re = A(b);
	te.current = O, R.current = k;
	let [U, W] = a("loading"), G = t((e) => {
		L.current = e, N(I, e);
	}, [I]);
	n(() => {
		let t = !1;
		return W("loading"), B(void 0), H(void 0), w(e, x).then((e) => {
			if (t) {
				e.dispose?.();
				return;
			}
			if (e.width < 1 || e.height < 1) throw e.dispose?.(), Error("The source image has no drawable pixels.");
			B(e);
		}).catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			W("error"), R.current?.(n);
		}), () => {
			t = !0;
		};
	}, [e, x]);
	let K = z ? D(z.width, z.height, r, s) : {
		width: E(r, 300),
		height: E(s, 150)
	};
	return n(() => {
		H(void 0);
	}, [r, s]), n(() => {
		let e = L.current;
		if (!e || !z) return;
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
			H((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
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
		z,
		K.width,
		K.height
	]), n(() => {
		let e = L.current;
		if (!e || !z || !V) return;
		let t = !1, n;
		return W("loading"), (async () => {
			let r = E(c, 1), i = Math.ceil(V.cssWidth / r), a = Math.ceil(V.cssHeight / r), o = r * V.width / V.cssWidth, s = r * V.height / V.cssHeight, _ = await m(C);
			if (t) return;
			let v = _.limits.maxTextureDimension2D;
			if (z.width > v || z.height > v || V.width > v || V.height > v) throw Error(`The source or output exceeds this device's ${v}px texture limit.`);
			let x = Math.max(4, i * a * 4);
			if (x > _.limits.maxStorageBufferBindingSize) throw Error("The requested output exceeds this device's storage-buffer limit. Increase pixelScale.");
			let w = e.getContext("webgpu");
			if (!w) throw Error("The canvas could not create a WebGPU context.");
			let D = navigator.gpu.getPreferredCanvasFormat();
			w.configure({
				device: _,
				format: D,
				alphaMode: "premultiplied"
			});
			let O = await S(_, D);
			if (t) return;
			let k = _.createBuffer({
				label: "Floyd–Steinberg output",
				size: x,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), A = _.createBuffer({
				label: "Floyd–Steinberg errors",
				size: x,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), j = _.createBuffer({
				label: "Floyd–Steinberg parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), N = _.createBuffer({
				label: "Floyd–Steinberg display parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), P = Math.ceil(a / g), F = _.limits.minUniformBufferOffsetAlignment, I = new ArrayBuffer(F * P), L = new DataView(I);
			for (let e = 0; e < P; e += 1) {
				let t = e * g;
				L.setUint32(e * F, t, !0), L.setUint32(e * F + 4, Math.min(g, a - t), !0);
			}
			let R = _.createBuffer({
				label: "Floyd–Steinberg band parameters",
				size: I.byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), B = _.createTexture({
				label: "Floyd–Steinberg source image",
				size: [z.width, z.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
			});
			n = {
				output: k,
				errors: A,
				computeParameters: j,
				displayParameters: N,
				bandParameters: R,
				sourceTexture: B
			}, _.queue.copyExternalImageToTexture({ source: z.source }, { texture: B }, [z.width, z.height]), _.queue.writeBuffer(R, 0, I), M(_, j, {
				logicalWidth: i,
				logicalHeight: a,
				sourceWidth: z.width,
				sourceHeight: z.height,
				fit: d,
				invert: f,
				threshold: T(u, 0, 1, .5),
				randomness: T(l, 0, 2, .35),
				seed: p,
				alphaBackground: T(h, 0, 1, 1)
			}), ee(_, N, i, a, o, s, y, b);
			let H = _.createBindGroup({
				label: "Floyd–Steinberg compute bind group",
				layout: O.computeLayout,
				entries: [
					{
						binding: 0,
						resource: { buffer: j }
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
							buffer: R,
							size: 16
						}
					},
					{
						binding: 4,
						resource: B.createView()
					}
				]
			}), ne = _.createBindGroup({
				label: "Floyd–Steinberg display bind group",
				layout: O.display.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: N }
				}, {
					binding: 1,
					resource: { buffer: k }
				}]
			}), re = _.createCommandEncoder({ label: "Floyd–Steinberg render" });
			re.clearBuffer(A);
			for (let e = 0; e < P; e += 1) {
				let t = re.beginComputePass({ label: `Floyd–Steinberg band ${e}` });
				t.setPipeline(O.compute), t.setBindGroup(0, H, [e * F]), t.dispatchWorkgroups(1), t.end();
			}
			let U = re.beginRenderPass({
				label: "Floyd–Steinberg display pass",
				colorAttachments: [{
					view: w.getCurrentTexture().createView(),
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
			U.setPipeline(O.display), U.setBindGroup(0, ne), U.draw(3), U.end(), _.queue.submit([re.finish()]), await _.queue.onSubmittedWorkDone(), !t && (W("ready"), te.current?.({
				canvas: e,
				device: _,
				...V,
				logicalWidth: i,
				logicalHeight: a
			}));
		})().catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			W("error"), R.current?.(n);
		}), () => {
			t = !0, j(n);
		};
	}, [
		z,
		V,
		c,
		l,
		u,
		d,
		f,
		p,
		h,
		ne,
		re,
		C
	]), n(() => () => {
		z?.dispose?.();
	}, [z]), /* @__PURE__ */ o("canvas", {
		...F,
		ref: G,
		width: V?.width ?? K.width,
		height: V?.height ?? K.height,
		"aria-label": P,
		"data-webgpu-status": U
	});
}), F = /* @__PURE__ */ new Map(), I = 8, L = 6;
function te(e, t) {
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
	for (let o = 0; o < I; o += 1) {
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
function ne(e, t) {
	let n = e.length, r = Math.min(L, Math.floor(Math.log2(t)));
	for (let i = 1; i <= r; i += 1) {
		let r = 2 ** i;
		for (let i = 1; i < r; i += 2) H(e, t, Math.floor((i - 1) * n / r), Math.floor(i * n / r), Math.floor((i + 1) * n / r));
	}
}
function re(e, t) {
	let n = `${e}:${t >>> 0}`, r = F.get(n);
	if (r) return r;
	let i = e * e, a = te(i, t), o = new Float64Array(i), s = new Float64Array(i), c = [
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
	return ne(u, e), F.set(n, u), u;
}
//#endregion
//#region src/BlueNoiseWave.tsx
var U = 1e3 / 60, W = [
	0,
	0,
	0,
	1
], G = [
	1,
	1,
	1,
	1
], K, q = /* @__PURE__ */ new WeakMap();
function ie(e, t) {
	let n = q.get(e);
	n || (n = /* @__PURE__ */ new Map(), q.set(e, n));
	let r = n.get(t);
	return r || (r = h(e, "Blue-noise wave WGSL", l).then((n) => e.createRenderPipeline({
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
function J(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function Y(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function ae(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: Y(e, 900),
		height: Y(t, 600)
	};
	if (e !== void 0) {
		let t = Y(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = Y(t, 600);
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
function X(e) {
	let t = e.trim();
	if (!K) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, K = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!K) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	K.fillStyle = "#010203", K.fillStyle = t;
	let n = K.fillStyle;
	if (K.fillStyle = "#040506", K.fillStyle = t, !t || K.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	K.clearRect(0, 0, 1, 1), K.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = K.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function oe(e) {
	return typeof e == "string" ? X(e) : [
		J(e[0], 0, 1, 0),
		J(e[1], 0, 1, 0),
		J(e[2], 0, 1, 0),
		J(e[3] ?? 1, 0, 1, 1)
	];
}
function se(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function ce(e) {
	e?.parameters.destroy(), e?.pattern.destroy();
}
function le(e, t) {
	typeof e == "function" ? e(t) : e && (e.current = t);
}
var ue = e(function({ width: e, height: s, pixelScale: c = 2, patternSize: l = 64, invert: u = !1, seed: d = 1592594996, dark: f = W, light: p = G, powerPreference: h = "high-performance", onReady: g, onError: _, "aria-label": v = "Blue-noise dithered wave", ...y }, b) {
	let x = i(null), S = i(g), C = i(_), [w, T] = a(), [E, D] = a("loading"), O = ae(e, s), k = se(f), A = se(p);
	S.current = g, C.current = _;
	let j = t((e) => {
		x.current = e, le(b, e);
	}, [b]);
	return n(() => {
		T(void 0);
	}, [e, s]), n(() => {
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
	}, [O.width, O.height]), r(() => {
		let e = x.current;
		if (!e || !w) return;
		let t = !1, n = 0, r;
		D("loading");
		let i = (e) => {
			t || (t = !0, n && cancelAnimationFrame(n), ce(r), r = void 0, D("error"), C.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = Y(c, 1), o = Math.round(J(l, 8, 128, 64)), s = Math.ceil(w.cssWidth / a), g = Math.ceil(w.cssHeight / a), _ = a * w.width / w.cssWidth, v = a * w.height / w.cssHeight, y = re(o, d), b = await m(h);
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
			let E = await ie(b, T);
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
			M.set(oe(f), 0), M.set(oe(p), 4);
			let ee = b.createBindGroup({
				label: "Blue-noise wave bind group",
				layout: E.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: O }
				}, {
					binding: 1,
					resource: { buffer: k }
				}]
			}), N = performance.now(), P = N - U, F = !1, I = (r) => {
				if (t) return;
				let a = r - P;
				if (a < U) {
					n = requestAnimationFrame(I);
					return;
				}
				P = r - a % U;
				try {
					j.setFloat32(28, (r - N) / 1e3, !0), b.queue.writeBuffer(O, 0, A);
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
					o.setPipeline(E), o.setBindGroup(0, ee), o.draw(3), o.end(), b.queue.submit([a.finish()]), F || (F = !0, b.queue.onSubmittedWorkDone().then(() => {
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
					}, i)), n = requestAnimationFrame(I);
				} catch (e) {
					i(e);
				}
			};
			I(performance.now());
		})().catch(i), () => {
			t = !0, n && cancelAnimationFrame(n), ce(r);
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
	]), /* @__PURE__ */ o("canvas", {
		...y,
		ref: j,
		width: w?.width ?? O.width,
		height: w?.height ?? O.height,
		"aria-label": v,
		"data-webgpu-status": E
	});
}), de = 1e3 / 60, fe = .5, pe = 16, me = [
	0,
	0,
	0,
	1
], he = [
	1,
	1,
	1,
	1
], Z, ge = /* @__PURE__ */ new WeakMap();
function _e(e, t) {
	let n = ge.get(e);
	n || (n = /* @__PURE__ */ new Map(), ge.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([h(e, "Fluid simulation WGSL", u), h(e, "Blue-noise fluid WGSL", d)]), i = e.createBindGroupLayout({
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
function Q(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function ve(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function $(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: ve(e, 900),
		height: ve(t, 600)
	};
	if (e !== void 0) {
		let t = ve(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = ve(t, 600);
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
function ye(e) {
	let t = e.trim();
	if (!Z) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, Z = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!Z) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	Z.fillStyle = "#010203", Z.fillStyle = t;
	let n = Z.fillStyle;
	if (Z.fillStyle = "#040506", Z.fillStyle = t, !t || Z.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	Z.clearRect(0, 0, 1, 1), Z.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = Z.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function be(e) {
	return typeof e == "string" ? ye(e) : [
		Q(e[0], 0, 1, 0),
		Q(e[1], 0, 1, 0),
		Q(e[2], 0, 1, 0),
		Q(e[3] ?? 1, 0, 1, 1)
	];
}
function xe(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function Se(e) {
	e?.simulationParameters.destroy(), e?.displayParameters.destroy(), e?.pattern.destroy(), e?.state.destroy(), e?.advectedState.destroy(), e?.divergence.destroy(), e?.pressureA.destroy(), e?.pressureB.destroy();
}
function Ce(e, t) {
	typeof e == "function" ? e(t) : e && (e.current = t);
}
var we = e(function({ width: e, height: s, pixelScale: c = 2, patternSize: l = 64, simulationSize: u = 192, interactionRadius: d = .05, invert: f = !1, seed: p = 1592594996, dark: h = me, light: g = he, powerPreference: _ = "high-performance", onReady: v, onError: y, style: b, "aria-label": x = "Interactive blue-noise fluid simulation", ...S }, C) {
	let w = i(null), T = i({
		x: .5,
		y: .5,
		velocityX: 0,
		velocityY: 0,
		lastEventTime: 0,
		lastMoveTime: -Infinity
	}), E = i(v), D = i(y), [O, k] = a(), [A, j] = a("loading"), M = $(e, s), ee = xe(h), N = xe(g);
	E.current = v, D.current = y;
	let P = t((e) => {
		w.current = e, Ce(C, e);
	}, [C]);
	return n(() => {
		k(void 0);
	}, [e, s]), n(() => {
		let e = w.current;
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
			k((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
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
	}, [M.width, M.height]), n(() => {
		let e = w.current;
		if (!e) return;
		let t = (t) => {
			let n = e.getBoundingClientRect();
			T.current.x = Q((t.clientX - n.left) / n.width, 0, 1, .5), T.current.y = Q((t.clientY - n.top) / n.height, 0, 1, .5), T.current.velocityX = 0, T.current.velocityY = 0, T.current.lastEventTime = t.timeStamp;
		}, n = (t) => {
			let n = e.getBoundingClientRect(), r = Q((t.clientX - n.left) / n.width, 0, 1, .5), i = Q((t.clientY - n.top) / n.height, 0, 1, .5), a = T.current, o = Math.max(1 / 240, (t.timeStamp - a.lastEventTime) / 1e3);
			a.velocityX = Q((r - a.x) / o, -3, 3, 0), a.velocityY = Q((i - a.y) / o, -3, 3, 0), a.x = r, a.y = i, a.lastEventTime = t.timeStamp, a.lastMoveTime = performance.now();
		}, r = () => {
			T.current.lastMoveTime = -Infinity;
		}, i = (n) => {
			t(n), T.current.lastMoveTime = performance.now(), e.setPointerCapture(n.pointerId);
		};
		return e.addEventListener("pointerenter", t), e.addEventListener("pointermove", n), e.addEventListener("pointerleave", r), e.addEventListener("pointerdown", i), () => {
			e.removeEventListener("pointerenter", t), e.removeEventListener("pointermove", n), e.removeEventListener("pointerleave", r), e.removeEventListener("pointerdown", i);
		};
	}, []), r(() => {
		let e = w.current;
		if (!e || !O) return;
		let t = !1, n = 0, r;
		j("loading");
		let i = (e) => {
			t || (t = !0, n && cancelAnimationFrame(n), Se(r), r = void 0, j("error"), D.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = ve(c, 1), o = Math.round(Q(l, 8, 128, 64)), s = Math.round(Q(u, 32, 384, 192)), v = Math.ceil(O.cssWidth / a), y = Math.ceil(O.cssHeight / a), b = a * O.width / O.cssWidth, x = a * O.height / O.cssHeight, S = O.cssWidth / O.cssHeight, C = S >= 1 ? s : Math.max(16, Math.round(s * S)), w = S >= 1 ? Math.max(16, Math.round(s / S)) : s, D = re(o, p), k = await m(_);
			if (t) return;
			let A = k.limits.maxTextureDimension2D;
			if (O.width > A || O.height > A || C > A || w > A) throw Error(`The output or simulation exceeds this device's ${A}px texture limit.`);
			let M = e.getContext("webgpu");
			if (!M) throw Error("The canvas could not create a WebGPU context.");
			let ee = navigator.gpu.getPreferredCanvasFormat();
			M.configure({
				device: k,
				format: ee,
				alphaMode: "premultiplied"
			});
			let N = await _e(k, ee);
			if (t) return;
			let P = k.createBuffer({
				label: "Fluid simulation parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), F = k.createBuffer({
				label: "Blue-noise fluid display parameters",
				size: 64,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), I = k.createBuffer({
				label: "Tileable blue-noise ranks",
				size: D.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), L = {
				size: [C, w],
				format: "rgba16float",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
			}, te = k.createTexture({
				...L,
				label: "Fluid state"
			}), R = k.createTexture({
				...L,
				label: "Advected fluid state"
			}), z = k.createTexture({
				...L,
				label: "Fluid divergence"
			}), B = k.createTexture({
				...L,
				label: "Fluid pressure A"
			}), V = k.createTexture({
				...L,
				label: "Fluid pressure B"
			}), H = k.createSampler({
				label: "Fluid linear sampler",
				magFilter: "linear",
				minFilter: "linear",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge"
			});
			r = {
				simulationParameters: P,
				displayParameters: F,
				pattern: I,
				state: te,
				advectedState: R,
				divergence: z,
				pressureA: B,
				pressureB: V,
				sampler: H
			}, k.queue.writeBuffer(I, 0, D);
			let ne = /* @__PURE__ */ new ArrayBuffer(48), U = new DataView(ne);
			U.setUint32(0, C, !0), U.setUint32(4, w, !0), U.setUint32(12, p >>> 0, !0), U.setFloat32(36, Q(d, .01, .3, .05), !0), k.queue.writeBuffer(P, 0, ne);
			let W = /* @__PURE__ */ new ArrayBuffer(64), G = new DataView(W);
			G.setUint32(0, v, !0), G.setUint32(4, y, !0), G.setFloat32(8, b, !0), G.setFloat32(12, x, !0), G.setUint32(16, o, !0), G.setUint32(20, o * o, !0), G.setUint32(24, +!!f, !0);
			let K = new Float32Array(W, 32, 8);
			K.set(be(h), 0), K.set(be(g), 4), k.queue.writeBuffer(F, 0, W);
			let q = te.createView(), ie = R.createView(), J = z.createView(), Y = B.createView(), ae = V.createView(), X = (e, t, n, r) => k.createBindGroup({
				label: e,
				layout: N.computeLayout,
				entries: [
					{
						binding: 0,
						resource: { buffer: P }
					},
					{
						binding: 1,
						resource: t
					},
					{
						binding: 2,
						resource: H
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
			}), oe = X("Initialize fluid state", ie, q, J), se = X("Clear fluid pressure A", q, Y, J), ce = X("Clear fluid pressure B", q, ae, J), le = X("Advect fluid state", q, ie, J), ue = X("Measure fluid divergence", ie, J, Y), me = [X("Solve pressure A to B", Y, ae, J), X("Solve pressure B to A", ae, Y, J)], he = X("Project fluid velocity", ie, q, Y), Z = k.createBindGroup({
				label: "Blue-noise fluid display",
				layout: N.display.getBindGroupLayout(0),
				entries: [
					{
						binding: 0,
						resource: { buffer: F }
					},
					{
						binding: 1,
						resource: { buffer: I }
					},
					{
						binding: 2,
						resource: q
					},
					{
						binding: 3,
						resource: H
					}
				]
			}), ge = k.createCommandEncoder({ label: "Initialize fluid" }), $ = ge.beginComputePass();
			$.setPipeline(N.initialize), $.setBindGroup(0, oe), $.dispatchWorkgroups(Math.ceil(C / 8), Math.ceil(w / 8)), $.setPipeline(N.clearScalar), $.setBindGroup(0, se), $.dispatchWorkgroups(Math.ceil(C / 8), Math.ceil(w / 8)), $.setBindGroup(0, ce), $.dispatchWorkgroups(Math.ceil(C / 8), Math.ceil(w / 8)), $.end(), k.queue.submit([ge.finish()]);
			let ye = performance.now(), xe = ye - de, Se = ye, Ce = !1, we = (r) => {
				if (t) return;
				let a = r - xe;
				if (a < de) {
					n = requestAnimationFrame(we);
					return;
				}
				xe = r - a % de;
				try {
					let a = Q((r - Se) / 1e3, 1 / 240, 1 / 30, 1 / 60) * fe;
					Se = r;
					let o = T.current, s = performance.now() - o.lastMoveTime < 120;
					U.setFloat32(8, a, !0), U.setFloat32(16, o.x, !0), U.setFloat32(20, o.y, !0), U.setFloat32(24, o.velocityX, !0), U.setFloat32(28, o.velocityY, !0), U.setFloat32(32, +!!s, !0), U.setFloat32(40, (r - ye) / 1e3, !0), k.queue.writeBuffer(P, 0, ne), o.velocityX *= .72, o.velocityY *= .72;
					let c = k.createCommandEncoder({ label: "Fluid simulation frame" }), l = (e, t, n) => {
						let r = c.beginComputePass({ label: e });
						r.setPipeline(t), r.setBindGroup(0, n), r.dispatchWorkgroups(Math.ceil(C / 8), Math.ceil(w / 8)), r.end();
					};
					l("Advect and heat fluid", N.advect, le), l("Measure fluid divergence", N.divergence, ue);
					for (let e = 0; e < pe; e += 1) l(`Solve fluid pressure ${e + 1}`, N.solvePressure, me[e % 2]);
					l("Project fluid velocity", N.project, he);
					let u = c.beginRenderPass({
						label: "Blue-noise fluid display pass",
						colorAttachments: [{
							view: M.getCurrentTexture().createView(),
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
					u.setPipeline(N.display), u.setBindGroup(0, Z), u.draw(3), u.end(), k.queue.submit([c.finish()]), Ce || (Ce = !0, k.queue.onSubmittedWorkDone().then(() => {
						if (t) return;
						j("ready");
						let n = {
							canvas: e,
							device: k,
							...O,
							logicalWidth: v,
							logicalHeight: y
						};
						E.current?.(n);
					}, i)), n = requestAnimationFrame(we);
				} catch (e) {
					i(e);
				}
			};
			we(performance.now());
		})().catch(i), () => {
			t = !0, n && cancelAnimationFrame(n), Se(r);
		};
	}, [
		O,
		c,
		l,
		u,
		d,
		f,
		p,
		ee,
		N,
		_
	]), /* @__PURE__ */ o("canvas", {
		...S,
		ref: P,
		width: O?.width ?? M.width,
		height: O?.height ?? M.height,
		style: {
			touchAction: "none",
			...b
		},
		"aria-label": x,
		"data-webgpu-status": A
	});
});
//#endregion
export { we as BlueNoiseFluid, ue as BlueNoiseWave, P as FloydSteinberg, c as displayShader, s as floydSteinbergShader, x as isWebGpuSupported };
