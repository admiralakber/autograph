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
 * length — a clean self-loop. `verify.ts` mirror + `PROTOCOL_VERSION` bump in lock-step) →
 * epoch 8 (THE COLD SELF-WRITE: reason (b), the SCORING-METRIC SEMANTICS changed. The
 * curriculum that bootstraps the length-discovery now hands the length decision over FAST
 * and makes length genuinely load-bearing, so a creature's `fidelity` means something
 * different — the genuine self-length reconstruction (it writes its own gene count), not the
 * old early-halting teacher-gamed value. Old v7 elites would mis-rank against the honest cold
 * metric, so the world rotates to a fresh room. The GENOME WIRE FORMAT is UNCHANGED
 * (`CPPN_OUTPUTS` stays 11), so the coordinator's `verify.ts` + `PROTOCOL_VERSION` are
 * untouched — this is a metric rotation, and the v7 self-writer ARCHITECTURE stands.) →
 * epoch 9 (THE CLEAN ARCHITECTURE: reason (a), the GENOME WIRE FORMAT changed. The
 * Stanley-grade genotype↔phenotype fix moves the brain's BEHAVIOURS out of the CPPN — they
 * become substrate OUTPUT NEURONS, computed by running — and makes density/hue genuine
 * CPPN-art APPEARANCE channels (the image the brain READS, never a brain output). So
 * `CPPN_OUTPUTS` drops 11→6 (weight, bias, density, hue, α, modGate). v7/epoch-8 elites no
 * longer verify against the new `genomeBytes` header (OUTPUTS=6), so the world rotates to a
 * fresh genesis-v9 room. Byte layout unchanged; `verify.ts` mirror + `PROTOCOL_VERSION` 5→6
 * bump in lock-step.) →
 * epoch 10 (THE STRUCTURAL SELF-WRITE: reason (a), the GENOME WIRE FORMAT changed. The brain
 * now reconstructs its EXACT DNA — the genome GRAPH (topology + activation types + weights),
 * von Neumann self-reproduction — reading a self-portrait that is a true DEPICTION OF THE
 * BUILT NETWORK (rendered from the substrate, not a CPPN channel). The density/hue appearance
 * channels are retired, so `CPPN_OUTPUTS` drops 11→4 (weight, bias, α, modGate). genesis-v9
 * elites no longer verify against the new `genomeBytes` header (OUTPUTS=4) → a fresh
 * genesis-v10 room. Byte layout unchanged; `verify.ts` mirror + `PROTOCOL_VERSION` 6→7 in
 * lock-step. The glimpse also becomes SPHERICAL (r,θ,φ) volumetric attention — phenotype-only.)
 */
export const ARCHIVE_EPOCH = 10;
