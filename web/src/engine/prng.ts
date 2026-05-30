// Determinism layer: a tiny, fast, *non-cryptographic* string hash + PRNG so
// that the same seed always grows the same creature (the "your key grows your
// creature" ritual, à la Art Blocks / fxhash deterministic generators).
//
// This is NOT used for the cryptographic layer — content hashes and signatures
// in `lineage.ts` use the Web Crypto API (SHA-256 + ECDSA). The two are kept
// deliberately separate: cyrb128 is for reproducibility, SubtleCrypto is for
// tamper-evidence.

/** cyrb128 — a solid 128-bit hash of a string, returned as four 32-bit ints. */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** A deterministic [0,1) generator with a `.next()` method. */
export interface Rng {
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Roughly-normal sample (sum-of-uniforms), mean 0, std ~1. */
  normal(): number;
}

/** sfc32 — fast, well-distributed 32-bit PRNG seeded from four ints. */
export function makeRng(a: number, b: number, c: number, d: number): Rng {
  let s0 = a >>> 0;
  let s1 = b >>> 0;
  let s2 = c >>> 0;
  let s3 = d >>> 0;
  const next = (): number => {
    s0 >>>= 0;
    s1 >>>= 0;
    s2 >>>= 0;
    s3 >>>= 0;
    let t = (s0 + s1) | 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) | 0;
    s2 = (s2 << 21) | (s2 >>> 11);
    s3 = (s3 + 1) | 0;
    t = (t + s3) | 0;
    s2 = (s2 + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (n) => Math.floor(next() * n),
    normal: () => next() + next() + next() - next() - next() - next(),
  };
}

/** Convenience: build a deterministic RNG straight from a seed string. */
export function rngFromSeed(seed: string): Rng {
  const [a, b, c, d] = cyrb128(seed);
  return makeRng(a, b, c, d);
}

/** Lowercase hex of arbitrary bytes. */
export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}
