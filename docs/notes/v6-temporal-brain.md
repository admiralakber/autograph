# v6 — the temporal / generative brain 🧠↺ (design doc)

> **Status: in progress on branch `v6-temporal-brain`. Built in verified phases.
> `main` (v5, `genesis-v5`) stays live + untouched; v6 merges + deploys only when
> COMPLETE, verified, honest and docs-coherent.** This document is the spec on the
> record; it is updated as phases land.

## The move

v5 is a creature that is a *static function*: query the substrate over space → a
density/hue field (the image), read that image back through the same brain → DNA′.
v6 turns each creature into a **generative dynamical system** — a brain that runs
over *time*, **learns within its own lifetime**, **chooses where to look**, and
**takes contemplation time before it names its beginning**.

**The hard rule (owner, non-negotiable): everything is INTRINSIC to the ONE
evolved phenotype.** No separate networks, no regressors, no bolt-ons, ever. Every
new faculty (plasticity, neuromodulation, attention, halting) is painted by the
*same* CPPN and embodied in the *same* ES-HyperNEAT substrate, and arrives by NEAT
mutation — a gentle on-ramp from the minimal seed, kept evolvable.

## Architecture (the eight pillars)

1. **Temporal forward pass** *(Phase 1 — this pass).* Replace the single-shot /
   2-settle substrate eval with a genuine **T-step recurrent rollout** (perf-aware
   budget). This makes the recurrent / self / lateral edges the genome *already*
   evolves do real work, and is the foundation everything else hangs off.
2. **Hebbian plasticity** *(Phase 2).* Each connection becomes `w = w₀ + α·trace`,
   a base weight plus a plastic term governed by a per-connection rule
   `Δ = η·(A·xᵢxⱼ + B·xᵢ + C·xⱼ + D)` whose coefficients are **painted by the
   CPPN** (extra output channels) — the differentiable-plasticity *form* [DP], but
   **evolved**, not back-propagated. Weights self-modify over the rollout: the
   creature *learns toward self-knowledge within its lifetime*.
3. **Neuromodulation** *(Phase 3).* A network-emitted signal `m(t)`, computed from
   the creature's **own** activity/inputs, **gates** the Hebbian learning rates per
   node/connection — the Backpropamine *form* [BP], evolved. The CPPN paints which
   neurons emit `m(t)` and which connections it modulates. A **functional** gating
   signal, never a viz channel.
4. **Attention / glimpse sensors** *(Phase 4).* The brain outputs **where to look
   next** (fixation + scale); it takes a foveated coarse+fine **glimpse** of its
   own image, recurs, and chooses the next gaze — evolved **hard attention** [RAM,
   AA]. Evolution handles the non-differentiable location choice natively (no
   REINFORCE).
