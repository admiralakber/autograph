// Topology — the single source of truth for both networks in the loop.
//
//   GENOTYPE (the DNA): a small *connective* CPPN. It maps a pair of substrate
//   node positions in 3D to a connection weight (+ a link-expression output that
//   gates whether the connection exists). Kept deliberately compact: a small DNA
//   is both easier for the self-portrait to re-encode and clearer to draw as a
//   graph.
//
//   PHENOTYPE (the substrate / "brain"): a HyperNEAT substrate whose weights are
//   *painted* by the CPPN and whose hidden neurons are *placed* by it
//   (simplified ES-HyperNEAT). Queried over 3D space, it outputs a density and a
//   hue — the volumetric self-portrait.

// --- CPPN genotype (DNA) ----------------------------------------------------

/** CPPN inputs: x1,y1,z1, x2,y2,z2, bias — the two node positions it connects. */
export const CPPN_INPUTS = 7;
/** Compact hidden layer(s). Small DNA → closable loop + legible graph. */
export const CPPN_HIDDEN = [6] as const;
/** CPPN outputs: [weight, leo] — the painted weight and a link-expression gate. */
export const CPPN_OUTPUTS = 2;

export const CPPN_LAYERS: readonly number[] = [CPPN_INPUTS, ...CPPN_HIDDEN, CPPN_OUTPUTS];
export const CPPN_TRANSITIONS = CPPN_LAYERS.length - 1;
export const CPPN_MAX_WIDTH: number = CPPN_LAYERS.reduce((a, b) => Math.max(a, b), 0);

export const WEIGHT_COUNT: number = (() => {
  let n = 0;
  for (let i = 0; i < CPPN_TRANSITIONS; i++) n += CPPN_LAYERS[i]! * CPPN_LAYERS[i + 1]!;
  return n;
})();
export const BIAS_COUNT: number = (() => {
  let n = 0;
  for (let i = 1; i < CPPN_LAYERS.length; i++) n += CPPN_LAYERS[i]!;
  return n;
})();

/** The DNA's real-valued dimension (weights ++ biases) — what the self-portrait
 *  must re-encode. Activation choices are the discrete part of the genome. */
export const GENOME_DIM = WEIGHT_COUNT + BIAS_COUNT;

export const WEIGHT_OFFSETS: readonly number[] = (() => {
  const offs: number[] = [];
  let n = 0;
  for (let t = 0; t < CPPN_TRANSITIONS; t++) {
    offs.push(n);
    n += CPPN_LAYERS[t]! * CPPN_LAYERS[t + 1]!;
  }
  return offs;
})();
export const NODE_OFFSETS: readonly number[] = (() => {
  const offs: number[] = [];
  let n = 0;
  for (let l = 1; l < CPPN_LAYERS.length; l++) {
    offs.push(n);
    n += CPPN_LAYERS[l]!;
  }
  return offs;
})();

// --- Substrate phenotype (the brain that draws) -----------------------------

/** Substrate input features per queried point: x, y, z, r=|p|, bias. */
export const SUB_INPUTS = 5;
/** Hidden neurons, placed in the volume by the CPPN (simplified ES-HyperNEAT). */
export const SUB_HIDDEN = 8;
/** Substrate outputs: [density (alpha), hue]. */
export const SUB_OUTPUTS = 2;
