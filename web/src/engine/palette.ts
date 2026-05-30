import type { Genome } from './cppn.ts';

// A duotone ink -> paper ramp with a per-creature accent glow at the midtones,
// evoking an Escher lithograph (graphite on warm paper). Mirrored exactly in
// the WGSL shader so the WebGPU and Canvas paths look identical.

export type RGB = readonly [number, number, number];

export const INK: RGB = [12, 16, 33]; // deep indigo-black
export const PAPER: RGB = [240, 233, 218]; // warm paper

const clamp255 = (x: number): number => (x < 0 ? 0 : x > 255 ? 255 : x);

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** A stable accent hue in degrees for a creature, from its weights. */
export function accentHue(g: Genome): number {
  let acc = 0;
  for (let i = 0; i < g.weights.length; i++) acc += g.weights[i]! * (i + 1);
  for (let i = 0; i < g.acts.length; i++) acc += g.acts[i]! * 13.37;
  return ((acc * 47.0) % 360 + 360) % 360;
}

export function accentRgb(g: Genome): RGB {
  return hslToRgb(accentHue(g), 0.62, 0.6);
}

const smoothstep = (v: number): number => v * v * (3 - 2 * v);

/** Map an ink scalar in [0,1] to an 8-bit RGB triple, given an accent colour. */
export function colourise(v: number, accent: RGB): RGB {
  const t = smoothstep(v < 0 ? 0 : v > 1 ? 1 : v);
  const baseR = INK[0] + (PAPER[0] - INK[0]) * t;
  const baseG = INK[1] + (PAPER[1] - INK[1]) * t;
  const baseB = INK[2] + (PAPER[2] - INK[2]) * t;
  const glow = Math.pow(1 - Math.abs(2 * v - 1), 1.5) * 0.55;
  return [
    clamp255(baseR + (accent[0] - baseR) * glow),
    clamp255(baseG + (accent[1] - baseG) * glow),
    clamp255(baseB + (accent[2] - baseB) * glow),
  ];
}
