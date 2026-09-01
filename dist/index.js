import { forwardRef as e, useCallback as t, useEffect as n, useLayoutEffect as r, useRef as i, useState as a } from "react";
import { jsx as o } from "react/jsx-runtime";
//#region src/shaders.ts
var s = "\nstruct Parameters {\n  outputSize: vec2u,\n  sourceSize: vec2u,\n  fit: u32,\n  invert: u32,\n  threshold: f32,\n  randomness: f32,\n  seed: u32,\n  alphaBackground: f32,\n  padding0: u32,\n  padding1: u32,\n}\n\nstruct Band {\n  firstRow: u32,\n  rowCount: u32,\n  padding0: u32,\n  padding1: u32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read_write> outputBits: array<u32>;\n@group(0) @binding(2) var<storage, read_write> errorBuffer: array<f32>;\n@group(0) @binding(3) var<uniform> band: Band;\n@group(0) @binding(4) var sourceTexture: texture_2d<f32>;\n\nfn hashValue(cell: vec2u, seed: u32) -> f32 {\n  var value = cell.x * 0x9e3779b9u + cell.y * 0x85ebca6bu + seed;\n  value = (value ^ (value >> 16u)) * 0x7feb352du;\n  value = (value ^ (value >> 15u)) * 0x846ca68bu;\n  value = value ^ (value >> 16u);\n  return f32(value) / 4294967295.0;\n}\n\nfn fittedUv(cell: vec2u) -> vec3f {\n  let outputSize = vec2f(parameters.outputSize);\n  let sourceSize = vec2f(parameters.sourceSize);\n  let outputAspect = outputSize.x / outputSize.y;\n  let sourceAspect = sourceSize.x / sourceSize.y;\n  var uv = (vec2f(cell) + vec2f(0.5)) / outputSize;\n\n  if (parameters.fit == 1u) {\n    // Cover: crop the longer source axis.\n    if (sourceAspect > outputAspect) {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    } else {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    }\n  } else if (parameters.fit == 2u) {\n    // Contain: map the letterboxed output area outside the source UV range.\n    if (sourceAspect > outputAspect) {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    } else {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    }\n  }\n\n  let inside = select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));\n  return vec3f(uv, inside);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let fitted = fittedUv(cell);\n  var luminance = parameters.alphaBackground;\n\n  if (fitted.z > 0.5) {\n    let maxPosition = vec2i(parameters.sourceSize) - vec2i(1);\n    let position = clamp(vec2i(fitted.xy * vec2f(parameters.sourceSize)), vec2i(0), maxPosition);\n    let color = textureLoad(sourceTexture, position, 0);\n    let imageLuminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));\n    luminance = mix(parameters.alphaBackground, imageLuminance, color.a);\n  }\n\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@compute @workgroup_size(256)\nfn main(@builtin(local_invocation_index) localRow: u32) {\n  let row = band.firstRow + localRow;\n  let activeRow = localRow < band.rowCount && row < parameters.outputSize.y;\n  var phaseCount = parameters.outputSize.x;\n  if (band.rowCount > 0u) {\n    phaseCount += 3u * (band.rowCount - 1u);\n  }\n\n  for (var phase = 0u; phase < phaseCount; phase += 1u) {\n    let rowDelay = 3u * localRow;\n    if (activeRow && phase >= rowDelay) {\n      let x = phase - rowDelay;\n      if (x < parameters.outputSize.x) {\n        let cell = vec2u(x, row);\n        let index = row * parameters.outputSize.x + x;\n        let value = clamp(sourceValue(cell) + errorBuffer[index], 0.0, 1.0);\n        let bit = select(0u, 1u, value >= parameters.threshold);\n        let error = value - f32(bit);\n        outputBits[index] = bit;\n\n        let r1 = (hashValue(cell, parameters.seed) * 2.0 - 1.0) * (5.0 / 16.0);\n        let r2 = (hashValue(cell, parameters.seed ^ 0xa511e9b3u) * 2.0 - 1.0) * (1.0 / 16.0);\n        let rightWeight = 7.0 / 16.0 + parameters.randomness * r1;\n        let downWeight = 5.0 / 16.0 - parameters.randomness * r1;\n        let downLeftWeight = 3.0 / 16.0 + parameters.randomness * r2;\n        let downRightWeight = 1.0 / 16.0 - parameters.randomness * r2;\n\n        if (x + 1u < parameters.outputSize.x) {\n          errorBuffer[index + 1u] += error * rightWeight;\n        }\n        if (row + 1u < parameters.outputSize.y) {\n          let below = index + parameters.outputSize.x;\n          if (x > 0u) {\n            errorBuffer[below - 1u] += error * downLeftWeight;\n          }\n          errorBuffer[below] += error * downWeight;\n          if (x + 1u < parameters.outputSize.x) {\n            errorBuffer[below + 1u] += error * downRightWeight;\n          }\n        }\n      }\n    }\n    storageBarrier();\n  }\n}\n", c = "\nstruct DisplayParameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: DisplayParameters;\n@group(0) @binding(1) var<storage, read> outputBits: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let bit = outputBits[cell.y * safeLogicalSize.x + cell.x];\n  return select(parameters.dark, parameters.light, bit != 0u);\n}\n", l = "\nstruct Parameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  patternSize: u32,\n  patternArea: u32,\n  invert: u32,\n  time: f32,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read> noiseRanks: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let size = max(vec2f(parameters.logicalSize), vec2f(1.0));\n  var point = (vec2f(cell) + vec2f(0.5)) / size - vec2f(0.5);\n  point.x *= size.x / size.y;\n\n  let time = parameters.time * 0.5;\n  let broadWave = sin(point.x * 5.0 + point.y * 2.2 - time * 0.75);\n  let crossWave = sin(point.y * 6.0 - point.x * 2.6 + time * 0.48);\n  let driftingGlow = cos(distance(point, vec2f(sin(time * 0.19) * 0.3, cos(time * 0.16) * 0.2)) * 6.0 - time * 0.32);\n  let rawLuminance = clamp(0.5 + broadWave * 0.2 + crossWave * 0.11 + driftingGlow * 0.14, 0.0, 1.0);\n  let luminance = smoothstep(0.32, 0.68, rawLuminance);\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let patternCell = cell % vec2u(parameters.patternSize);\n  let rank = noiseRanks[patternCell.y * parameters.patternSize + patternCell.x];\n  let threshold = (f32(rank) + 0.5) / f32(parameters.patternArea);\n  return select(parameters.dark, parameters.light, sourceValue(cell) >= threshold);\n}\n", u;
function d() {
	return typeof navigator < "u" && "gpu" in navigator;
}
async function f(e) {
	if (!d()) throw Error("WebGPU is not available in this browser.");
	return u ||= navigator.gpu.requestAdapter({ powerPreference: e }).then(async (e) => {
		if (!e) throw Error("No compatible WebGPU adapter was found.");
		let t = await e.requestDevice();
		return t.lost.then(() => {
			u = void 0;
		}), t;
	}), u;
}
async function p(e, t, n) {
	let r = e.createShaderModule({
		label: t,
		code: n
	}), i = (await r.getCompilationInfo()).messages.filter((e) => e.type === "error");
	if (i.length > 0) throw Error(i.map((e) => `${t}: ${e.message}`).join("\n"));
	return r;
}
//#endregion
//#region src/FloydSteinberg.tsx
var m = 256, h = [
	0,
	0,
	0,
	1
], g = [
	1,
	1,
	1,
	1
], _, v = /* @__PURE__ */ new WeakMap();
function y() {
	return d();
}
function b(e, t) {
	let n = v.get(e);
	n || (n = /* @__PURE__ */ new Map(), v.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([p(e, "Stochastic Floyd–Steinberg WGSL", s), p(e, "Floyd–Steinberg display WGSL", c)]), i = e.createBindGroupLayout({
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
function x(e) {
	return typeof HTMLImageElement < "u" && e instanceof HTMLImageElement ? {
		width: e.naturalWidth,
		height: e.naturalHeight
	} : {
		width: e.width,
		height: e.height
	};
}
async function S(e, t) {
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
	let { width: n, height: r } = x(e);
	return {
		source: e,
		width: n,
		height: r
	};
}
function C(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function w(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function T(e, t, n, r) {
	if (n !== void 0 && r !== void 0) return {
		width: w(n, e),
		height: w(r, t)
	};
	if (n !== void 0) {
		let r = w(n, e);
		return {
			width: r,
			height: w(r * t / e, t)
		};
	}
	if (r !== void 0) {
		let n = w(r, t);
		return {
			width: w(n * e / t, e),
			height: n
		};
	}
	return {
		width: w(e, 1),
		height: w(t, 1)
	};
}
function E(e) {
	let t = e.trim();
	if (!_) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, _ = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!_) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	_.fillStyle = "#010203", _.fillStyle = t;
	let n = _.fillStyle;
	if (_.fillStyle = "#040506", _.fillStyle = t, !t || _.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	_.clearRect(0, 0, 1, 1), _.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = _.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function D(e) {
	return typeof e == "string" ? E(e) : [
		C(e[0], 0, 1, 0),
		C(e[1], 0, 1, 0),
		C(e[2], 0, 1, 0),
		C(e[3] ?? 1, 0, 1, 1)
	];
}
function O(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function k(e) {
	e && (e.output.destroy(), e.errors.destroy(), e.computeParameters.destroy(), e.displayParameters.destroy(), e.bandParameters.destroy(), e.sourceTexture.destroy());
}
function A(e, t, n) {
	let r = /* @__PURE__ */ new ArrayBuffer(48), i = new DataView(r);
	i.setUint32(0, n.logicalWidth, !0), i.setUint32(4, n.logicalHeight, !0), i.setUint32(8, n.sourceWidth, !0), i.setUint32(12, n.sourceHeight, !0), i.setUint32(16, {
		stretch: 0,
		cover: 1,
		contain: 2
	}[n.fit], !0), i.setUint32(20, +!!n.invert, !0), i.setFloat32(24, n.threshold, !0), i.setFloat32(28, n.randomness, !0), i.setUint32(32, n.seed >>> 0, !0), i.setFloat32(36, n.alphaBackground, !0), e.queue.writeBuffer(t, 0, r);
}
function j(e, t, n, r, i, a, o, s) {
	let c = /* @__PURE__ */ new ArrayBuffer(48), l = new DataView(c);
	l.setUint32(0, n, !0), l.setUint32(4, r, !0), l.setFloat32(8, i, !0), l.setFloat32(12, a, !0);
	let u = new Float32Array(c, 16, 8);
	u.set(D(o), 0), u.set(D(s), 4), e.queue.writeBuffer(t, 0, c);
}
function M(e, t) {
	typeof e == "function" ? e(t) : e && (e.current = t);
}
var N = e(function({ src: e, width: r, height: s, pixelScale: c = 1, randomness: l = .35, threshold: u = .5, fit: d = "contain", invert: p = !1, seed: _ = 1592594996, alphaBackground: v = 1, dark: y = h, light: x = g, crossOrigin: E = "anonymous", powerPreference: D = "high-performance", onReady: N, onError: P, "aria-label": F = "Floyd–Steinberg dithered image", ...I }, L) {
	let R = i(null), z = i(N), B = i(P), [V, H] = a(), [U, W] = a(), G = O(y), K = O(x);
	z.current = N, B.current = P;
	let [q, J] = a("loading"), Y = t((e) => {
		R.current = e, M(L, e);
	}, [L]);
	n(() => {
		let t = !1;
		return J("loading"), H(void 0), W(void 0), S(e, E).then((e) => {
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
	let X = V ? T(V.width, V.height, r, s) : {
		width: w(r, 300),
		height: w(s, 150)
	};
	return n(() => {
		W(void 0);
	}, [r, s]), n(() => {
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
			let r = w(c, 1), i = Math.ceil(U.cssWidth / r), a = Math.ceil(U.cssHeight / r), o = r * U.width / U.cssWidth, s = r * U.height / U.cssHeight, h = await f(D);
			if (t) return;
			let g = h.limits.maxTextureDimension2D;
			if (V.width > g || V.height > g || U.width > g || U.height > g) throw Error(`The source or output exceeds this device's ${g}px texture limit.`);
			let S = Math.max(4, i * a * 4);
			if (S > h.limits.maxStorageBufferBindingSize) throw Error("The requested output exceeds this device's storage-buffer limit. Increase pixelScale.");
			let T = e.getContext("webgpu");
			if (!T) throw Error("The canvas could not create a WebGPU context.");
			let E = navigator.gpu.getPreferredCanvasFormat();
			T.configure({
				device: h,
				format: E,
				alphaMode: "premultiplied"
			});
			let O = await b(h, E);
			if (t) return;
			let k = h.createBuffer({
				label: "Floyd–Steinberg output",
				size: S,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), M = h.createBuffer({
				label: "Floyd–Steinberg errors",
				size: S,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), N = h.createBuffer({
				label: "Floyd–Steinberg parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), P = h.createBuffer({
				label: "Floyd–Steinberg display parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), F = Math.ceil(a / m), I = h.limits.minUniformBufferOffsetAlignment, L = new ArrayBuffer(I * F), R = new DataView(L);
			for (let e = 0; e < F; e += 1) {
				let t = e * m;
				R.setUint32(e * I, t, !0), R.setUint32(e * I + 4, Math.min(m, a - t), !0);
			}
			let B = h.createBuffer({
				label: "Floyd–Steinberg band parameters",
				size: L.byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), H = h.createTexture({
				label: "Floyd–Steinberg source image",
				size: [V.width, V.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
			});
			n = {
				output: k,
				errors: M,
				computeParameters: N,
				displayParameters: P,
				bandParameters: B,
				sourceTexture: H
			}, h.queue.copyExternalImageToTexture({ source: V.source }, { texture: H }, [V.width, V.height]), h.queue.writeBuffer(B, 0, L), A(h, N, {
				logicalWidth: i,
				logicalHeight: a,
				sourceWidth: V.width,
				sourceHeight: V.height,
				fit: d,
				invert: p,
				threshold: C(u, 0, 1, .5),
				randomness: C(l, 0, 2, .35),
				seed: _,
				alphaBackground: C(v, 0, 1, 1)
			}), j(h, P, i, a, o, s, y, x);
			let W = h.createBindGroup({
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
						resource: { buffer: M }
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
			}), G = h.createBindGroup({
				label: "Floyd–Steinberg display bind group",
				layout: O.display.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: P }
				}, {
					binding: 1,
					resource: { buffer: k }
				}]
			}), K = h.createCommandEncoder({ label: "Floyd–Steinberg render" });
			K.clearBuffer(M);
			for (let e = 0; e < F; e += 1) {
				let t = K.beginComputePass({ label: `Floyd–Steinberg band ${e}` });
				t.setPipeline(O.compute), t.setBindGroup(0, W, [e * I]), t.dispatchWorkgroups(1), t.end();
			}
			let q = K.beginRenderPass({
				label: "Floyd–Steinberg display pass",
				colorAttachments: [{
					view: T.getCurrentTexture().createView(),
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
			q.setPipeline(O.display), q.setBindGroup(0, G), q.draw(3), q.end(), h.queue.submit([K.finish()]), await h.queue.onSubmittedWorkDone(), !t && (J("ready"), z.current?.({
				canvas: e,
				device: h,
				...U,
				logicalWidth: i,
				logicalHeight: a
			}));
		})().catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			J("error"), B.current?.(n);
		}), () => {
			t = !0, k(n);
		};
	}, [
		V,
		U,
		c,
		l,
		u,
		d,
		p,
		_,
		v,
		G,
		K,
		D
	]), n(() => () => {
		V?.dispose?.();
	}, [V]), /* @__PURE__ */ o("canvas", {
		...I,
		ref: Y,
		width: U?.width ?? X.width,
		height: U?.height ?? X.height,
		"aria-label": F,
		"data-webgpu-status": q
	});
}), P = /* @__PURE__ */ new Map(), F = 8, I = 6;
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
function W(e, t) {
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
var G = 1e3 / 60, K = [
	0,
	0,
	0,
	1
], q = [
	1,
	1,
	1,
	1
], J, Y = /* @__PURE__ */ new WeakMap();
function X(e, t) {
	let n = Y.get(e);
	n || (n = /* @__PURE__ */ new Map(), Y.set(e, n));
	let r = n.get(t);
	return r || (r = p(e, "Blue-noise wave WGSL", l).then((n) => e.createRenderPipeline({
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
function Z(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function Q(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function ee(e, t) {
	if (e !== void 0 && t !== void 0) return {
		width: Q(e, 900),
		height: Q(t, 600)
	};
	if (e !== void 0) {
		let t = Q(e, 900);
		return {
			width: t,
			height: Math.max(1, Math.round(t * 2 / 3))
		};
	}
	if (t !== void 0) {
		let e = Q(t, 600);
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
	if (!J) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, J = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!J) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	J.fillStyle = "#010203", J.fillStyle = t;
	let n = J.fillStyle;
	if (J.fillStyle = "#040506", J.fillStyle = t, !t || J.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	J.clearRect(0, 0, 1, 1), J.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = J.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function $(e) {
	return typeof e == "string" ? te(e) : [
		Z(e[0], 0, 1, 0),
		Z(e[1], 0, 1, 0),
		Z(e[2], 0, 1, 0),
		Z(e[3] ?? 1, 0, 1, 1)
	];
}
function ne(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function re(e) {
	e?.parameters.destroy(), e?.pattern.destroy();
}
function ie(e, t) {
	typeof e == "function" ? e(t) : e && (e.current = t);
}
var ae = e(function({ width: e, height: s, pixelScale: c = 2, patternSize: l = 64, invert: u = !1, seed: d = 1592594996, dark: p = K, light: m = q, powerPreference: h = "high-performance", onReady: g, onError: _, "aria-label": v = "Blue-noise dithered wave", ...y }, b) {
	let x = i(null), S = i(g), C = i(_), [w, T] = a(), [E, D] = a("loading"), O = ee(e, s), k = ne(p), A = ne(m);
	S.current = g, C.current = _;
	let j = t((e) => {
		x.current = e, ie(b, e);
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
			t || (t = !0, n && cancelAnimationFrame(n), re(r), r = void 0, D("error"), C.current?.(e instanceof Error ? e : Error(String(e))));
		};
		return (async () => {
			let a = Q(c, 1), o = Math.round(Z(l, 8, 128, 64)), s = Math.ceil(w.cssWidth / a), g = Math.ceil(w.cssHeight / a), _ = a * w.width / w.cssWidth, v = a * w.height / w.cssHeight, y = W(o, d), b = await f(h);
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
			let E = await X(b, T);
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
			M.set($(p), 0), M.set($(m), 4);
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
			}), P = performance.now(), F = P - G, I = !1, L = (r) => {
				if (t) return;
				let a = r - F;
				if (a < G) {
					n = requestAnimationFrame(L);
					return;
				}
				F = r - a % G;
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
			t = !0, n && cancelAnimationFrame(n), re(r);
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
});
//#endregion
export { ae as BlueNoiseWave, N as FloydSteinberg, c as displayShader, s as floydSteinbergShader, y as isWebGpuSupported };
