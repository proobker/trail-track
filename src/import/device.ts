export type ModelDevice = 'webgpu' | 'wasm';

let detected: Promise<ModelDevice> | undefined;

/** WebGPU when this browser exposes a usable adapter; otherwise WASM on the CPU. */
export function modelDevice(): Promise<ModelDevice> {
  detected ??= (async () => {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      return gpu && (await gpu.requestAdapter()) ? 'webgpu' : 'wasm';
    } catch {
      return 'wasm';
    }
  })();
  return detected;
}

/**
 * Loads a model on the fastest device, falling back to WASM if the GPU can't run it. Callers keep
 * their usual dtype so switching device never downloads a second copy of the weights.
 */
export async function loadOnDevice<T>(load: (device: ModelDevice) => Promise<T>): Promise<T> {
  const device = await modelDevice();
  if (device === 'wasm') return load('wasm');
  try {
    return await load('webgpu');
  } catch (e) {
    console.warn('[trail-track] WebGPU model load failed, using WASM', e);
    return load('wasm');
  }
}
