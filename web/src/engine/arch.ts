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
//   network outputs a density and a hue — the volumetric image the brain emerges
//   within. See eshyperneat.ts for the algorithm.

// --- CPPN genotype (DNA) — NEAT graph ---------------------------------------

/** CPPN inputs: x1,y1,z1, x2,y2,z2, bias — the two 3-D coordinates it relates. */
export const CPPN_INPUTS = 7;
/** CPPN outputs: [weight, bias | α, emit, modGate, fixX, fixY, fixScale]. The first
 *  two paint the STATIC image: `weight` paints a connection between two coordinates;
 *  `bias`, read at a single coordinate (p,p), is that neuron's bias. The rest paint
 *  the TEMPORAL brain and start OFF (gentle on-ramp; deferred from the loop target by
 *  fork (B), below):
 *    • `plasticity` α (v6 Phase 2) — per-connection Hebbian coefficient, painted at
 *      the same coordinate pair as the weight; effective weight = w + α·trace.
 *    • `emit` (v6 Phase 3) — per-neuron, read at (p,p) like bias: how much that
 *      neuron's activity contributes to the brain's own neuromodulatory signal m(t).
 *    • `modGate` (v6 Phase 3) — per-connection, painted at the weight coordinate
 *      pair: how much m(t) gates that synapse's Hebbian learning rate (Backpropamine
 *      form, EVOLVED).
 *    • `fixX`, `fixY`, `fixScale` (v6 Phase 4) — per-neuron, read at (p,p) like emit:
 *      the ATTENTION readouts. Each step the brain emits a fixation (location + scale)
 *      from its own activity and takes a foveated glimpse of its image there (RAM,
 *      EVOLVED hard attention).
 *    • `halt` (v6 Phase 5) — per-neuron, read at (p,p) like emit: the brain's Adaptive
 *      Computation Time signal. It accumulates over the READ rollout; when it crosses
 *      threshold (or a hard cap) the brain stops pondering and switches to EMIT.
 *  All temporal channels arise by mutation, none pre-wired. Connection *expression* is
 *  decided by ES-HyperNEAT band-pruning on the weight pattern (Risi & Stanley 2012). */
export const CPPN_OUTPUTS = 9;

/** Canonical node ids: inputs 0..6, outputs 7..15 (weight, bias, α, emit, modGate,
 *  fixX, fixY, fixScale, halt), hidden ids start at 16. */
export const INPUT_IDS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const OUTPUT_IDS: readonly number[] = [7, 8, 9, 10, 11, 12, 13, 14, 15];
export const FIRST_HIDDEN_ID = 16;

/** The gentle ON-RAMP wiring: `minimalGenome` wires ONLY the first `IMAGE_OUTPUTS`
 *  channels (weight, bias) at birth; every temporal channel (α, emit, modGate,
 *  fixX/Y/Scale, halt) starts UNCONNECTED and arises by mutation. This is permanent —
 *  it is how each faculty on-ramps gently — and is independent of the target below. */
export const IMAGE_OUTPUTS = 2;

/** v6 fork (B) — which CPPN output channels are EXCLUDED from the reconstruction
 *  target: the temporal channels (α, emit, modGate, fixX/Y/Scale, halt).
 *
 *  Phase 5 tested the hypothesis that a TEMPORAL read→ponder→emit decode would make
 *  these reconstructable — and found, honestly, that it does NOT, for a structural
 *  reason that follows from fork (B)'s own premise: the image stays the STATIC
 *  initial-state field, and a static self-portrait does not encode how the creature
 *  learns / attends / ponders. Reading it over a plastic, attentional lifetime makes
 *  those faculties SHAPE the read (attention is load-bearing — ablating it measurably
 *  changes the reconstruction), but adds no spatial information ABOUT the temporal
 *  genes, so the spatial gene-readout cannot extract them. Forcing them into the target
 *  yields R² ≈ −12 (worse than the mean) and destroys the gradient (skill ≡ 0, no
 *  bootstrap) — a measured negative result, not honest difficulty.
 *
 *  So fork (B) STANDS: the temporal channels are load-bearing INPUTS to the read (they
 *  choose where to glimpse, when to halt), not reconstructed OUTPUTS. The creature can
 *  read back what its image SHOWS (its visible form: weight + bias) but not its
 *  invisible temporal interior. The loop reconstructs the image-encoded genome; the
 *  honest skill it earns is humbler than v5's, and that is the truth. (Empty set ⇒
 *  every channel rejoins — kept here, behind this measured finding, for a future
 *  dynamics-based readout that could reconstruct the temporal genes from the read's
 *  signature rather than the static image.) */
export const DEFERRED_OUTPUT_IDS: ReadonlySet<number> = new Set(OUTPUT_IDS.slice(IMAGE_OUTPUTS));
/** Innovation numbers 0..(CPPN_INPUTS*CPPN_OUTPUTS-1) are the minimal genome's
 *  input→output connections; the registry hands out fresh ones after that. */
export const BASE_INNOV = CPPN_INPUTS * CPPN_OUTPUTS;

// --- Substrate phenotype (the brain that emerges within the image) ----------

/** Substrate input features per queried point: x, y, z, r=|p|, bias. These are
 *  the 5 fixed *sensor* neurons; the network's response, swept over 3-D space,
 *  is the volumetric image the creature is born in. */
export const SUB_INPUTS = 5;
/** Substrate outputs: [density (alpha), hue]. */
export const SUB_OUTPUTS = 2;
// NOTE: hidden-neuron count is NOT fixed — ES-HyperNEAT discovers placement and
// density from the CPPN pattern (see eshyperneat.ts / hyperparams.ts caps).
