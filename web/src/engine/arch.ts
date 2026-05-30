// The fixed CPPN topology — the single source of truth shared by the CPU
// evaluator, the WebGPU shader, and the self-encoding ("quine") probe layout.
//
// We use a *fixed* topology with evolvable weights and per-node activation
// functions. This is a genuine CPPN (heterogeneous activations queried over
// coordinates); full NEAT-style topology growth is on the roadmap, not in this
// client-side MVP. Keeping the topology fixed lets one shader evaluate any
// genome from a uniform/storage buffer with no per-genome recompile.

/** Coordinate inputs fed to every creature: x, y, radius, and a constant bias. */
export const INPUTS = 4;

/** Hidden layer widths. Small on purpose: a smaller genome lets the
 *  self-encoding loop visibly close while staying expressive enough to be pretty. */
export const HIDDEN = [7, 7] as const;

/** A single scalar "ink" output in [0,1], later mapped through a duotone palette. */
export const OUTPUTS = 1;

/** Layer sizes from input to output, e.g. [4, 7, 7, 1]. */
export const LAYERS: readonly number[] = [INPUTS, ...HIDDEN, OUTPUTS];

/** Number of weight matrices / bias vectors (one per inter-layer transition). */
export const TRANSITIONS = LAYERS.length - 1;

/** Total evolvable weights across all transitions (dense connectivity). */
export const WEIGHT_COUNT: number = (() => {
  let n = 0;
  for (let i = 0; i < TRANSITIONS; i++) n += LAYERS[i]! * LAYERS[i + 1]!;
  return n;
})();

/** Total evolvable biases (one per non-input node). */
export const BIAS_COUNT: number = (() => {
  let n = 0;
  for (let i = 1; i < LAYERS.length; i++) n += LAYERS[i]!;
  return n;
})();

/** Activations are evolvable for every hidden + output node. */
export const ACTIVATION_NODE_COUNT = BIAS_COUNT;

/** The genome's full real-valued dimension (weights ++ biases). This is the
 *  vector the creature tries to re-paint as its own self-portrait. */
export const GENOME_DIM = WEIGHT_COUNT + BIAS_COUNT;

/** Largest layer width — used to size scratch buffers and the shader's arrays. */
export const MAX_WIDTH: number = LAYERS.reduce((a, b) => Math.max(a, b), 0);

/** Start index, in the flat weight buffer, of each transition's dense matrix.
 *  Shared by the CPU evaluator and the generated WGSL shader (single source of
 *  truth — the whole point of the "one core" story). */
export const WEIGHT_OFFSETS: readonly number[] = (() => {
  const offs: number[] = [];
  let n = 0;
  for (let t = 0; t < TRANSITIONS; t++) {
    offs.push(n);
    n += LAYERS[t]! * LAYERS[t + 1]!;
  }
  return offs;
})();

/** Start index, in the flat bias/activation buffers, of each non-input layer. */
export const NODE_OFFSETS: readonly number[] = (() => {
  const offs: number[] = [];
  let n = 0;
  for (let l = 1; l < LAYERS.length; l++) {
    offs.push(n);
    n += LAYERS[l]!;
  }
  return offs;
})();
