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
 *      threshold (or a hard cap) the brain stops pondering and switches to WRITE.
 *    • `emitVal`, `emitEnd` (v7) — per-neuron readout vectors (read at (p,p) like emit),
 *      the AUTOREGRESSIVE WRITER. After the read, the brain emits its DNA element by
 *      element from its OWN neurons: `value = σ(Σ emitVal·activity)` is the next gene,
 *      `end = Σ emitEnd·activity` is the end-of-sequence signal — when it fires the
 *      creature has DECIDED its own length. No CPPN re-projection, no per-gene lookup,
 *      no length given (v6's quine is gone). Off at birth ⇒ a fresh creature writes a
 *      constant and never halts; the writer arises by mutation like every faculty.
 *  All temporal channels arise by mutation, none pre-wired. Connection *expression* is
 *  decided by ES-HyperNEAT band-pruning on the weight pattern (Risi & Stanley 2012). */
export const CPPN_OUTPUTS = 11;

/** Canonical node ids: inputs 0..6, outputs 7..17 (weight, bias, α, emit, modGate,
 *  fixX, fixY, fixScale, halt, emitVal, emitEnd), hidden ids start at 18. */
export const INPUT_IDS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const OUTPUT_IDS: readonly number[] = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
export const FIRST_HIDDEN_ID = 18;

/** The gentle ON-RAMP wiring: `minimalGenome` wires ONLY the first `IMAGE_OUTPUTS`
 *  channels (weight, bias) at birth; every temporal channel (α, emit, modGate,
 *  fixX/Y/Scale, halt) starts UNCONNECTED and arises by mutation. This is permanent —
 *  it is how each faculty on-ramps gently — and is independent of the target below. */
export const IMAGE_OUTPUTS = 2;

/** v7 — the reconstruction target is the FULL genome (empty deferral set).
 *
 *  v6's fork (B) excluded the temporal channels because its decode was a SPATIAL
 *  gene-readout of a STATIC image (which cannot encode how a creature learns / attends /
 *  ponders — forcing them in yielded R² ≈ −12, a measured negative result). v7's decode
 *  is fundamentally different: the brain AUTOREGRESSIVELY WRITES its DNA from its OWN
 *  recurrent state — a state shaped by ALL its genes (the temporal ones included, via the
 *  plastic / neuromodulated / attentional read). So there is no static-image argument for
 *  excluding any channel a priori: the writer is asked to reproduce its WHOLE genome, and
 *  the honest skill reflects how much of it the brain can actually reach. Whether it can
 *  reach the temporal genes is an open empirical question, reported honestly — not assumed
 *  away. Hence: nothing deferred. `targetVector ≡ genomeVector`, `targetCount ≡ paramCount`. */
export const DEFERRED_OUTPUT_IDS: ReadonlySet<number> = new Set<number>();
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
