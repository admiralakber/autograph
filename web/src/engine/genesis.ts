// The Genesis of the canonical world — preserved byte-for-byte, emoji included.
// The entire genealogy (the signed Merkle-DAG tree of life) descends from this
// exact seed. The whole world is watching and helping one neural network — and
// this algorithm — draw its true self out of the false.
export const GENESIS_SEED =
  'And yet.... 🦕 a trace.... ✨ of.. the true self... 🐣 exists.... 🐥 within the false 🍗 = 🦖';

/** A short, fixed label used wherever the Genesis is surfaced in the instrument. */
export const GENESIS_LABEL = 'GENESIS';

/**
 * THE ARCHIVE EPOCH — the single source of truth for the shared world's identity.
 *
 * The swarm's room name is derived from this (`genesis-v${ARCHIVE_EPOCH}`), so a
 * bump AUTO-ROTATES every client onto a fresh shared archive — no manual reset,
 * no stale elites lingering. Bump it whenever the shared MAP-Elites archive
 * becomes INCOMPATIBLE with what's already stored, which happens for EITHER of
 * two reasons:
 *
 *   (a) the GENOME WIRE FORMAT changes  — old elites no longer verify
 *       (mirror: cppn.ts `genomeBytes` / coordinator `verify.ts`); or
 *   (b) the SCORING-METRIC SEMANTICS change — old elites' signed `fidelity`
 *       means something different, so keep-best would mis-rank them against new
 *       ones (e.g. the v3→v4 bump: the loop's skill went from the bypassing
 *       "self-quine" echo to the genuine image→brain read-back — a different
 *       scoring scale entirely, so the old signed scores were no longer
 *       comparable and keep-best had to start fresh).
 *
 * History: v1 (analytic read-back) → v2 (bolt-on reader weights) → v3 (intrinsic
 * self-quine; genome dropped reader) → v4 (read-back through the picture/brain;
 * genome format UNCHANGED from v3, but the metric semantics changed → rotate) →
 * v5 (HARDENED loop skill: the read-back sees only a bounded, per-gene view of
 * the image and skill is complexity-weighted — so v4's pre-hardening elites,
 * signed at the old looser ~0.9, are no longer comparable and would freeze
 * keep-best; genome format UNCHANGED from v4, metric semantics changed → rotate) →
 * v6 (THE TEMPORAL BRAIN: the GENOME WIRE FORMAT changed — `CPPN_OUTPUTS` 2→9,
 * adding the temporal channels [α plasticity, neuromod emit/modGate, attention
 * fixX/fixY/fixScale, halt]. v5 elites no longer verify against the v6 `genomeBytes`
 * header (which now records OUTPUTS=9), so the world rotates to a fresh v6 room —
 * reason (a), the genome wire format. The read-back is now a temporal read→ponder→
 * emit; the coordinator's `verify.ts` mirror + `PROTOCOL_VERSION` bump in lock-step) →
 * v7 (THE SELF-WRITER: the GENOME WIRE FORMAT changed AGAIN — `CPPN_OUTPUTS` 9→11, adding
 * the autoregressive WRITER channels [emitVal, emitEnd]. v6 elites no longer verify against
 * the v7 `genomeBytes` header (OUTPUTS=11), so the world rotates to a fresh v7 room —
 * reason (a). The decode is no longer v6's quine re-projection: the brain now reads its
 * image then AUTOREGRESSIVELY WRITES its own DNA, one gene at a time, DECIDING its own
 * length — a clean self-loop. `verify.ts` mirror + `PROTOCOL_VERSION` bump in lock-step).
 */
export const ARCHIVE_EPOCH = 7;
