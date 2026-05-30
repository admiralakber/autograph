// CPPN activation functions. The heterogeneity is the whole point: mixing
// sin / gauss / abs / tanh gives the regular, symmetric, repeating motifs that
// make CPPN images beautiful (Stanley 2007; Picbreeder, Secretan et al. 2011).

export const ACTIVATIONS = [
  'sin',
  'gauss',
  'tanh',
  'sigmoid',
  'abs',
  'identity',
] as const;

export type ActivationName = (typeof ACTIVATIONS)[number];

export const ACTIVATION_COUNT = ACTIVATIONS.length;

/** Evaluate activation `id` (index into ACTIVATIONS) at `x`. Kept numerically
 *  tame so the CPU path and the WGSL path agree to a sensible tolerance. */
export function activate(id: number, x: number): number {
  switch (id) {
    case 0:
      return Math.sin(x);
    case 1:
      return Math.exp(-(x * x)); // gaussian bump, peak 1 at 0
    case 2:
      return Math.tanh(x);
    case 3:
      return 1 / (1 + Math.exp(-x));
    case 4:
      return Math.abs(x) > 1 ? 1 : Math.abs(x); // clamped abs
    default:
      return Math.max(-1, Math.min(1, x)); // identity, clamped
  }
}
