import { forwardRef as e, useCallback as t, useEffect as n, useRef as r, useState as i } from "react";
import { jsx as a } from "react/jsx-runtime";
//#region src/shaders.ts
var o = "\nstruct Parameters {\n  outputSize: vec2u,\n  sourceSize: vec2u,\n  fit: u32,\n  invert: u32,\n  threshold: f32,\n  randomness: f32,\n  seed: u32,\n  alphaBackground: f32,\n  padding0: u32,\n  padding1: u32,\n}\n\nstruct Band {\n  firstRow: u32,\n  rowCount: u32,\n  padding0: u32,\n  padding1: u32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read_write> outputBits: array<u32>;\n@group(0) @binding(2) var<storage, read_write> errorBuffer: array<f32>;\n@group(0) @binding(3) var<uniform> band: Band;\n@group(0) @binding(4) var sourceTexture: texture_2d<f32>;\n\nfn hashValue(cell: vec2u, seed: u32) -> f32 {\n  var value = cell.x * 0x9e3779b9u + cell.y * 0x85ebca6bu + seed;\n  value = (value ^ (value >> 16u)) * 0x7feb352du;\n  value = (value ^ (value >> 15u)) * 0x846ca68bu;\n  value = value ^ (value >> 16u);\n  return f32(value) / 4294967295.0;\n}\n\nfn fittedUv(cell: vec2u) -> vec3f {\n  let outputSize = vec2f(parameters.outputSize);\n  let sourceSize = vec2f(parameters.sourceSize);\n  let outputAspect = outputSize.x / outputSize.y;\n  let sourceAspect = sourceSize.x / sourceSize.y;\n  var uv = (vec2f(cell) + vec2f(0.5)) / outputSize;\n\n  if (parameters.fit == 1u) {\n    // Cover: crop the longer source axis.\n    if (sourceAspect > outputAspect) {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    } else {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    }\n  } else if (parameters.fit == 2u) {\n    // Contain: map the letterboxed output area outside the source UV range.\n    if (sourceAspect > outputAspect) {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    } else {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    }\n  }\n\n  let inside = select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));\n  return vec3f(uv, inside);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let fitted = fittedUv(cell);\n  var luminance = parameters.alphaBackground;\n\n  if (fitted.z > 0.5) {\n    let maxPosition = vec2i(parameters.sourceSize) - vec2i(1);\n    let position = clamp(vec2i(fitted.xy * vec2f(parameters.sourceSize)), vec2i(0), maxPosition);\n    let color = textureLoad(sourceTexture, position, 0);\n    let imageLuminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));\n    luminance = mix(parameters.alphaBackground, imageLuminance, color.a);\n  }\n\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@compute @workgroup_size(256)\nfn main(@builtin(local_invocation_index) localRow: u32) {\n  let row = band.firstRow + localRow;\n  let activeRow = localRow < band.rowCount && row < parameters.outputSize.y;\n  var phaseCount = parameters.outputSize.x;\n  if (band.rowCount > 0u) {\n    phaseCount += 3u * (band.rowCount - 1u);\n  }\n\n  for (var phase = 0u; phase < phaseCount; phase += 1u) {\n    let rowDelay = 3u * localRow;\n    if (activeRow && phase >= rowDelay) {\n      let x = phase - rowDelay;\n      if (x < parameters.outputSize.x) {\n        let cell = vec2u(x, row);\n        let index = row * parameters.outputSize.x + x;\n        let value = clamp(sourceValue(cell) + errorBuffer[index], 0.0, 1.0);\n        let bit = select(0u, 1u, value >= parameters.threshold);\n        let error = value - f32(bit);\n        outputBits[index] = bit;\n\n        let r1 = (hashValue(cell, parameters.seed) * 2.0 - 1.0) * (5.0 / 16.0);\n        let r2 = (hashValue(cell, parameters.seed ^ 0xa511e9b3u) * 2.0 - 1.0) * (1.0 / 16.0);\n        let rightWeight = 7.0 / 16.0 + parameters.randomness * r1;\n        let downWeight = 5.0 / 16.0 - parameters.randomness * r1;\n        let downLeftWeight = 3.0 / 16.0 + parameters.randomness * r2;\n        let downRightWeight = 1.0 / 16.0 - parameters.randomness * r2;\n\n        if (x + 1u < parameters.outputSize.x) {\n          errorBuffer[index + 1u] += error * rightWeight;\n        }\n        if (row + 1u < parameters.outputSize.y) {\n          let below = index + parameters.outputSize.x;\n          if (x > 0u) {\n            errorBuffer[below - 1u] += error * downLeftWeight;\n          }\n          errorBuffer[below] += error * downWeight;\n          if (x + 1u < parameters.outputSize.x) {\n            errorBuffer[below + 1u] += error * downRightWeight;\n          }\n        }\n      }\n    }\n    storageBarrier();\n  }\n}\n", s = "\nstruct DisplayParameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: DisplayParameters;\n@group(0) @binding(1) var<storage, read> outputBits: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let bit = outputBits[cell.y * safeLogicalSize.x + cell.x];\n  return select(parameters.dark, parameters.light, bit != 0u);\n}\n", c = "\nstruct Parameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  patternArea: u32,\n  invert: u32,\n  time: f32,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let size = max(vec2f(parameters.logicalSize), vec2f(1.0));\n  var point = (vec2f(cell) + vec2f(0.5)) / size - vec2f(0.5);\n  point.x *= size.x / size.y;\n\n  let time = parameters.time * 0.5;\n  let broadWave = sin(point.x * 5.0 + point.y * 2.2 - time * 0.75);\n  let crossWave = sin(point.y * 6.0 - point.x * 2.6 + time * 0.48);\n  let driftingGlow = cos(distance(point, vec2f(sin(time * 0.19) * 0.3, cos(time * 0.16) * 0.2)) * 6.0 - time * 0.32);\n  let rawLuminance = clamp(0.5 + broadWave * 0.2 + crossWave * 0.11 + driftingGlow * 0.14, 0.0, 1.0);\n  let luminance = smoothstep(0.32, 0.68, rawLuminance);\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternArea);\n  return select(parameters.dark, parameters.light, sourceValue(cell) >= threshold);\n}\n", l;
function u() {
	return typeof navigator < "u" && "gpu" in navigator;
}
async function d(e) {
	if (!u()) throw Error("WebGPU is not available in this browser.");
	return l ||= navigator.gpu.requestAdapter({ powerPreference: e }).then(async (e) => {
		if (!e) throw Error("No compatible WebGPU adapter was found.");
		let t = await e.requestDevice();
		return t.lost.then(() => {
			l = void 0;
		}), t;
	}), l;
}
async function f(e, t, n) {
	let r = e.createShaderModule({
		label: t,
		code: n
	}), i = (await r.getCompilationInfo()).messages.filter((e) => e.type === "error");
	if (i.length > 0) throw Error(i.map((e) => `${t}: ${e.message}`).join("\n"));
	return r;
}
//#endregion
//#region src/FloydSteinberg.tsx
var p = 256, m = [
	0,
	0,
	0,
	1
], h = [
	1,
	1,
	1,
	1
], g, _ = /* @__PURE__ */ new WeakMap();
function v() {
	return u();
}
function y(e, t) {
	let n = _.get(e);
	n || (n = /* @__PURE__ */ new Map(), _.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([f(e, "Stochastic Floyd–Steinberg WGSL", o), f(e, "Floyd–Steinberg display WGSL", s)]), i = e.createBindGroupLayout({
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
function b(e) {
	return typeof HTMLImageElement < "u" && e instanceof HTMLImageElement ? {
		width: e.naturalWidth,
		height: e.naturalHeight
	} : {
		width: e.width,
		height: e.height
	};
}
async function x(e, t) {
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
	let { width: n, height: r } = b(e);
	return {
		source: e,
		width: n,
		height: r
	};
}
function S(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function C(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function w(e, t, n, r) {
	if (n !== void 0 && r !== void 0) return {
		width: C(n, e),
		height: C(r, t)
	};
	if (n !== void 0) {
		let r = C(n, e);
		return {
			width: r,
			height: C(r * t / e, t)
		};
	}
	if (r !== void 0) {
		let n = C(r, t);
		return {
			width: C(n * e / t, e),
			height: n
		};
	}
	return {
		width: C(e, 1),
		height: C(t, 1)
	};
}
function T(e) {
	let t = e.trim();
	if (!g) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, g = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!g) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	g.fillStyle = "#010203", g.fillStyle = t;
	let n = g.fillStyle;
	if (g.fillStyle = "#040506", g.fillStyle = t, !t || g.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	g.clearRect(0, 0, 1, 1), g.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = g.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function E(e) {
	return typeof e == "string" ? T(e) : [
		S(e[0], 0, 1, 0),
		S(e[1], 0, 1, 0),
		S(e[2], 0, 1, 0),
		S(e[3] ?? 1, 0, 1, 1)
	];
}
function D(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function O(e) {
	e && (e.output.destroy(), e.errors.destroy(), e.computeParameters.destroy(), e.displayParameters.destroy(), e.bandParameters.destroy(), e.sourceTexture.destroy());
}
function k(e, t, n) {
	let r = /* @__PURE__ */ new ArrayBuffer(48), i = new DataView(r);
	i.setUint32(0, n.logicalWidth, !0), i.setUint32(4, n.logicalHeight, !0), i.setUint32(8, n.sourceWidth, !0), i.setUint32(12, n.sourceHeight, !0), i.setUint32(16, {
		stretch: 0,
		cover: 1,
		contain: 2
	}[n.fit], !0), i.setUint32(20, +!!n.invert, !0), i.setFloat32(24, n.threshold, !0), i.setFloat32(28, n.randomness, !0), i.setUint32(32, n.seed >>> 0, !0), i.setFloat32(36, n.alphaBackground, !0), e.queue.writeBuffer(t, 0, r);
}
function A(e, t, n, r, i, a, o, s) {
	let c = /* @__PURE__ */ new ArrayBuffer(48), l = new DataView(c);
	l.setUint32(0, n, !0), l.setUint32(4, r, !0), l.setFloat32(8, i, !0), l.setFloat32(12, a, !0);
	let u = new Float32Array(c, 16, 8);
	u.set(E(o), 0), u.set(E(s), 4), e.queue.writeBuffer(t, 0, c);
}
function j(e, t) {
	typeof e == "function" ? e(t) : e && (e.current = t);
}
var M = e(function({ src: e, width: o, height: s, pixelScale: c = 1, randomness: l = .35, threshold: u = .5, fit: f = "contain", invert: g = !1, seed: _ = 1592594996, alphaBackground: v = 1, dark: b = m, light: T = h, crossOrigin: E = "anonymous", powerPreference: M = "high-performance", onReady: N, onError: P, "aria-label": F = "Floyd–Steinberg dithered image", ...I }, L) {
	let R = r(null), z = r(N), B = r(P), [V, H] = i(), [U, W] = i(), G = D(b), K = D(T);
	z.current = N, B.current = P;
	let [q, J] = i("loading"), Y = t((e) => {
		R.current = e, j(L, e);
	}, [L]);
	n(() => {
		let t = !1;
		return J("loading"), H(void 0), W(void 0), x(e, E).then((e) => {
			if (t) {
				e.dispose?.();
				return;
			}
			if (e.width < 1 || e.height < 1) throw e.dispose?.(), Error("The source image has no drawable pixels.");
			H(e);
		}).catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			J("error"), B.current?.(n);
		}), () => {
			t = !0;
		};
	}, [e, E]);
	let X = V ? w(V.width, V.height, o, s) : {
		width: C(o, 300),
		height: C(s, 150)
	};
	return n(() => {
		W(void 0);
	}, [o, s]), n(() => {
		let e = R.current;
		if (!e || !V) return;
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
			W((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
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
		V,
		X.width,
		X.height
	]), n(() => {
		let e = R.current;
		if (!e || !V || !U) return;
		let t = !1, n;
		return J("loading"), (async () => {
			let r = C(c, 1), i = Math.ceil(U.cssWidth / r), a = Math.ceil(U.cssHeight / r), o = r * U.width / U.cssWidth, s = r * U.height / U.cssHeight, m = await d(M);
			if (t) return;
			let h = m.limits.maxTextureDimension2D;
			if (V.width > h || V.height > h || U.width > h || U.height > h) throw Error(`The source or output exceeds this device's ${h}px texture limit.`);
			let x = Math.max(4, i * a * 4);
			if (x > m.limits.maxStorageBufferBindingSize) throw Error("The requested output exceeds this device's storage-buffer limit. Increase pixelScale.");
			let w = e.getContext("webgpu");
			if (!w) throw Error("The canvas could not create a WebGPU context.");
			let E = navigator.gpu.getPreferredCanvasFormat();
			w.configure({
				device: m,
				format: E,
				alphaMode: "premultiplied"
			});
			let D = await y(m, E);
			if (t) return;
			let O = m.createBuffer({
				label: "Floyd–Steinberg output",
				size: x,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), j = m.createBuffer({
				label: "Floyd–Steinberg errors",
				size: x,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), N = m.createBuffer({
				label: "Floyd–Steinberg parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), P = m.createBuffer({
				label: "Floyd–Steinberg display parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), F = Math.ceil(a / p), I = m.limits.minUniformBufferOffsetAlignment, L = new ArrayBuffer(I * F), R = new DataView(L);
			for (let e = 0; e < F; e += 1) {
				let t = e * p;
				R.setUint32(e * I, t, !0), R.setUint32(e * I + 4, Math.min(p, a - t), !0);
			}
			let B = m.createBuffer({
				label: "Floyd–Steinberg band parameters",
				size: L.byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), H = m.createTexture({
				label: "Floyd–Steinberg source image",
				size: [V.width, V.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
			});
			n = {
				output: O,
				errors: j,
				computeParameters: N,
				displayParameters: P,
				bandParameters: B,
				sourceTexture: H
			}, m.queue.copyExternalImageToTexture({ source: V.source }, { texture: H }, [V.width, V.height]), m.queue.writeBuffer(B, 0, L), k(m, N, {
				logicalWidth: i,
				logicalHeight: a,
				sourceWidth: V.width,
				sourceHeight: V.height,
				fit: f,
				invert: g,
				threshold: S(u, 0, 1, .5),
				randomness: S(l, 0, 2, .35),
				seed: _,
				alphaBackground: S(v, 0, 1, 1)
			}), A(m, P, i, a, o, s, b, T);
			let W = m.createBindGroup({
				label: "Floyd–Steinberg compute bind group",
				layout: D.computeLayout,
				entries: [
					{
						binding: 0,
						resource: { buffer: N }
					},
					{
						binding: 1,
						resource: { buffer: O }
					},
					{
						binding: 2,
						resource: { buffer: j }
					},
					{
						binding: 3,
						resource: {
							buffer: B,
							size: 16
						}
					},
					{
						binding: 4,
						resource: H.createView()
					}
				]
			}), G = m.createBindGroup({
				label: "Floyd–Steinberg display bind group",
				layout: D.display.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: P }
				}, {
					binding: 1,
					resource: { buffer: O }
				}]
			}), K = m.createCommandEncoder({ label: "Floyd–Steinberg render" });
			K.clearBuffer(j);
			for (let e = 0; e < F; e += 1) {
				let t = K.beginComputePass({ label: `Floyd–Steinberg band ${e}` });
				t.setPipeline(D.compute), t.setBindGroup(0, W, [e * I]), t.dispatchWorkgroups(1), t.end();
			}
			let q = K.beginRenderPass({
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
			q.setPipeline(D.display), q.setBindGroup(0, G), q.draw(3), q.end(), m.queue.submit([K.finish()]), await m.queue.onSubmittedWorkDone(), !t && (J("ready"), z.current?.({
				canvas: e,
				device: m,
				...U,
				logicalWidth: i,
				logicalHeight: a
			}));
		})().catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			J("error"), B.current?.(n);
		}), () => {
			t = !0, O(n);
		};
	}, [
		V,
		U,
		c,
		l,
		u,
		f,
		g,
		_,
		v,
		G,
		K,
		M
	]), n(() => () => {
		V?.dispose?.();
	}, [V]), /* @__PURE__ */ a("canvas", {
		...I,
		ref: Y,
		width: U?.width ?? X.width,
		height: U?.height ?? X.height,
		"aria-label": F,
		"data-webgpu-status": q
	});
}), N = /* @__PURE__ */ new Map(), P = 8, F = 6;
function I(e, t) {
	let n = new Float64Array(e), r = t >>> 0 || 1;
	for (let t = 0; t < e; t += 1) r ^= r << 13, r ^= r >>> 17, r ^= r << 5, n[t] = (r >>> 0) / 4294967296;
	return n;
}
function L(e, t) {
	let n = new Float64Array(t * 2 + 1), r = 0;
	for (let i = -t; i <= t; i += 1) {
		let a = Math.exp(-(i * i) / (2 * e * e));
		n[i + t] = a, r += a;
	}
	for (let e = 0; e < n.length; e += 1) n[e] /= r;
	return n;
}
function R(e, t, n, r, i) {
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
function z(e, t, n, r) {
	let i = (r.length - 1) / 2, a = e % n, o = Math.floor(e / n), s = t % n, c = Math.floor(t / n), l = Math.min(Math.abs(a - s), n - Math.abs(a - s)), u = Math.min(Math.abs(o - c), n - Math.abs(o - c));
	return l > i || u > i ? 0 : r[i + l] * r[i + u];
}
function B(e, t, n, r) {
	let i = t % n, a = Math.floor(t / n);
	for (let t = -r; t <= r; t += 1) for (let o = -r; o <= r; o += 1) {
		let r = (i + o + n) % n, s = (a + t + n) % n;
		e[s * n + r] = 1;
	}
}
function V(e, t, n, r, i) {
	let a = e.length, o = r / a, s = o <= .5, c = Math.min(o, 1 - o), l = Math.min(2.25, Math.max(.8, .38 / Math.sqrt(c))), u = Math.min(7, Math.floor((t - 1) / 2), Math.ceil(l * 3)), d = L(l, u), f = d[u] * d[u], p = Math.max(1, Math.floor(Math.min(r - n, i - r) / 64));
	for (let o = 0; o < P; o += 1) {
		let o = R(e, t, r, s, d), c = [], l = [];
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
			if (o[r] - z(n, r, t, d) >= i) break;
			let a = e[n];
			e[n] = e[r], e[r] = a, B(m, n, t, u), B(m, r, t, u), _ += 1;
		}
		if (_ === 0) break;
	}
}
function H(e, t) {
	let n = e.length, r = Math.min(F, Math.floor(Math.log2(t)));
	for (let i = 1; i <= r; i += 1) {
		let r = 2 ** i;
		for (let i = 1; i < r; i += 2) V(e, t, Math.floor((i - 1) * n / r), Math.floor(i * n / r), Math.floor((i + 1) * n / r));
	}
}
function U(e, t) {
	let n = `${e}:${t >>> 0}`, r = N.get(n);
	if (r) return r;
	let i = e * e, a = I(i, t), o = new Float64Array(i), s = new Float64Array(i), c = [
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
	return H(u, e), N.set(n, u), u;
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
	return r || (r = f(e, "Blue-noise wave WGSL", c).then((n) => e.createRenderPipeline({
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
function Z(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function ee(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: Z(e, 900),
		height: Z(t, 600)
	};
	if (e !== void 0) {
		let t = Z(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = Z(t, 600);
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
function te(e) {
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
function Q(e) {
	return typeof e == "string" ? te(e) : [
		X(e[0], 0, 1, 0),
		X(e[1], 0, 1, 0),
		X(e[2], 0, 1, 0),
		X(e[3] ?? 1, 0, 1, 1)
	];
}
function $(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function ne(e) {
	e?.parameters.destroy(), e?.pattern.destroy();
}
function re(e, t) {
	typeof e == "function" ? e(t) : e && (e.current = t);
}
var ie = e(function({ width: e, height: o, pixelScale: s = 2, patternSize: c = 64, invert: l = !1, seed: u = 1592594996, dark: f = G, light: p = K, powerPreference: m = "high-performance", onReady: h, onError: g, "aria-label": _ = "Blue-noise dithered wave", ...v }, y) {
	let b = r(null), x = r(h), S = r(g), [C, w] = i(), [T, E] = i("loading"), D = ee(e, o), O = $(f), k = $(p);
	x.current = h, S.current = g;
	let A = t((e) => {
		b.current = e, re(y, e);
	}, [y]);
	return n(() => {
		w(void 0);
	}, [e, o]), n(() => {
		let e = b.current;
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
			w((e) => e && e.width === a.width && e.height === a.height && e.cssWidth === a.cssWidth && e.cssHeight === a.cssHeight && e.devicePixelRatio === a.devicePixelRatio ? e : a);
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
	}, [D.width, D.height]), n(() => {
		let e = b.current;
		if (!e || !C) return;
		let t = !1, n = 0, r;
		E("loading");
		let i = (e) => {
			t || (t = !0, n && cancelAnimationFrame(n), ne(r), r = void 0, E("error"), S.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = Z(s, 1), o = Math.round(X(c, 8, 128, 64)), h = Math.ceil(C.cssWidth / a), g = Math.ceil(C.cssHeight / a), _ = a * C.width / C.cssWidth, v = a * C.height / C.cssHeight, y = U(o, u), b = await d(m);
			if (t) return;
			let S = b.limits.maxTextureDimension2D;
			if (C.width > S || C.height > S) throw Error(`The output exceeds this device's ${S}px texture limit.`);
			if (y.byteLength > b.limits.maxStorageBufferBindingSize) throw Error("The blue-noise pattern exceeds this device's storage-buffer limit.");
			let w = e.getContext("webgpu");
			if (!w) throw Error("The canvas could not create a WebGPU context.");
			let T = navigator.gpu.getPreferredCanvasFormat();
			w.configure({
				device: b,
				format: T,
				alphaMode: "premultiplied"
			});
			let D = await Y(b, T);
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
			j.setUint32(0, h, !0), j.setUint32(4, g, !0), j.setFloat32(8, _, !0), j.setFloat32(12, v, !0), j.setUint32(16, o, !0), j.setUint32(20, o * o, !0), j.setUint32(24, +!!l, !0);
			let M = new Float32Array(A, 32, 8);
			M.set(Q(f), 0), M.set(Q(p), 4);
			let N = b.createBindGroup({
				label: "Blue-noise wave bind group",
				layout: D.getBindGroupLayout(0),
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
					o.setPipeline(D), o.setBindGroup(0, N), o.draw(3), o.end(), b.queue.submit([a.finish()]), I || (I = !0, b.queue.onSubmittedWorkDone().then(() => {
						if (t) return;
						E("ready");
						let n = {
							canvas: e,
							device: b,
							...C,
							logicalWidth: h,
							logicalHeight: g
						};
						x.current?.(n);
					}, i)), n = requestAnimationFrame(L);
				} catch (e) {
					i(e);
				}
			};
			n = requestAnimationFrame(L);
		})().catch(i), () => {
			t = !0, n && cancelAnimationFrame(n), ne(r);
		};
	}, [
		C,
		s,
		c,
		l,
		u,
		O,
		k,
		m
	]), /* @__PURE__ */ a("canvas", {
		...v,
		ref: A,
		width: C?.width ?? D.width,
		height: C?.height ?? D.height,
		"aria-label": _,
		"data-webgpu-status": T
	});
});
//#endregion
export { ie as BlueNoiseWave, M as FloydSteinberg, s as displayShader, o as floydSteinbergShader, v as isWebGpuSupported };
