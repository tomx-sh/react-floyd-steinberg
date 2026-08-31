import { forwardRef as e, useCallback as t, useEffect as n, useRef as r, useState as i } from "react";
import { jsx as a } from "react/jsx-runtime";
//#region src/shaders.ts
var o = "\nstruct Parameters {\n  outputSize: vec2u,\n  sourceSize: vec2u,\n  fit: u32,\n  invert: u32,\n  threshold: f32,\n  randomness: f32,\n  seed: u32,\n  alphaBackground: f32,\n  padding0: u32,\n  padding1: u32,\n}\n\nstruct Band {\n  firstRow: u32,\n  rowCount: u32,\n  padding0: u32,\n  padding1: u32,\n}\n\n@group(0) @binding(0) var<uniform> parameters: Parameters;\n@group(0) @binding(1) var<storage, read_write> outputBits: array<u32>;\n@group(0) @binding(2) var<storage, read_write> errorBuffer: array<f32>;\n@group(0) @binding(3) var<uniform> band: Band;\n@group(0) @binding(4) var sourceTexture: texture_2d<f32>;\n\nfn hashValue(cell: vec2u, seed: u32) -> f32 {\n  var value = cell.x * 0x9e3779b9u + cell.y * 0x85ebca6bu + seed;\n  value = (value ^ (value >> 16u)) * 0x7feb352du;\n  value = (value ^ (value >> 15u)) * 0x846ca68bu;\n  value = value ^ (value >> 16u);\n  return f32(value) / 4294967295.0;\n}\n\nfn fittedUv(cell: vec2u) -> vec3f {\n  let outputSize = vec2f(parameters.outputSize);\n  let sourceSize = vec2f(parameters.sourceSize);\n  let outputAspect = outputSize.x / outputSize.y;\n  let sourceAspect = sourceSize.x / sourceSize.y;\n  var uv = (vec2f(cell) + vec2f(0.5)) / outputSize;\n\n  if (parameters.fit == 1u) {\n    // Cover: crop the longer source axis.\n    if (sourceAspect > outputAspect) {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    } else {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    }\n  } else if (parameters.fit == 2u) {\n    // Contain: map the letterboxed output area outside the source UV range.\n    if (sourceAspect > outputAspect) {\n      uv.y = (uv.y - 0.5) * (sourceAspect / outputAspect) + 0.5;\n    } else {\n      uv.x = (uv.x - 0.5) * (outputAspect / sourceAspect) + 0.5;\n    }\n  }\n\n  let inside = select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));\n  return vec3f(uv, inside);\n}\n\nfn sourceValue(cell: vec2u) -> f32 {\n  let fitted = fittedUv(cell);\n  var luminance = parameters.alphaBackground;\n\n  if (fitted.z > 0.5) {\n    let maxPosition = vec2i(parameters.sourceSize) - vec2i(1);\n    let position = clamp(vec2i(fitted.xy * vec2f(parameters.sourceSize)), vec2i(0), maxPosition);\n    let color = textureLoad(sourceTexture, position, 0);\n    let imageLuminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));\n    luminance = mix(parameters.alphaBackground, imageLuminance, color.a);\n  }\n\n  return select(luminance, 1.0 - luminance, parameters.invert != 0u);\n}\n\n@compute @workgroup_size(256)\nfn main(@builtin(local_invocation_index) localRow: u32) {\n  let row = band.firstRow + localRow;\n  let activeRow = localRow < band.rowCount && row < parameters.outputSize.y;\n  var phaseCount = parameters.outputSize.x;\n  if (band.rowCount > 0u) {\n    phaseCount += 3u * (band.rowCount - 1u);\n  }\n\n  for (var phase = 0u; phase < phaseCount; phase += 1u) {\n    let rowDelay = 3u * localRow;\n    if (activeRow && phase >= rowDelay) {\n      let x = phase - rowDelay;\n      if (x < parameters.outputSize.x) {\n        let cell = vec2u(x, row);\n        let index = row * parameters.outputSize.x + x;\n        let value = clamp(sourceValue(cell) + errorBuffer[index], 0.0, 1.0);\n        let bit = select(0u, 1u, value >= parameters.threshold);\n        let error = value - f32(bit);\n        outputBits[index] = bit;\n\n        let r1 = (hashValue(cell, parameters.seed) * 2.0 - 1.0) * (5.0 / 16.0);\n        let r2 = (hashValue(cell, parameters.seed ^ 0xa511e9b3u) * 2.0 - 1.0) * (1.0 / 16.0);\n        let rightWeight = 7.0 / 16.0 + parameters.randomness * r1;\n        let downWeight = 5.0 / 16.0 - parameters.randomness * r1;\n        let downLeftWeight = 3.0 / 16.0 + parameters.randomness * r2;\n        let downRightWeight = 1.0 / 16.0 - parameters.randomness * r2;\n\n        if (x + 1u < parameters.outputSize.x) {\n          errorBuffer[index + 1u] += error * rightWeight;\n        }\n        if (row + 1u < parameters.outputSize.y) {\n          let below = index + parameters.outputSize.x;\n          if (x > 0u) {\n            errorBuffer[below - 1u] += error * downLeftWeight;\n          }\n          errorBuffer[below] += error * downWeight;\n          if (x + 1u < parameters.outputSize.x) {\n            errorBuffer[below + 1u] += error * downRightWeight;\n          }\n        }\n      }\n    }\n    storageBarrier();\n  }\n}\n", s = "\nstruct DisplayParameters {\n  logicalSize: vec2u,\n  cellSize: vec2f,\n  dark: vec4f,\n  light: vec4f,\n}\n\n@group(0) @binding(0) var<uniform> parameters: DisplayParameters;\n@group(0) @binding(1) var<storage, read> outputBits: array<u32>;\n\n@vertex\nfn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {\n  let x = f32((index << 1u) & 2u);\n  let y = f32(index & 2u);\n  return vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);\n}\n\n@fragment\nfn fragmentMain(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let safeLogicalSize = max(parameters.logicalSize, vec2u(1u));\n  let safeCellSize = max(parameters.cellSize, vec2f(0.0001));\n  let cell = min(vec2u(position.xy / safeCellSize), safeLogicalSize - vec2u(1u));\n  let bit = outputBits[cell.y * safeLogicalSize.x + cell.x];\n  return select(parameters.dark, parameters.light, bit != 0u);\n}\n", c = 256, l = [
	0,
	0,
	0,
	1
], u = [
	1,
	1,
	1,
	1
], d, f, p = /* @__PURE__ */ new WeakMap();
function m() {
	return typeof navigator < "u" && "gpu" in navigator;
}
async function h(e) {
	if (!m()) throw Error("WebGPU is not available in this browser.");
	return f ||= navigator.gpu.requestAdapter({ powerPreference: e }).then(async (e) => {
		if (!e) throw Error("No compatible WebGPU adapter was found.");
		let t = await e.requestDevice();
		return t.lost.then(() => {
			f = void 0;
		}), t;
	}), f;
}
async function g(e, t, n) {
	let r = e.createShaderModule({
		label: t,
		code: n
	}), i = (await r.getCompilationInfo()).messages.filter((e) => e.type === "error");
	if (i.length > 0) throw Error(i.map((e) => `${t}: ${e.message}`).join("\n"));
	return r;
}
function _(e, t) {
	let n = p.get(e);
	n || (n = /* @__PURE__ */ new Map(), p.set(e, n));
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
function v(e) {
	return typeof HTMLImageElement < "u" && e instanceof HTMLImageElement ? {
		width: e.naturalWidth,
		height: e.naturalHeight
	} : {
		width: e.width,
		height: e.height
	};
}
async function y(e, t) {
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
	let { width: n, height: r } = v(e);
	return {
		source: e,
		width: n,
		height: r
	};
}
function b(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function x(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function S(e, t, n, r) {
	if (n !== void 0 && r !== void 0) return {
		width: x(n, e),
		height: x(r, t)
	};
	if (n !== void 0) {
		let r = x(n, e);
		return {
			width: r,
			height: x(r * t / e, t)
		};
	}
	if (r !== void 0) {
		let n = x(r, t);
		return {
			width: x(n * e / t, e),
			height: n
		};
	}
	return {
		width: x(e, 1),
		height: x(t, 1)
	};
}
function C(e) {
	let t = e.trim();
	if (!d) {
		let e = document.createElement("canvas");
		e.width = 1, e.height = 1, d = e.getContext("2d", { willReadFrequently: !0 }) ?? void 0;
	}
	if (!d) throw Error("CSS colors could not be resolved because a 2D canvas context is unavailable.");
	d.fillStyle = "#010203", d.fillStyle = t;
	let n = d.fillStyle;
	if (d.fillStyle = "#040506", d.fillStyle = t, !t || d.fillStyle !== n) throw Error(`Invalid CSS color: ${JSON.stringify(e)}.`);
	d.clearRect(0, 0, 1, 1), d.fillRect(0, 0, 1, 1);
	let [r, i, a, o] = d.getImageData(0, 0, 1, 1).data;
	return [
		r / 255,
		i / 255,
		a / 255,
		o / 255
	];
}
function w(e) {
	return typeof e == "string" ? C(e) : [
		b(e[0], 0, 1, 0),
		b(e[1], 0, 1, 0),
		b(e[2], 0, 1, 0),
		b(e[3] ?? 1, 0, 1, 1)
	];
}
function T(e) {
	return typeof e == "string" ? `css:${e}` : `tuple:${e.join(",")}`;
}
function E(e) {
	e && (e.output.destroy(), e.errors.destroy(), e.computeParameters.destroy(), e.displayParameters.destroy(), e.bandParameters.destroy(), e.sourceTexture.destroy());
}
function D(e, t, n) {
	let r = /* @__PURE__ */ new ArrayBuffer(48), i = new DataView(r);
	i.setUint32(0, n.logicalWidth, !0), i.setUint32(4, n.logicalHeight, !0), i.setUint32(8, n.sourceWidth, !0), i.setUint32(12, n.sourceHeight, !0), i.setUint32(16, {
		stretch: 0,
		cover: 1,
		contain: 2
	}[n.fit], !0), i.setUint32(20, +!!n.invert, !0), i.setFloat32(24, n.threshold, !0), i.setFloat32(28, n.randomness, !0), i.setUint32(32, n.seed >>> 0, !0), i.setFloat32(36, n.alphaBackground, !0), e.queue.writeBuffer(t, 0, r);
}
function O(e, t, n, r, i, a, o, s) {
	let c = /* @__PURE__ */ new ArrayBuffer(48), l = new DataView(c);
	l.setUint32(0, n, !0), l.setUint32(4, r, !0), l.setFloat32(8, i, !0), l.setFloat32(12, a, !0);
	let u = new Float32Array(c, 16, 8);
	u.set(w(o), 0), u.set(w(s), 4), e.queue.writeBuffer(t, 0, c);
}
function k(e, t) {
	typeof e == "function" ? e(t) : e && (e.current = t);
}
var A = e(function({ src: e, width: o, height: s, pixelScale: d = 1, randomness: f = .35, threshold: p = .5, fit: m = "contain", invert: g = !1, seed: v = 1592594996, alphaBackground: C = 1, dark: w = l, light: A = u, crossOrigin: j = "anonymous", powerPreference: M = "high-performance", onReady: N, onError: P, "aria-label": F = "Floyd–Steinberg dithered image", ...I }, L) {
	let R = r(null), z = r(N), B = r(P), [V, H] = i(), [U, W] = i(), G = T(w), K = T(A);
	z.current = N, B.current = P;
	let [q, J] = i("loading"), Y = t((e) => {
		R.current = e, k(L, e);
	}, [L]);
	n(() => {
		let t = !1;
		return J("loading"), H(void 0), W(void 0), y(e, j).then((e) => {
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
	}, [e, j]);
	let X = V ? S(V.width, V.height, o, s) : {
		width: x(o, 300),
		height: x(s, 150)
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
			let r = x(d, 1), i = Math.ceil(U.cssWidth / r), a = Math.ceil(U.cssHeight / r), o = r * U.width / U.cssWidth, s = r * U.height / U.cssHeight, l = await h(M);
			if (t) return;
			let u = l.limits.maxTextureDimension2D;
			if (V.width > u || V.height > u || U.width > u || U.height > u) throw Error(`The source or output exceeds this device's ${u}px texture limit.`);
			let y = Math.max(4, i * a * 4);
			if (y > l.limits.maxStorageBufferBindingSize) throw Error("The requested output exceeds this device's storage-buffer limit. Increase pixelScale.");
			let S = e.getContext("webgpu");
			if (!S) throw Error("The canvas could not create a WebGPU context.");
			let T = navigator.gpu.getPreferredCanvasFormat();
			S.configure({
				device: l,
				format: T,
				alphaMode: "premultiplied"
			});
			let E = await _(l, T);
			if (t) return;
			let k = l.createBuffer({
				label: "Floyd–Steinberg output",
				size: y,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), j = l.createBuffer({
				label: "Floyd–Steinberg errors",
				size: y,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), N = l.createBuffer({
				label: "Floyd–Steinberg parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), P = l.createBuffer({
				label: "Floyd–Steinberg display parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), F = Math.ceil(a / c), I = l.limits.minUniformBufferOffsetAlignment, L = new ArrayBuffer(I * F), R = new DataView(L);
			for (let e = 0; e < F; e += 1) {
				let t = e * c;
				R.setUint32(e * I, t, !0), R.setUint32(e * I + 4, Math.min(c, a - t), !0);
			}
			let B = l.createBuffer({
				label: "Floyd–Steinberg band parameters",
				size: L.byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), H = l.createTexture({
				label: "Floyd–Steinberg source image",
				size: [V.width, V.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
			});
			n = {
				output: k,
				errors: j,
				computeParameters: N,
				displayParameters: P,
				bandParameters: B,
				sourceTexture: H
			}, l.queue.copyExternalImageToTexture({ source: V.source }, { texture: H }, [V.width, V.height]), l.queue.writeBuffer(B, 0, L), D(l, N, {
				logicalWidth: i,
				logicalHeight: a,
				sourceWidth: V.width,
				sourceHeight: V.height,
				fit: m,
				invert: g,
				threshold: b(p, 0, 1, .5),
				randomness: b(f, 0, 2, .35),
				seed: v,
				alphaBackground: b(C, 0, 1, 1)
			}), O(l, P, i, a, o, s, w, A);
			let W = l.createBindGroup({
				label: "Floyd–Steinberg compute bind group",
				layout: E.computeLayout,
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
			}), G = l.createBindGroup({
				label: "Floyd–Steinberg display bind group",
				layout: E.display.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: P }
				}, {
					binding: 1,
					resource: { buffer: k }
				}]
			}), K = l.createCommandEncoder({ label: "Floyd–Steinberg render" });
			K.clearBuffer(j);
			for (let e = 0; e < F; e += 1) {
				let t = K.beginComputePass({ label: `Floyd–Steinberg band ${e}` });
				t.setPipeline(E.compute), t.setBindGroup(0, W, [e * I]), t.dispatchWorkgroups(1), t.end();
			}
			let q = K.beginRenderPass({
				label: "Floyd–Steinberg display pass",
				colorAttachments: [{
					view: S.getCurrentTexture().createView(),
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
			q.setPipeline(E.display), q.setBindGroup(0, G), q.draw(3), q.end(), l.queue.submit([K.finish()]), await l.queue.onSubmittedWorkDone(), !t && (J("ready"), z.current?.({
				canvas: e,
				device: l,
				...U,
				logicalWidth: i,
				logicalHeight: a
			}));
		})().catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			J("error"), B.current?.(n);
		}), () => {
			t = !0, E(n);
		};
	}, [
		V,
		U,
		d,
		f,
		p,
		m,
		g,
		v,
		C,
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
});
//#endregion
export { A as FloydSteinberg, s as displayShader, o as floydSteinbergShader, m as isWebGpuSupported };
