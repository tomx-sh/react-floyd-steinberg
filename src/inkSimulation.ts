// Adapted from the vgpu fluid example; see THIRD_PARTY_NOTICES.md.
import { clamp } from "./canvasUtils";
import type { StirInput } from "./inkPointer";
import {
  blueNoiseInkShader,
  inkAdvectDyeShader,
  inkAdvectVelocityShader,
  inkCurlShader,
  inkDivergenceShader,
  inkPressureShader,
  inkProjectShader,
  inkVorticityShader,
} from "./inkShaders";
import { createCheckedModule } from "./webgpu";

const computeShaders = {
  advectVelocity: inkAdvectVelocityShader,
  curl: inkCurlShader,
  vorticity: inkVorticityShader,
  divergence: inkDivergenceShader,
  pressure: inkPressureShader,
  project: inkProjectShader,
  advectDye: inkAdvectDyeShader,
};
type PassName = keyof typeof computeShaders;
interface InkPipelines {
  compute: Record<PassName, GPUComputePipeline>;
  display: GPURenderPipeline;
}
const pipelineCache = new WeakMap<GPUDevice, Map<GPUTextureFormat, Promise<InkPipelines>>>();

export function getInkPipelines(device: GPUDevice, format: GPUTextureFormat): Promise<InkPipelines> {
  let formats = pipelineCache.get(device);
  if (!formats) {
    formats = new Map();
    pipelineCache.set(device, formats);
  }
  let pending = formats.get(format);
  if (!pending) {
    pending = (async () => {
      const compute = {} as InkPipelines["compute"];
      await Promise.all(Object.entries(computeShaders).map(async ([name, code]) => {
        const module = await createCheckedModule(device, `Ink ${name} WGSL`, code);
        compute[name as PassName] = await device.createComputePipelineAsync({
          label: `Ink ${name}`, layout: "auto", compute: { module, entryPoint: "main" },
        });
      }));
      const module = await createCheckedModule(device, "Blue-noise ink WGSL", blueNoiseInkShader);
      const display = await device.createRenderPipelineAsync({
        label: "Blue-noise ink display", layout: "auto",
        vertex: { module, entryPoint: "vertexMain" },
        fragment: { module, entryPoint: "fragmentMain", targets: [{ format }] },
        primitive: { topology: "triangle-list" },
      });
      return { compute, display };
    })();
    formats.set(format, pending);
    void pending.catch(() => formats?.delete(format));
  }
  return pending;
}

