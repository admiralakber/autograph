// Topology — the single source of truth for both networks in the loop.
//
//   GENOTYPE (the DNA): a *connective* CPPN evolved with real NEAT — augmenting
//   topologies. It starts minimal (inputs wired straight to outputs) and grows
//   structure over generations via add-node / add-connection mutations with
//   innovation tracking; recurrent connections are allowed. Given a pair of
//   substrate node positions it returns a connection weight (+ a link-expression
//   gate). The genome is a graph, so its size *grows* — visible complexification.
//
//   PHENOTYPE (the substrate / "brain"): a HyperNEAT substrate whose weights are
//   *painted* by the CPPN and whose hidden neurons are *placed* by it
//   (simplified ES-HyperNEAT). Queried over 3D space, it outputs a density and a
//   hue — the volumetric self-portrait.

// --- CPPN genotype (DNA) — NEAT graph ---------------------------------------

/** CPPN inputs: x1,y1,z1, x2,y2,z2, bias — the two node positions it connects. */
export const CPPN_INPUTS = 7;
/** CPPN outputs: [weight, leo] — the painted weight and a link-expression gate. */
export const CPPN_OUTPUTS = 2;

/** Canonical node ids: inputs 0..6, outputs 7..8, hidden ids start at 9. */
export const INPUT_IDS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const OUTPUT_IDS: readonly number[] = [7, 8];
export const FIRST_HIDDEN_ID = 9;
/** Innovation numbers 0..(CPPN_INPUTS*CPPN_OUTPUTS-1) are the minimal genome's
 *  input→output connections; the registry hands out fresh ones after that. */
export const BASE_INNOV = CPPN_INPUTS * CPPN_OUTPUTS;

// --- Substrate phenotype (the brain that draws) -----------------------------

/** Substrate input features per queried point: x, y, z, r=|p|, bias. */
export const SUB_INPUTS = 5;
/** Hidden neurons, placed in the volume by the CPPN (simplified ES-HyperNEAT). */
export const SUB_HIDDEN = 8;
/** Substrate outputs: [density (alpha), hue]. */
export const SUB_OUTPUTS = 2;
