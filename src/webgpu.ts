let sharedDevicePromise: Promise<GPUDevice> | undefined;

export function isWebGpuSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function getSharedDevice(powerPreference: GPUPowerPreference): Promise<GPUDevice> {
  if (!isWebGpuSupported()) {
    throw new Error("WebGPU is not available in this browser.");
  }

  if (!sharedDevicePromise) {
    sharedDevicePromise = navigator.gpu.requestAdapter({ powerPreference }).then(async (adapter) => {
      if (!adapter) throw new Error("No compatible WebGPU adapter was found.");
      const device = await adapter.requestDevice();
      device.lost.then(() => {
        sharedDevicePromise = undefined;
      });
      return device;
    });
  }

  return sharedDevicePromise;
}

export async function createCheckedModule(device: GPUDevice, label: string, code: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code });
  const compilation = await module.getCompilationInfo();
  const errors = compilation.messages.filter((message) => message.type === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((error) => `${label}: ${error.message}`).join("\n"));
  }
  return module;
}
