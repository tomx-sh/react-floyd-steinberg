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
], d, f = /* @__PURE__ */ new WeakMap();
function p() {
	return typeof navigator < "u" && "gpu" in navigator;
}
async function m(e) {
	if (!p()) throw Error("WebGPU is not available in this browser.");
	return d ||= navigator.gpu.requestAdapter({ powerPreference: e }).then(async (e) => {
		if (!e) throw Error("No compatible WebGPU adapter was found.");
		let t = await e.requestDevice();
		return t.lost.then(() => {
			d = void 0;
		}), t;
	}), d;
}
async function h(e, t, n) {
	let r = e.createShaderModule({
		label: t,
		code: n
	}), i = (await r.getCompilationInfo()).messages.filter((e) => e.type === "error");
	if (i.length > 0) throw Error(i.map((e) => `${t}: ${e.message}`).join("\n"));
	return r;
}
function g(e, t) {
	let n = f.get(e);
	n || (n = /* @__PURE__ */ new Map(), f.set(e, n));
	let r = n.get(t);
	return r || (r = (async () => {
		let [n, r] = await Promise.all([h(e, "Stochastic Floyd–Steinberg WGSL", o), h(e, "Floyd–Steinberg display WGSL", s)]), i = e.createBindGroupLayout({
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
function _(e) {
	return typeof HTMLImageElement < "u" && e instanceof HTMLImageElement ? {
		width: e.naturalWidth,
		height: e.naturalHeight
	} : {
		width: e.width,
		height: e.height
	};
}
async function v(e, t) {
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
	let { width: n, height: r } = _(e);
	return {
		source: e,
		width: n,
		height: r
	};
}
function y(e, t, n, r) {
	return Number.isFinite(e) ? Math.min(n, Math.max(t, e)) : r;
}
function b(e, t) {
	return Math.max(1, Math.round(Number.isFinite(e) ? e : t));
}
function x(e, t, n, r) {
	if (n !== void 0 && r !== void 0) return {
		width: b(n, e),
		height: b(r, t)
	};
	if (n !== void 0) {
		let r = b(n, e);
		return {
			width: r,
			height: b(r * t / e, t)
		};
	}
	if (r !== void 0) {
		let n = b(r, t);
		return {
			width: b(n * e / t, e),
			height: n
		};
	}
	return {
		width: b(e, 1),
		height: b(t, 1)
	};
}
function S(e) {
	return [
		y(e[0], 0, 1, 0),
		y(e[1], 0, 1, 0),
		y(e[2], 0, 1, 0),
		y(e[3] ?? 1, 0, 1, 1)
	];
}
function C(e) {
	e && (e.output.destroy(), e.errors.destroy(), e.computeParameters.destroy(), e.displayParameters.destroy(), e.bandParameters.destroy(), e.sourceTexture.destroy());
}
function w(e, t, n) {
	let r = /* @__PURE__ */ new ArrayBuffer(48), i = new DataView(r);
	i.setUint32(0, n.logicalWidth, !0), i.setUint32(4, n.logicalHeight, !0), i.setUint32(8, n.sourceWidth, !0), i.setUint32(12, n.sourceHeight, !0), i.setUint32(16, {
		stretch: 0,
		cover: 1,
		contain: 2
	}[n.fit], !0), i.setUint32(20, +!!n.invert, !0), i.setFloat32(24, n.threshold, !0), i.setFloat32(28, n.randomness, !0), i.setUint32(32, n.seed >>> 0, !0), i.setFloat32(36, n.alphaBackground, !0), e.queue.writeBuffer(t, 0, r);
}
function T(e, t, n, r, i, a, o, s) {
	let c = /* @__PURE__ */ new ArrayBuffer(48), l = new DataView(c);
	l.setUint32(0, n, !0), l.setUint32(4, r, !0), l.setFloat32(8, i, !0), l.setFloat32(12, a, !0);
	let u = new Float32Array(c, 16, 8);
	u.set(S(o), 0), u.set(S(s), 4), e.queue.writeBuffer(t, 0, c);
}
function E(e, t) {
	typeof e == "function" ? e(t) : e && (e.current = t);
}
var D = e(function({ src: e, width: o, height: s, pixelScale: d = 1, randomness: f = .35, threshold: p = .5, fit: h = "contain", invert: _ = !1, seed: S = 1592594996, alphaBackground: D = 1, dark: O = l, light: k = u, crossOrigin: A = "anonymous", powerPreference: j = "high-performance", onReady: M, onError: N, "aria-label": P = "Floyd–Steinberg dithered image", ...F }, I) {
	let L = r(null), R = r(M), z = r(N), [B, V] = i(), [H, U] = i();
	R.current = M, z.current = N;
	let [W, G] = i("loading"), K = t((e) => {
		L.current = e, E(I, e);
	}, [I]);
	n(() => {
		let t = !1;
		return G("loading"), V(void 0), U(void 0), v(e, A).then((e) => {
			if (t) {
				e.dispose?.();
				return;
			}
			if (e.width < 1 || e.height < 1) throw e.dispose?.(), Error("The source image has no drawable pixels.");
			V(e);
		}).catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			G("error"), z.current?.(n);
		}), () => {
			t = !0;
		};
	}, [e, A]);
	let q = B ? x(B.width, B.height, o, s) : {
		width: b(o, 300),
		height: b(s, 150)
	};
	return n(() => {
		U(void 0);
	}, [o, s]), n(() => {
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
		q.width,
		q.height
	]), n(() => {
		let e = L.current;
		if (!e || !B || !H) return;
		let t = !1, n;
		return G("loading"), (async () => {
			let r = b(d, 1), i = Math.ceil(H.cssWidth / r), a = Math.ceil(H.cssHeight / r), o = r * H.width / H.cssWidth, s = r * H.height / H.cssHeight, l = await m(j);
			if (t) return;
			let u = l.limits.maxTextureDimension2D;
			if (B.width > u || B.height > u || H.width > u || H.height > u) throw Error(`The source or output exceeds this device's ${u}px texture limit.`);
			let v = Math.max(4, i * a * 4);
			if (v > l.limits.maxStorageBufferBindingSize) throw Error("The requested output exceeds this device's storage-buffer limit. Increase pixelScale.");
			let x = e.getContext("webgpu");
			if (!x) throw Error("The canvas could not create a WebGPU context.");
			let C = navigator.gpu.getPreferredCanvasFormat();
			x.configure({
				device: l,
				format: C,
				alphaMode: "premultiplied"
			});
			let E = await g(l, C);
			if (t) return;
			let A = l.createBuffer({
				label: "Floyd–Steinberg output",
				size: v,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), M = l.createBuffer({
				label: "Floyd–Steinberg errors",
				size: v,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			}), N = l.createBuffer({
				label: "Floyd–Steinberg parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), P = l.createBuffer({
				label: "Floyd–Steinberg display parameters",
				size: 48,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), F = Math.ceil(a / c), I = l.limits.minUniformBufferOffsetAlignment, L = new ArrayBuffer(I * F), z = new DataView(L);
			for (let e = 0; e < F; e += 1) {
				let t = e * c;
				z.setUint32(e * I, t, !0), z.setUint32(e * I + 4, Math.min(c, a - t), !0);
			}
			let V = l.createBuffer({
				label: "Floyd–Steinberg band parameters",
				size: L.byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			}), U = l.createTexture({
				label: "Floyd–Steinberg source image",
				size: [B.width, B.height],
				format: "rgba8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
			});
			n = {
				output: A,
				errors: M,
				computeParameters: N,
				displayParameters: P,
				bandParameters: V,
				sourceTexture: U
			}, l.queue.copyExternalImageToTexture({ source: B.source }, { texture: U }, [B.width, B.height]), l.queue.writeBuffer(V, 0, L), w(l, N, {
				logicalWidth: i,
				logicalHeight: a,
				sourceWidth: B.width,
				sourceHeight: B.height,
				fit: h,
				invert: _,
				threshold: y(p, 0, 1, .5),
				randomness: y(f, 0, 2, .35),
				seed: S,
				alphaBackground: y(D, 0, 1, 1)
			}), T(l, P, i, a, o, s, O, k);
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
						resource: { buffer: A }
					},
					{
						binding: 2,
						resource: { buffer: M }
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
			}), K = l.createBindGroup({
				label: "Floyd–Steinberg display bind group",
				layout: E.display.getBindGroupLayout(0),
				entries: [{
					binding: 0,
					resource: { buffer: P }
				}, {
					binding: 1,
					resource: { buffer: A }
				}]
			}), q = l.createCommandEncoder({ label: "Floyd–Steinberg render" });
			q.clearBuffer(M);
			for (let e = 0; e < F; e += 1) {
				let t = q.beginComputePass({ label: `Floyd–Steinberg band ${e}` });
				t.setPipeline(E.compute), t.setBindGroup(0, W, [e * I]), t.dispatchWorkgroups(1), t.end();
			}
			let J = q.beginRenderPass({
				label: "Floyd–Steinberg display pass",
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
			J.setPipeline(E.display), J.setBindGroup(0, K), J.draw(3), J.end(), l.queue.submit([q.finish()]), await l.queue.onSubmittedWorkDone(), !t && (G("ready"), R.current?.({
				canvas: e,
				device: l,
				...H,
				logicalWidth: i,
				logicalHeight: a
			}));
		})().catch((e) => {
			if (t) return;
			let n = e instanceof Error ? e : Error(String(e));
			G("error"), z.current?.(n);
		}), () => {
			t = !0, C(n);
		};
	}, [
		B,
		H,
		d,
		f,
		p,
		h,
		_,
		S,
		D,
		O[0],
		O[1],
		O[2],
		O[3],
		k[0],
		k[1],
		k[2],
		k[3],
		j
	]), n(() => () => {
		B?.dispose?.();
	}, [B]), /* @__PURE__ */ a("canvas", {
		...F,
		ref: K,
		width: H?.width ?? q.width,
		height: H?.height ?? q.height,
		"aria-label": P,
		"data-webgpu-status": W
	});
});
//#endregion
export { D as FloydSteinberg, s as displayShader, o as floydSteinbergShader, p as isWebGpuSupported };
