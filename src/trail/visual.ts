/** Difference hashes only identify near-duplicate frames, not named places. */
export function nearDuplicate(a?: string, b?: string): boolean {
  if (!a || !b || !/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return false;
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let changed = 0;
  while (bits) {
    bits &= bits - 1n;
    changed++;
  }
  return changed <= 6;
}

/** Embeddings from sceneAnalysis are unit vectors. */
export function sceneSimilarity(a?: Float32Array, b?: Float32Array): number | undefined {
  if (!a || !b || a.length !== b.length) return undefined;
  let similarity = 0;
  for (let i = 0; i < a.length; i++) similarity += a[i] * b[i];
  return similarity;
}
