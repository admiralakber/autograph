import { Hsluv } from 'hsluv';

// COLOUR POLICY (hard rule).
// The "sunrise" palette — HSLuv, Lightness 72, Saturation 100, hue swept
// 0→360, alpha ~0.7 — colours *life only*: the creature renders, the
// generative volume, accents that stand for living things. The instrument
// chrome (panels, rules, labels, readouts) stays strictly greyscale + monospace
// (enforced in CSS). A precise greyscale instrument framing vivid, living colour.
//
// HSLuv (hsluv.org, MIT) gives a perceptually-even hue sweep, so the cycle
// glows evenly with no muddy or blown-out arcs — the "sunrise" quality.

const LUT_N = 720;
export const SUNRISE_L = 72;
export const SUNRISE_S = 100;
export const LIFE_ALPHA = 0.7;

const clamp255 = (x: number): number => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));

/** Precomputed sunrise LUT: hue 0→360 at L72/S100 → 8-bit RGB. */
const SUNRISE: Uint8Array = (() => {
  const conv = new Hsluv();
  const arr = new Uint8Array(LUT_N * 3);
  for (let i = 0; i < LUT_N; i++) {
    conv.hsluv_h = (i / LUT_N) * 360;
    conv.hsluv_s = SUNRISE_S;
    conv.hsluv_l = SUNRISE_L;
    conv.hsluvToRgb();
    arr[i * 3] = clamp255(conv.rgb_r * 255);
    arr[i * 3 + 1] = clamp255(conv.rgb_g * 255);
    arr[i * 3 + 2] = clamp255(conv.rgb_b * 255);
  }
  return arr;
})();

/** Sunrise colour for a living thing, from a hue in [0,1]. */
export function lifeRgb(hue01: number): [number, number, number] {
  const h = ((hue01 % 1) + 1) % 1;
  const i = Math.min(LUT_N - 1, Math.floor(h * LUT_N));
  return [SUNRISE[i * 3]!, SUNRISE[i * 3 + 1]!, SUNRISE[i * 3 + 2]!];
}

/** Sunrise colour as normalised floats [0,1] (for WebGL / three.js buffers). */
export function lifeRgbF(hue01: number): [number, number, number] {
  const [r, g, b] = lifeRgb(hue01);
  return [r / 255, g / 255, b / 255];
}
