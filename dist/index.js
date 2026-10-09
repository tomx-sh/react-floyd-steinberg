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
	let L = r(null), R = r(w), z = r(k), [B, V] = i(), [H, U] = i(), ee = j(g), W = j(b);
	R.current = w, z.current = k;
	let [G, K] = i("loading"), q = e((e) => {
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
			let ee = v.createBindGroup({
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
			}), W = v.createBindGroup({
				label: "Floyd–Steinberg display bind group",
				layout: O.display.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: M }
				}, {
					binding: 1,
					resource: { buffer: k }
				}]
			}), G = v.createCommandEncoder({ label: "Floyd–Steinberg render" });
			G.clearBuffer(A);
			for (let e = 0; e < F; e += 1) {
				let t = G.beginComputePass({ label: `Floyd–Steinberg band ${e}` });
				t.setPipeline(O.compute), t.setBindGroup(0, ee, [e * I]), t.dispatchWorkgroups(1), t.end();
			}
			let q = G.beginRenderPass({
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
			q.setPipeline(O.display), q.setBindGroup(0, W), q.draw(3), q.end(), v.queue.submit([G.finish()]), await v.queue.onSubmittedWorkDone(), !t && (K("ready"), R.current?.({
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
		ee,
		W,
		S
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
function ee(e, t, n, r, i) {
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
function W(e, t) {
	let n = e.length, r = Math.min(R, Math.floor(Math.log2(t)));
	for (let i = 1; i <= r; i += 1) {
		let r = 2 ** i;
		for (let i = 1; i < r; i += 2) ee(e, t, Math.floor((i - 1) * n / r), Math.floor(i * n / r), Math.floor((i + 1) * n / r));
	}
}
function G(e, t) {
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
	return W(u, e), I.set(n, u), u;
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
], Y, X = /* @__PURE__ */ new WeakMap();
function te(e, t) {
	let n = X.get(e);
	n || (n = /* @__PURE__ */ new Map(), X.set(e, n));
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
function ne(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function re(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function ie(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: re(e, 900),
		height: re(t, 600)
	};
	if (e !== void 0) {
		let t = re(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = re(t, 600);
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
function ae(e) {
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
function oe(e) {
	return typeof e == "string" ? ae(e) : [
		ne(e[0], 0, 1, 0),
		ne(e[1], 0, 1, 0),
		ne(e[2], 0, 1, 0),
		ne(e[3] ?? 1, 0, 1, 1)
	];
}
function se(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function ce(e) {
	e?.parameters.destroy(), e?.pattern.destroy();
}
function le({ width: o, height: s, pixelScale: c = 2, patternSize: l = 64, invert: u = !1, seed: d = 1592594996, dark: f = q, light: p = J, powerPreference: m = "high-performance", onReady: g, onError: _, ref: v, "aria-label": y = "Blue-noise dithered wave", ...b }) {
	let x = r(null), S = r(g), C = r(_), [w, T] = i(), [E, D] = i("loading"), O = ie(o, s), k = se(f), A = se(p);
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
			t || (t = !0, n && cancelAnimationFrame(n), ce(r), r = void 0, D("error"), C.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = re(c, 1), o = Math.round(ne(l, 8, 128, 64)), s = Math.ceil(w.cssWidth / a), g = Math.ceil(w.cssHeight / a), _ = a * w.width / w.cssWidth, v = a * w.height / w.cssHeight, y = G(o, d), b = await h(m);
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
			let E = await te(b, T);
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
//#region src/canvasUtils.ts
var Z;
function Q(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function ue(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function de(e) {
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
function fe(e) {
	return typeof e == "string" ? de(e) : [
		Q(e[0], 0, 1, 0),
		Q(e[1], 0, 1, 0),
		Q(e[2], 0, 1, 0),
		Q(e[3] ?? 1, 0, 1, 1)
	];
}
function pe(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
//#endregion
//#region src/paintShaders.ts
var me = "\nstruct Parameters {\n  size: vec2u,\n  deltaTime: f32,\n  seed: u32,\n  pointer: vec2f,\n  pointerVelocity: vec2f,\n  pointerActive: f32,\n  interactionRadius: f32,\n  time: f32,\n  quantity: u32,\n  viscosity: f32,\n  swirlStrength: f32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var previousState: texture_2d<f32>;\n@group(0) @binding(2) var linearSampler: sampler;\n@group(0) @binding(3) var nextState: texture_storage_2d<rgba16float, write>;\n@group(0) @binding(4) var secondaryState: texture_2d<f32>;\n\n// Velocity is measured in shorter-side lengths per second, so eddies stay\n// circular and pressure uses square cells in both portrait and landscape.\nfn gridScale() -> f32 { return f32(min(parameters.size.x, parameters.size.y)); }\nfn domainSize() -> vec2f { return vec2f(parameters.size) / gridScale(); }\nfn simulationUv(cell: vec2u) -> vec2f {\n  return (vec2f(cell) + vec2f(0.5)) / vec2f(parameters.size);\n}\nfn isBoundary(cell: vec2u) -> bool {\n  return any(cell == vec2u(0u)) || any(cell + vec2u(1u) == parameters.size);\n}\nfn nearestInterior(cell: vec2u) -> vec2i {\n  return clamp(vec2i(cell), vec2i(1), vec2i(parameters.size) - vec2i(2));\n}\nfn random01(value: u32) -> f32 {\n  var bits = value ^ parameters.seed;\n  bits = (bits ^ (bits >> 16u)) * 0x7feb352du;\n  bits = (bits ^ (bits >> 15u)) * 0x846ca68bu;\n  bits = bits ^ (bits >> 16u);\n  return f32(bits & 0x00ffffffu) / 16777216.0;\n}\nfn vortexCenter(index: u32) -> vec2f {\n  let phase = random01(index * 7u + 1u) * 6.2831853;\n  let base = vec2f(0.24 + 0.52 * random01(index * 7u + 2u),\n                   0.24 + 0.52 * random01(index * 7u + 3u));\n  return base + vec2f(sin(parameters.time * 0.13 + phase),\n                     cos(parameters.time * 0.11 + phase * 1.7)) * 0.1;\n}\nfn stirringVelocity(uv: vec2f) -> vec2f {\n  var velocity = vec2f(0.0);\n  for (var i = 0u; i < 6u; i += 1u) {\n    let offset = (uv - vortexCenter(i)) * domainSize();\n    let radius = 0.18 + random01(i * 7u + 4u) * 0.16;\n    let falloff = exp(-dot(offset, offset) / (radius * radius));\n    let direction = select(-1.0, 1.0, i % 2u == 0u);\n    let pulse = 0.8 + 0.2 * sin(parameters.time * 0.17 + f32(i) * 2.1);\n    velocity += vec2f(-offset.y, offset.x) / radius * falloff * direction * pulse * 0.42;\n  }\n  return velocity * parameters.swirlStrength;\n}\nfn confinedVelocity(cell: vec2u, value: vec2f) -> vec2f {\n  var velocity = value;\n  let first = 1u;\n  let last = parameters.size - vec2u(2u);\n  if (cell.x <= first && velocity.x < 0.0) { velocity.x = 0.0; }\n  if (cell.x >= last.x && velocity.x > 0.0) { velocity.x = 0.0; }\n  if (cell.y <= first && velocity.y < 0.0) { velocity.y = 0.0; }\n  if (cell.y >= last.y && velocity.y > 0.0) { velocity.y = 0.0; }\n  let speed = length(velocity);\n  return velocity * min(1.0, 0.65 / max(speed, 0.00001));\n}\n\n@compute @workgroup_size(8, 8)\nfn initialize(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) { return; }\n  // Begin empty and at rest; the sources build the scene over time.\n  textureStore(nextState, vec2i(id.xy), vec4f(0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn clearScalar(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) { return; }\n  textureStore(nextState, vec2i(id.xy), vec4f(0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn resample(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) { return; }\n  let state = textureSampleLevel(previousState, linearSampler, simulationUv(id.xy), 0.0);\n  var velocity = confinedVelocity(id.xy, state.xy);\n  if (isBoundary(id.xy)) {\n    velocity = vec2f(0.0);\n  }\n  textureStore(nextState, vec2i(id.xy), vec4f(velocity, 0.0, state.w));\n}\n\n@compute @workgroup_size(8, 8)\nfn advect(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) { return; }\n  let cell = id.xy;\n  if (isBoundary(cell)) {\n    // Solid walls stop motion, but pigment can reach them without being erased.\n    let pigment = textureLoad(previousState, nearestInterior(cell), 0).w;\n    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, pigment));\n    return;\n  }\n  let uv = simulationUv(cell);\n  let current = textureLoad(previousState, vec2i(cell), 0);\n  let sampleMin = vec2f(1.5) / vec2f(parameters.size);\n  let backUv = clamp(uv - current.xy * parameters.deltaTime / domainSize(), sampleMin, vec2f(1.0) - sampleMin);\n  let advected = textureSampleLevel(previousState, linearSampler, backUv, 0.0);\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0);\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0);\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0);\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0);\n  let neighborVelocity = (left.xy + right.xy + up.xy + down.xy) * 0.25;\n  var velocity = mix(advected.xy, neighborVelocity, 1.0 - exp(-parameters.viscosity * parameters.deltaTime));\n\n  // A changing mixture of clockwise and counterclockwise eddies supplies\n  // energy throughout the box. There is no gravity or preferred direction.\n  // Ease in automatic stirring and pigment over the first two seconds.\n  let startup = smoothstep(0.0, 2.0, parameters.time);\n  velocity = mix(velocity, stirringVelocity(uv) * startup, 1.0 - exp(-parameters.deltaTime * 0.65));\n  var pigment = advected.w * exp(-parameters.deltaTime * 0.045);\n  // Slowly replenish paint in the interior so a long-running scene does not\n  // diffuse to a uniform field. These sources travel with the stirring centers.\n  for (var i = 0u; i < 3u; i += 1u) {\n    let offset = (uv - vortexCenter(i * 2u)) * domainSize();\n    let source = exp(-dot(offset, offset) / 0.012);\n    pigment += source * (1.0 - pigment) * parameters.deltaTime * 0.3 * startup;\n  }\n\n  if (parameters.pointerActive > 0.5) {\n    let offset = (uv - parameters.pointer) * domainSize();\n    let radius = max(0.01, parameters.interactionRadius);\n    let falloff = exp(-dot(offset, offset) / (radius * radius));\n    velocity += parameters.pointerVelocity * domainSize() * falloff * parameters.deltaTime * 1.8;\n    if (parameters.quantity != 0u) {\n      pigment += falloff * parameters.deltaTime * 2.5;\n    }\n  }\n\n  textureStore(nextState, vec2i(cell), vec4f(confinedVelocity(cell, velocity), 0.0, clamp(pigment, 0.0, 1.0)));\n}\n\n@compute @workgroup_size(8, 8)\nfn divergence(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) { return; }\n  let cell = id.xy;\n  if (isBoundary(cell)) {\n    textureStore(nextState, vec2i(cell), vec4f(0.0));\n    return;\n  }\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).xy;\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).xy;\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).xy;\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).xy;\n  let value = 0.5 * gridScale() * (right.x - left.x + down.y - up.y);\n  textureStore(nextState, vec2i(cell), vec4f(value, 0.0, 0.0, 0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn solvePressure(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) { return; }\n  let cell = id.xy;\n  if (isBoundary(cell)) {\n    // Neumann pressure at the canvas walls: copy the nearest fluid cell.\n    let pressure = textureLoad(previousState, nearestInterior(cell), 0).x;\n    textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));\n    return;\n  }\n  let left = textureLoad(previousState, vec2i(cell) + vec2i(-1, 0), 0).x;\n  let right = textureLoad(previousState, vec2i(cell) + vec2i(1, 0), 0).x;\n  let up = textureLoad(previousState, vec2i(cell) + vec2i(0, -1), 0).x;\n  let down = textureLoad(previousState, vec2i(cell) + vec2i(0, 1), 0).x;\n  let source = textureLoad(secondaryState, vec2i(cell), 0).x;\n  let pressure = (left + right + up + down - source / (gridScale() * gridScale())) * 0.25;\n  textureStore(nextState, vec2i(cell), vec4f(pressure, 0.0, 0.0, 0.0));\n}\n\n@compute @workgroup_size(8, 8)\nfn project(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= parameters.size)) { return; }\n  let cell = id.xy;\n  let advected = textureLoad(previousState, vec2i(cell), 0);\n  if (isBoundary(cell)) {\n    textureStore(nextState, vec2i(cell), vec4f(0.0, 0.0, 0.0, advected.w));\n    return;\n  }\n  let left = textureLoad(secondaryState, vec2i(cell) + vec2i(-1, 0), 0).x;\n  let right = textureLoad(secondaryState, vec2i(cell) + vec2i(1, 0), 0).x;\n  let up = textureLoad(secondaryState, vec2i(cell) + vec2i(0, -1), 0).x;\n  let down = textureLoad(secondaryState, vec2i(cell) + vec2i(0, 1), 0).x;\n  let velocity = advected.xy - 0.5 * gridScale() * vec2f(right - left, down - up);\n  textureStore(nextState, vec2i(cell), vec4f(confinedVelocity(cell, velocity), 0.0, advected.w));\n}\n", he = "\nstruct Parameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  quantity: u32,\n  invert: u32,\n  contrast: f32,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n@group(0) @binding(2) var fluidState: texture_2d<f32>;\n@group(0) @binding(3) var linearSampler: sampler;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let size = max(parameters.logicalSize, vec2u(1u));\n  let cell = min(vec2u(position.xy / max(parameters.cellSize, vec2f(0.0001))), size - vec2u(1u));\n  let uv = (vec2f(cell) + vec2f(0.5)) / vec2f(size);\n  let fluid = textureSampleLevel(fluidState, linearSampler, uv, 0.0);\n  let pigment = smoothstep(0.06, 0.72, fluid.w);\n  let speed = smoothstep(0.008, 0.2, length(fluid.xy));\n  var luminance = select(speed, pigment, parameters.quantity != 0u);\n  luminance = clamp((luminance - 0.5) * parameters.contrast + 0.5, 0.0, 1.0);\n  luminance = select(luminance, 1.0 - luminance, parameters.invert != 0u);\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternSize * parameters.patternSize);\n  return select(parameters.dark, parameters.light, luminance >= threshold);\n}\n", ge = 1e3 / 60, _e = .5, ve = 16, ye = [
	0,
	0,
	0,
	1
], be = [
	1,
	1,
	1,
	1
], xe = /* @__PURE__ */ new WeakMap();
function Se(e, t, n) {
	let r = xe.get(e);
	r || (r = /* @__PURE__ */ new Map(), xe.set(e, r));
	let i = `${t}:${n}`, a = r.get(i);
	return a || (a = (async () => {
		let [r, i] = await Promise.all([g(e, "Fluid simulation WGSL", n === "paint" ? me : l), g(e, "Blue-noise fluid WGSL", n === "paint" ? he : u)]), a = e.createBindGroupLayout({
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
		}), o = e.createPipelineLayout({ bindGroupLayouts: [a] });
		return {
			initialize: e.createComputePipeline({
				label: "Initialize fluid",
				layout: o,
				compute: {
					module: r,
					entryPoint: "initialize"
				}
			}),
			clearScalar: e.createComputePipeline({
				label: "Clear fluid scalar field",
				layout: o,
				compute: {
					module: r,
					entryPoint: "clearScalar"
				}
			}),
			resample: e.createComputePipeline({
				label: "Resample fluid state",
				layout: o,
				compute: {
					module: r,
					entryPoint: "resample"
				}
			}),
			advect: e.createComputePipeline({
				label: "Advect fluid",
				layout: o,
				compute: {
					module: r,
					entryPoint: "advect"
				}
			}),
			divergence: e.createComputePipeline({
				label: "Measure fluid divergence",
				layout: o,
				compute: {
					module: r,
					entryPoint: "divergence"
				}
			}),
			solvePressure: e.createComputePipeline({
				label: "Solve fluid pressure",
				layout: o,
				compute: {
					module: r,
					entryPoint: "solvePressure"
				}
			}),
			project: e.createComputePipeline({
				label: "Project fluid velocity",
				layout: o,
				compute: {
					module: r,
					entryPoint: "project"
				}
			}),
			computeLayout: a,
			display: e.createRenderPipeline({
				label: "Blue-noise fluid display",
				layout: "auto",
				vertex: {
					module: i,
					entryPoint: "vertexMain"
				},
				fragment: {
					module: i,
					entryPoint: "fragmentMain",
					targets: [{ format: t }]
				},
				primitive: { topology: "triangle-list" }
			})
		};
	})(), r.set(i, a)), a;
}
function Ce(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: ue(e, 900),
		height: ue(t, 600)
	};
	if (e !== void 0) {
		let t = ue(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = ue(t, 600);
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
function we(e) {
	e?.simulationParameters.destroy(), e?.displayParameters.destroy(), e?.pattern.destroy(), e?.state.destroy(), e?.advectedState.destroy(), e?.divergence.destroy(), e?.pressureA.destroy(), e?.pressureB.destroy();
}
function Te(e) {
	return /* @__PURE__ */ a(Ee, {
		...e,
		setup: "convection"
	});
}
function Ee({ setup: o, swirlStrength: s = 1, width: c, height: l, pixelScale: u = 2, patternSize: d = 64, simulationSize: f = 192, interactionRadius: p = .05, viscosity: m = 1, quantity: g = "temperature", contrast: _ = 1, invert: v = !1, seed: y = 1592594996, dark: b = ye, light: x = be, powerPreference: S = "high-performance", onReady: C, onError: w, ref: T, style: E, "aria-label": D = "Interactive blue-noise fluid simulation", ...O }) {
	let k = r(null), A = r({
		x: .5,
		y: .5,
		velocityX: 0,
		velocityY: 0,
		lastEventTime: 0,
		lastMoveTime: -Infinity
	}), j = r(C), M = r(w), [N, P] = i(), [F, I] = i("loading"), L = Ce(c, l), R = pe(b), z = pe(x);
	j.current = C, M.current = w;
	let B = r(void 0), V = r({
		swirlStrength: s,
		pixelScale: u,
		patternSize: d,
		simulationSize: f,
		interactionRadius: p,
		viscosity: m,
		quantity: g,
		contrast: _,
		invert: v,
		darkDependency: R,
		lightDependency: z,
		seed: y,
		powerPreference: S,
		dark: b,
		light: x
	});
	V.current = {
		swirlStrength: s,
		pixelScale: u,
		patternSize: d,
		simulationSize: f,
		interactionRadius: p,
		viscosity: m,
		quantity: g,
		contrast: _,
		invert: v,
		darkDependency: R,
		lightDependency: z,
		seed: y,
		powerPreference: S,
		dark: b,
		light: x
	}, r(void 0);
	let H = r(L);
	H.current = L;
	let U = e((e) => {
		k.current = e, typeof T == "function" ? T(e) : T && (T.current = e);
	}, [T]);
	return t(() => {
		P(void 0);
	}, [c, l]), t(() => {
		let e = k.current;
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
			B.current = a, P((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
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
	}, [L.width, L.height]), t(() => {
		let e = k.current;
		if (!e) return;
		let t = (t) => {
			let n = e.getBoundingClientRect();
			A.current.x = Q((t.clientX - n.left) / n.width, 0, 1, .5), A.current.y = Q((t.clientY - n.top) / n.height, 0, 1, .5), A.current.velocityX = 0, A.current.velocityY = 0, A.current.lastEventTime = t.timeStamp;
		}, n = (t) => {
			let n = e.getBoundingClientRect(), r = Q((t.clientX - n.left) / n.width, 0, 1, .5), i = Q((t.clientY - n.top) / n.height, 0, 1, .5), a = A.current, o = Math.max(1 / 240, (t.timeStamp - a.lastEventTime) / 1e3);
			a.velocityX = Q((r - a.x) / o, -3, 3, 0), a.velocityY = Q((i - a.y) / o, -3, 3, 0), a.x = r, a.y = i, a.lastEventTime = t.timeStamp, a.lastMoveTime = performance.now();
		}, r = () => {
			A.current.lastMoveTime = -Infinity;
		}, i = (n) => {
			t(n), A.current.lastMoveTime = performance.now(), e.setPointerCapture(n.pointerId);
		};
		return e.addEventListener("pointerenter", t), e.addEventListener("pointermove", n), e.addEventListener("pointerleave", r), e.addEventListener("pointerdown", i), () => {
			e.removeEventListener("pointerenter", t), e.removeEventListener("pointermove", n), e.removeEventListener("pointerleave", r), e.removeEventListener("pointerdown", i);
		};
	}, []), n(() => {
		let e = k.current;
		if (!e) return;
		let t = !1, n = 0, r;
		I("loading");
		let i = (e) => {
			t || (t = !0, n && cancelAnimationFrame(n), we(r), r = void 0, I("error"), M.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = V.current, s = Math.round(Q(a.simulationSize, 32, 384, 192)), c = Math.round(Q(a.patternSize, 8, 128, 64)), l = B.current ?? {
				width: e.width,
				height: e.height,
				cssWidth: e.clientWidth || H.current.width,
				cssHeight: e.clientHeight || H.current.height,
				devicePixelRatio: window.devicePixelRatio || 1
			}, u = l.cssWidth / l.cssHeight, d = u >= 1 ? s : Math.max(16, Math.round(s * u)), f = u >= 1 ? Math.max(16, Math.round(s / u)) : s, p = Math.ceil(l.cssWidth / Math.max(1, Math.round(a.pixelScale))), m = Math.ceil(l.cssHeight / Math.max(1, Math.round(a.pixelScale))), g = G(c, a.seed), _ = await h(a.powerPreference);
			if (t) return;
			let v = _.limits.maxTextureDimension2D;
			if (l.width > v || l.height > v || d > v || f > v) throw Error(`The output or simulation exceeds this device's ${v}px texture limit.`);
			let y = e.getContext("webgpu");
			if (!y) throw Error("The canvas could not create a WebGPU context.");
			let b = navigator.gpu.getPreferredCanvasFormat();
			y.configure({
				device: _,
				format: b,
				alphaMode: "premultiplied"
			});
			let x = await Se(_, b, o);
			if (t) return;
			let S = _.createBuffer({
				label: "Fluid simulation parameters",
				size: 56,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), C = _.createBuffer({
				label: "Blue-noise fluid display parameters",
				size: 64,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), w = _.createBuffer({
				label: "Tileable blue-noise ranks",
				size: 65536,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), T = {
				size: [d, f],
				format: "rgba16float",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
			}, E = _.createTexture({
				...T,
				label: "Fluid state"
			}), D = _.createTexture({
				...T,
				label: "Advected fluid state"
			}), O = _.createTexture({
				...T,
				label: "Fluid divergence"
			}), k = _.createTexture({
				...T,
				label: "Fluid pressure A"
			}), M = _.createTexture({
				...T,
				label: "Fluid pressure B"
			}), N = _.createSampler({
				label: "Fluid linear sampler",
				magFilter: "linear",
				minFilter: "linear",
				addressModeU: "clamp-to-edge",
				addressModeV: "clamp-to-edge"
			});
			r = {
				simulationParameters: S,
				displayParameters: C,
				pattern: w,
				state: E,
				advectedState: D,
				divergence: O,
				pressureA: k,
				pressureB: M,
				sampler: N
			}, _.queue.writeBuffer(w, 0, g);
			let P = /* @__PURE__ */ new ArrayBuffer(56), F = new DataView(P);
			F.setUint32(0, d, !0), F.setUint32(4, f, !0), F.setUint32(12, a.seed >>> 0, !0), F.setFloat32(36, Q(a.interactionRadius, .01, .3, .05), !0), F.setUint32(44, +(a.quantity === "temperature"), !0), F.setFloat32(48, Q(a.viscosity, 0, 20, 1), !0), F.setFloat32(52, Q(a.swirlStrength, 0, 3, 1), !0), _.queue.writeBuffer(S, 0, P);
			let L = /* @__PURE__ */ new ArrayBuffer(64), R = new DataView(L), z = Math.max(1, Math.round(a.pixelScale));
			R.setUint32(0, p, !0), R.setUint32(4, m, !0), R.setFloat32(8, z * l.width / l.cssWidth, !0), R.setFloat32(12, z * l.height / l.cssHeight, !0), R.setUint32(16, c, !0), R.setUint32(20, +(a.quantity === "temperature"), !0), R.setUint32(24, +!!a.invert, !0), R.setFloat32(28, Q(a.contrast, .25, 8, 1), !0);
			let U = {
				key: `${a.darkDependency}|${a.lightDependency}`,
				dark: fe(a.dark),
				light: fe(a.light)
			}, ee = new Float32Array(L, 32, 8);
			ee.set(U.dark, 0), ee.set(U.light, 4), _.queue.writeBuffer(C, 0, L);
			let W = E.createView(), K = D.createView(), q = O.createView(), J = k.createView(), Y = M.createView(), X = (e, t, n, r) => _.createBindGroup({
				label: e,
				layout: x.computeLayout,
				entries: [
					{
						binding: 0,
						resource: { buffer: S }
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
			}), te = X("Initialize fluid state", K, W, q), ne = X("Clear fluid pressure A", W, J, q), re = X("Clear fluid pressure B", W, Y, q), ie = X("Advect fluid state", W, K, q), ae = X("Measure fluid divergence", K, q, J), oe = [X("Solve pressure A to B", J, Y, q), X("Solve pressure B to A", Y, J, q)], se = X("Project fluid velocity", K, W, J), ce = _.createBindGroup({
				label: "Blue-noise fluid display",
				layout: x.display.getBindGroupLayout(0),
				entries: [
					{
						binding: 0,
						resource: { buffer: C }
					},
					{
						binding: 1,
						resource: { buffer: w }
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
			}), le = _.createCommandEncoder({ label: "Initialize fluid" }), Z = le.beginComputePass();
			Z.setPipeline(x.initialize), Z.setBindGroup(0, te), Z.dispatchWorkgroups(Math.ceil(d / 8), Math.ceil(f / 8)), Z.setPipeline(x.clearScalar), Z.setBindGroup(0, ne), Z.dispatchWorkgroups(Math.ceil(d / 8), Math.ceil(f / 8)), Z.setBindGroup(0, re), Z.dispatchWorkgroups(Math.ceil(d / 8), Math.ceil(f / 8)), Z.end(), _.queue.submit([le.finish()]);
			let ue = performance.now(), de = ue - ge, pe = ue, me = !1, he = (e, t) => {
				let n = {
					size: [e, t],
					format: "rgba16float",
					usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
				}, i = _.createTexture({
					...n,
					label: "Fluid state"
				}), a = _.createTexture({
					...n,
					label: "Advected fluid state"
				}), o = _.createTexture({
					...n,
					label: "Fluid divergence"
				}), s = _.createTexture({
					...n,
					label: "Fluid pressure A"
				}), c = _.createTexture({
					...n,
					label: "Fluid pressure B"
				}), l = i.createView(), u = a.createView(), p = o.createView(), m = s.createView(), h = c.createView();
				F.setUint32(0, e, !0), F.setUint32(4, t, !0), _.queue.writeBuffer(S, 0, P);
				let g = X("Resample fluid state", W, l, W), v = _.createCommandEncoder({ label: "Resample fluid state" }), y = v.beginComputePass();
				y.setPipeline(x.resample), y.setBindGroup(0, g), y.dispatchWorkgroups(Math.ceil(e / 8), Math.ceil(t / 8)), y.end(), _.queue.submit([v.finish()]), E.destroy(), D.destroy(), O.destroy(), k.destroy(), M.destroy(), E = i, D = a, O = o, k = s, M = c, r && (r.state = i, r.advectedState = a, r.divergence = o, r.pressureA = s, r.pressureB = c), W = l, K = u, q = p, J = m, Y = h, d = e, f = t, ie = X("Advect fluid state", W, K, q), ae = X("Measure fluid divergence", K, q, J), oe = [X("Solve pressure A to B", J, Y, q), X("Solve pressure B to A", Y, J, q)], se = X("Project fluid velocity", K, W, J), ce = _.createBindGroup({
					label: "Blue-noise fluid display",
					layout: x.display.getBindGroupLayout(0),
					entries: [
						{
							binding: 0,
							resource: { buffer: C }
						},
						{
							binding: 1,
							resource: { buffer: w }
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
			}, ye = (r) => {
				if (t) return;
				let a = r - de;
				if (a < ge) {
					n = requestAnimationFrame(ye);
					return;
				}
				de = r - a % ge;
				try {
					let a = V.current, o = B.current;
					if (o && o.cssWidth > 0 && o.cssHeight > 0) {
						let e = o.cssWidth / o.cssHeight, t = e >= 1 ? s : Math.max(16, Math.round(s * e)), n = e >= 1 ? Math.max(16, Math.round(s / e)) : s;
						(t !== d || n !== f) && he(t, n);
					}
					let u = Math.round(Q(a.patternSize, 8, 128, 64));
					u !== c && (c = u, _.queue.writeBuffer(w, 0, G(u, a.seed)));
					let h = Q((r - pe) / 1e3, 1 / 240, 1 / 30, 1 / 60) * _e;
					pe = r;
					let g = A.current, v = performance.now() - g.lastMoveTime < 120;
					if (F.setFloat32(8, h, !0), F.setFloat32(16, g.x, !0), F.setFloat32(20, g.y, !0), F.setFloat32(24, g.velocityX, !0), F.setFloat32(28, g.velocityY, !0), F.setFloat32(32, +!!v, !0), F.setFloat32(36, Q(a.interactionRadius, .01, .3, .05), !0), F.setFloat32(40, (r - ue) / 1e3, !0), F.setUint32(44, +(a.quantity === "temperature"), !0), F.setFloat32(48, Q(a.viscosity, 0, 20, 1), !0), F.setFloat32(52, Q(a.swirlStrength, 0, 3, 1), !0), _.queue.writeBuffer(S, 0, P), g.velocityX *= .72, g.velocityY *= .72, o) {
						let e = Math.max(1, Math.round(a.pixelScale));
						p = Math.ceil(o.cssWidth / e), m = Math.ceil(o.cssHeight / e), R.setFloat32(8, e * o.width / o.cssWidth, !0), R.setFloat32(12, e * o.height / o.cssHeight, !0);
					}
					R.setUint32(0, p, !0), R.setUint32(4, m, !0), R.setUint32(16, c, !0), R.setUint32(20, +(a.quantity === "temperature"), !0), R.setUint32(24, +!!a.invert, !0), R.setFloat32(28, Q(a.contrast, .25, 8, 1), !0);
					let b = `${a.darkDependency}|${a.lightDependency}`;
					U.key !== b && (U = {
						key: b,
						dark: fe(a.dark),
						light: fe(a.light)
					});
					let T = new Float32Array(L, 32, 8);
					T.set(U.dark, 0), T.set(U.light, 4), _.queue.writeBuffer(C, 0, L);
					let E = _.createCommandEncoder({ label: "Fluid simulation frame" }), D = (e, t, n) => {
						let r = E.beginComputePass({ label: e });
						r.setPipeline(t), r.setBindGroup(0, n), r.dispatchWorkgroups(Math.ceil(d / 8), Math.ceil(f / 8)), r.end();
					};
					D("Advect fluid", x.advect, ie), D("Measure fluid divergence", x.divergence, ae);
					for (let e = 0; e < ve; e += 1) D(`Solve fluid pressure ${e + 1}`, x.solvePressure, oe[e % 2]);
					D("Project fluid velocity", x.project, se);
					let O = E.beginRenderPass({
						label: "Blue-noise fluid display pass",
						colorAttachments: [{
							view: y.getCurrentTexture().createView(),
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
					O.setPipeline(x.display), O.setBindGroup(0, ce), O.draw(3), O.end(), _.queue.submit([E.finish()]), me || (me = !0, _.queue.onSubmittedWorkDone().then(() => {
						if (t) return;
						I("ready");
						let n = {
							canvas: e,
							device: _,
							...B.current ?? l,
							logicalWidth: p,
							logicalHeight: m
						};
						j.current?.(n);
					}, i)), n = requestAnimationFrame(ye);
				} catch (e) {
					i(e);
				}
			};
			ye(performance.now());
		})().catch(i), () => {
			t = !0, n && cancelAnimationFrame(n), we(r);
		};
	}, [
		f,
		y,
		S,
		o
	]), /* @__PURE__ */ a("canvas", {
		...O,
		ref: U,
		width: N?.width ?? L.width,
		height: N?.height ?? L.height,
		style: {
			touchAction: "none",
			...E
		},
		"aria-label": D,
		"data-webgpu-status": F
	});
}
//#endregion
//#region src/BlueNoisePaint.tsx
function De({ quantity: e = "pigment", viscosity: t = 2, "aria-label": n = "Interactive blue-noise paint in a box", ...r }) {
	return /* @__PURE__ */ a(Ee, {
		...r,
		setup: "paint",
		quantity: e === "velocity" ? "velocity" : "temperature",
		viscosity: t,
		"aria-label": n
	});
}
//#endregion
//#region src/inkPointer.ts
function Oe(e) {
	let t, n = [.5, .5], r = [.5, .5], i = [0, 0], a = 0, o = 0, s = e.style.touchAction;
	e.style.touchAction = "none";
	let c = (t) => {
		let n = e.getBoundingClientRect();
		return [Math.max(0, Math.min(1, (t.clientX - n.left) / Math.max(1, n.width))), Math.max(0, Math.min(1, 1 - (t.clientY - n.top) / Math.max(1, n.height)))];
	}, l = (s) => {
		s.isPrimary && t === void 0 && (e.setPointerCapture(s.pointerId), t = s.pointerId, n = r = c(s), a = s.timeStamp, i = [0, 0], o = 2);
	}, u = (e) => {
		if (!e.isPrimary) return;
		let t = c(e);
		if (a === 0) {
			n = r = t, a = e.timeStamp;
			return;
		}
		let s = Math.max(.004, Math.min(.05, (e.timeStamp - a) / 1e3));
		n = r, r = t, i = [Math.max(-2.5, Math.min(2.5, (r[0] - n[0]) / s)), Math.max(-2.5, Math.min(2.5, (r[1] - n[1]) / s))], a = e.timeStamp, o = 2;
	}, d = (n) => {
		n.isPrimary && n.pointerId === t && (e.hasPointerCapture?.(n.pointerId) && e.releasePointerCapture(n.pointerId), t = void 0, o = 2);
	}, f = () => {
		t === void 0 && (a = 0, o = 0);
	};
	return e.addEventListener("pointerdown", l), e.addEventListener("pointermove", u), e.addEventListener("pointerup", d), e.addEventListener("pointercancel", d), e.addEventListener("pointerleave", f), {
		get active() {
			return t !== void 0 || o > 0;
		},
		get from() {
			return n;
		},
		get to() {
			return r;
		},
		get velocity() {
			return i;
		},
		consumeStep() {
			n = r, t === void 0 && o > 0 && (i = [i[0] * .45, i[1] * .45], o--);
		},
		dispose() {
			e.removeEventListener("pointerdown", l), e.removeEventListener("pointermove", u), e.removeEventListener("pointerup", d), e.removeEventListener("pointercancel", d), e.removeEventListener("pointerleave", f), t !== void 0 && e.hasPointerCapture?.(t) && e.releasePointerCapture(t), t = void 0, e.style.touchAction = s;
		}
	};
}
//#endregion
//#region src/inkShaders.ts
var ke = "struct Grid {\n  size: vec2u,\n  dye_size: vec2u,\n}\n\nstruct Input {\n  step: u32,\n  pointer_active: f32,\n  pointer_from: vec2f,\n  pointer_to: vec2f,\n  pointer_velocity: vec2f,\n  idle_a: vec4f,\n  idle_b: vec4f,\n  pointer_radius_squared: f32,\n}\n\nfn index_of(p: vec2i, size: vec2u) -> u32 {\n  let q = clamp(p, vec2i(0), vec2i(size) - 1);\n  return u32(q.y) * size.x + u32(q.x);\n}\n\nfn cell_uv(p: vec2i, size: vec2u) -> vec2f {\n  return (vec2f(p) + 0.5) / vec2f(size);\n}\n\nfn segment_weight(\n  p: vec2f,\n  a: vec2f,\n  b: vec2f,\n  radius_squared: f32,\n  aspect: f32,\n) -> f32 {\n  let scale = vec2f(aspect, 1.0);\n  let point = p * scale;\n  let origin = a * scale;\n  let delta = (b - a) * scale;\n  let t = clamp(dot(point - origin, delta) / max(dot(delta, delta), 1e-7), 0.0, 1.0);\n  let d = point - (origin + t * delta);\n  return exp(-dot(d, d) / radius_squared);\n}\n\nfn emitter_weight(p: vec2f, emitter: vec4f, aspect: f32) -> f32 {\n  let d = (p - emitter.xy) * vec2f(aspect, 1.0);\n  return exp(-dot(d, d) / emitter.w) * emitter.z;\n}\n", Ae = "\nstruct Grid {\n  size: vec2u,\n  dye_size: vec2u,\n}\nstruct Display {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  invert: u32,\n  contrast: f32,\n  padding: f32,\n  dark: vec4f,\n  light: vec4f,\n}\n@group(0) @binding(0) var<uniform> grid: Grid;\n@group(0) @binding(1) var<uniform> display: Display;\n@group(0) @binding(2) var<storage, read> dye: array<f32>;\n@group(0) @binding(3) var<storage, read> noiseRanks: array<u32>;\n\nfn index_of(p: vec2i) -> u32 {\n  let q = clamp(p, vec2i(0), vec2i(grid.dye_size) - 1);\n  return u32(q.y) * grid.dye_size.x + u32(q.x);\n}\nfn sample_dye(uv: vec2f) -> f32 {\n  let coord = clamp(uv * vec2f(grid.dye_size) - 0.5, vec2f(0), vec2f(grid.dye_size) - 1.0);\n  let cell = vec2i(floor(coord));\n  let f = fract(coord);\n  let bottom = mix(dye[index_of(cell)], dye[index_of(cell + vec2i(1, 0))], f.x);\n  let top = mix(dye[index_of(cell + vec2i(0, 1))], dye[index_of(cell + vec2i(1, 1))], f.x);\n  return mix(bottom, top, f.y);\n}\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let size = max(display.logicalSize, vec2u(1u));\n  let cell = min(vec2u(position.xy / max(display.cellSize, vec2f(0.0001))), size - vec2u(1u));\n  var uv = (vec2f(cell) + 0.5) / vec2f(size);\n  uv.y = 1.0 - uv.y;\n  let density = sample_dye(uv);\n  let vignette = 0.68 + 0.32 * pow(max(0.0, 1.0 - dot(uv - 0.5, uv - 0.5) * 1.9), 1.5);\n  var luminance = (1.0 - exp(-density * 1.35)) * vignette;\n  luminance = clamp((luminance - 0.5) * display.contrast + 0.5, 0.0, 1.0);\n  luminance = select(luminance, 1.0 - luminance, display.invert != 0u);\n  let patternCell = cell % vec2u(display.patternSize);\n  let rank = noiseRanks[patternCell.y * display.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(display.patternSize * display.patternSize);\n  return select(display.dark, display.light, luminance >= threshold);\n}\n", je = {
	advectVelocity: ke + "@group(0) @binding(0) var<uniform> grid: Grid;\n@group(0) @binding(1) var<uniform> input: Input;\n@group(0) @binding(2) var<storage, read> src: array<vec2f>;\n@group(0) @binding(3) var<storage, read_write> dst: array<vec2f>;\n\nfn sample_velocity(p: vec2f) -> vec2f {\n  let coord = clamp(p * vec2f(grid.size) - 0.5, vec2f(0), vec2f(grid.size) - 1.0);\n  let cell = vec2i(floor(coord));\n  let f = fract(coord);\n  let bottom = mix(src[index_of(cell, grid.size)], src[index_of(cell + vec2i(1, 0), grid.size)], f.x);\n  let top = mix(src[index_of(cell + vec2i(0, 1), grid.size)], src[index_of(cell + vec2i(1, 1), grid.size)], f.x);\n  return mix(bottom, top, f.y);\n}\n\n@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= grid.size)) { return; }\n  let cell = vec2i(id.xy);\n  let p = cell_uv(cell, grid.size);\n  let aspect = f32(grid.size.x) / f32(grid.size.y);\n  let dt = 1.0 / 60.0;\n  let source_velocity = src[index_of(cell, grid.size)];\n  let backtrace = clamp(p - dt * source_velocity, 0.5 / vec2f(grid.size), 1.0 - 0.5 / vec2f(grid.size));\n  var velocity = 0.98 * sample_velocity(backtrace);\n\n  let weight_a = emitter_weight(p, input.idle_a, aspect);\n  let weight_b = emitter_weight(p, input.idle_b, aspect);\n  let time = f32(input.step) / 60.0;\n  let tangent_a = vec2f(0.28 * 0.73 * cos(0.73 * time), 0.22 * 1.09 * cos(1.09 * time + 0.4));\n  let tangent_b = vec2f(0.26 * 0.61 * cos(0.61 * time + 3.14159265), 0.24 * 0.97 * cos(0.97 * time + 2.1));\n  velocity += dt * (weight_a * (2.6 * tangent_a + 2.0 * vec2f(-tangent_a.y, tangent_a.x))\n                  + weight_b * (2.6 * tangent_b - 2.0 * vec2f(-tangent_b.y, tangent_b.x)));\n\n  if (input.pointer_active > 0.0) {\n    let weight = segment_weight(p, input.pointer_from, input.pointer_to, input.pointer_radius_squared, aspect);\n    velocity += weight * input.pointer_velocity * 0.8;\n  }\n\n  let speed = length(velocity);\n  if (speed > 2.5) { velocity *= 2.5 / speed; }\n  dst[index_of(cell, grid.size)] = velocity;\n}\n",
	curl: ke + "@group(0) @binding(0) var<uniform> grid: Grid;\n@group(0) @binding(1) var<storage, read> velocity: array<vec2f>;\n@group(0) @binding(2) var<storage, read_write> curl: array<f32>;\n\n@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= grid.size)) { return; }\n  let p = vec2i(id.xy);\n  let left = velocity[index_of(p - vec2i(1, 0), grid.size)].y;\n  let right = velocity[index_of(p + vec2i(1, 0), grid.size)].y;\n  let top = velocity[index_of(p + vec2i(0, 1), grid.size)].x;\n  let bottom = velocity[index_of(p - vec2i(0, 1), grid.size)].x;\n  curl[index_of(p, grid.size)] = 0.5 * (right - left - top + bottom);\n}\n",
	vorticity: ke + "@group(0) @binding(0) var<uniform> grid: Grid;\n@group(0) @binding(1) var<storage, read> src: array<vec2f>;\n@group(0) @binding(2) var<storage, read> curl: array<f32>;\n@group(0) @binding(3) var<storage, read_write> dst: array<vec2f>;\n\n@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= grid.size)) { return; }\n  let p = vec2i(id.xy);\n  let left = abs(curl[index_of(p - vec2i(1, 0), grid.size)]);\n  let right = abs(curl[index_of(p + vec2i(1, 0), grid.size)]);\n  let top = abs(curl[index_of(p + vec2i(0, 1), grid.size)]);\n  let bottom = abs(curl[index_of(p - vec2i(0, 1), grid.size)]);\n  let center = curl[index_of(p, grid.size)];\n\n  var force = 0.5 * vec2f(top - bottom, right - left);\n  force /= length(force) + 0.0001;\n  force *= 20.0 * center;\n  force.y *= -1.0;\n\n  var velocity = src[index_of(p, grid.size)] + force / 60.0;\n  let speed = length(velocity);\n  if (speed > 2.5) { velocity *= 2.5 / speed; }\n  dst[index_of(p, grid.size)] = velocity;\n}\n",
	divergence: ke + "@group(0) @binding(0) var<uniform> grid: Grid;\n@group(0) @binding(1) var<storage, read> velocity: array<vec2f>;\n@group(0) @binding(2) var<storage, read_write> divergence: array<f32>;\n\n@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= grid.size)) { return; }\n  let p = vec2i(id.xy);\n  let last = vec2i(grid.size) - 1;\n  let l = select(velocity[index_of(p - vec2i(1, 0), grid.size)].x, 0.0, p.x == 0);\n  let r = select(velocity[index_of(p + vec2i(1, 0), grid.size)].x, 0.0, p.x == last.x);\n  let b = select(velocity[index_of(p - vec2i(0, 1), grid.size)].y, 0.0, p.y == 0);\n  let t = select(velocity[index_of(p + vec2i(0, 1), grid.size)].y, 0.0, p.y == last.y);\n  divergence[index_of(p, grid.size)] =\n    (r - l)*.5*f32(grid.size.x) + (t - b)*.5*f32(grid.size.y);\n}\n",
	pressure: ke + "struct PressureParams {\n  decay: f32,\n}\n@group(0) @binding(0) var<uniform> grid: Grid;\n@group(0) @binding(1) var<uniform> params: PressureParams;\n@group(0) @binding(2) var<storage, read> src: array<f32>;\n@group(0) @binding(3) var<storage, read> divergence: array<f32>;\n@group(0) @binding(4) var<storage, read_write> dst: array<f32>;\n\n@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= grid.size)) { return; }\n  let p = vec2i(id.xy);\n  let i = index_of(p, grid.size);\n  let center = src[i];\n  let last = vec2i(grid.size) - 1;\n  let left = select(src[index_of(p - vec2i(1, 0), grid.size)], center, p.x == 0) * params.decay;\n  let right = select(src[index_of(p + vec2i(1, 0), grid.size)], center, p.x == last.x) * params.decay;\n  let bottom = select(src[index_of(p - vec2i(0, 1), grid.size)], center, p.y == 0) * params.decay;\n  let top = select(src[index_of(p + vec2i(0, 1), grid.size)], center, p.y == last.y) * params.decay;\n  let wx = f32(grid.size.x * grid.size.x);\n  let wy = f32(grid.size.y * grid.size.y);\n  dst[i] = ((left + right) * wx + (bottom + top) * wy - divergence[i]) / (2.0 * wx + 2.0 * wy);\n}\n",
	project: ke + "@group(0) @binding(0) var<uniform> grid: Grid;\n@group(0) @binding(1) var<storage, read> src: array<vec2f>;\n@group(0) @binding(2) var<storage, read> pressure: array<f32>;\n@group(0) @binding(3) var<storage, read_write> dst: array<vec2f>;\n\n@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= grid.size)) { return; }\n  let p = vec2i(id.xy);\n  let last = vec2i(grid.size) - 1;\n  let c = pressure[index_of(p, grid.size)];\n  let l = select(pressure[index_of(p - vec2i(1, 0), grid.size)], c, p.x == 0);\n  let r = select(pressure[index_of(p + vec2i(1, 0), grid.size)], c, p.x == last.x);\n  let b = select(pressure[index_of(p - vec2i(0, 1), grid.size)], c, p.y == 0);\n  let t = select(pressure[index_of(p + vec2i(0, 1), grid.size)], c, p.y == last.y);\n  var u = src[index_of(p, grid.size)] - vec2f(\n    (r - l)*.5*f32(grid.size.x),\n    (t - b)*.5*f32(grid.size.y),\n  );\n  if (p.x == 0 && u.x < 0.0) { u.x = 0.0; }\n  if (p.x == last.x && u.x > 0.0) { u.x = 0.0; }\n  if (p.y == 0 && u.y < 0.0) { u.y = 0.0; }\n  if (p.y == last.y && u.y > 0.0) { u.y = 0.0; }\n  let s = length(u);\n  if (s > 2.5) { u *= 2.5 / s; }\n  dst[index_of(p, grid.size)] = u;\n}\n",
	advectDye: ke + "@group(0) @binding(0) var<uniform> grid: Grid;\n@group(0) @binding(1) var<uniform> input: Input;\n@group(0) @binding(2) var<storage, read> src: array<f32>;\n@group(0) @binding(3) var<storage, read> velocity: array<vec2f>;\n@group(0) @binding(4) var<storage, read_write> dst: array<f32>;\n\nfn sample_dye(p: vec2f) -> f32 {\n  let coord = clamp(p * vec2f(grid.dye_size) - 0.5, vec2f(0), vec2f(grid.dye_size) - 1.0);\n  let cell = vec2i(floor(coord));\n  let f = fract(coord);\n  let bottom = mix(src[index_of(cell, grid.dye_size)], src[index_of(cell + vec2i(1, 0), grid.dye_size)], f.x);\n  let top = mix(\n    src[index_of(cell + vec2i(0, 1), grid.dye_size)],\n    src[index_of(cell + vec2i(1, 1), grid.dye_size)],\n    f.x,\n  );\n  return mix(bottom, top, f.y);\n}\n\nfn sample_velocity(p: vec2f) -> vec2f {\n  let coord = clamp(p * vec2f(grid.size) - 0.5, vec2f(0), vec2f(grid.size) - 1.0);\n  let cell = vec2i(floor(coord));\n  let f = fract(coord);\n  let bottom = mix(velocity[index_of(cell, grid.size)], velocity[index_of(cell + vec2i(1, 0), grid.size)], f.x);\n  let top = mix(\n    velocity[index_of(cell + vec2i(0, 1), grid.size)],\n    velocity[index_of(cell + vec2i(1, 1), grid.size)],\n    f.x,\n  );\n  return mix(bottom, top, f.y);\n}\n\n@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) id: vec3u) {\n  if (any(id.xy >= grid.dye_size)) { return; }\n  let cell = vec2i(id.xy);\n  let p = cell_uv(cell, grid.dye_size);\n  let aspect = f32(grid.size.x) / f32(grid.size.y);\n  let backtrace = clamp(p - sample_velocity(p) / 60.0, 0.5 / vec2f(grid.dye_size), 1.0 - 0.5 / vec2f(grid.dye_size));\n  var density = 0.97 * sample_dye(backtrace);\n\n  density += emitter_weight(p, input.idle_a, aspect) * 0.12;\n  density += emitter_weight(p, input.idle_b, aspect) * 0.115;\n  if (input.pointer_active > 0.0) {\n    let weight = segment_weight(p, input.pointer_from, input.pointer_to, input.pointer_radius_squared, aspect);\n    density += weight * 0.35;\n  }\n\n  dst[index_of(cell, grid.dye_size)] = clamp(density, 0.0, 4.0);\n}\n"
}, Me = /* @__PURE__ */ new WeakMap();
function Ne(e, t) {
	let n = Me.get(e);
	n || (n = /* @__PURE__ */ new Map(), Me.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let n = {};
		await Promise.all(Object.entries(je).map(async ([t, r]) => {
			let i = await g(e, `Ink ${t} WGSL`, r);
			n[t] = await e.createComputePipelineAsync({
				label: `Ink ${t}`,
				layout: "auto",
				compute: {
					module: i,
					entryPoint: "main"
				}
			});
		}));
		let r = await g(e, "Blue-noise ink WGSL", Ae);
		return {
			compute: n,
			display: await e.createRenderPipelineAsync({
				label: "Blue-noise ink display",
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
	})(), n.set(t, r), r.catch(() => n?.delete(t))), r;
}
function Pe(e, t, n) {
	let r = Math.round(Q(n, 32, 384, 128)), i = Math.round(r * 9 / 16), a = r * 4, o = i * 4, s = r * i, c = [], l = (t, n, r) => {
		let i = e.createBuffer({
			label: t,
			size: n,
			usage: r
		});
		return c.push(i), i;
	}, u = () => {
		for (let e of c) e.destroy();
	};
	try {
		let n = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, c = GPUBufferUsage.STORAGE, d = l("Ink grid", 16, n);
		e.queue.writeBuffer(d, 0, new Uint32Array([
			r,
			i,
			a,
			o
		]));
		let f = l("Ink input", 80, n), p = l("Ink display", 64, n), m = l("Ink blue-noise ranks", 65536, c | GPUBufferUsage.COPY_DST), h = [l("Ink velocity A", s * 8, c), l("Ink velocity B", s * 8, c)], g = [l("Ink dye A", s * 16 * 4, c), l("Ink dye B", s * 16 * 4, c)], _ = [l("Ink pressure A", s * 4, c), l("Ink pressure B", s * 4, c)], v = l("Ink curl", s * 4, c), y = l("Ink divergence", s * 4, c), b = [l("Ink pressure decay", 4, n), l("Ink pressure retain", 4, n)];
		e.queue.writeBuffer(b[0], 0, new Float32Array([.8])), e.queue.writeBuffer(b[1], 0, new Float32Array([1]));
		let x = (t, n) => e.createBindGroup({
			layout: t.getBindGroupLayout(0),
			entries: n.map((e, t) => ({
				binding: t,
				resource: { buffer: e }
			}))
		}), S = t.compute, C = (e) => [e(0), e(1)], w = C((e) => x(S.advectVelocity, [
			d,
			f,
			h[e],
			h[1 - e]
		])), T = C((e) => x(S.curl, [
			d,
			h[e],
			v
		])), E = C((e) => x(S.vorticity, [
			d,
			h[e],
			v,
			h[1 - e]
		])), D = C((e) => x(S.divergence, [
			d,
			h[e],
			y
		])), O = b.map((e) => C((t) => x(S.pressure, [
			d,
			e,
			_[t],
			y,
			_[1 - t]
		]))), k = h.map((e, t) => C((n) => x(S.project, [
			d,
			e,
			_[n],
			h[1 - t]
		]))), A = g.map((e, t) => C((n) => x(S.advectDye, [
			d,
			f,
			e,
			h[n],
			g[1 - t]
		]))), j = C((e) => x(t.display, [
			d,
			p,
			g[e],
			m
		])), M = 0, N = 0, P = 0, F = 0, I = -1e3, L = /* @__PURE__ */ new ArrayBuffer(80), R = new DataView(L), z = (e, t) => {
			R.setFloat32(e, t[0], !0), R.setFloat32(e + 4, t[1], !0);
		};
		return {
			displayParameters: p,
			pattern: m,
			dispose: u,
			step(t, n) {
				let s = t.active;
				s && (I = F);
				let c = F / 60, l = F - I, u = l < 90 ? .15 : .15 + .85 * Math.min(1, (l - 90) / 60), d = Math.min(1, (F + 1) / 24), p = t.velocity;
				s && Math.hypot(...p) < .02 && (p = [.16 * Math.cos(c * 5), .16 * Math.sin(c * 5)]), R.setUint32(0, F, !0), R.setFloat32(4, +!!s, !0), z(8, t.from), z(16, t.to), z(24, p), z(32, [.5 + .28 * Math.sin(.73 * c), .5 + .22 * Math.sin(1.09 * c + .4)]), R.setFloat32(40, d * u, !0), R.setFloat32(44, .006, !0), z(48, [.5 + .26 * Math.sin(.61 * c + Math.PI), .5 + .24 * Math.sin(.97 * c + 2.1)]), R.setFloat32(56, d * u, !0), R.setFloat32(60, .0055, !0), R.setFloat32(64, Q(n, .01, .3, Math.sqrt(.002)) ** 2, !0), e.queue.writeBuffer(f, 0, L);
				let m = e.createCommandEncoder({ label: "Ink simulation step" }), h = (e, t, n = r, a = i) => {
					let o = m.beginComputePass({ label: `Ink ${e}` });
					o.setPipeline(S[e]), o.setBindGroup(0, t), o.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(a / 8)), o.end();
				};
				h("advectVelocity", w[M]), M = 1 - M, h("curl", T[M]), h("vorticity", E[M]), M = 1 - M, h("divergence", D[M]);
				for (let e = 0; e < 3; e++) h("pressure", O[e === 0 ? 0 : 1][P]), P = 1 - P;
				h("project", k[M][P]), M = 1 - M, h("advectDye", A[N][M], a, o), N = 1 - N, e.queue.submit([m.finish()]), F++, t.consumeStep();
			},
			render(n) {
				let r = e.createCommandEncoder({ label: "Blue-noise ink frame" }), i = r.beginRenderPass({ colorAttachments: [{
					view: n.getCurrentTexture().createView(),
					clearValue: {
						r: 0,
						g: 0,
						b: 0,
						a: 0
					},
					loadOp: "clear",
					storeOp: "store"
				}] });
				i.setPipeline(t.display), i.setBindGroup(0, j[N]), i.draw(3), i.end(), e.queue.submit([r.finish()]);
			}
		};
	} catch (e) {
		throw u(), e;
	}
}
//#endregion
//#region src/BlueNoiseInk.tsx
function Fe({ width: o, height: s, pixelScale: c = 2, patternSize: l = 64, simulationSize: u = 128, interactionRadius: d = Math.sqrt(.002), contrast: f = 1, invert: p = !1, seed: m = 1592594996, dark: g = "black", light: _ = "white", powerPreference: v = "high-performance", onReady: y, onError: b, ref: x, style: S, "aria-label": C = "Interactive blue-noise ink simulation", ...w }) {
	let T = r(null), E = r(void 0), [D, O] = i(), [k, A] = i("loading"), j = ue(o, s === void 0 ? 960 : ue(s, 540) * 16 / 9), M = ue(s, j * 9 / 16), N = r({
		onReady: y,
		onError: b
	});
	N.current = {
		onReady: y,
		onError: b
	};
	let P = r({
		pixelScale: c,
		patternSize: l,
		interactionRadius: d,
		contrast: f,
		invert: p,
		seed: m,
		dark: g,
		light: _
	});
	P.current = {
		pixelScale: c,
		patternSize: l,
		interactionRadius: d,
		contrast: f,
		invert: p,
		seed: m,
		dark: g,
		light: _
	};
	let F = e((e) => {
		T.current = e, typeof x == "function" ? x(e) : x && (x.current = e);
	}, [x]);
	return t(() => {
		let e = T.current;
		if (!e) return;
		let t = 0, n = 0, r, i = () => {
			if (t <= 0 || n <= 0) return;
			let e = Math.max(.01, window.devicePixelRatio || 1), r = {
				width: Math.max(1, Math.round(t * e)),
				height: Math.max(1, Math.round(n * e)),
				cssWidth: t,
				cssHeight: n,
				devicePixelRatio: e
			};
			E.current = r, O((e) => e && Object.keys(r).every((t) => e[t] === r[t]) ? e : r);
		}, a = new ResizeObserver(([e]) => {
			e && (t = Math.round(e.contentRect.width * 64) / 64, n = Math.round(e.contentRect.height * 64) / 64, i());
		});
		a.observe(e);
		let o = () => {
			i(), r?.removeEventListener("change", o), r = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`), r.addEventListener("change", o, { once: !0 });
		};
		return window.addEventListener("resize", o), o(), () => {
			a.disconnect(), window.removeEventListener("resize", o), r?.removeEventListener("change", o);
		};
	}, [j, M]), n(() => {
		let e = T.current;
		if (!e) return;
		let t = !1, n = 0, r, i, a, o;
		A("loading");
		let s = () => {
			n && cancelAnimationFrame(n), i?.dispose(), r?.dispose(), a?.removeEventListener("uncapturederror", l), o?.unconfigure();
		}, c = (e) => {
			t || (t = !0, s(), A("error"), N.current.onError?.(e instanceof Error ? e : Error(String(e))));
		}, l = (e) => c(Error(e.error.message));
		return (async () => {
			let s = await h(v);
			if (t) return;
			let d = navigator.gpu.getPreferredCanvasFormat(), f = await Ne(s, d);
			if (t) return;
			if (a = s, a.addEventListener("uncapturederror", l), a.lost.then((e) => c(/* @__PURE__ */ Error(`WebGPU device lost: ${e.message}`))), o = e.getContext("webgpu") ?? void 0, !o) throw Error("The canvas could not create a WebGPU context.");
			o.configure({
				device: a,
				format: d,
				alphaMode: "premultiplied"
			}), r = Pe(a, f, u), i = Oe(e);
			let p = /* @__PURE__ */ new ArrayBuffer(64), m = new DataView(p), g = new Float32Array(p, 32, 8), _ = "", y = 0, b = performance.now(), x = 0, S = !1, C = (s) => {
				if (t || !r || !i || !a || !o) return;
				let l = Math.min((s - b) / 1e3, 1 / 30);
				if (b = s, document.hidden) {
					x = 0, n = requestAnimationFrame(C);
					return;
				}
				try {
					let s = P.current, u = E.current ?? {
						width: e.width,
						height: e.height,
						cssWidth: e.clientWidth || j,
						cssHeight: e.clientHeight || M,
						devicePixelRatio: window.devicePixelRatio || 1
					};
					if (u.width > a.limits.maxTextureDimension2D || u.height > a.limits.maxTextureDimension2D) throw Error(`The canvas exceeds this device's ${a.limits.maxTextureDimension2D}px texture limit.`);
					let d = ue(s.pixelScale, 2), f = Math.ceil(u.cssWidth / d), h = Math.ceil(u.cssHeight / d), v = Math.round(Q(s.patternSize, 8, 128, 64));
					v !== y && (a.queue.writeBuffer(r.pattern, 0, G(v, s.seed)), y = v);
					let b = `${pe(s.dark)}|${pe(s.light)}`;
					b !== _ && (g.set(fe(s.dark), 0), g.set(fe(s.light), 4), _ = b), m.setUint32(0, f, !0), m.setUint32(4, h, !0), m.setFloat32(8, d * u.width / u.cssWidth, !0), m.setFloat32(12, d * u.height / u.cssHeight, !0), m.setUint32(16, y, !0), m.setUint32(20, +!!s.invert, !0), m.setFloat32(24, Q(s.contrast, .25, 8, 1), !0), a.queue.writeBuffer(r.displayParameters, 0, p), x += l;
					let w = 0;
					for (; x >= 1 / 60 && w < 2;) r.step(i, s.interactionRadius), x -= 1 / 60, w++;
					if (w === 2 && (x = 0), r.render(o), !S) {
						S = !0;
						let n = {
							canvas: e,
							device: a,
							...u,
							logicalWidth: f,
							logicalHeight: h
						};
						a.queue.onSubmittedWorkDone().then(() => {
							t || (A("ready"), N.current.onReady?.(n));
						}, c);
					}
					n = requestAnimationFrame(C);
				} catch (e) {
					c(e);
				}
			};
			n = requestAnimationFrame(C);
		})().catch(c), () => {
			t = !0, s();
		};
	}, [
		u,
		m,
		v
	]), /* @__PURE__ */ a("canvas", {
		...w,
		ref: F,
		width: D?.width ?? j,
		height: D?.height ?? M,
		style: {
			touchAction: "none",
			...S
		},
		"aria-label": C,
		"data-webgpu-status": k
	});
}
//#endregion
//#region src/leniaSeed.ts
function Ie(e) {
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
function Le(e) {
	let t = e >>> 0;
	return () => (t = Math.imul(t, 1664525) + 1013904223 >>> 0, t / 4294967296);
}
function Re(e, t) {
	return Number.isFinite(e) ? Math.min(1, Math.max(0, e)) : t;
}
function ze(e) {
	return Number.isFinite(e) ? Math.min(3, Math.max(.5, e)) : 1;
}
function Be(e, t) {
	if (t === 1) return e;
	let n = e.length, r = Math.max(...e.map((e) => e.length)), i = Math.max(1, Math.round(r * t)), a = Math.max(1, Math.round(n * t)), o = (t, n) => e[n]?.[t] ?? 0;
	return Array.from({ length: a }, (e, t) => Array.from({ length: i }, (e, s) => {
		let c = (s + .5) * r / i - .5, l = (t + .5) * n / a - .5, u = Math.floor(c), d = Math.floor(l), f = c - u, p = l - d;
		return o(u, d) * (1 - f) * (1 - p) + o(u + 1, d) * f * (1 - p) + o(u, d + 1) * (1 - f) * p + o(u + 1, d + 1) * f * p;
	}));
}
function Ve(e, t) {
	let n = e.length, r = Math.max(...e.map((e) => e.length)), i = t * Math.PI / 180, a = Math.cos(i), o = Math.sin(i), s = Math.ceil(Math.abs(r * a) + Math.abs(n * o)), c = Math.ceil(Math.abs(r * o) + Math.abs(n * a)), l = (r - 1) / 2, u = (n - 1) / 2, d = (s - 1) / 2, f = (c - 1) / 2, p = (t, n) => e[n]?.[t] ?? 0;
	return Array.from({ length: c }, (e, t) => Array.from({ length: s }, (e, n) => {
		let r = n - d, i = t - f, s = a * r + o * i + l, c = -o * r + a * i + u, m = Math.floor(s), h = Math.floor(c), g = s - m, _ = c - h;
		return p(m, h) * (1 - g) * (1 - _) + p(m + 1, h) * g * (1 - _) + p(m, h + 1) * (1 - g) * _ + p(m + 1, h + 1) * g * _;
	}));
}
function He(e, t, n, r, i, a, o = 1) {
	let s = new Float32Array(e * t), c = Be(Ie(n.cells), ze(o)), l = Le(r), u = Math.floor(l() * 4) * 90, d = Math.min(e, t) >= 64 ? [
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
		let o = Ve(c, r.rotation), u = o[0]?.length ?? 0, d = o.length, f = i ? 0 : .05, p = n === 0 ? a : void 0, m = Re(p?.x ?? r.x, .5) + (l() - .5) * f, h = Re(p?.y ?? r.y, .5) + (l() - .5) * f, g = r.margin ?? 0, _ = r.anchor === "bottom-right" && !p ? e - u - g : Math.round(m * e - u / 2), v = r.anchor === "bottom-right" && !p ? t - d - g : Math.round(h * t - d / 2), y = Math.max(0, e - u), b = Math.max(0, t - d), x = Math.min(g, y), S = Math.min(g, b), C = Math.max(x, y - g), w = Math.max(S, b - g), T = Math.min(C, Math.max(x, _)), E = Math.min(w, Math.max(S, v));
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
function Ue(...e) {
	return e.join("$");
}
var We = [
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
		cells: Ue("7.MD6.qL", "6.pKqEqFURpApBRAqQ", "5.VqTrSsBrOpXpWpTpWpUpCrQ", "4.CQrQsTsWsApITNPpGqGvL", "3.IpIpWrOsGsBqXpJ4.LsFrL", "A.DpKpSpJpDqOqUqSqE5.ExD", "qL.pBpTT2.qCrGrVrWqM5.sTpP", ".pGpWpD3.qUsMtItQtJ6.tL", ".uFqGH3.pXtOuR2vFsK5.sM", ".tUqL4.GuNwAwVxBwNpC4.qXpA", "2.uH5.vBxGyEyMyHtW4.qIpL", "2.wV5.tIyG3yOxQqW2.FqHpJ", "2.tUS4.rM2yOyJyOyHtVpPMpFqNV", "2.HsR4.pUxAyOxLxDxEuVrMqBqGqKJ", "3.sLpE3.pEuNxHwRwGvUuLsHrCqTpR", "3.TrMS2.pFsLvDvPvEuPtNsGrGqIP", "4.pRqRpNpFpTrNtGtVtStGsMrNqNpF", "5.pMqKqLqRrIsCsLsIrTrFqJpHE", "6.RpSqJqPqVqWqRqKpRXE", "8.OpBpIpJpFTK")
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
		cells: Ue("13.pK", "14.qV", "6.VpA.MpEpKpITqV", "4.BpPpNrIrEqDpWpOpLpUqNvT", "4.IqRrNsPsKqHJ3.GqOuC", "4.TrLsTrPrLpS6.uUD", "3.SpWqNrBqLpRqPqE6.vA", "2.FpTpMLpHqPqHrVsPrS5.qUqA", "K.pCpRG.ErFsRsVuSuPqN4.CrR", "pA.pTU3.rWuBuRvXwTwKpF4.rCH", ".tPqHH3.qFvAwUwVyJyKwNL2.DqLR", ".pGsGA4.vPxSyDxE2yOuHS.XqJT", "2.xIE4.sCyHyOvLvRyFxCsGpVpXqGP", "2.VsU4.DxQyOvVuSwDwQuBrMqSqCF", "3.vG5.tEyKwVvIvKvMtVrXqTpM", "4.sU4.qFvDwMvNuUuDsUrKqDO", "4.qCrDJ2.pPsKuGuHtOsQrNqKpC", "5.pTqTpVpNqFrJsGsKrVrDqFpFD", "6.QqCqJqPqVqXqRqHpOTC", "8.LWpFpEXPG")
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
		cells: Ue("10.EL2QLE", "7.TpU2qHqCpXpUpNpFL", "4.JrVtTuKuPuKtLrXqTqHqCpPpDG", "3.qWtDqRpKqEsMuXvBtGrApXpUpSpIO", "2.rQrN4.pAuAvRtTrIpUpIpKpFO", ".pSsM6.tJwFuNsPsFrVpPpDL", ".uFB6.tJ2yO2yLyOyDsKL", "pDuC6.pFxW3yOwIwD2xPqH", "rNtV5.EsMxCyIyOwXtJsMtJwFuX", "sHuSV3.EpDvOwFxEwQsRqR2qHsFvWE", "rQvJsWpPQpKpSqCvEvBuCpD3.BpDtGrQ", "pXuKvMuPtLsWsCrIuCtBrS6.qWrQ", "EsKvEwXyBwLtVrVsCrDqH6.pXrG", ".qHtVxJyOwQrQpNqJpPV6.qJqE", ".JsUxMyOrX10.pFqRJ", "2.rQxPwIpI9.pKqJT", "2.qJxEuPpKB7.qCpP", "2.EvOvMpPO5.TrGqH", "3.sCyOqEpIOEBOqHqEsRtG", "4.xMsMqJqCpXqJqRpIqOuCtBsF", "5.xPrAqTqMpSE.rSsMrLqRqHV.TpS", "6.vErDE2.VpPB", "7.pIrNqHpKQ")
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
		cells: Ue("6.VrQ2tJrQT", "5.sUxH3yOxWuUpU", "4.tOyG7yOqW", "3.rDxC9yOxR", "3.tD3yOxRwLwAwDwX4yO", "3.vW2yOwSuXuKuFtTtB2.vO2yO", "3.2yOxPuItO2tQtB4.E2yO", "2.pI2yOuFLrDtGuCtO5.yB2yOB", "2.wLyOvT3.qWyGxPqO4.qJ2yOvRpA", "2.2yO4.pPtVvMrVqO3.rQxR2yOuFJ", "2.2yO4.pFsPuCtOsHtL.qWtQwI2yOxRrN", "2.2yO4.pSsRtVuCvTyOuStQuCvT3yOtV", ".qE2yOqH3.pDtVtLsWtQyGuKtVuIvW3yOuN", ".sR2yOwDrXqErQtJqOqMpPpKJsRtLuKwQ3yOtO", "OuF2yOxEuItLtJtLqC5.tGvByG3yOrA", "pDvO2yOyDvMuItTtD6.uAxJ3yOvO", "OvR3yOxEvJuNtT6.yG2yOyBvRqH", ".tV4yOxRwSwDvG3.pD3yOxRsMpK", ".pXxE13yOqH", "2.rSxP9yOvR", "3.rAvTyByIxRxHuUrG", "4.JqTsHsCqH")
	}
], Ge = "orbium-unicaudatus", Ke = [{
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
}], qe = new Map(We.map((e) => [e.id, e])), Je = new Map(Ke.map((e) => [e.id, e]));
function Ye(e) {
	return qe.get(e) ?? We[0];
}
function Xe(e) {
	return Je.get(e) ?? Ke[0];
}
//#endregion
//#region src/BlueNoiseLenia.tsx
var Ze = 1e3 / 60, Qe = 250, $e = [
	0,
	0,
	0,
	1
], et = [
	1,
	1,
	1,
	1
], $, tt = /* @__PURE__ */ new WeakMap();
function nt(e, t) {
	let n = tt.get(e);
	n || (n = /* @__PURE__ */ new Map(), tt.set(e, n));
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
function rt(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function it(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function at(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: it(e, 900),
		height: it(t, 600)
	};
	if (e !== void 0) {
		let t = it(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = it(t, 600);
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
function ot(e) {
	let t = e.trim();
	if (!$) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, $ = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!$) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	$.fillStyle = "#010203", $.fillStyle = t;
	let n = $.fillStyle;
	if ($.fillStyle = "#040506", $.fillStyle = t, !t || $.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	$.clearRect(0, 0, 1, 1), $.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = $.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function st(e) {
	return typeof e == "string" ? ot(e) : [
		rt(e[0], 0, 1, 0),
		rt(e[1], 0, 1, 0),
		rt(e[2], 0, 1, 0),
		rt(e[3] ?? 1, 0, 1, 1)
	];
}
function ct(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function lt(e) {
	e?.parameters.destroy(), e?.pattern.destroy(), e?.initialState.destroy(), e?.stateA.destroy(), e?.stateB.destroy();
}
function ut({ width: o, height: s, pixelScale: c = 2, patternSize: l = 64, simulationSize: u = 256, species: d = Ge, preset: f, position: p, spatialScale: m = 1, dither: g = !0, interactionRadius: _ = .05, contrast: v = 1, invert: y = !1, seed: b = 1592594996, dark: x = $e, light: S = et, powerPreference: C = "high-performance", onReady: w, onError: T, ref: E, style: D, "aria-label": O = "Interactive blue-noise Lenia automaton", ...k }) {
	let A = r(null), j = r({
		x: .5,
		y: .5,
		lastMoveTime: -Infinity
	}), M = r(w), N = r(T), [P, F] = i(), [I, L] = i("loading"), R = at(o, s), z = ct(x), B = ct(S);
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
	let ee = e((e) => {
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
			j.current.x = rt((t.clientX - n.left) / n.width, 0, 1, .5), j.current.y = rt((t.clientY - n.top) / n.height, 0, 1, .5), j.current.lastMoveTime = performance.now();
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
			t || (t = !0, n && cancelAnimationFrame(n), lt(r), r = void 0, L("error"), N.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = H.current, o = a.preset ? Xe(a.preset) : void 0, s = Ye(o?.species ?? a.species), c = ze(a.spatialScale), l = Math.round(rt(a.simulationSize, 64, 384, 256)), u = Math.round(rt(a.patternSize, 8, 128, 64)), d = V.current ?? {
				width: e.width,
				height: e.height,
				cssWidth: e.clientWidth || U.current.width,
				cssHeight: e.clientHeight || U.current.height,
				devicePixelRatio: window.devicePixelRatio || 1
			}, f = d.cssWidth / d.cssHeight, p = f >= 1 ? l : Math.max(24, Math.round(l * f)), m = f >= 1 ? Math.max(24, Math.round(l / f)) : l, g = Math.ceil(d.cssWidth / Math.max(1, Math.round(a.pixelScale))), _ = Math.ceil(d.cssHeight / Math.max(1, Math.round(a.pixelScale))), v = G(u, a.seed), y = await h(a.powerPreference);
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
			let C = await nt(y, S);
			if (t) return;
			let w = y.createBuffer({
				label: "Lenia parameters",
				size: 128,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), T = y.createBuffer({
				label: "Tileable blue-noise ranks",
				size: 65536,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), E = He(p, m, s, a.seed, o, a.position, c), D = y.createBuffer({
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
			}), ee = (e, t, n) => y.createBindGroup({
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
			}), W = B("Initialize Lenia state", R, z), K = [B("Step Lenia A to B", R, z), B("Step Lenia B to A", z, R)], q = [ee("Display Lenia state A", R, z), ee("Display Lenia state B", z, R)], J = y.createCommandEncoder({ label: "Initialize Lenia" }), Y = J.beginComputePass();
			Y.setPipeline(C.initialize), Y.setBindGroup(0, W), Y.dispatchWorkgroups(Math.ceil(p / 8), Math.ceil(m / 8)), Y.end(), y.queue.submit([J.finish()]);
			let X = {
				key: `${a.darkDependency}|${a.lightDependency}`,
				dark: st(a.dark),
				light: st(a.light)
			}, te = performance.now(), ne = te - Ze, re = te - Qe, ie = !1, ae = 1, oe = (e, t) => {
				let n = ae === 0 ? R : z, i = y.createTexture({
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
				u.setPipeline(C.resample), u.setBindGroup(0, c), u.dispatchWorkgroups(Math.ceil(e / 8), Math.ceil(t / 8)), u.end(), y.queue.submit([l.finish()]), k.destroy(), A.destroy(), k = i, A = a, R = o, z = s, r && (r.stateA = i, r.stateB = a), p = e, m = t, K = [B("Step Lenia A to B", R, z), B("Step Lenia B to A", z, R)], q = [ee("Display Lenia state A", R, z), ee("Display Lenia state B", z, R)], ae = 0;
			}, se = (r) => {
				if (t) return;
				let a = r - ne;
				if (a < Ze) {
					n = requestAnimationFrame(se);
					return;
				}
				ne = r - a % Ze;
				let o = r - re, s = o >= Qe, c = Math.min(1, o / Qe);
				s && (re = r - o % Qe, c = 0);
				try {
					let r = H.current, a = V.current;
					if (a && a.cssWidth > 0 && a.cssHeight > 0) {
						let e = a.cssWidth / a.cssHeight, t = e >= 1 ? l : Math.max(24, Math.round(l * e)), n = e >= 1 ? Math.max(24, Math.round(l / e)) : l;
						(t !== p || n !== m) && oe(t, n);
					}
					let o = Math.round(rt(r.patternSize, 8, 128, 64));
					o !== u && (u = o, F.setUint32(72, u, !0), y.queue.writeBuffer(T, 0, G(o, r.seed)));
					let f = j.current, h = performance.now() - f.lastMoveTime < 120;
					if (F.setFloat32(16, f.x, !0), F.setFloat32(20, f.y, !0), F.setFloat32(24, +!!h, !0), F.setFloat32(28, rt(r.interactionRadius, .005, .3, .05), !0), F.setFloat32(32, c, !0), a) {
						let e = Math.max(1, Math.round(r.pixelScale));
						g = Math.ceil(a.cssWidth / e), _ = Math.ceil(a.cssHeight / e), F.setFloat32(64, e * a.width / a.cssWidth, !0), F.setFloat32(68, e * a.height / a.cssHeight, !0);
					}
					F.setUint32(56, g, !0), F.setUint32(60, _, !0), F.setUint32(72, u, !0), F.setFloat32(44, rt(r.contrast, .25, 8, 1), !0), F.setUint32(48, +!!r.invert, !0), F.setUint32(76, I | (r.dither ? 0 : 1024), !0);
					let v = `${r.darkDependency}|${r.lightDependency}`;
					X.key !== v && (X = {
						key: v,
						dark: st(r.dark),
						light: st(r.light)
					});
					let b = new Float32Array(P, 80, 8);
					b.set(X.dark, 0), b.set(X.light, 4), y.queue.writeBuffer(w, 0, P);
					let S = y.createCommandEncoder({ label: "Lenia frame" });
					if (s) {
						let e = S.beginComputePass({ label: "Step Lenia automaton" });
						e.setPipeline(C.step), e.setBindGroup(0, K[ae]), e.dispatchWorkgroups(Math.ceil(p / 8), Math.ceil(m / 8)), e.end(), ae = 1 - ae;
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
					E.setPipeline(C.display), E.setBindGroup(0, q[ae]), E.draw(3), E.end(), y.queue.submit([S.finish()]), ie || (ie = !0, y.queue.onSubmittedWorkDone().then(() => {
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
					}, i)), n = requestAnimationFrame(se);
				} catch (e) {
					i(e);
				}
			};
			se(performance.now());
		})().catch(i), () => {
			t = !0, n && cancelAnimationFrame(n), lt(r);
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
		ref: ee,
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
export { Te as BlueNoiseFluid, Fe as BlueNoiseInk, ut as BlueNoiseLenia, De as BlueNoisePaint, le as BlueNoiseWave, Ge as DEFAULT_LENIA_SPECIES, F as FloydSteinberg, Ke as LENIA_SCENE_PRESETS, We as LENIA_SPECIES_PRESETS, s as displayShader, o as floydSteinbergShader, Xe as getLeniaScenePreset, Ye as getLeniaSpeciesPreset, S as isWebGpuSupported };
