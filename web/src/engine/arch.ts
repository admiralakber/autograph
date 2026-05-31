// Topology — the single source of truth for the loop's two networks.
//
//   GENOTYPE (the DNA): a *connective* CPPN evolved with real NEAT — augmenting
//   topologies. Given a pair of 3-D coordinates it returns FOUR channels — structure +
//   faculties, the genome's expression of its own connectivity:
//     • STRUCTURE — `weight` (the connection pattern ES-HyperNEAT grows the brain from;
//       it also sets each neuron's activation) + `bias`.
//     • FACULTIES — `α` (per-connection Hebbian plasticity) + `modGate` (neuromod gate).
//   It starts minimal and complexifies (add-node / add-connection, recurrent links).
//   There is NO separate density/hue "appearance" channel: the self-portrait is not a
//   correlated aesthetic, it is a true DEPICTION OF THE BUILT NETWORK (see below).
//
//   PHENOTYPE (the substrate / "brain"): a HyperNEAT substrate GROWN by genuine
//   ES-HyperNEAT (Risi & Stanley 2012) from the CPPN's WEIGHT pattern — a quadtree
//   decomposition with variance-based division + band-pruning, placing the hidden
//   neurons where the pattern carries information. Its INPUT is the IMAGE (read via
//   foveated 3-D RAM glimpses); its OUTPUT NEURONS are the WRITER — the emitted DNA value,
//   the end-of-sequence + halt signals, the next-look (x, y, z, scale), and its own
//   neuromodulator m — all computed by RUNNING the recurrent / plastic / neuromodulated
//   rollout. The brain reads a true picture of its own wiring and writes the DNA back.
//
//   THE IMAGE (the self-portrait): rendered FROM THE BUILT SUBSTRATE — density ↔ each
//   neuron's connection strength (Σ|incoming weight| + |bias|) and the wires between them,
//   hue ↔ each neuron's ACTIVATION TYPE. So the picture genuinely depicts the creature's
//   own brain (render = network = code, made literal), and the loop is the real inverse
//   problem: read the network's portrait → write the CPPN recipe that grows it. It is NOT
//   a CPPN output channel and NEVER a brain output (see substrate.ts renderSubstrateImage).

// --- CPPN genotype (DNA) — NEAT graph ---------------------------------------

/** CPPN inputs: x1,y1,z1, x2,y2,z2, bias — the two 3-D coordinates it relates. */
export const CPPN_INPUTS = 7;
/** CPPN outputs (4) — structure + faculties, the genome's expression of its connectivity:
 *    0 `weight`  — STRUCTURE: connection weight between two coords; ES-HyperNEAT grows the
 *                  brain from this pattern, and it also sets each neuron's activation.
 *    1 `bias`    — STRUCTURE: a neuron's bias, read at a single coord (p,p).
 *    2 `α`       — FACULTY: per-connection Hebbian plasticity coefficient (adaptive
 *                  HyperNEAT, Risi & Stanley); effective weight = w + α·trace.
 *    3 `modGate` — FACULTY: per-connection neuromodulation gate (Backpropamine form) —
 *                  how much the brain's own m(t) gates that synapse's learning rate.
 *  The IMAGE is NOT a channel here — it is rendered from the BUILT SUBSTRATE (a true
 *  depiction of the wiring; renderSubstrateImage in substrate.ts). The brain's behaviours
 *  (emit value/end, halt, next-look, m) are NOT here either — they are substrate OUTPUT
 *  NEURONS, computed by running. Connection *expression* is decided by ES-HyperNEAT
 *  band-pruning on the weight pattern. */
export const CPPN_OUTPUTS = 4;

/** Canonical node ids: inputs 0..6, outputs 7..10 (weight, bias, α, modGate), hidden
 *  ids start at 11. */
export const INPUT_IDS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const OUTPUT_IDS: readonly number[] = [7, 8, 9, 10];
export const FIRST_HIDDEN_ID = 11;

/** The gentle ON-RAMP. `minimalGenome` wires the STRUCTURE channels (weight, bias — the
 *  first `BIRTH_OUTPUTS`) at birth, so a fresh creature has a grown brain (hence a non-flat
 *  self-portrait — the substrate's own wiring); the FACULTIES (α, modGate) start UNCONNECTED
 *  and arise by mutation. The brain's WRITER output neurons on-ramp STRUCTURALLY too —
 *  unconnected at birth (a constant write, never halting) until the weight pattern expresses
 *  connections to them; the faculties then arise neuron- and synapse-wise. */
export const BIRTH_OUTPUTS = 2;
/** Kept for the reconstruction-target helpers in cppn.ts. The writer is asked to reproduce
 *  the WHOLE genome, so `targetVector ≡ genomeVector` (DEFERRED is empty). */
export const DEFERRED_OUTPUT_IDS: ReadonlySet<number> = new Set<number>();
/** Innovation numbers 0..(CPPN_INPUTS*CPPN_OUTPUTS-1) are the minimal genome's
 *  input→output connections; the registry hands out fresh ones after that. */
export const BASE_INNOV = CPPN_INPUTS * CPPN_OUTPUTS;

// --- Substrate phenotype (the brain that READS the image + WRITES the DNA) ---

/** Substrate INPUT neurons (6) — the brain's read/write sensory port, fed per phase:
 *    READ : a foveated 3-D glimpse of the self-portrait at the brain's chosen fixation —
 *           [fovea density, fovea hue, periphery density] — plus 0 (no prev value), READ mode, bias.
 *    WRITE: [0, 0, 0, the brain's own previous emitted value (autoregressive feedback),
 *           WRITE mode, bias].
 *  The image read is a true picture of the wiring; where to look next is the brain's output. */
export const SUB_INPUTS = 6;
/** Substrate OUTPUT neurons (8) — the WRITER, computed by running the brain:
 *    0 emitVal   — the next DNA value (a real value, σ of the neuron; NOT a discrete token).
 *    1 emitEnd   — end-of-sequence: the creature decides its own DNA length.
 *    2 fixX, 3 fixY, 4 fixZ, 5 fixScale — where (in the VOLUME) + how zoomed to glimpse next
 *                  (RAM hard attention, now 3-D — the brain attends in depth).
 *    6 halt      — Adaptive Computation Time: "I've read enough", switch to writing.
 *    7 m         — the brain's own neuromodulator (gates its plasticity; Backpropamine). */
export const SUB_OUTPUTS = 8;
// NOTE: hidden-neuron count is NOT fixed — ES-HyperNEAT discovers placement and density
// from the CPPN weight pattern (see eshyperneat.ts / hyperparams.ts caps).
