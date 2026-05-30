// CPPN activation functions. The heterogeneity is the whole point: mixing
// sin / gauss / abs / tanh / cos / triangle gives the regular, symmetric,
// repeating motifs that make CPPN images beautiful (Stanley 2007; Picbreeder,
// Secretan et al. 2011). NEAT mutates a node's activation as part of structure.

export const ACTIVATIONS = [
  'sin',
  'gauss',
  'tanh',
  'sigmoid',
  'abs',
  'identity',
  'cos',
  'relu',
  'tri',
  'softsign',
  'step',
  'bent',
] as const;

export type ActivationName = (typeof ACTIVATIONS)[number];

export const ACTIVATION_COUNT = ACTIVATIONS.length;
/** Index of the linear-ish default (inputs and fresh output nodes). */
export const IDENTITY_ACT = 5;

/** Evaluate activation `id` (index into ACTIVATIONS) at `x`. Kept numerically
 *  tame so the CPU path and a future WGSL path agree to a sensible tolerance. */
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
    case 6:
      return Math.cos(x);
    case 7:
      return x < 0 ? 0 : x > 1 ? 1 : x; // clamped relu
    case 8:
      return (2 / Math.PI) * Math.asin(Math.sin(x)); // triangle wave in [-1,1]
    case 9:
      return x / (1 + Math.abs(x)); // softsign (neataptic)
    case 10:
      return x > 0 ? 1 : 0; // step
    case 11: {
      const b = (Math.sqrt(x * x + 1) - 1) / 2 + x; // bent identity (clamped tame)
      return b < -1 ? -1 : b > 1 ? 1 : b;
    }
    default:
      return Math.max(-1, Math.min(1, x)); // identity, clamped
  }
}