5. **Read → ponder → emit + halting** *(Phase 5).* **READ:** glimpse… glimpse…
   building recurrent state (outputs NOOP'd). **HALT:** an Adaptive-Computation-Time
   gate [ACT] with a **ponder cost** + a **hard step cap** decides "enough". **EMIT:**
   autoregressively output DNA′ (inputs NOOP'd / zero-fed) [seq2seq]. The creature
   takes contemplation time before naming its beginning.
6. **Channels / initial-state output** *(Phase 6 / threaded through 2–5).* The CPPN
   emits **more per-connection channels** — `weight, bias, α-plasticity, neuromod
   strength/wiring` — painting the **initial** phenotype state. The rendered image
   is the **static initial-state field**; we do **not** visualise the runtime
   Hebbian change live (perf — owner-confirmed). The loop reconstructs the
   **continuous** genome (weights, biases, α, neuromod strengths); **discrete
   topology is the given body** (not reconstructed — if a discrete attribute is ever
   wanted, encode continuous→quantised). Continuous channels (RGBA/HSVA-style)
   carry it; widen as needed.
7. **Honesty guards (first duty to truth).** The self-read goes **through the
   brain's neurons** (never raw pixels — no stash-and-fetch cheat); a **bounded**
   glimpse/read budget so closure is *earned*; baseline-corrected **R² skill** +
   **vitality gate**; blank/random → ~0. Report the genuine numbers however
   humbling — never fake them down *or* up. The harder the task, the more the
   humility has to be earned, not narrated.
8. **Representational sufficiency + evolvability.** Both the genome (CPPN emits all
   channels) and the phenotype (substrate embodies recurrence/plasticity/neuromod/
   attention) must be expressive enough — diverse activations, self/recurrent/
   lateral edges, gates — and kept **evolvable** via NEAT complexification: start
   minimal; plasticity, modulation and attention arrive as **mutations** (a gentle
   on-ramp), never as a fixed scaffold.

## Phase plan (verified gates)

| Phase | Deliverable | Gate |
|---|---|---|
| **1. Temporal pass** ✓ | T-step recurrent rollout; recurrent/self/lateral edges functional | build ✓ + smoke ✓, v5 loop still honest; recurrence measurably affects output |
| **2. Hebbian plasticity** ✓ | CPPN-painted α; weights self-modify over the rollout | closure stays earned; blank/random ~0 |
| **3. Neuromodulation** ✓ | evolved `m(t)` gating plastic rates | functional gate (ablating `m` changes learning) |
| **4. Attention / glimpse** ✓ | evolved fixation+scale; foveated glimpses of own image | bounded glimpse budget; honest read |
| **5. Read→ponder→emit + halting** ✓ | ACT halt + ponder cost + hard cap; attention-chosen glimpse read decodes DNA′ | no think-forever; earned closure; attention load-bearing **← this pass** |
| 6. Channels / initial-state | widen CPPN outputs; reconstruct continuous genome | representational sufficiency |
| **Perf-hardening** | eval → Web Workers (off the rAF thread); kill `coordKey` strings + integer-ify `cleanNet`; reuse scratch buffers (×T under v6); WASM/SIMD dense rollout + attention | runs headless (Node / swarm CPU) too; no main-thread eval; identical numbers |
| **Deploy (only when COMPLETE)** | bump `ARCHIVE_EPOCH` (auto-rotate), re-sync coordinator `verify.ts`/fixture/`PROTOCOL_VERSION`, redeploy coordinator + site, live QA | honest numbers; docs-coherent |

Each phase: `npm run build` ✓ + `npm run smoke` ✓ with the loop still honest, a
commit on the branch, and a report to the coordinator for green-light. **No deploy
until v6 is complete.** Because v6 changes the genome wire format, deploy will bump
`ARCHIVE_EPOCH` (the auto-rotate the owner has cleared) and re-sync the
coordinator's verifier — but only at v6-out.

## Phase 1 — what landed (this pass)

- `substrateForward` is now a genuine **T-step rollout** (`HYPER.substrateSteps`),
  replacing the fixed 2-pass settle. Forward edges still settle within a step (so a
  feed-forward-only creature is **byte-identical** to v5 — no regression), while
  recurrent / self / lateral edges (`src ≥ i`) now iterate over **T steps**, doing
  real temporal work for the first time.
- v5's honest loop is preserved: same read-back-through-the-brain decode, same
  baseline-corrected complexity-weighted R², same vitality gate; blank/random
  still score ~0 (asserted in smoke). Skill *values* shift for recurrent creatures
  (their dynamics are now functional) — that is the intended effect, not a
  regression, and it is why deploy will rotate the epoch.
- The rollout is structured so later phases slot in cleanly: state persists across
  steps; the per-step propagation is the primitive the read→ponder→emit loop
  (Phases 4–5) will drive with per-step-varying glimpse inputs.

## Phase 2 — what landed (Hebbian plasticity faculty)

- **The CPPN gained a 3rd output channel, α (plasticity).** `CPPN_OUTPUTS` 2→3 — a
  genome wire-format delta on the branch (minimal genome 9n·14c → **10n·21c**;
  `genomeBytes` records OUTPUTS=3). Each expressed substrate connection reads
  α = tanh(cppn₂) × `plasticityScale` at the same coordinate pair as its weight.
  **Gentle on-ramp:** the α channel starts OFF (zero bias + zero incoming weights
  ⇒ α≈0), so a fresh creature is non-plastic (v5-static, fast path) and plasticity
  arises by ordinary mutation (measured: fresh mean |α| **0.0000**; evolved archive
  mean |α| **~0.5–0.7**).
- **The substrate runs a plastic rollout** (`stepSubstrate` plastic mode): the
  effective weight is `w + α·trace`, the trace a bounded decaying EMA of pre·post
  updated each of the T steps — the differentiable-plasticity *form* [DP], EVOLVED.
  Gated by `hasPlastic` so non-plastic creatures pay nothing.
- **Functional (ablation-confirmed):** for plastic creatures the plastic rollout's
  field differs from the static one by mean |Δ| ≈ **0.30** — the weights genuinely
  self-modify and change behaviour.
- **NOT yet load-bearing for skill — two honest findings:**
  1. Sampling the readback PICTURE via the plastic rollout *crashed* skill
     (~47% → ~2%): the runtime weight-change scrambles the picture↔genome map. So
     the picture stays the **static initial-state field** (owner's spec item 6,
     confirmed by this negative result) — plasticity belongs in the **decode**.
  2. With α in the genome but invisible to the static picture, including it in the
     reconstruction TARGET measured an **impossible subtask**: ~⅓ of the genome the
     image physically cannot encode, dragging the loop to **11% by 2000 gens**
     (down from Phase 1's 47%), still honest, blank/random → 0.

### Fork (B) — APPLIED: measure only what the static image encodes

The owner's call (first duty to truth): reconstructing a channel the static image
physically can't carry is measuring an impossible subtask — a meaningless drag, not
genuine difficulty. So during **Phases 2–4 the reconstruction target = only the
image-encoded channels (weight + bias)**; α (and the neuromod channels Phase 3 adds)
are **DEFERRED from the target** until Phase 5, when the read→ponder→emit plastic
decode finally makes them reconstructable. This is a deliberate, truthful
*measurement* choice, encoded once in `arch.ts` (`IMAGE_OUTPUTS` /
`DEFERRED_OUTPUT_IDS`) and honoured by `cppn.ts` (`targetConns` / `targetVector` /
`applyTargetParams`), so target, read-back, complexity weight and the loop iteration
all agree by construction. The **full** genome (`genomeVector` / `paramCount` /
`genomeBytes`) is untouched — serialisation, lineage and whole-creature complexity
still see every channel; only the *loop's target* shrinks.

- **Recovery (measured).** Removing α from the target restored the loop:
  smoke best-skill **11% → 27% by 2000 gens**, blank/random still **0.000** — the
  α-drag was the impossible-subtask penalty, exactly as predicted.
- **Residual gap to Phase 1's 47% is honest evolutionary dilution, not a measurement
  artefact.** Measured at this commit (Phase 2's α pre-wired at weight 0), the α
  channel was **33%** of the genome (minimal: full 24 genes → target 16); ~⅓ of
  mutations landed on a channel that doesn't help the Phase 2–4 target, so the
  visible-channel search ran ~⅓ slower per generation. **Phase 3 then removed this
  dilution** by switching every temporal channel to a *fully unconnected* on-ramp
  (nothing pre-wired) — best-skill recovered the rest of the way to **~48% by 2000
  gens**, at/above Phase 1. See Phase 3 below.
- **Resolution (Phase 5).** When read→ponder→emit makes the decode temporal, the
  creature reads its image over a plastic *lifetime*; α (and neuromod) then shape the
  decode's dynamics, become reconstructable, and rejoin the target (shrink
  `DEFERRED_OUTPUT_IDS` → the helpers collapse to the full genome again, for free).
  Phase 2 builds the faculty + on-ramp; Phase 5 makes it load-bearing.

## Phase 3 — what landed (neuromodulation faculty)

Backpropamine [BP], but EVOLVED, not back-propagated, and INTRINSIC (no separate
network): the brain emits its own neuromodulatory signal m(t) from its own activity,
and m(t) gates the Hebbian learning rate of Phase 2 — per connection.

- **Two CPPN channels, both CPPN-painted, `CPPN_OUTPUTS` 3→5** (a branch-only genome
  wire-format delta; `genomeBytes` records OUTPUTS=5):
  - **`emit` (output 10, per-neuron, read at (p,p) like bias) — "who emits".** The
    brain's signal is `m(t) = tanh(meanᵢ emit_i · activityᵢ(t−1))`, a one-step-lagged
    (retroactive) readout of the creature's OWN activity; `emit` paints which neurons
    speak into it.
  - **`modGate` g (output 11, per-connection, painted at the weight coordinate pair
    like α) — "what it gates".** The gated update is
    `trace ← (1−η)·trace + η·(1 + g·m(t))·(pre·post)`: m(t) modulates each synapse's
    learning rate. g=0 **or** m=0 ⇒ the factor is 1 ⇒ the Phase 2 update **exactly**.
- **Unified, fully-OFF on-ramp (a Phase-2 refinement too).** Every temporal channel
  (α, emit, modGate) now starts with **no incoming connections** and zero bias, so it
  reads exactly 0. A fresh creature is therefore a v5-static feed-forward brain (the
  fast path — `hasRecurrent`/`hasPlastic`/`hasNeuromod` all false, no T-step cost),
  and each faculty arises ONLY when a structural mutation wires its output. This
  replaced Phase 2's pre-wired-at-zero α, which is why removing that pre-wiring lifted
  the loop the rest of the way to Phase-1 health (see below). Measured: fresh **0/40**
  neuromodulated, mean |emit|=|g| **0.0000**; after 1200 gens **88/189** archive
  creatures evolved neuromodulation (peak mean |emit|, |g| ≈ **0.76**).
- **Functional — m(t) genuinely GATES plasticity (ablation, 2×2 isolation).** On a
  rich creature in the transient regime, the plastic field moves **only** when the
  brain BOTH emits a signal AND a synapse is gated:
  - emit on / gate **off**: Δ **0.00000** (no gate path)
  - emit **off** / gate on (m clamped→0): Δ **0.00000** (reproduces Phase 2)
  - emit on / gate on (m live): Δ **0.0067 mean, 0.152 max** — and a clean **monotonic
    dose-response** in g (0 → .0021 → .0040 → .0057 → .0073). So the brain's own m(t)
    causally modulates the learning rate. (At large α the 6-step constant-input EMA
    converges and the *rate* gating washes out at the fixed point — expected; Phase 5's
    varying glimpse inputs keep it load-bearing throughout. Like α, neuromod is built +
    on-ramped here, load-bearing at Phase 5.)
- **Honest + recovered.** `npm run build` ✓, `npm run smoke` ✓; constant/random
  creatures still score **0.000**; best-skill **48.1% by 2000 gens** (Phase 1: 47%,
  Phase 2(B): 27%). Perf **~195 evals/s** — *faster* than Phase 2 because fresh
  creatures are non-plastic feed-forward (the fast path), only evolved-temporal ones
  pay the T-step rollout. Genome: minimal **12 nodes · 14 conns** (the 3 temporal
  output nodes dormant at birth); `DEFERRED_OUTPUT_IDS` = {9,10,11} (α, emit, modGate),
  all deferred from the loop target by fork (B) until Phase 5.

## Phase 4 — what landed (attention / glimpse faculty)

RAM [RAM], but as EVOLVED hard attention (cf. [AA]) and INTRINSIC (no separate
net): each rollout step the brain emits a FIXATION (location + scale) from its OWN
activity and takes a FOVEATED glimpse of its own image there; the glimpse feeds the
recurrent state; the brain chooses where to look next. Evolution handles the
non-differentiable location choice natively — no REINFORCE.

- **Three CPPN readout channels, `CPPN_OUTPUTS` 5→8** (branch-only genome delta;
  `genomeBytes` records OUTPUTS=8): `fixX` (12), `fixY` (13), `fixScale` (14) — each
  per-neuron, read at (p,p) like `emit`. The fixation is the brain's own activity
  read out: `fixⱼ = tanh(meanᵢ fixⱼ_readout · activityᵢ)` → WHERE (fixX,fixY) + zoom
  (fixScale) to glimpse next.
- **Foveated glimpse of the STATIC image.** The image is rendered to a grid ONCE
  (`HYPER.glimpseRes`²; the static initial-state field, fork (B)), then each glimpse
  reads a fine **fovea** ring + a coarse **periphery** ring (RAM's multi-resolution
  sensor), zoomed by the chosen scale. The brain reads a FIXED image, never a moving
  target. The glimpse (fx, fy, fovea, periphery, bias) is fed as the substrate's input
  sensors, so the per-step propagation primitive is unchanged — attention just varies
  the inputs per step (exactly what Phase 1 built the rollout for).
- **Unified OFF on-ramp** (same scheme as α / neuromod): the fix channels start
  unconnected ⇒ readouts 0 ⇒ a fixed **centred** glimpse, no chosen movement; attention
  arises only when a structural mutation wires the channels. Measured: fresh **0/40**
  choose a fixation (mean roam **0.0000**); after 1200 gens **166/185** archive
  creatures choose (peak |fix readout| ≈ **0.76**).
- **Functional (ablation — fixed vs evolved fixation).** On a rich creature: attention
  OFF ⇒ roam **0.0000**; attention ON ⇒ the gaze roams **0.47** off-centre and the
  foveated glimpses gather different information, so the read-state differs from the
  forced-centred control by mean Δ **0.324**. So the brain genuinely glimpses + chooses
  where to look. (Attention controls the *input*, so it is the most behaviourally
  potent faculty so far — fitting, since Phase 5 makes the glimpses the loop's "read".)
- **Honest + deferred.** `npm run build` ✓, `npm run smoke` ✓; constant/random still
  **0.000**; the reconstruction target is unchanged (attention deferred by fork (B):
  `DEFERRED_OUTPUT_IDS` = {9..14}), so skill stays ~Phase-1 health and attention is
  **not yet load-bearing**. attentionRead ≈ **1.2 ms** (the one-off grid render
  dominates) and is **not in the eval loop** in Phase 4 — Phase 5 wires it in, and the
  perf-hardening phase makes it cheap.

## Phase 5 — what landed (read → ponder → emit + halting), and an honest finding

The culmination: the loop's decode is now the temporal **read → ponder → emit**, and
attention becomes **load-bearing**. But Phase 5 also produced a *measured negative
result* that the owner's first duty to truth requires stating plainly: the temporal
genes **cannot** rejoin the reconstruction target.

**What landed (and is verified):**
- **The decode is now read→ponder→emit (`readPonderEmit` + `selfReadback`).** The brain
  reads its own static image by taking up to `ponderMaxSteps` foveated glimpses: each
  fixation is a default Fibonacci **scan** position PLUS a learned **deviation** the
  brain emits from its own activity (Phase 4 attention). Plasticity + neuromodulation
  are active in the rollout that chooses the gaze. It accumulates an **ACT halt signal**
  (Graves 2016) and stops when it has "seen enough" (or at the cap). The chosen glimpses
  are then projected through the SAME CPPN weights into the hidden layer and DNA′ is
  read out at the genome coordinates — the self-quine round-trip, now driven by an
  attention-chosen, ponder-gated read. A **gentle ponder cost** penalises dithering.
- **+1 CPPN channel `halt` (`CPPN_OUTPUTS` 8→9)**, per-neuron readout, OFF at birth
  (unconnected) ⇒ a fresh creature ponders to the cap with no chosen halt; halting
  arises by mutation. The fixation default also changed from "centred" (Phase 4) to an
  informative **scan** — without it the read is uninformative (centre only) and the loop
  cannot bootstrap (a measured result).
- **Attention is load-bearing (ablation).** Ablating the gaze to the pure scan changes
  DNA′ by mean Δ **~0.21** — the brain's *chosen* glimpses genuinely shape the
  reconstruction. **Variable, bounded ponder:** across an evolved archive, ponder spans
  **2…8** steps (cap 8), ~**120/188** evolve a halt readout and some halt early — not
  instant, not forever. **Honest floor:** constant/random → **0.000**.
- **Honest skill:** best **~30%** by 2000 gens (raw R² ~0.38) — humbler than v5's 98%,
  reconstructing the image-encoded genome through a genuinely harder temporal read.

**The finding — fork (B) STANDS, it does not end here:**
- The owner's plan was for the temporal channels (α, neuromod, attention, halt) to
  rejoin the target now that the decode is temporal. They **shape** the read (attention
  is load-bearing), but the read still samples the **STATIC image** (fork (B)'s own
  premise), and a static self-portrait **does not encode** how the creature learns /
  attends / ponders. So a *spatial* gene-readout has no signal to reconstruct the
  temporal genes from. Forcing them into the target gives **R² ≈ −12** (far worse than
  the mean) and **destroys the gradient** — skill ≡ 0, the loop can't bootstrap. That is
  a broken loop, not honest difficulty, so truth forbids it.
- **Interpretation (honest + poignant):** the creature can read back what its image
  *shows* — its visible form (weight + bias) — but **not its invisible temporal
  interior** (how it learns, attends, ponders). Those faculties are load-bearing
  *inputs* to its self-reading, never reconstructed *outputs*. The temporal genes remain
  deferred, not as a measurement dodge but as a structural truth.
- **The open door (a possible Phase 5b, owner's call):** reconstruct the temporal genes
  from the read's **dynamic signature** (the fixation trajectory, ponder count, plastic
  trace they leave) rather than the static image — a non-spatial readout. Uncertain,
  research-grade; deliberately *not* attempted unilaterally.

## Perf-hardening phase (scheduled; owner-approved)

The T-step rollout makes eval ~T× heavier, and Phase 4's glimpse adds a per-creature
image render; Phase 5 will put both in the eval loop. So a dedicated perf phase runs
**after the faculties, before v6 ships** (full analysis: `_local/perf-analysis.md`).
Cheap algorithmic wins MAY be folded in opportunistically if they ease a phase; the
structural ones are scheduled here for when the full compute load is known. **No item
may change the numbers** — perf only.

1. **Eval off the main thread → Web Worker(s) / pool — MANDATORY.** Once the rollout is
   T× heavier, eval must never run on the rAF thread. A worker pool keeps the UI at
   60 fps and is the structural prerequisite for everything below.
2. **Kill `coordKey` string formatting (~20% CPU) + integer-ify `cleanNet` (~12.5%).**
   The substrate maps coordinates via `toFixed(5)` string keys and `cleanNet` does
   string-set reachability — together ~⅓ of build CPU. Replace with packed-integer
   coordinate ids. Do this **before** scaling. (Cheap + portable — a candidate to fold
   in early.)
3. **Reuse scratch buffers (×T allocations under v6).** The rollout/glimpse allocate
   per-step/per-call; pre-size and reuse (the engine already does this for `val`/`prev`/
   `hebb`/`gridBuf` — extend the discipline to the read→ponder→emit buffers).
4. **WASM/SIMD for the dense rollout + attention maths — the PORTABLE accelerator.**
   Preferred over GPU because it runs headless/Node too, so it does **not** strand the
   swarm's CPU contributors (GPU stays parked). Targets the inner propagation +
   glimpse-sampling loops.

## References (verified)

- **NEAT** — Stanley & Miikkulainen 2002, *Evolving Neural Networks through
  Augmenting Topologies*, Evolutionary Computation 10(2):99–127.
- **CPPN** — Stanley 2007, *Compositional Pattern Producing Networks*, GPEM.
- **ES-HyperNEAT** — Risi & Stanley 2012, *An Enhanced Hypercube-Based Encoding…*,
  Artificial Life 18(4):331–363, [doi:10.1162/artl_a_00071](https://doi.org/10.1162/artl_a_00071).
- **[DP] Differentiable plasticity** — Miconi, Stanley & Clune 2018, ICML,
  [arXiv:1804.02464](https://arxiv.org/abs/1804.02464). *(form borrowed; ours is evolved, not back-propped.)*
- **[BP] Backpropamine** — Miconi, Rawal, Clune & Stanley 2019, ICLR,
  [arXiv:2002.10585](https://arxiv.org/abs/2002.10585). *(neuromodulated plasticity; ours evolved.)*
- adaptive-plasticity lineage — Risi & Stanley 2010 (adaptive HyperNEAT); review:
  Soltoggio, Stanley & Risi 2018, *Born to Learn*, [arXiv:1703.10371](https://arxiv.org/abs/1703.10371).
- **[RAM] Recurrent visual attention** — Mnih, Heess, Graves & Kavukcuoglu 2014,
  NeurIPS, [arXiv:1406.6247](https://arxiv.org/abs/1406.6247).
- **[AA] evolved hard attention** — Tang, Nguyen & Ha 2020, *Neuroevolution of
  Self-Interpretable Agents*, [arXiv:2003.08165](https://arxiv.org/abs/2003.08165).
- **[ACT] Adaptive Computation Time** — Graves 2016, [arXiv:1603.08983](https://arxiv.org/abs/1603.08983).
- **seq2seq** — Sutskever, Vinyals & Le 2014, NeurIPS, [arXiv:1409.3215](https://arxiv.org/abs/1409.3215).
- **neural-network quine** — Chang & Lipson 2018, [arXiv:1803.05859](https://arxiv.org/abs/1803.05859).