/** Native WebGPU version of the reference's seven-pass, 60 Hz solver. */
export function createInkSimulation(device: GPUDevice, pipelines: InkPipelines, simulationSize: number) {
  const width = Math.round(clamp(simulationSize, 32, 384, 128));
  const height = Math.round(width * 9 / 16);
  const dyeWidth = width * 4;
  const dyeHeight = height * 4;
  const cells = width * height;
  const allocated: GPUBuffer[] = [];
  const buffer = (label: string, size: number, usage: GPUBufferUsageFlags) => {
    const result = device.createBuffer({ label, size, usage });
    allocated.push(result);
    return result;
  };
  const dispose = () => { for (const resource of allocated) resource.destroy(); };
  try {
    const uniform = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
    const storage = GPUBufferUsage.STORAGE;
    const grid = buffer("Ink grid", 16, uniform);
    device.queue.writeBuffer(grid, 0, new Uint32Array([width, height, dyeWidth, dyeHeight]));
    const inputBuffer = buffer("Ink input", 80, uniform);
    const displayParameters = buffer("Ink display", 64, uniform);
    const pattern = buffer("Ink blue-noise ranks", 128 * 128 * 4, storage | GPUBufferUsage.COPY_DST);
    const velocity = [buffer("Ink velocity A", cells * 8, storage), buffer("Ink velocity B", cells * 8, storage)];
    // A scalar dye replaces the original RGBA field, using one quarter of its memory.
    const dye = [buffer("Ink dye A", cells * 16 * 4, storage), buffer("Ink dye B", cells * 16 * 4, storage)];
    const pressure = [buffer("Ink pressure A", cells * 4, storage), buffer("Ink pressure B", cells * 4, storage)];
    const curl = buffer("Ink curl", cells * 4, storage);
    const divergence = buffer("Ink divergence", cells * 4, storage);
    const decay = [buffer("Ink pressure decay", 4, uniform), buffer("Ink pressure retain", 4, uniform)];
    device.queue.writeBuffer(decay[0], 0, new Float32Array([0.8]));
    device.queue.writeBuffer(decay[1], 0, new Float32Array([1]));
    const bindings = (pipeline: GPUComputePipeline | GPURenderPipeline, buffers: GPUBuffer[]) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((value, binding) => ({ binding, resource: { buffer: value } })),
      });
    const p = pipelines.compute;
    const pair = (fn: (i: number) => GPUBindGroup) => [fn(0), fn(1)];
    const advectGroups = pair(i => bindings(p.advectVelocity, [grid, inputBuffer, velocity[i], velocity[1 - i]]));
    const curlGroups = pair(i => bindings(p.curl, [grid, velocity[i], curl]));
    const vorticityGroups = pair(i => bindings(p.vorticity, [grid, velocity[i], curl, velocity[1 - i]]));
    const divergenceGroups = pair(i => bindings(p.divergence, [grid, velocity[i], divergence]));
    const pressureGroups = decay.map(decayBuffer => pair(i =>
      bindings(p.pressure, [grid, decayBuffer, pressure[i], divergence, pressure[1 - i]])));
    const projectGroups = velocity.map((value, i) => pair(j =>
      bindings(p.project, [grid, value, pressure[j], velocity[1 - i]])));
    const dyeGroups = dye.map((value, i) => pair(j =>
      bindings(p.advectDye, [grid, inputBuffer, value, velocity[j], dye[1 - i]])));
    const displayGroups = pair(i => bindings(pipelines.display, [grid, displayParameters, dye[i], pattern]));
    let velocityIndex = 0;
    let dyeIndex = 0;
    let pressureIndex = 0;
    let step = 0;
    let lastInputStep = -1000;
    const inputData = new ArrayBuffer(80);
    const input = new DataView(inputData);
    const setPair = (offset: number, value: readonly number[]) => {
      input.setFloat32(offset, value[0], true);
      input.setFloat32(offset + 4, value[1], true);
    };

    return {
      displayParameters,
      pattern,
      dispose,
      step(pointer: StirInput, interactionRadius: number) {
        const active = pointer.active;
        if (active) lastInputStep = step;
        const time = step / 60;
        const sinceInput = step - lastInputStep;
        const idle = sinceInput < 90 ? 0.15 : 0.15 + 0.85 * Math.min(1, (sinceInput - 90) / 60);
        const ramp = Math.min(1, (step + 1) / 24);
        let pointerVelocity = pointer.velocity;
        if (active && Math.hypot(...pointerVelocity) < 0.02) {
          pointerVelocity = [0.16 * Math.cos(time * 5), 0.16 * Math.sin(time * 5)];
        }
        input.setUint32(0, step, true);
        input.setFloat32(4, active ? 1 : 0, true);
        setPair(8, pointer.from);
        setPair(16, pointer.to);
        setPair(24, pointerVelocity);
        setPair(32, [0.5 + 0.28 * Math.sin(0.73 * time), 0.5 + 0.22 * Math.sin(1.09 * time + 0.4)]);
        input.setFloat32(40, ramp * idle, true);
        input.setFloat32(44, 0.006, true);
        setPair(48, [0.5 + 0.26 * Math.sin(0.61 * time + Math.PI), 0.5 + 0.24 * Math.sin(0.97 * time + 2.1)]);
        input.setFloat32(56, ramp * idle, true);
        input.setFloat32(60, 0.0055, true);
        input.setFloat32(64, clamp(interactionRadius, 0.01, 0.3, Math.sqrt(0.002)) ** 2, true);
        device.queue.writeBuffer(inputBuffer, 0, inputData);
        const encoder = device.createCommandEncoder({ label: "Ink simulation step" });
        const dispatch = (name: PassName, group: GPUBindGroup, w = width, h = height) => {
          const pass = encoder.beginComputePass({ label: `Ink ${name}` });
          pass.setPipeline(p[name]);
          pass.setBindGroup(0, group);
          pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
          pass.end();
        };
        dispatch("advectVelocity", advectGroups[velocityIndex]);
        velocityIndex = 1 - velocityIndex;
        dispatch("curl", curlGroups[velocityIndex]);
        dispatch("vorticity", vorticityGroups[velocityIndex]);
        velocityIndex = 1 - velocityIndex;
        dispatch("divergence", divergenceGroups[velocityIndex]);
        for (let i = 0; i < 3; i++) {
          dispatch("pressure", pressureGroups[i === 0 ? 0 : 1][pressureIndex]);
          pressureIndex = 1 - pressureIndex;
        }
        dispatch("project", projectGroups[velocityIndex][pressureIndex]);
        velocityIndex = 1 - velocityIndex;
        dispatch("advectDye", dyeGroups[dyeIndex][velocityIndex], dyeWidth, dyeHeight);
        dyeIndex = 1 - dyeIndex;
        // Submit each fixed step separately so later uniform writes cannot replace its input.
        device.queue.submit([encoder.finish()]);
        step++;
        pointer.consumeStep();
      },
      render(context: GPUCanvasContext) {
        const encoder = device.createCommandEncoder({ label: "Blue-noise ink frame" });
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store",
          }],
        });
        pass.setPipeline(pipelines.display);
        pass.setBindGroup(0, displayGroups[dyeIndex]);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
