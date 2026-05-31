// Topology — the single source of truth for both networks in the loop.
//
//   GENOTYPE (the DNA): a *connective* CPPN evolved with real NEAT — augmenting
//   topologies. It starts minimal (inputs wired straight to outputs) and grows
//   structure over generations via add-node / add-connection mutations with
//   innovation tracking; recurrent connections are allowed. Given a pair of
//   3-D coordinates it returns [weight, bias]: the connection weight painted
//   between two points, and a bias pattern read at a point. The genome is a
//   graph, so its size *grows* — visible complexification.
//
//   PHENOTYPE (the substrate / "brain"): a HyperNEAT substrate whose connection
//   weights are *painted* by the CPPN and whose hidden neurons are *placed,
//   density-chosen, and wired* by genuine ES-HyperNEAT (Risi & Stanley 2012):
//   a quadtree decomposition of the CPPN-encoded weight pattern, with variance-
//   based division and band-pruning. Queried over 3D space, the resulting
//   network outputs a density and a hue — the volumetric self-portrait. See
//   eshyperneat.ts for the algorithm.

// --- CPPN genotype (DNA) — NEAT graph ---------------------------------------

/** CPPN inputs: x1,y1,z1, x2,y2,z2, bias — the two 3-D coordinates it relates. */
export const CPPN_INPUTS = 7;
/** CPPN outputs: [weight, bias]. `weight` paints a connection between two
 *  coordinates; `bias`, read at a single coordinate (p,p), is that neuron's
 *  bias. Connection *expression* is decided by ES-HyperNEAT band-pruning on the
 *  weight pattern (Risi & Stanley 2012), not a separate gate. */
export const CPPN_OUTPUTS = 2;

/** Canonical node ids: inputs 0..6, outputs 7..8, hidden ids start at 9. */
export const INPUT_IDS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const OUTPUT_IDS: readonly number[] = [7, 8];
export const FIRST_HIDDEN_ID = 9;
/** Innovation numbers 0..(CPPN_INPUTS*CPPN_OUTPUTS-1) are the minimal genome's
 *  input→output connections; the registry hands out fresh ones after that. */
export const BASE_INNOV = CPPN_INPUTS * CPPN_OUTPUTS;

// --- Substrate phenotype (the brain that draws) -----------------------------

/** Substrate input features per queried point: x, y, z, r=|p|, bias. These are
 *  the 5 fixed *sensor* neurons; the network's response, swept over 3-D space,
 *  is the volumetric self-portrait. */
export const SUB_INPUTS = 5;
/** Substrate outputs: [density (alpha), hue]. */
export const SUB_OUTPUTS = 2;
// NOTE: hidden-neuron count is NOT fixed — ES-HyperNEAT discovers placement and
// density from the CPPN pattern (see eshyperneat.ts / hyperparams.ts caps).
