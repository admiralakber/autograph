// Topology — the single source of truth for the loop's two networks.
//
//   GENOTYPE (the DNA): a *connective* CPPN evolved with real NEAT — augmenting
//   topologies. Given a pair of 3-D coordinates it returns SIX channels — the genome's
//   three EXPRESSIONS (none of them a phenotype behaviour):
//     • STRUCTURE — `weight` (the connection pattern ES-HyperNEAT grows the brain from;
//       it also sets each neuron's activation) + `bias`.
//     • APPEARANCE — `density` + `hue`: the self-portrait the DNA PAINTS over space
//       (CPPN-art, à la Picbreeder/Stanley). This IMAGE is what the brain READS.
//     • FACULTIES — `α` (per-connection Hebbian plasticity) + `modGate` (neuromod gate).
//   It starts minimal and complexifies (add-node / add-connection, recurrent links).
//
//   PHENOTYPE (the substrate / "brain"): a HyperNEAT substrate GROWN by genuine
//   ES-HyperNEAT (Risi & Stanley 2012) from the CPPN's WEIGHT pattern — a quadtree
//   decomposition with variance-based division + band-pruning, placing the hidden
//   neurons where the pattern carries information. The brain's INPUT is the IMAGE (read
//   via foveated RAM glimpses); its OUTPUT NEURONS are the WRITER — the emitted DNA value,
//   the end-of-sequence + halt signals, the next-look (x, y, scale), and its own
//   neuromodulator m — all computed by RUNNING the recurrent / plastic / neuromodulated
//   rollout. The brain reads its self-portrait and writes its DNA back.
//
//   THE BOUNDARY (Stanley-grade): the CPPN paints structure + appearance + faculties; the
//   BRAIN runs to behave. density/hue is the DNA's APPEARANCE the brain reads — NEVER a
//   brain output. emit/halt/look/m are the BRAIN's outputs — NEVER CPPN channels.

// --- CPPN genotype (DNA) — NEAT graph ---------------------------------------

/** CPPN inputs: x1,y1,z1, x2,y2,z2, bias — the two 3-D coordinates it relates. */
export const CPPN_INPUTS = 7;
/** CPPN outputs (6) — the genome's three expressions, NONE a phenotype behaviour:
 *    0 `weight`  — STRUCTURE: connection weight between two coords; ES-HyperNEAT grows the
 *                  brain from this pattern, and it also sets each neuron's activation.
 *    1 `bias`    — STRUCTURE: a neuron's bias, read at a single coord (p,p).
 *    2 `density` — APPEARANCE: the self-portrait's alpha at a coord (CPPN-art).
 *    3 `hue`     — APPEARANCE: the self-portrait's colour at a coord (CPPN-art).
 *    4 `α`       — FACULTY: per-connection Hebbian plasticity coefficient (adaptive
 *                  HyperNEAT, Risi & Stanley); effective weight = w + α·trace.
 *    5 `modGate` — FACULTY: per-connection neuromodulation gate (Backpropamine form) —
 *                  how much the brain's own m(t) gates that synapse's learning rate.
 *  The IMAGE (density/hue) is the DNA's appearance the brain READS; the brain's behaviours
 *  (emit value/end, halt, next-look, m) are NOT here — they are substrate OUTPUT NEURONS,
 *  computed by running (see SUB_OUTPUTS + substrate.ts). Connection *expression* is decided
 *  by ES-HyperNEAT band-pruning on the weight pattern. */
export const CPPN_OUTPUTS = 6;

/** Canonical node ids: inputs 0..6, outputs 7..12 (weight, bias, density, hue, α, modGate),
 *  hidden ids start at 13. */
export const INPUT_IDS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const OUTPUT_IDS: readonly number[] = [7, 8, 9, 10, 11, 12];
export const FIRST_HIDDEN_ID = 13;

/** The gentle ON-RAMP. `minimalGenome` wires the STRUCTURE + APPEARANCE channels (weight,
 *  bias, density, hue — the first `BIRTH_OUTPUTS`) at birth, so a fresh creature has both a
 *  grown brain and a visible (non-flat) self-portrait; the FACULTIES (α, modGate) start
 *  UNCONNECTED and arise by mutation. The brain's WRITER output neurons on-ramp STRUCTURALLY
 *  too — unconnected at birth (a constant write, never halting) until the weight pattern
 *  expresses connections to them; the faculties then arise neuron- and synapse-wise. */
export const BIRTH_OUTPUTS = 4;
/** Kept for the reconstruction-target helpers in cppn.ts. v7's fork (B) is empty: the writer
 *  is asked to reproduce the WHOLE genome, so `targetVector ≡ genomeVector`. */
export const DEFERRED_OUTPUT_IDS: ReadonlySet<number> = new Set<number>();
/** Innovation numbers 0..(CPPN_INPUTS*CPPN_OUTPUTS-1) are the minimal genome's
 *  input→output connections; the registry hands out fresh ones after that. */
export const BASE_INNOV = CPPN_INPUTS * CPPN_OUTPUTS;

// --- Substrate phenotype (the brain that READS the image + WRITES the DNA) ---

/** Substrate INPUT neurons (6) — the brain's read/write sensory port, fed per phase:
 *    READ : a foveated glimpse of the self-portrait at the brain's chosen fixation —
 *           [fovea density, fovea hue, periphery density] — plus 0 (no prev value), READ mode, bias.
 *    WRITE: [0, 0, 0, the brain's own previous emitted value (autoregressive feedback),
 *           WRITE mode, bias].
 *  The image is read "across its channels"; where to look next is the brain's own output. */
export const SUB_INPUTS = 6;
/** Substrate OUTPUT neurons (7) — the WRITER, computed by running the brain:
 *    0 emitVal   — the next DNA value (a real value, σ of the neuron; NOT a discrete token).
 *    1 emitEnd   — end-of-sequence: the creature decides its own DNA length.
 *    2 fixX, 3 fixY, 4 fixScale — where + how zoomed to glimpse next (RAM hard attention).
 *    5 halt      — Adaptive Computation Time: "I've read enough", switch to writing.
 *    6 m         — the brain's own neuromodulator (gates its plasticity; Backpropamine). */
export const SUB_OUTPUTS = 7;
// NOTE: hidden-neuron count is NOT fixed — ES-HyperNEAT discovers placement and density
// from the CPPN weight pattern (see eshyperneat.ts / hyperparams.ts caps).
