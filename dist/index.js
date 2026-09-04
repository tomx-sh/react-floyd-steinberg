import { useCallback as e, useEffect as t, useLayoutEffect as n, useRef as r, useState as i } from "react";
import { jsx as a } from "react/jsx-runtime";
//#region src/shaders.ts
var o = "\nstruct Parameters {\n  outputSize: vec2u,\n  sourceSize: vec2u,\n  fit: u32,\n  invert: u32,\n  threshold: f32,\n  randomness: f32,\n  seed: u32,\n  alphaBackground: f32,\n  padding0: u32,\n  padding1: u32,\n}\n\nstruct Band {\n  firstRow: u32,\n  rowCount: u32,\n  padding0: u32,\n  padding1: u32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read_write> outputBits: array<u32>;\n@group(0) @binding(2) var<storage, read_write> errorBuffer: array<f32>;\n@group(0) @binding(3) var<uniform> band: Band;\n@group(0) @binding(4) var sourceTexture: texture_2d<f32>;\n\nfn hashValue(cell: vec2u, seed: u32) -> f32 {\n  var value = cell.x * 0x9e3779b9u + cell.y * 0x85ebca6bu + seed;\n  value = (value ^ (value >> 16u)) * 0x7feb352du;\n  value = (value ^ (value >> 15u)) * 0x846ca68bu;\n  value = value ^ (value >> 16u);\n  return f32(value) / 4294967295.0;\n}\n\nfn fittedUv(cell: vec2u) -> vec3f {\n  let outputSize = vec2f(parameters.outputSize);\n  let sourceSize = vec2f(parameters.sourceSize);\n  let outputAspect = outputSize.x / outputSize.y;\n  let sourceAspect = sourceSize.x / sourceSize.y;\n  var uv = (vec2f(cell) + vec2f(0.5)) / outputSize;\n\n  if (parameters.fit == 1u) {\n    // Cover: crop the longer source axis.\n    if (sourceAspect > outputAspect) {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    } else {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    }\n  } else if (parameters.fit == 2u) {\n    // Contain: map the letterboxed output area outside the source UV range.\n    if (sourceAspect > outputAspect) {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    } else {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    }\n  }\n\n  let inside = select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));\n  return vec3f(uv, inside);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let fitted = fittedUv(cell);\n  var luminance = parameters.alphaBackground;\n\n  if (fitted.z > 0.5) {\n    let maxPosition = vec2i(parameters.sourceSize) - vec2i(1);\n    let position = clamp(vec2i(fitted.xy * vec2f(parameters.sourceSize)), vec2i(0), maxPosition);\n    let color = textureLoad(sourceTexture, position, 0);\n    let imageLuminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));\n    luminance = mix(parameters.alphaBackground, imageLuminance, color.a);\n  }\n\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@compute @workgroup_size(256)\nfn main(@builtin(local_invocation_index) localRow: u32) {\n  let row = band.firstRow + localRow;\n  let activeRow = localRow < band.rowCount && row < parameters.outputSize.y;\n  var phaseCount = parameters.outputSize.x;\n  if (band.rowCount > 0u) {\n    phaseCount += 3u * (band.rowCount - 1u);\n  }\n\n  for (var phase = 0u; phase < phaseCount; phase += 1u) {\n    let rowDelay = 3u * localRow;\n    if (activeRow && phase >= rowDelay) {\n      let x = phase - rowDelay;\n      if (x < parameters.outputSize.x) {\n        let cell = vec2u(x, row);\n        let index = row * parameters.outputSize.x + x;\n        let value = clamp(sourceValue(cell) + errorBuffer[index], 0.0, 1.0);\n        let bit = select(0u, 1u, value >= parameters.threshold);\n        let error = value - f32(bit);\n        outputBits[index] = bit;\n\n        let r1 = (hashValue(cell, parameters.seed) * 2.0 - 1.0) * (5.0 / 16.0);\n        let r2 = (hashValue(cell, parameters.seed ^ 0xa511e9b3u) * 2.0 - 1.0) * (1.0 / 16.0);\n        let rightWeight = 7.0 / 16.0 + parameters.randomness * r1;\n        let downWeight = 5.0 / 16.0 - parameters.randomness * r1;\n        let downLeftWeight = 3.0 / 16.0 + parameters.randomness * r2;\n        let downRightWeight = 1.0 / 16.0 - parameters.randomness * r2;\n\n        if (x + 1u < parameters.outputSize.x) {\n          errorBuffer[index + 1u] += error * rightWeight;\n        }\n        if (row + 1u < parameters.outputSize.y) {\n          let below = index + parameters.outputSize.x;\n          if (x > 0u) {\n            errorBuffer[below - 1u] += error * downLeftWeight;\n          }\n          errorBuffer[below] += error * downWeight;\n          if (x + 1u < parameters.outputSize.x) {\n            errorBuffer[below + 1u] += error * downRightWeight;\n          }\n        }\n      }\n    }\n    storageBarrier();\n  }\n}\n", s = "\nstruct DisplayParameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: DisplayParameters;\n@group(0) @binding(1) var<storage, read> outputBits: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let bit = outputBits[cell.y * safeLogicalSize.x + cell.x];\n  return select(parameters.dark, parameters.light, bit != 0u);\n}\n", c = "\nstruct Parameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  patternArea: u32,\n  invert: u32,\n  time: f32,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let size = max(vec2f(parameters.logicalSize), vec2f(1.0));\n  var point = (vec2f(cell) + vec2f(0.5)) / size - vec2f(0.5);\n  point.x *= size.x / size.y;\n\n  let time = parameters.time * 0.5;\n  let broadWave = sin(point.x * 5.0 + point.y * 2.2 - time * 0.75);\n  let crossWave = sin(point.y * 6.0 - point.x * 2.6 + time * 0.48);\n  let driftingGlow = cos(distance(point, vec2f(sin(time * 0.19) * 0.3, cos(time * 0.16) * 0.2)) * 6.0 - time * 0.32);\n  let rawLuminance = clamp(0.5 + broadWave * 0.2 + crossWave * 0.11 + driftingGlow * 0.14, 0.0, 1.0);\n  let luminance = smoothstep(0.32, 0.68, rawLuminance);\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternArea);\n  return select(parameters.dark, parameters.light, sourceValue(cell) >= threshold);\n}\n", l = "\nstruct Parameters {\n  size: vec2u,\n  deltaTime: f32,\n  seed: u32,\n  pointer: vec2f,\n  pointerVelocity: vec2f,\n  pointerActive: f32,\n  interactionRadius: f32,\n  time: f32,\n  quantity: u32,\n  viscosity: f32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var previousState: texture_2d<f32>;\n@group(0) @binding(2) var linearSampler: sampler;\n@group(0) @binding(3) var nextState: texture_storage_2d<rgba16float, write>;\n@group(0) @binding(4) var secondaryState: texture_2d<f32>;\n\nfn simulationUv(cell: vec2u) -> vec2f {\n  return (vec2f(cell) + vec2f(0.5)) / vec2f(parameters.size);\n}\n\nfn isBoundary(cell: vec2u) -> bool {\n  return cell.x == 0u || cell.y == 0u || cell.x + 1u == parameters.size.x || cell.y + 1u == parameters.size.y;\n}\n\nfn random01(value: u32) -> f32 {\n  var bits = value ^ parameters.seed;\n  bits = bits ^ (bits >> 16u);\n  bits = bits * 0x7feb352du;\n  bits = bits ^ (bits >> 15u);\n  bits = bits * 0x846ca68bu;\n  bits = bits ^ (bits >> 16u);\n  return f32(bits & 0x00ffffffu) / 16777216.0;\n}\n\nfn plateTemperature(cell: vec2u) -> f32 {\n  let irregularity = random01(cell.x) * 2.0 - 1.0;\n  let broadVariation = sin(f32(cell.x) * 0.19 + f32(parameters.seed & 1023u) * 0.013);\n  return clamp(0.91 + irregularity * 0.055 + broadVariation * 0.035, 0.78, 1.0);\n}\n\nfn wallTemperature(cell: vec2u) -> f32 {\n  let verticalPosition = f32(cell.y) / f32(max(parameters.size.y - 1u, 1u));\n  return verticalPosition * plateTemperature(cell);\n}\n\n@compute @workgroup_size(8, 8)\nfn initialize(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n\n  let uv = simulationUv(id.xy);\n  var temperature = exp(-(1.0 - uv.y) * 42.0) * plateTemperature(id.xy);\n  if (isBoundary(id.xy)) {\n    temperature = wallTemperature(id.xy);\n  }\n  textureStore(nextState, vec2i(id.xy), vec4f(0.0, 0.0, 0.0, temperature));\n}\n\n@compute @workgroup_size(8, 8)\nfn clearScalar(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  textureStore(nextState, vec2i(id.xy), vec4f(0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn resample(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let uv = simulationUv(id.xy);\n  let sampled = textureSampleLevel(previousState, linearSampler, uv, 0.0);\n  textureStore(nextState, vec2i(id.xy), sampled);\n}\n\n@compute @workgroup_size(8, 8)\nfn advect(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n\n  let cell = id.xy;\n  let uv = simulationUv(cell);\n  let texel = 1.0 / vec2f(parameters.size);\n  let current = textureLoad(previousState, vec2i(cell), 0);\n\n  if (isBoundary(cell)) {\n    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, wallTemperature(cell)));\n    return;\n  }\n\n  let backUv = clamp(uv - current.xy * parameters.deltaTime, texel * 1.5, vec2f(1.0) - texel * 1.5);\n  let advected = textureSampleLevel(previousState, linearSampler, backUv, 0.0);\n  var velocity = advected.xy;\n\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0);\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0);\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0);\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0);\n  let neighborVelocity = (left.xy + right.xy + up.xy + down.xy) * 0.25;\n  let neighborTemperature = (left.w + right.w + up.w + down.w) * 0.25;\n  // Viscosity diffuses velocity gradients, removing small eddies while\n  // preserving the large-scale convection. Exponential decay keeps this\n  // stable across varying frame times.\n  let viscousMix = 1.0 - exp(-parameters.viscosity * parameters.deltaTime);\n  velocity = mix(velocity, neighborVelocity, viscousMix);\n  var temperature = mix(advected.w, neighborTemperature, min(parameters.deltaTime * 0.9, 0.08));\n  temperature *= exp(-parameters.deltaTime * 0.035);\n\n  let plateBand = smoothstep(0.94, 0.995, uv.y);\n  temperature = max(temperature, plateBand * plateTemperature(cell));\n  temperature *= smoothstep(0.0, 0.075, uv.y);\n\n  // Boussinesq-style buoyancy: hot fluid rises and cool fluid settles.\n  // Texture-space Y points downward, so rising velocity is negative.\n  velocity.y -= (temperature - 0.16) * parameters.deltaTime * 0.58;\n  let fixedPerturbation = random01(cell.x * 1664525u + cell.y * 1013904223u) * 2.0 - 1.0;\n  velocity.x += fixedPerturbation * plateBand * parameters.deltaTime * 0.022;\n\n  if (parameters.pointerActive > 0.5) {\n    let offset = uv - parameters.pointer;\n    let falloff = exp(-dot(offset, offset) / max(0.0001, parameters.interactionRadius * parameters.interactionRadius));\n    if (parameters.quantity == 0u) {\n      let tangent = vec2f(-offset.y, offset.x);\n      velocity += (parameters.pointerVelocity * 1.4 + tangent * 0.4) * falloff * parameters.deltaTime;\n    } else {\n      temperature += falloff * parameters.deltaTime * 2.5;\n    }\n  }\n\n  velocity *= exp(-parameters.deltaTime * 0.12);\n  let speed = length(velocity);\n  if (speed > 0.75) {\n    velocity *= 0.75 / speed;\n  }\n\n  textureStore(nextState, vec2i(cell), vec4f(velocity, 0.0, clamp(temperature, 0.0, 1.0)));\n}\n\n@compute @workgroup_size(8, 8)\nfn divergence(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let cell = id.xy;\n  if (isBoundary(cell)) {\n    textureStore(nextState, vec2i(cell), vec4f(0.0));\n    return;\n  }\n\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).xy;\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).xy;\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).xy;\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).xy;\n  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));\n  let value = 0.5 * reciprocalCellSize * ((right.x - left.x) + (down.y - up.y));\n  textureStore(nextState, vec2i(cell), vec4f(value, 0.0, 0.0, 0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn solvePressure(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let cell = id.xy;\n  if (isBoundary(cell)) {\n    let interior = clamp(vec2i(cell), vec2i(1), vec2i(parameters.size) - vec2i(2));\n    let pressure = textureLoad(previousState, interior, 0).x;\n    textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));\n    return;\n  }\n\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).x;\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).x;\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).x;\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).x;\n  let source = textureLoad(secondaryState, vec2i(cell), 0).x;\n  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));\n  let cellSizeSquared = 1.0 / (reciprocalCellSize * reciprocalCellSize);\n  let pressure = (left + right + up + down - source * cellSizeSquared) * 0.25;\n  textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn project(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let cell = id.xy;\n  let advected = textureLoad(previousState, vec2i(cell), 0);\n  var temperature = advected.w;\n\n  if (isBoundary(cell)) {\n    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, wallTemperature(cell)));\n    return;\n  }\n\n  let left = textureLoad(secondaryState, vec2i(cell) + vec2i(-1, 0), 0).x;\n  let right = textureLoad(secondaryState, vec2i(cell) + vec2i(1, 0), 0).x;\n  let up = textureLoad(secondaryState, vec2i(cell) + vec2i(0, -1), 0).x;\n  let down = textureLoad(secondaryState, vec2i(cell) + vec2i(0, 1), 0).x;\n  let reciprocalCellSize = f32(max(parameters.size.x, parameters.size.y));\n  var velocity = advected.xy - 0.5 * reciprocalCellSize * vec2f(right - left, down - up);\n\n  // Prevent the cells beside the perimeter from carrying flow through a wall.\n  if (cell.x == 1u && velocity.x < 0.0) { velocity.x = 0.0; }\n  if (cell.x + 2u == parameters.size.x && velocity.x > 0.0) { velocity.x = 0.0; }\n  if (cell.y == 1u && velocity.y < 0.0) { velocity.y = 0.0; }\n  if (cell.y + 2u == parameters.size.y && velocity.y > 0.0) { velocity.y = 0.0; }\n\n  textureStore(nextState, vec2i(cell), vec4f(velocity, 0.0, temperature));\n}\n", u = "\nstruct Parameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  quantity: u32,\n  invert: u32,\n  contrast: f32,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n@group(0) @binding(2) var fluidState: texture_2d<f32>;\n@group(0) @binding(3) var linearSampler: sampler;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(safeLogicalSize);\n  let fluid = textureSampleLevel(fluidState, linearSampler, uv, 0.0);\n  let velocityLuminance = smoothstep(0.015, 0.16, length(fluid.xy));\n  let temperatureLuminance = smoothstep(0.0, 0.85, fluid.w);\n  var luminance = select(velocityLuminance, temperatureLuminance, parameters.quantity != 0u);\n  // Expand or collapse the colored areas by pushing luminance away from or\n  // toward its midpoint before the blue-noise threshold comparison.\n  luminance = clamp((luminance - 0.5) * parameters.contrast + 0.5, 0.0, 1.0);\n  let source = select(luminance, 1.0 - luminance, parameters.invert != 0u);\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternSize * parameters.patternSize);\n  return select(parameters.dark, parameters.light, source >= threshold);\n}\n", d = "\nstruct Parameters {\n  size: vec2u,\n  deltaTime: f32,\n  seed: u32,\n  pointer: vec2f,\n  pointerActive: f32,\n  interactionRadius: f32,\n  time: f32,\n  mu: f32,\n  sigma: f32,\n  contrast: f32,\n  invert: u32,\n  kernelRadius: u32,\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  kernelConfig: u32,\n  dark: vec4f,\n  light: vec4f,\n  kernelPeaks: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var previousState: texture_2d<f32>;\n@group(0) @binding(2) var nextState: texture_storage_2d<rgba16float, write>;\n@group(0) @binding(3) var linearSampler: sampler;\n@group(0) @binding(4) var<storage, read> initialState: array<f32>;\n\nfn kernelPeak(index: u32) -> f32 {\n  if (index == 0u) { return parameters.kernelPeaks.x; }\n  if (index == 1u) { return parameters.kernelPeaks.y; }\n  if (index == 2u) { return parameters.kernelPeaks.z; }\n  return parameters.kernelPeaks.w;\n}\n\n// Catalog presets can combine up to four concentric bump4 or quad4 bands.\nfn kernelWeight(distance: f32) -> f32 {\n  let r = distance / f32(parameters.kernelRadius);\n  if (r <= 0.0 || r >= 1.0) {\n    return 0.0;\n  }\n  let peakCount = max(parameters.kernelConfig & 0xffu, 1u);\n  let bandPosition = r * f32(peakCount);\n  let bandIndex = min(u32(floor(bandPosition)), peakCount - 1u);\n  let bandR = fract(bandPosition);\n  let core = select(\n    exp(4.0 - 1.0 / (bandR * (1.0 - bandR))),\n    pow(4.0 * bandR * (1.0 - bandR), 4.0),\n    (parameters.kernelConfig & 0x100u) != 0u,\n  );\n  return kernelPeak(bandIndex) * core;\n}\n\n@compute @workgroup_size(8, 8)\nfn initialize(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n\n  let value = initialState[id.y * parameters.size.x + id.x];\n  textureStore(nextState, vec2i(id.xy), vec4f(value, 0.0, 0.0, 1.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn resample(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n  let uv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(parameters.size);\n  textureStore(nextState, vec2i(id.xy), textureSampleLevel(previousState, linearSampler, uv, 0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn advance(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) {\n    return;\n  }\n\n  let cell = vec2i(id.xy);\n  let extent = i32(parameters.kernelRadius);\n  var potential = 0.0;\n  var normalization = 0.0;\n  for (var dy = -extent; dy <= extent; dy += 1) {\n    for (var dx = -extent; dx <= extent; dx += 1) {\n      let weight = kernelWeight(length(vec2f(f32(dx), f32(dy))));\n      if (weight > 0.0) {\n        let sampleX = (cell.x + dx + i32(parameters.size.x)) % i32(parameters.size.x);\n        let sampleY = (cell.y + dy + i32(parameters.size.y)) % i32(parameters.size.y);\n        potential += weight * textureLoad(previousState, vec2i(sampleX, sampleY), 0).x;\n        normalization += weight;\n      }\n    }\n  }\n  potential /= normalization;\n\n  let deviation = potential - parameters.mu;\n  let gaussianGrowth = exp(-deviation * deviation / (2.0 * parameters.sigma * parameters.sigma));\n  let polynomialBase = max(0.0, 1.0 - deviation * deviation / (9.0 * parameters.sigma * parameters.sigma));\n  let polynomialGrowth = pow(polynomialBase, 4.0);\n  let growth = 2.0 * select(\n    gaussianGrowth,\n    polynomialGrowth,\n    (parameters.kernelConfig & 0x200u) != 0u,\n  ) - 1.0;\n  var state = textureLoad(previousState, cell, 0).x + parameters.deltaTime * growth;\n\n  // Pointer interaction injects a soft creature-sized blob.\n  if (parameters.pointerActive > 0.5) {\n    let offset = (vec2f(cell) + vec2f(0.5)) / vec2f(parameters.size) - parameters.pointer;\n    let scaled = offset * vec2f(f32(parameters.size.x), f32(parameters.size.y));\n    let sigmaCells = parameters.interactionRadius * f32(parameters.size.y);\n    let gaussian = 0.95 * exp(-dot(scaled, scaled) / (2.0 * sigmaCells * sigmaCells));\n    state = max(state, gaussian);\n  }\n\n  textureStore(nextState, cell, vec4f(clamp(state, 0.0, 1.0), 0.0, 0.0, 1.0));\n}\n", f = "\nstruct Parameters {\n  size: vec2u,\n  deltaTime: f32,\n  seed: u32,\n  pointer: vec2f,\n  pointerActive: f32,\n  interactionRadius: f32,\n  time: f32,\n  mu: f32,\n  sigma: f32,\n  contrast: f32,\n  invert: u32,\n  kernelRadius: u32,\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  kernelConfig: u32,\n  dark: vec4f,\n  light: vec4f,\n  kernelPeaks: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n@group(0) @binding(2) var leniaState: texture_2d<f32>;\n@group(0) @binding(3) var linearSampler: sampler;\n@group(0) @binding(4) var previousLeniaState: texture_2d<f32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\nfn mitchellWeight(distance: f32) -> f32 {\n  let x = abs(distance);\n  if (x <= 1.0) {\n    return (7.0 * x * x * x - 12.0 * x * x + 16.0 / 3.0) / 6.0;\n  }\n  if (x < 2.0) {\n    return ((-7.0 / 3.0 * x + 12.0) * x * x - 20.0 * x + 32.0 / 3.0) / 6.0;\n  }\n  return 0.0;\n}\n\nfn sampleBicubic(stateTexture: texture_2d<f32>, uv: vec2f) -> f32 {\n  let textureSize = vec2i(textureDimensions(stateTexture));\n  let position = uv * vec2f(textureSize) - vec2f(0.5);\n  let base = vec2i(floor(position));\n  let fraction = fract(position);\n  var value = 0.0;\n  var totalWeight = 0.0;\n\n  for (var y = -1; y <= 2; y += 1) {\n    let weightY = mitchellWeight(f32(y) - fraction.y);\n    for (var x = -1; x <= 2; x += 1) {\n      let weight = mitchellWeight(f32(x) - fraction.x) * weightY;\n      let cell = clamp(base + vec2i(x, y), vec2i(0), textureSize - vec2i(1));\n      value += textureLoad(stateTexture, cell, 0).x * weight;\n      totalWeight += weight;\n    }\n  }\n  return clamp(value / max(totalWeight, 0.0001), 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(safeLogicalSize);\n  let ditherDisabled = (parameters.kernelConfig & 0x400u) != 0u;\n  var currentState = textureSampleLevel(leniaState, linearSampler, uv, 0.0).x;\n  var previousState = textureSampleLevel(previousLeniaState, linearSampler, uv, 0.0).x;\n  if (ditherDisabled) {\n    currentState = sampleBicubic(leniaState, uv);\n    previousState = sampleBicubic(previousLeniaState, uv);\n  }\n  let state = mix(previousState, currentState, clamp(parameters.time, 0.0, 1.0));\n  // Preserve faint densities in source-debug mode; the dithered presentation\n  // keeps its tighter curve so the blue-noise pattern remains well defined.\n  var luminance = select(smoothstep(0.04, 0.5, state), pow(clamp(state, 0.0, 1.0), 0.8), ditherDisabled);\n  luminance = clamp((luminance - 0.5) * parameters.contrast + 0.5, 0.0, 1.0);\n  let source = select(luminance, 1.0 - luminance, parameters.invert != 0u);\n  if (ditherDisabled) {\n    return mix(parameters.dark, parameters.light, source);\n  }\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternSize * parameters.patternSize);\n  return select(parameters.dark, parameters.light, source >= threshold);\n}\n", p;
function m() {
	return typeof navigator < "u" && "gpu" in navigator;
}
async function h(e) {
	if (!m()) throw Error("WebGPU is not available in this browser.");
	return p ||= navigator.gpu.requestAdapter({ powerPreference: e }).then(async (e) => {
		if (!e) throw Error("No compatible WebGPU adapter was found.");
		let t = await e.requestDevice();
		return t.lost.then(() => {
			p = void 0;
		}), t;
	}), p;
}
async function g(e, t, n) {
	let r = e.createShaderModule({
		label: t,
		code: n
	}), i = (await r.getCompilationInfo()).messages.filter((e) => e.type === "error");
	if (i.length > 0) throw Error(i.map((e) => `${t}: ${e.message}`).join("\n"));
	return r;
}
//#endregion
//#region src/FloydSteinberg.tsx
var _ = 256, v = [
	0,
	0,
	0,
	1
], y = [
	1,
	1,
	1,
	1
], b, x = /* @__PURE__ */ new WeakMap();
function S() {
	return m();
}
function C(e, t) {
	let n = x.get(e);
	n || (n = /* @__PURE__ */ new Map(), x.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([g(e, "Stochastic Floyd–Steinberg WGSL", o), g(e, "Floyd–Steinberg display WGSL", s)]), i = e.createBindGroupLayout({
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
function w(e) {
	return typeof HTMLImageElement < "u" && e instanceof HTMLImageElement ? {
		width: e.naturalWidth,
		height: e.naturalHeight
	} : {
		width: e.width,
		height: e.height
	};
}
async function T(e, t) {
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
	let { width: n, height: r } = w(e);
	return {
		source: e,
		width: n,
		height: r
	};
}
function E(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function D(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function O(e, t, n, r) {
	if (n !== void 0 && r !== void 0) return {
		width: D(n, e),
		height: D(r, t)
	};
	if (n !== void 0) {
		let r = D(n, e);
		return {
			width: r,
			height: D(r * t / e, t)
		};
	}
	if (r !== void 0) {
		let n = D(r, t);
		return {
			width: D(n * e / t, e),
			height: n
		};
	}
	return {
		width: D(e, 1),
		height: D(t, 1)
	};
}
function k(e) {
	let t = e.trim();
	if (!b) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, b = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!b) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	b.fillStyle = "#010203", b.fillStyle = t;
	let n = b.fillStyle;
	if (b.fillStyle = "#040506", b.fillStyle = t, !t || b.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	b.clearRect(0, 0, 1, 1), b.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = b.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function A(e) {
	return typeof e == "string" ? k(e) : [
		E(e[0], 0, 1, 0),
		E(e[1], 0, 1, 0),
		E(e[2], 0, 1, 0),
		E(e[3] ?? 1, 0, 1, 1)
	];
}
function j(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function M(e) {
	e && (e.output.destroy(), e.errors.destroy(), e.computeParameters.destroy(), e.displayParameters.destroy(), e.bandParameters.destroy(), e.sourceTexture.destroy());
}
function N(e, t, n) {
	let r = /* @__PURE__ */ new ArrayBuffer(48), i = new DataView(r);
	i.setUint32(0, n.logicalWidth, !0), i.setUint32(4, n.logicalHeight, !0), i.setUint32(8, n.sourceWidth, !0), i.setUint32(12, n.sourceHeight, !0), i.setUint32(16, {
		stretch: 0,
		cover: 1,
		contain: 2
	}[n.fit], !0), i.setUint32(20, +!!n.invert, !0), i.setFloat32(24, n.threshold, !0), i.setFloat32(28, n.randomness, !0), i.setUint32(32, n.seed >>> 0, !0), i.setFloat32(36, n.alphaBackground, !0), e.queue.writeBuffer(t, 0, r);
}
function P(e, t, n, r, i, a, o, s) {
	let c = /* @__PURE__ */ new ArrayBuffer(48), l = new DataView(c);
	l.setUint32(0, n, !0), l.setUint32(4, r, !0), l.setFloat32(8, i, !0), l.setFloat32(12, a, !0);
	let u = new Float32Array(c, 16, 8);
	u.set(A(o), 0), u.set(A(s), 4), e.queue.writeBuffer(t, 0, c);
}
function F({ src: n, width: o, height: s, pixelScale: c = 1, randomness: l = .35, threshold: u = .5, fit: d = "contain", invert: f = !1, seed: p = 1592594996, alphaBackground: m = 1, dark: g = v, light: b = y, crossOrigin: x = "anonymous", powerPreference: S = "high-performance", onReady: w, onError: k, ref: A, "aria-label": F = "Floyd–Steinberg dithered image", ...I }) {
	let L = r(null), R = r(w), z = r(k), [B, V] = i(), [H, U] = i(), W = j(g), G = j(b);
	R.current = w, z.current = k;
	let [ee, K] = i("loading"), q = e((e) => {
		L.current = e, typeof A == "function" ? A(e) : A && (A.current = e);
	}, [A]);
	t(() => {
		let e = !1;
		return K("loading"), V(void 0), U(void 0), T(n, x).then((t) => {
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
	}, [n, x]);
	let J = B ? O(B.width, B.height, o, s) : {
		width: D(o, 300),
		height: D(s, 150)
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
			let r = D(c, 1), i = Math.ceil(H.cssWidth / r), a = Math.ceil(H.cssHeight / r), o = r * H.width / H.cssWidth, s = r * H.height / H.cssHeight, v = await h(S);
			if (t) return;
			let y = v.limits.maxTextureDimension2D;
			if (B.width > y || B.height > y || H.width > y || H.height > y) throw Error(`The source or output exceeds this device's ${y}px texture limit.`);
			let x = Math.max(4, i * a * 4);
			if (x > v.limits.maxStorageBufferBindingSize) throw Error("The requested output exceeds this device's storage-buffer limit. Increase pixelScale.");
			let w = e.getContext("webgpu");
			if (!w) throw Error("The canvas could not create a WebGPU context.");
			let T = navigator.gpu.getPreferredCanvasFormat();
			w.configure({
				device: v,
				format: T,
				alphaMode: "premultiplied"
			});
			let O = await C(v, T);
			if (t) return;
			let k = v.createBuffer({
				label: "Floyd–Steinberg output",
				size: x,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), A = v.createBuffer({
				label: "Floyd–Steinberg errors",
				size: x,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), j = v.createBuffer({
				label: "Floyd–Steinberg parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), M = v.createBuffer({
				label: "Floyd–Steinberg display parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), F = Math.ceil(a / _), I = v.limits.minUniformBufferOffsetAlignment, L = new ArrayBuffer(I * F), z = new DataView(L);
			for (let e = 0; e < F; e += 1) {
				let t = e * _;
				z.setUint32(e * I, t, !0), z.setUint32(e * I + 4, Math.min(_, a - t), !0);
			}
			let V = v.createBuffer({
				label: "Floyd–Steinberg band parameters",
				size: L.byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), U = v.createTexture({
				label: "Floyd–Steinberg source image",
				size: [B.width, B.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
			});
			n = {
				output: k,
				errors: A,
				computeParameters: j,
				displayParameters: M,
				bandParameters: V,
				sourceTexture: U
			}, v.queue.copyExternalImageToTexture({ source: B.source }, { texture: U }, [B.width, B.height]), v.queue.writeBuffer(V, 0, L), N(v, j, {
				logicalWidth: i,
				logicalHeight: a,
				sourceWidth: B.width,
				sourceHeight: B.height,
				fit: d,
				invert: f,
				threshold: E(u, 0, 1, .5),
				randomness: E(l, 0, 2, .35),
				seed: p,
				alphaBackground: E(m, 0, 1, 1)
			}), P(v, M, i, a, o, s, g, b);
			let W = v.createBindGroup({
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
							buffer: V,
							size: 16
						}
					},
					{
						binding: 4,
						resource: U.createView()
					}
				]
			}), G = v.createBindGroup({
				label: "Floyd–Steinberg display bind group",
				layout: O.display.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: M }
				}, {
					binding: 1,
					resource: { buffer: k }
				}]
			}), ee = v.createCommandEncoder({ label: "Floyd–Steinberg render" });
			ee.clearBuffer(A);
			for (let e = 0; e < F; e += 1) {
				let t = ee.beginComputePass({ label: `Floyd–Steinberg band ${e}` });
				t.setPipeline(O.compute), t.setBindGroup(0, W, [e * I]), t.dispatchWorkgroups(1), t.end();
			}
			let q = ee.beginRenderPass({
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
			q.setPipeline(O.display), q.setBindGroup(0, G), q.draw(3), q.end(), v.queue.submit([ee.finish()]), await v.queue.onSubmittedWorkDone(), !t && (K("ready"), R.current?.({
				canvas: e,
				device: v,
				...H,
				logicalWidth: i,
				logicalHeight: a
			}));
		})().catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			K("error"), z.current?.(n);
		}), () => {
			t = !0, M(n);
		};
	}, [
		B,
		H,
		c,
		l,
		u,
		d,
		f,
		p,
		m,
		W,
		G,
		S
	]), t(() => () => {
		B?.dispose?.();
	}, [B]), /* @__PURE__ */ a("canvas", {
		...I,
		ref: q,
		width: H?.width ?? J.width,
		height: H?.height ?? J.height,
		"aria-label": F,
		"data-webgpu-status": ee
	});
}
//#endregion
//#region src/blueNoise.ts
var I = /* @__PURE__ */ new Map(), L = 8, R = 6;
function z(e, t) {
	let n = new Float64Array(e), r = t >>> 0 || 1;
	for (let t = 0; t < e; t += 1) r ^= r << 13, r ^= r >>> 17, r ^= r << 5, n[t] = (r >>> 0) / 4294967296;
	return n;
}
function B(e, t) {
	let n = new Float64Array(t * 2 + 1), r = 0;
	for (let i = -t; i <= t; i += 1) {
		let a = Math.exp(-(i * i) / (2 * e * e));
		n[i + t] = a, r += a;
	}
	for (let e = 0; e < n.length; e += 1) n[e] /= r;
	return n;
}
function V(e, t, n, r, i) {
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
function H(e, t, n, r) {
	let i = (r.length - 1) / 2, a = e % n, o = Math.floor(e / n), s = t % n, c = Math.floor(t / n), l = Math.min(Math.abs(a - s), n - Math.abs(a - s)), u = Math.min(Math.abs(o - c), n - Math.abs(o - c));
	return l > i || u > i ? 0 : r[i + l] * r[i + u];
}
function U(e, t, n, r) {
	let i = t % n, a = Math.floor(t / n);
	for (let t = -r; t <= r; t += 1) for (let o = -r; o <= r; o += 1) {
		let r = (i + o + n) % n, s = (a + t + n) % n;
		e[s * n + r] = 1;
	}
}
function W(e, t, n, r, i) {
	let a = e.length, o = r / a, s = o <= .5, c = Math.min(o, 1 - o), l = Math.min(2.25, Math.max(.8, .38 / Math.sqrt(c))), u = Math.min(7, Math.floor((t - 1) / 2), Math.ceil(l * 3)), d = B(l, u), f = d[u] * d[u], p = Math.max(1, Math.floor(Math.min(r - n, i - r) / 64));
	for (let o = 0; o < L; o += 1) {
		let o = V(e, t, r, s, d), c = [], l = [];
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
			if (o[r] - H(n, r, t, d) >= i) break;
			let a = e[n];
			e[n] = e[r], e[r] = a, U(m, n, t, u), U(m, r, t, u), _ += 1;
		}
		if (_ === 0) break;
	}
}
function G(e, t) {
	let n = e.length, r = Math.min(R, Math.floor(Math.log2(t)));
	for (let i = 1; i <= r; i += 1) {
		let r = 2 ** i;
		for (let i = 1; i < r; i += 2) W(e, t, Math.floor((i - 1) * n / r), Math.floor(i * n / r), Math.floor((i + 1) * n / r));
	}
}
function ee(e, t) {
	let n = `${e}:${t >>> 0}`, r = I.get(n);
	if (r) return r;
	let i = e * e, a = z(i, t), o = new Float64Array(i), s = new Float64Array(i), c = [
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
	return G(u, e), I.set(n, u), u;
}
//#endregion
//#region src/BlueNoiseWave.tsx
var K = 1e3 / 60, q = [
	0,
	0,
	0,
	1
], J = [
	1,
	1,
	1,
	1
], Y, te = /* @__PURE__ */ new WeakMap();
function ne(e, t) {
	let n = te.get(e);
	n || (n = /* @__PURE__ */ new Map(), te.set(e, n));
	let r = n.get(t);
	return r || (r = g(e, "Blue-noise wave WGSL", c).then((n) => e.createRenderPipeline({
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
function re(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function ie(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function ae(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: ie(e, 900),
		height: ie(t, 600)
	};
	if (e !== void 0) {
		let t = ie(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = ie(t, 600);
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
function oe(e) {
	let t = e.trim();
	if (!Y) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, Y = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!Y) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	Y.fillStyle = "#010203", Y.fillStyle = t;
	let n = Y.fillStyle;
	if (Y.fillStyle = "#040506", Y.fillStyle = t, !t || Y.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	Y.clearRect(0, 0, 1, 1), Y.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = Y.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function se(e) {
	return typeof e == "string" ? oe(e) : [
		re(e[0], 0, 1, 0),
		re(e[1], 0, 1, 0),
		re(e[2], 0, 1, 0),
		re(e[3] ?? 1, 0, 1, 1)
	];
}
function ce(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function le(e) {
	e?.parameters.destroy(), e?.pattern.destroy();
}
function ue({ width: o, height: s, pixelScale: c = 2, patternSize: l = 64, invert: u = !1, seed: d = 1592594996, dark: f = q, light: p = J, powerPreference: m = "high-performance", onReady: g, onError: _, ref: v, "aria-label": y = "Blue-noise dithered wave", ...b }) {
	let x = r(null), S = r(g), C = r(_), [w, T] = i(), [E, D] = i("loading"), O = ae(o, s), k = ce(f), A = ce(p);
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
			t || (t = !0, n && cancelAnimationFrame(n), le(r), r = void 0, D("error"), C.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = ie(c, 1), o = Math.round(re(l, 8, 128, 64)), s = Math.ceil(w.cssWidth / a), g = Math.ceil(w.cssHeight / a), _ = a * w.width / w.cssWidth, v = a * w.height / w.cssHeight, y = ee(o, d), b = await h(m);
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
			let E = await ne(b, T);
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
			M.set(se(f), 0), M.set(se(p), 4);
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
			}), P = performance.now(), F = P - K, I = !1, L = (r) => {
				if (t) return;
				let a = r - F;
				if (a < K) {
					n = requestAnimationFrame(L);
					return;
				}
				F = r - a % K;
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
			t = !0, n && cancelAnimationFrame(n), le(r);
		};
	}, [
		w,
		c,
		l,
		u,
		d,
		k,
		A,
		m
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
var de = 1e3 / 60, fe = .5, pe = 16, me = [
	0,
	0,
	0,
	1
], he = [
	1,
	1,
	1,
	1
], X, ge = /* @__PURE__ */ new WeakMap();
function _e(e, t) {
	let n = ge.get(e);
	n || (n = /* @__PURE__ */ new Map(), ge.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([g(e, "Fluid simulation WGSL", l), g(e, "Blue-noise fluid WGSL", u)]), i = e.createBindGroupLayout({
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
function Z(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function ve(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function ye(e, t) {
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
function be(e) {
	let t = e.trim();
	if (!X) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, X = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!X) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	X.fillStyle = "#010203", X.fillStyle = t;
	let n = X.fillStyle;
	if (X.fillStyle = "#040506", X.fillStyle = t, !t || X.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	X.clearRect(0, 0, 1, 1), X.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = X.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function xe(e) {
	return typeof e == "string" ? be(e) : [
		Z(e[0], 0, 1, 0),
		Z(e[1], 0, 1, 0),
		Z(e[2], 0, 1, 0),
		Z(e[3] ?? 1, 0, 1, 1)
	];
}
function Se(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function Ce(e) {
	e?.simulationParameters.destroy(), e?.displayParameters.destroy(), e?.pattern.destroy(), e?.state.destroy(), e?.advectedState.destroy(), e?.divergence.destroy(), e?.pressureA.destroy(), e?.pressureB.destroy();
}
function we({ width: o, height: s, pixelScale: c = 2, patternSize: l = 64, simulationSize: u = 192, interactionRadius: d = .05, viscosity: f = 1, quantity: p = "temperature", contrast: m = 1, invert: g = !1, seed: _ = 1592594996, dark: v = me, light: y = he, powerPreference: b = "high-performance", onReady: x, onError: S, ref: C, style: w, "aria-label": T = "Interactive blue-noise fluid simulation", ...E }) {
	let D = r(null), O = r({
		x: .5,
		y: .5,
		velocityX: 0,
		velocityY: 0,
		lastEventTime: 0,
		lastMoveTime: -Infinity
	}), k = r(x), A = r(S), [j, M] = i(), [N, P] = i("loading"), F = ye(o, s), I = Se(v), L = Se(y);
	k.current = x, A.current = S;
	let R = r(void 0), z = r({
		pixelScale: c,
		patternSize: l,
		simulationSize: u,
		interactionRadius: d,
		viscosity: f,
		quantity: p,
		contrast: m,
		invert: g,
		darkDependency: I,
		lightDependency: L,
		seed: _,
		powerPreference: b,
		dark: v,
		light: y
	});
	z.current = {
		pixelScale: c,
		patternSize: l,
		simulationSize: u,
		interactionRadius: d,
		viscosity: f,
		quantity: p,
		contrast: m,
		invert: g,
		darkDependency: I,
		lightDependency: L,
		seed: _,
		powerPreference: b,
		dark: v,
		light: y
	}, r(void 0);
	let B = r(F);
	B.current = F;
	let V = e((e) => {
		D.current = e, typeof C == "function" ? C(e) : C && (C.current = e);
	}, [C]);
	return t(() => {
		M(void 0);
	}, [o, s]), t(() => {
		let e = D.current;
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
			R.current = a, M((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
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
	}, [F.width, F.height]), t(() => {
		let e = D.current;
		if (!e) return;
		let t = (t) => {
			let n = e.getBoundingClientRect();
			O.current.x = Z((t.clientX - n.left) / n.width, 0, 1, .5), O.current.y = Z((t.clientY - n.top) / n.height, 0, 1, .5), O.current.velocityX = 0, O.current.velocityY = 0, O.current.lastEventTime = t.timeStamp;
		}, n = (t) => {
			let n = e.getBoundingClientRect(), r = Z((t.clientX - n.left) / n.width, 0, 1, .5), i = Z((t.clientY - n.top) / n.height, 0, 1, .5), a = O.current, o = Math.max(1 / 240, (t.timeStamp - a.lastEventTime) / 1e3);
			a.velocityX = Z((r - a.x) / o, -3, 3, 0), a.velocityY = Z((i - a.y) / o, -3, 3, 0), a.x = r, a.y = i, a.lastEventTime = t.timeStamp, a.lastMoveTime = performance.now();
		}, r = () => {
			O.current.lastMoveTime = -Infinity;
		}, i = (n) => {
			t(n), O.current.lastMoveTime = performance.now(), e.setPointerCapture(n.pointerId);
		};
		return e.addEventListener("pointerenter", t), e.addEventListener("pointermove", n), e.addEventListener("pointerleave", r), e.addEventListener("pointerdown", i), () => {
			e.removeEventListener("pointerenter", t), e.removeEventListener("pointermove", n), e.removeEventListener("pointerleave", r), e.removeEventListener("pointerdown", i);
		};
	}, []), n(() => {
		let e = D.current;
		if (!e) return;
		let t = !1, n = 0, r;
		P("loading");
		let i = (e) => {
			t || (t = !0, n && cancelAnimationFrame(n), Ce(r), r = void 0, P("error"), A.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = z.current, o = Math.round(Z(a.simulationSize, 32, 384, 192)), s = Math.round(Z(a.patternSize, 8, 128, 64)), c = R.current ?? {
				width: e.width,
				height: e.height,
				cssWidth: e.clientWidth || B.current.width,
				cssHeight: e.clientHeight || B.current.height,
				devicePixelRatio: window.devicePixelRatio || 1
			}, l = c.cssWidth / c.cssHeight, u = l >= 1 ? o : Math.max(16, Math.round(o * l)), d = l >= 1 ? Math.max(16, Math.round(o / l)) : o, f = Math.ceil(c.cssWidth / Math.max(1, Math.round(a.pixelScale))), p = Math.ceil(c.cssHeight / Math.max(1, Math.round(a.pixelScale))), m = ee(s, a.seed), g = await h(a.powerPreference);
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
			let b = await _e(g, y);
			if (t) return;
			let x = g.createBuffer({
				label: "Fluid simulation parameters",
				size: 56,
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
			}), E = g.createTexture({
				...w,
				label: "Advected fluid state"
			}), D = g.createTexture({
				...w,
				label: "Fluid divergence"
			}), A = g.createTexture({
				...w,
				label: "Fluid pressure A"
			}), j = g.createTexture({
				...w,
				label: "Fluid pressure B"
			}), M = g.createSampler({
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
				advectedState: E,
				divergence: D,
				pressureA: A,
				pressureB: j,
				sampler: M
			}, g.queue.writeBuffer(C, 0, m);
			let N = /* @__PURE__ */ new ArrayBuffer(56), F = new DataView(N);
			F.setUint32(0, u, !0), F.setUint32(4, d, !0), F.setUint32(12, a.seed >>> 0, !0), F.setFloat32(36, Z(a.interactionRadius, .01, .3, .05), !0), F.setUint32(44, +(a.quantity === "temperature"), !0), F.setFloat32(48, Z(a.viscosity, 0, 20, 1), !0), g.queue.writeBuffer(x, 0, N);
			let I = /* @__PURE__ */ new ArrayBuffer(64), L = new DataView(I), V = Math.max(1, Math.round(a.pixelScale));
			L.setUint32(0, f, !0), L.setUint32(4, p, !0), L.setFloat32(8, V * c.width / c.cssWidth, !0), L.setFloat32(12, V * c.height / c.cssHeight, !0), L.setUint32(16, s, !0), L.setUint32(20, +(a.quantity === "temperature"), !0), L.setUint32(24, +!!a.invert, !0), L.setFloat32(28, Z(a.contrast, .25, 8, 1), !0);
			let H = {
				key: `${a.darkDependency}|${a.lightDependency}`,
				dark: xe(a.dark),
				light: xe(a.light)
			}, U = new Float32Array(I, 32, 8);
			U.set(H.dark, 0), U.set(H.light, 4), g.queue.writeBuffer(S, 0, I);
			let W = T.createView(), G = E.createView(), K = D.createView(), q = A.createView(), J = j.createView(), Y = (e, t, n, r) => g.createBindGroup({
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
						resource: M
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
			}), te = Y("Initialize fluid state", G, W, K), ne = Y("Clear fluid pressure A", W, q, K), re = Y("Clear fluid pressure B", W, J, K), ie = Y("Advect fluid state", W, G, K), ae = Y("Measure fluid divergence", G, K, q), oe = [Y("Solve pressure A to B", q, J, K), Y("Solve pressure B to A", J, q, K)], se = Y("Project fluid velocity", G, W, q), ce = g.createBindGroup({
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
						resource: M
					}
				]
			}), le = g.createCommandEncoder({ label: "Initialize fluid" }), ue = le.beginComputePass();
			ue.setPipeline(b.initialize), ue.setBindGroup(0, te), ue.dispatchWorkgroups(Math.ceil(u / 8), Math.ceil(d / 8)), ue.setPipeline(b.clearScalar), ue.setBindGroup(0, ne), ue.dispatchWorkgroups(Math.ceil(u / 8), Math.ceil(d / 8)), ue.setBindGroup(0, re), ue.dispatchWorkgroups(Math.ceil(u / 8), Math.ceil(d / 8)), ue.end(), g.queue.submit([le.finish()]);
			let me = performance.now(), he = me - de, X = me, ge = !1, ve = (e, t) => {
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
				F.setUint32(0, e, !0), F.setUint32(4, t, !0), g.queue.writeBuffer(x, 0, N);
				let _ = Y("Resample fluid state", W, l, W), v = g.createCommandEncoder({ label: "Resample fluid state" }), y = v.beginComputePass();
				y.setPipeline(b.resample), y.setBindGroup(0, _), y.dispatchWorkgroups(Math.ceil(e / 8), Math.ceil(t / 8)), y.end(), g.queue.submit([v.finish()]), T.destroy(), E.destroy(), D.destroy(), A.destroy(), j.destroy(), T = i, E = a, D = o, A = s, j = c, r && (r.state = i, r.advectedState = a, r.divergence = o, r.pressureA = s, r.pressureB = c), W = l, G = f, K = p, q = m, J = h, u = e, d = t, ie = Y("Advect fluid state", W, G, K), ae = Y("Measure fluid divergence", G, K, q), oe = [Y("Solve pressure A to B", q, J, K), Y("Solve pressure B to A", J, q, K)], se = Y("Project fluid velocity", G, W, q), ce = g.createBindGroup({
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
							resource: M
						}
					]
				});
			}, ye = (r) => {
				if (t) return;
				let a = r - he;
				if (a < de) {
					n = requestAnimationFrame(ye);
					return;
				}
				he = r - a % de;
				try {
					let a = z.current, l = R.current;
					if (l && l.cssWidth > 0 && l.cssHeight > 0) {
						let e = l.cssWidth / l.cssHeight, t = e >= 1 ? o : Math.max(16, Math.round(o * e)), n = e >= 1 ? Math.max(16, Math.round(o / e)) : o;
						(t !== u || n !== d) && ve(t, n);
					}
					let m = Math.round(Z(a.patternSize, 8, 128, 64));
					m !== s && (s = m, g.queue.writeBuffer(C, 0, ee(m, a.seed)));
					let h = Z((r - X) / 1e3, 1 / 240, 1 / 30, 1 / 60) * fe;
					X = r;
					let _ = O.current, y = performance.now() - _.lastMoveTime < 120;
					if (F.setFloat32(8, h, !0), F.setFloat32(16, _.x, !0), F.setFloat32(20, _.y, !0), F.setFloat32(24, _.velocityX, !0), F.setFloat32(28, _.velocityY, !0), F.setFloat32(32, +!!y, !0), F.setFloat32(36, Z(a.interactionRadius, .01, .3, .05), !0), F.setFloat32(40, (r - me) / 1e3, !0), F.setUint32(44, +(a.quantity === "temperature"), !0), F.setFloat32(48, Z(a.viscosity, 0, 20, 1), !0), g.queue.writeBuffer(x, 0, N), _.velocityX *= .72, _.velocityY *= .72, l) {
						let e = Math.max(1, Math.round(a.pixelScale));
						f = Math.ceil(l.cssWidth / e), p = Math.ceil(l.cssHeight / e), L.setFloat32(8, e * l.width / l.cssWidth, !0), L.setFloat32(12, e * l.height / l.cssHeight, !0);
					}
					L.setUint32(0, f, !0), L.setUint32(4, p, !0), L.setUint32(16, s, !0), L.setUint32(20, +(a.quantity === "temperature"), !0), L.setUint32(24, +!!a.invert, !0), L.setFloat32(28, Z(a.contrast, .25, 8, 1), !0);
					let w = `${a.darkDependency}|${a.lightDependency}`;
					H.key !== w && (H = {
						key: w,
						dark: xe(a.dark),
						light: xe(a.light)
					});
					let T = new Float32Array(I, 32, 8);
					T.set(H.dark, 0), T.set(H.light, 4), g.queue.writeBuffer(S, 0, I);
					let E = g.createCommandEncoder({ label: "Fluid simulation frame" }), D = (e, t, n) => {
						let r = E.beginComputePass({ label: e });
						r.setPipeline(t), r.setBindGroup(0, n), r.dispatchWorkgroups(Math.ceil(u / 8), Math.ceil(d / 8)), r.end();
					};
					D("Advect and heat fluid", b.advect, ie), D("Measure fluid divergence", b.divergence, ae);
					for (let e = 0; e < pe; e += 1) D(`Solve fluid pressure ${e + 1}`, b.solvePressure, oe[e % 2]);
					D("Project fluid velocity", b.project, se);
					let A = E.beginRenderPass({
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
					A.setPipeline(b.display), A.setBindGroup(0, ce), A.draw(3), A.end(), g.queue.submit([E.finish()]), ge || (ge = !0, g.queue.onSubmittedWorkDone().then(() => {
						if (t) return;
						P("ready");
						let n = {
							canvas: e,
							device: g,
							...R.current ?? c,
							logicalWidth: f,
							logicalHeight: p
						};
						k.current?.(n);
					}, i)), n = requestAnimationFrame(ye);
				} catch (e) {
					i(e);
				}
			};
			ye(performance.now());
		})().catch(i), () => {
			t = !0, n && cancelAnimationFrame(n), Ce(r);
		};
	}, [
		u,
		_,
		b
	]), /* @__PURE__ */ a("canvas", {
		...E,
		ref: V,
		width: j?.width ?? F.width,
		height: j?.height ?? F.height,
		style: {
			touchAction: "none",
			...w
		},
		"aria-label": T,
		"data-webgpu-status": N
	});
}
//#endregion
//#region src/leniaSeed.ts
function Te(e) {
	let t = [[]], n = "";
	for (let r = 0; r < e.length; r += 1) {
		let i = e[r];
		if (i >= "0" && i <= "9") {
			n += i;
			continue;
		}
		if (i === "$") {
			let e = n ? Number(n) : 1;
			for (let n = 0; n < e; n += 1) t.push([]);
			n = "";
			continue;
		}
		let a = i;
		i >= "p" && i <= "y" && (a += e[r + 1], r += 1);
		let o = a === "." || a === "b" ? 0 : a === "o" ? 255 : a.length === 1 ? a.charCodeAt(0) - 64 : (a.charCodeAt(0) - 112) * 24 + (a.charCodeAt(1) - 65 + 25), s = n ? Number(n) : 1;
		for (let e = 0; e < s; e += 1) t[t.length - 1].push(o / 255);
		n = "";
	}
	return t;
}
function Ee(e) {
	let t = e >>> 0;
	return () => (t = Math.imul(t, 1664525) + 1013904223 >>> 0, t / 4294967296);
}
function De(e, t) {
	return Number.isFinite(e) ? Math.min(1, Math.max(0, e)) : t;
}
function Oe(e) {
	return Number.isFinite(e) ? Math.min(3, Math.max(.5, e)) : 1;
}
function ke(e, t) {
	if (t === 1) return e;
	let n = e.length, r = Math.max(...e.map((e) => e.length)), i = Math.max(1, Math.round(r * t)), a = Math.max(1, Math.round(n * t)), o = (t, n) => e[n]?.[t] ?? 0;
	return Array.from({ length: a }, (e, t) => Array.from({ length: i }, (e, s) => {
		let c = (s + .5) * r / i - .5, l = (t + .5) * n / a - .5, u = Math.floor(c), d = Math.floor(l), f = c - u, p = l - d;
		return o(u, d) * (1 - f) * (1 - p) + o(u + 1, d) * f * (1 - p) + o(u, d + 1) * (1 - f) * p + o(u + 1, d + 1) * f * p;
	}));
}
function Ae(e, t) {
	let n = e.length, r = Math.max(...e.map((e) => e.length)), i = t * Math.PI / 180, a = Math.cos(i), o = Math.sin(i), s = Math.ceil(Math.abs(r * a) + Math.abs(n * o)), c = Math.ceil(Math.abs(r * o) + Math.abs(n * a)), l = (r - 1) / 2, u = (n - 1) / 2, d = (s - 1) / 2, f = (c - 1) / 2, p = (t, n) => e[n]?.[t] ?? 0;
	return Array.from({ length: c }, (e, t) => Array.from({ length: s }, (e, n) => {
		let r = n - d, i = t - f, s = a * r + o * i + l, c = -o * r + a * i + u, m = Math.floor(s), h = Math.floor(c), g = s - m, _ = c - h;
		return p(m, h) * (1 - g) * (1 - _) + p(m + 1, h) * g * (1 - _) + p(m, h + 1) * (1 - g) * _ + p(m + 1, h + 1) * g * _;
	}));
}
function je(e, t, n, r, i, a, o = 1) {
	let s = new Float32Array(e * t), c = ke(Te(n.cells), Oe(o)), l = Ee(r), u = Math.floor(l() * 4) * 90, d = Math.min(e, t) >= 64 ? [
		{
			anchor: "normalized",
			x: .2,
			y: .25,
			rotation: u
		},
		{
			anchor: "normalized",
			x: .6,
			y: .25,
			rotation: u
		},
		{
			anchor: "normalized",
			x: .4,
			y: .55,
			rotation: u
		}
	] : [{
		anchor: "normalized",
		x: .5,
		y: .5,
		rotation: u
	}], f = i?.placements ?? d;
	for (let [n, r] of f.entries()) {
		let o = Ae(c, r.rotation), u = o[0]?.length ?? 0, d = o.length, f = i ? 0 : .05, p = n === 0 ? a : void 0, m = De(p?.x ?? r.x, .5) + (l() - .5) * f, h = De(p?.y ?? r.y, .5) + (l() - .5) * f, g = r.margin ?? 0, _ = r.anchor === "bottom-right" && !p ? e - u - g : Math.round(m * e - u / 2), v = r.anchor === "bottom-right" && !p ? t - d - g : Math.round(h * t - d / 2), y = Math.max(0, e - u), b = Math.max(0, t - d), x = Math.min(g, y), S = Math.min(g, b), C = Math.max(x, y - g), w = Math.max(S, b - g), T = Math.min(C, Math.max(x, _)), E = Math.min(w, Math.max(S, v));
		for (let n = 0; n < d; n += 1) {
			let r = o[n];
			for (let i = 0; i < u; i += 1) {
				let a = T + i, o = E + n;
				if (a < 0 || a >= e || o < 0 || o >= t) continue;
				let c = o * e + a;
				s[c] = Math.max(s[c], r[i]);
			}
		}
	}
	return s;
}
//#endregion
//#region src/leniaPresets.ts
function Me(...e) {
	return e.join("$");
}
var Ne = [
	{
		id: "orbium-unicaudatus",
		name: "Orbium unicaudatus",
		radius: 13,
		timeResolution: 10,
		mu: .15,
		sigma: .015,
		kernelPeaks: [1],
		kernelCore: "bump4",
		growthFunction: "gaussian",
		cells: Me("7.MD6.qL", "6.pKqEqFURpApBRAqQ", "5.VqTrSsBrOpXpWpTpWpUpCrQ", "4.CQrQsTsWsApITNPpGqGvL", "3.IpIpWrOsGsBqXpJ4.LsFrL", "A.DpKpSpJpDqOqUqSqE5.ExD", "qL.pBpTT2.qCrGrVrWqM5.sTpP", ".pGpWpD3.qUsMtItQtJ6.tL", ".uFqGH3.pXtOuR2vFsK5.sM", ".tUqL4.GuNwAwVxBwNpC4.qXpA", "2.uH5.vBxGyEyMyHtW4.qIpL", "2.wV5.tIyG3yOxQqW2.FqHpJ", "2.tUS4.rM2yOyJyOyHtVpPMpFqNV", "2.HsR4.pUxAyOxLxDxEuVrMqBqGqKJ", "3.sLpE3.pEuNxHwRwGvUuLsHrCqTpR", "3.TrMS2.pFsLvDvPvEuPtNsGrGqIP", "4.pRqRpNpFpTrNtGtVtStGsMrNqNpF", "5.pMqKqLqRrIsCsLsIrTrFqJpHE", "6.RpSqJqPqVqWqRqKpRXE", "8.OpBpIpJpFTK")
	},
	{
		id: "orbium-bicaudatus",
		name: "Orbium bicaudatus",
		radius: 13,
		timeResolution: 10,
		mu: .15,
		sigma: .014,
		kernelPeaks: [1],
		kernelCore: "bump4",
		growthFunction: "gaussian",
		cells: Me("13.pK", "14.qV", "6.VpA.MpEpKpITqV", "4.BpPpNrIrEqDpWpOpLpUqNvT", "4.IqRrNsPsKqHJ3.GqOuC", "4.TrLsTrPrLpS6.uUD", "3.SpWqNrBqLpRqPqE6.vA", "2.FpTpMLpHqPqHrVsPrS5.qUqA", "K.pCpRG.ErFsRsVuSuPqN4.CrR", "pA.pTU3.rWuBuRvXwTwKpF4.rCH", ".tPqHH3.qFvAwUwVyJyKwNL2.DqLR", ".pGsGA4.vPxSyDxE2yOuHS.XqJT", "2.xIE4.sCyHyOvLvRyFxCsGpVpXqGP", "2.VsU4.DxQyOvVuSwDwQuBrMqSqCF", "3.vG5.tEyKwVvIvKvMtVrXqTpM", "4.sU4.qFvDwMvNuUuDsUrKqDO", "4.qCrDJ2.pPsKuGuHtOsQrNqKpC", "5.pTqTpVpNqFrJsGsKrVrDqFpFD", "6.QqCqJqPqVqXqRqHpOTC", "8.LWpFpEXPG")
	},
	{
		id: "gyrorbium-gyrans",
		name: "Gyrorbium gyrans",
		radius: 13,
		timeResolution: 10,
		mu: .156,
		sigma: .0224,
		kernelPeaks: [1],
		kernelCore: "bump4",
		growthFunction: "gaussian",
		cells: Me("10.EL2QLE", "7.TpU2qHqCpXpUpNpFL", "4.JrVtTuKuPuKtLrXqTqHqCpPpDG", "3.qWtDqRpKqEsMuXvBtGrApXpUpSpIO", "2.rQrN4.pAuAvRtTrIpUpIpKpFO", ".pSsM6.tJwFuNsPsFrVpPpDL", ".uFB6.tJ2yO2yLyOyDsKL", "pDuC6.pFxW3yOwIwD2xPqH", "rNtV5.EsMxCyIyOwXtJsMtJwFuX", "sHuSV3.EpDvOwFxEwQsRqR2qHsFvWE", "rQvJsWpPQpKpSqCvEvBuCpD3.BpDtGrQ", "pXuKvMuPtLsWsCrIuCtBrS6.qWrQ", "EsKvEwXyBwLtVrVsCrDqH6.pXrG", ".qHtVxJyOwQrQpNqJpPV6.qJqE", ".JsUxMyOrX10.pFqRJ", "2.rQxPwIpI9.pKqJT", "2.qJxEuPpKB7.qCpP", "2.EvOvMpPO5.TrGqH", "3.sCyOqEpIOEBOqHqEsRtG", "4.xMsMqJqCpXqJqRpIqOuCtBsF", "5.xPrAqTqMpSE.rSsMrLqRqHV.TpS", "6.vErDE2.VpPB", "7.pIrNqHpKQ")
	},
	{
		id: "tricircium-inversus",
		name: "Tricircium inversus",
		radius: 18,
		timeResolution: 10,
		mu: .25,
		sigma: .03,
		kernelPeaks: [1, 1 / 3],
		kernelCore: "quad4",
		growthFunction: "quad4",
		cells: Me("6.VrQ2tJrQT", "5.sUxH3yOxWuUpU", "4.tOyG7yOqW", "3.rDxC9yOxR", "3.tD3yOxRwLwAwDwX4yO", "3.vW2yOwSuXuKuFtTtB2.vO2yO", "3.2yOxPuItO2tQtB4.E2yO", "2.pI2yOuFLrDtGuCtO5.yB2yOB", "2.wLyOvT3.qWyGxPqO4.qJ2yOvRpA", "2.2yO4.pPtVvMrVqO3.rQxR2yOuFJ", "2.2yO4.pFsPuCtOsHtL.qWtQwI2yOxRrN", "2.2yO4.pSsRtVuCvTyOuStQuCvT3yOtV", ".qE2yOqH3.pDtVtLsWtQyGuKtVuIvW3yOuN", ".sR2yOwDrXqErQtJqOqMpPpKJsRtLuKwQ3yOtO", "OuF2yOxEuItLtJtLqC5.tGvByG3yOrA", "pDvO2yOyDvMuItTtD6.uAxJ3yOvO", "OvR3yOxEvJuNtT6.yG2yOyBvRqH", ".tV4yOxRwSwDvG3.pD3yOxRsMpK", ".pXxE13yOqH", "2.rSxP9yOvR", "3.rAvTyByIxRxHuUrG", "4.JqTsHsCqH")
	}
], Pe = "orbium-unicaudatus", Fe = [{
	id: "orbium-unicaudatus-solo-up",
	name: "Solo upward Orbium",
	species: "orbium-unicaudatus",
	placements: [{
		anchor: "bottom-right",
		rotation: 200,
		margin: 4
	}]
}, {
	id: "tricircium-inversus-solo",
	name: "Solo Tricircium inversus",
	species: "tricircium-inversus",
	placements: [{
		anchor: "normalized",
		x: .5,
		y: .5,
		rotation: 0,
		margin: 2
	}]
}], Ie = new Map(Ne.map((e) => [e.id, e])), Le = new Map(Fe.map((e) => [e.id, e]));
function Re(e) {
	return Ie.get(e) ?? Ne[0];
}
function ze(e) {
	return Le.get(e) ?? Fe[0];
}
//#endregion
//#region src/BlueNoiseLenia.tsx
var Be = 1e3 / 60, Ve = 250, He = [
	0,
	0,
	0,
	1
], Ue = [
	1,
	1,
	1,
	1
], Q, We = /* @__PURE__ */ new WeakMap();
function Ge(e, t) {
	let n = We.get(e);
	n || (n = /* @__PURE__ */ new Map(), We.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([g(e, "Lenia simulation WGSL", d), g(e, "Blue-noise Lenia WGSL", f)]), i = e.createBindGroupLayout({
			label: "Lenia bindings",
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
					storageTexture: {
						access: "write-only",
						format: "rgba16float"
					}
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					sampler: { type: "filtering" }
				},
				{
					binding: 4,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" }
				}
			]
		}), a = e.createPipelineLayout({ bindGroupLayouts: [i] });
		return {
			initialize: e.createComputePipeline({
				label: "Initialize Lenia state",
				layout: a,
				compute: {
					module: n,
					entryPoint: "initialize"
				}
			}),
			resample: e.createComputePipeline({
				label: "Resample Lenia state",
				layout: a,
				compute: {
					module: n,
					entryPoint: "resample"
				}
			}),
			step: e.createComputePipeline({
				label: "Step Lenia state",
				layout: a,
				compute: {
					module: n,
					entryPoint: "advance"
				}
			}),
			computeLayout: i,
			display: e.createRenderPipeline({
				label: "Blue-noise Lenia display",
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
function Ke(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function qe(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: Ke(e, 900),
		height: Ke(t, 600)
	};
	if (e !== void 0) {
		let t = Ke(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = Ke(t, 600);
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
function Je(e) {
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
function Ye(e) {
	return typeof e == "string" ? Je(e) : [
		$(e[0], 0, 1, 0),
		$(e[1], 0, 1, 0),
		$(e[2], 0, 1, 0),
		$(e[3] ?? 1, 0, 1, 1)
	];
}
function Xe(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function Ze(e) {
	e?.parameters.destroy(), e?.pattern.destroy(), e?.initialState.destroy(), e?.stateA.destroy(), e?.stateB.destroy();
}
function Qe({ width: o, height: s, pixelScale: c = 2, patternSize: l = 64, simulationSize: u = 256, species: d = Pe, preset: f, position: p, spatialScale: m = 1, dither: g = !0, interactionRadius: _ = .05, contrast: v = 1, invert: y = !1, seed: b = 1592594996, dark: x = He, light: S = Ue, powerPreference: C = "high-performance", onReady: w, onError: T, ref: E, style: D, "aria-label": O = "Interactive blue-noise Lenia automaton", ...k }) {
	let A = r(null), j = r({
		x: .5,
		y: .5,
		lastMoveTime: -Infinity
	}), M = r(w), N = r(T), [P, F] = i(), [I, L] = i("loading"), R = qe(o, s), z = Xe(x), B = Xe(S);
	M.current = w, N.current = T;
	let V = r(void 0), H = r({
		pixelScale: c,
		patternSize: l,
		simulationSize: u,
		species: d,
		preset: f,
		position: p,
		spatialScale: m,
		dither: g,
		interactionRadius: _,
		contrast: v,
		invert: y,
		darkDependency: z,
		lightDependency: B,
		seed: b,
		powerPreference: C,
		dark: x,
		light: S
	});
	H.current = {
		pixelScale: c,
		patternSize: l,
		simulationSize: u,
		species: d,
		preset: f,
		position: p,
		spatialScale: m,
		dither: g,
		interactionRadius: _,
		contrast: v,
		invert: y,
		darkDependency: z,
		lightDependency: B,
		seed: b,
		powerPreference: C,
		dark: x,
		light: S
	};
	let U = r(R);
	U.current = R;
	let W = e((e) => {
		A.current = e, typeof E == "function" ? E(e) : E && (E.current = e);
	}, [E]);
	return t(() => {
		F(void 0);
	}, [o, s]), t(() => {
		let e = A.current;
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
			V.current = a, F((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
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
	}, [R.width, R.height]), t(() => {
		let e = A.current;
		if (!e) return;
		let t = (t) => {
			let n = e.getBoundingClientRect();
			j.current.x = $((t.clientX - n.left) / n.width, 0, 1, .5), j.current.y = $((t.clientY - n.top) / n.height, 0, 1, .5), j.current.lastMoveTime = performance.now();
		}, n = () => {
			j.current.lastMoveTime = -Infinity;
		};
		return e.addEventListener("pointermove", t), e.addEventListener("pointerleave", n), () => {
			e.removeEventListener("pointermove", t), e.removeEventListener("pointerleave", n);
		};
	}, []), n(() => {
		let e = A.current;
		if (!e) return;
		let t = !1, n = 0, r;
		L("loading");
		let i = (e) => {
			t || (t = !0, n && cancelAnimationFrame(n), Ze(r), r = void 0, L("error"), N.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = H.current, o = a.preset ? ze(a.preset) : void 0, s = Re(o?.species ?? a.species), c = Oe(a.spatialScale), l = Math.round($(a.simulationSize, 64, 384, 256)), u = Math.round($(a.patternSize, 8, 128, 64)), d = V.current ?? {
				width: e.width,
				height: e.height,
				cssWidth: e.clientWidth || U.current.width,
				cssHeight: e.clientHeight || U.current.height,
				devicePixelRatio: window.devicePixelRatio || 1
			}, f = d.cssWidth / d.cssHeight, p = f >= 1 ? l : Math.max(24, Math.round(l * f)), m = f >= 1 ? Math.max(24, Math.round(l / f)) : l, g = Math.ceil(d.cssWidth / Math.max(1, Math.round(a.pixelScale))), _ = Math.ceil(d.cssHeight / Math.max(1, Math.round(a.pixelScale))), v = ee(u, a.seed), y = await h(a.powerPreference);
			if (t) return;
			let b = y.limits.maxTextureDimension2D;
			if (d.width > b || d.height > b || p > b || m > b) throw Error(`The output or simulation exceeds this device's ${b}px texture limit.`);
			let x = e.getContext("webgpu");
			if (!x) throw Error("The canvas could not create a WebGPU context.");
			let S = navigator.gpu.getPreferredCanvasFormat();
			x.configure({
				device: y,
				format: S,
				alphaMode: "premultiplied"
			});
			let C = await Ge(y, S);
			if (t) return;
			let w = y.createBuffer({
				label: "Lenia parameters",
				size: 128,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), T = y.createBuffer({
				label: "Tileable blue-noise ranks",
				size: 65536,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), E = je(p, m, s, a.seed, o, a.position, c), D = y.createBuffer({
				label: `${s.name} initial state`,
				size: E.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), O = {
				size: [p, m],
				format: "rgba16float",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
			}, k = y.createTexture({
				...O,
				label: "Lenia state A"
			}), A = y.createTexture({
				...O,
				label: "Lenia state B"
			}), N = y.createSampler({
				label: "Lenia linear sampler",
				magFilter: "linear",
				minFilter: "linear",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge"
			});
			r = {
				parameters: w,
				pattern: T,
				initialState: D,
				stateA: k,
				stateB: A,
				sampler: N
			}, y.queue.writeBuffer(T, 0, v), y.queue.writeBuffer(D, 0, E);
			let P = /* @__PURE__ */ new ArrayBuffer(128), F = new DataView(P);
			F.setUint32(0, p, !0), F.setUint32(4, m, !0), F.setFloat32(8, 1 / s.timeResolution, !0), F.setUint32(12, a.seed >>> 0, !0), F.setFloat32(32, 0, !0), F.setFloat32(36, s.mu, !0), F.setFloat32(40, s.sigma, !0), F.setUint32(52, Math.max(1, Math.round(s.radius * c)), !0), F.setUint32(72, u, !0);
			let I = Math.min(s.kernelPeaks.length, 4) | (s.kernelCore === "quad4" ? 256 : 0) | (s.growthFunction === "quad4" ? 512 : 0);
			F.setUint32(76, I | (a.dither ? 0 : 1024), !0), s.kernelPeaks.slice(0, 4).forEach((e, t) => {
				F.setFloat32(112 + t * 4, e, !0);
			}), y.queue.writeBuffer(w, 0, P);
			let R = k.createView(), z = A.createView(), B = (e, t, n) => y.createBindGroup({
				label: e,
				layout: C.computeLayout,
				entries: [
					{
						binding: 0,
						resource: { buffer: w }
					},
					{
						binding: 1,
						resource: t
					},
					{
						binding: 2,
						resource: n
					},
					{
						binding: 3,
						resource: N
					},
					{
						binding: 4,
						resource: { buffer: D }
					}
				]
			}), W = (e, t, n) => y.createBindGroup({
				label: e,
				layout: C.display.getBindGroupLayout(0),
				entries: [
					{
						binding: 0,
						resource: { buffer: w }
					},
					{
						binding: 1,
						resource: { buffer: T }
					},
					{
						binding: 2,
						resource: t
					},
					{
						binding: 3,
						resource: N
					},
					{
						binding: 4,
						resource: n
					}
				]
			}), G = B("Initialize Lenia state", R, z), K = [B("Step Lenia A to B", R, z), B("Step Lenia B to A", z, R)], q = [W("Display Lenia state A", R, z), W("Display Lenia state B", z, R)], J = y.createCommandEncoder({ label: "Initialize Lenia" }), Y = J.beginComputePass();
			Y.setPipeline(C.initialize), Y.setBindGroup(0, G), Y.dispatchWorkgroups(Math.ceil(p / 8), Math.ceil(m / 8)), Y.end(), y.queue.submit([J.finish()]);
			let te = {
				key: `${a.darkDependency}|${a.lightDependency}`,
				dark: Ye(a.dark),
				light: Ye(a.light)
			}, ne = performance.now(), re = ne - Be, ie = ne - Ve, ae = !1, oe = 1, se = (e, t) => {
				let n = oe === 0 ? R : z, i = y.createTexture({
					label: "Lenia state A",
					size: [e, t],
					format: "rgba16float",
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
				}), a = y.createTexture({
					label: "Lenia state B",
					size: [e, t],
					format: "rgba16float",
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
				}), o = i.createView(), s = a.createView();
				F.setUint32(0, e, !0), F.setUint32(4, t, !0), y.queue.writeBuffer(w, 0, P);
				let c = B("Resample Lenia state", n, o), l = y.createCommandEncoder({ label: "Resample Lenia state" }), u = l.beginComputePass();
				u.setPipeline(C.resample), u.setBindGroup(0, c), u.dispatchWorkgroups(Math.ceil(e / 8), Math.ceil(t / 8)), u.end(), y.queue.submit([l.finish()]), k.destroy(), A.destroy(), k = i, A = a, R = o, z = s, r && (r.stateA = i, r.stateB = a), p = e, m = t, K = [B("Step Lenia A to B", R, z), B("Step Lenia B to A", z, R)], q = [W("Display Lenia state A", R, z), W("Display Lenia state B", z, R)], oe = 0;
			}, ce = (r) => {
				if (t) return;
				let a = r - re;
				if (a < Be) {
					n = requestAnimationFrame(ce);
					return;
				}
				re = r - a % Be;
				let o = r - ie, s = o >= Ve, c = Math.min(1, o / Ve);
				s && (ie = r - o % Ve, c = 0);
				try {
					let r = H.current, a = V.current;
					if (a && a.cssWidth > 0 && a.cssHeight > 0) {
						let e = a.cssWidth / a.cssHeight, t = e >= 1 ? l : Math.max(24, Math.round(l * e)), n = e >= 1 ? Math.max(24, Math.round(l / e)) : l;
						(t !== p || n !== m) && se(t, n);
					}
					let o = Math.round($(r.patternSize, 8, 128, 64));
					o !== u && (u = o, F.setUint32(72, u, !0), y.queue.writeBuffer(T, 0, ee(o, r.seed)));
					let f = j.current, h = performance.now() - f.lastMoveTime < 120;
					if (F.setFloat32(16, f.x, !0), F.setFloat32(20, f.y, !0), F.setFloat32(24, +!!h, !0), F.setFloat32(28, $(r.interactionRadius, .005, .3, .05), !0), F.setFloat32(32, c, !0), a) {
						let e = Math.max(1, Math.round(r.pixelScale));
						g = Math.ceil(a.cssWidth / e), _ = Math.ceil(a.cssHeight / e), F.setFloat32(64, e * a.width / a.cssWidth, !0), F.setFloat32(68, e * a.height / a.cssHeight, !0);
					}
					F.setUint32(56, g, !0), F.setUint32(60, _, !0), F.setUint32(72, u, !0), F.setFloat32(44, $(r.contrast, .25, 8, 1), !0), F.setUint32(48, +!!r.invert, !0), F.setUint32(76, I | (r.dither ? 0 : 1024), !0);
					let v = `${r.darkDependency}|${r.lightDependency}`;
					te.key !== v && (te = {
						key: v,
						dark: Ye(r.dark),
						light: Ye(r.light)
					});
					let b = new Float32Array(P, 80, 8);
					b.set(te.dark, 0), b.set(te.light, 4), y.queue.writeBuffer(w, 0, P);
					let S = y.createCommandEncoder({ label: "Lenia frame" });
					if (s) {
						let e = S.beginComputePass({ label: "Step Lenia automaton" });
						e.setPipeline(C.step), e.setBindGroup(0, K[oe]), e.dispatchWorkgroups(Math.ceil(p / 8), Math.ceil(m / 8)), e.end(), oe = 1 - oe;
					}
					let E = S.beginRenderPass({
						label: "Blue-noise Lenia display pass",
						colorAttachments: [{
							view: x.getCurrentTexture().createView(),
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
					E.setPipeline(C.display), E.setBindGroup(0, q[oe]), E.draw(3), E.end(), y.queue.submit([S.finish()]), ae || (ae = !0, y.queue.onSubmittedWorkDone().then(() => {
						if (t) return;
						L("ready");
						let n = {
							canvas: e,
							device: y,
							...V.current ?? d,
							logicalWidth: g,
							logicalHeight: _
						};
						M.current?.(n);
					}, i)), n = requestAnimationFrame(ce);
				} catch (e) {
					i(e);
				}
			};
			ce(performance.now());
		})().catch(i), () => {
			t = !0, n && cancelAnimationFrame(n), Ze(r);
		};
	}, [
		u,
		d,
		f,
		p?.x,
		p?.y,
		m,
		b,
		C
	]), /* @__PURE__ */ a("canvas", {
		...k,
		ref: W,
		width: P?.width ?? R.width,
		height: P?.height ?? R.height,
		style: {
			touchAction: "none",
			...D
		},
		"aria-label": O,
		"data-webgpu-status": I
	});
}
//#endregion
export { we as BlueNoiseFluid, Qe as BlueNoiseLenia, ue as BlueNoiseWave, Pe as DEFAULT_LENIA_SPECIES, F as FloydSteinberg, Fe as LENIA_SCENE_PRESETS, Ne as LENIA_SPECIES_PRESETS, s as displayShader, o as floydSteinbergShader, ze as getLeniaScenePreset, Re as getLeniaSpeciesPreset, S as isWebGpuSupported };
