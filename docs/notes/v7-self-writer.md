# v7 — THE SELF-WRITER (clean painter / reader / writer split)

*Design note. Owner's decision: build v7 fully, end-to-end. Quality + honesty over
speed. Drive to a shipped v7 — or an honest evolvability wall.*

---

## 0. Ground-truth on the base (a corrected note)

A momentary scare while branching: my **local** `main` was stale (`1d7d6c7`, the v5
"reconcile to the v5 reality" commit), which looked like "v6 never shipped." After
`git fetch`, the truth is the opposite — **`origin/main` is `9768b64`, the v6 ship**
(`genesis-v6`, `CPPN_OUTPUTS=9`, the full temporal brain). So v6 *did* ship to main; my
local checkout was just behind.

v7 is built on the v6 ship (`9768b64`), and `origin/main` is an **ancestor of the v7
branch**, so shipping v7 is a clean **fast-forward** of `origin/main` (v6) → v7 — no v5/v6
tangle. v7 keeps the v6 temporal read (recurrence, Hebbian plasticity, neuromodulation, RAM
attention, ACT halt) and replaces only the *decode*.

## 1. Why v7 — the v6 emit is a hackjob

v6's "emit" (`readback.selfReadback`) is a **quine re-projection**: it projects the
read glimpses *through the CPPN's own weights* into the hidden layer, then reads **one
value per existing gene** at that gene's canonical coordinate (`readGene`). Two sins:

1. **Quine entanglement** — the emit re-invokes the CPPN, so DNA′ is not produced by
   the brain's own dynamics; it's a coordinate lookup through the genome that painted it.
2. **Length is given** — it emits exactly `targetCount` values (one per gene). The
   creature never *decides* how long its DNA is; the answer's shape is handed to it.

v7 fixes the architecture: the brain genuinely **reads its own image and writes its own
DNA, element by element, deciding its own length.**

## 2. The v7 architecture

```
        DNA (CPPN, 11 channels)                    ← recipe / painter (unchanged)
            │  ES-HyperNEAT grows the substrate
            ▼
        BRAIN (substrate)  ── paints ──▶  IMAGE (coords → density/hue)   [the DRAW half]
            │                                   ▲
            │  READ: RAM attention, recurrent,  │  (its own static image)
            │  plastic, neuromodulated, ponder- │
            │  gated lifetime  (Phases 1–5)     │
            ▼
        recurrent state ── WRITE: autoregressive emit, from its OWN neurons,
            feeding back its own previous output, until it HALTS ──▶ DNA′
                                                              (variable length, self-decided)
        skill = how well DNA′ matches DNA  (variable-length: values + length)
```

**Painter — unchanged.** DNA (CPPN) → ES-HyperNEAT → brain → image. Untouched.

**Reader — unchanged (the v6 read).** `readPonderEmit`: foveated glimpses where the
brain chooses to look (RAM, evolved hard attention), over a variable ponder (ACT halt),
plasticity + neuromodulation active, building a recurrent state. This is the "reading."

**Writer — NEW (replaces the quine).** Two new CPPN output channels paint per-neuron
**readout vectors** (exactly like the existing `fixX`/`halt` readouts — painted once at
build, never re-invoked at emit time):

- `emitVal` (channel 9) — the next DNA element.
- `emitEnd` (channel 10) — the end-of-sequence (halting) signal.

Autoregressive emit, step `t` (starting from the post-read recurrent state):

1. Feed the brain its **own previous output**: `val[0] = prevValue`, an emit-mode flag
   `val[1] = 1`, a position signal `val[2] = t/runLen`, `val[3]=0`, `val[4]=1` (bias).
2. **Step the substrate** (one recurrent step; plasticity + neuromod stay active — the
   brain keeps learning as it writes).
3. Read from its **own neurons**: `value_t = σ(Σ_i emitVal[i]·activity_i)`,
   `end_t = Σ_i emitEnd[i]·activity_i`.
4. If `σ(end_t) > 0.5` → **HALT**: the creature decided its length `L = t`. Else continue
   to a hard cap `emitMaxLen`.

`DNA′ = [value_0 … value_{L-1}]` — **variable length, creature-decided.** No CPPN
re-projection, no per-gene coordinate lookup, no length given.

**On-ramp (gentle, consistent with every v6 faculty).** `minimalGenome` wires ONLY the
two image channels (weight, bias). `emitVal`/`emitEnd` start **unconnected** → a fresh
creature reads ≈0 from them → emits a constant `σ(0)=0.5` and never halts (runs to cap).
The writer arises by mutation, like α / neuromod / attention / halt before it.

## 3. The target + the variable-length comparison

**Target = the whole DNA.** `DNA = genomeVector(g)` → unit space (length `G = paramCount(g)`).
The brain is asked to write its *entire* genome, not a curated subset. (v6's fork (B)
deferral does not apply — the writer generates from a recurrent state shaped by *all* the
genes, so there is no static-image argument for excluding the temporal channels a priori.
Whether it can actually reach them is an honest empirical question; the skill reflects it.)

**Comparison (both length and values must be right):**

- **Value skill (self-length)** `R²_self` — baseline-corrected over the `G` canonical
  positions: `pred_i = value_i` if `i < L`, else the target mean `μ` (a "no information"
  fallback for under-length). `R²_self = 1 − Σ(pred_i − T_i)² / Σ(T_i − μ)²`. Under-length
  cannot explain variance it never emitted (natural penalty, never below the mean
  baseline); over-length is handled by Λ.
- **Length shaping** `Λ = clamp(1 − |L − G| / G, 0, 1)` — a *separate* gradient toward
  the right length, independent of the values.

## 4. THE HARD PART — evolvability / length-discovery (where v7 lives or dies)

A random creature emits wrong-length constant garbage → `R²_self ≈ 0`, `Λ` random → no
signal to climb (sparse + brutal, unlike v6's dense per-gene reward). The fix is a
**competence-scheduled curriculum + length-shaping**, all from a single emit rollout:

1. **Dense teacher-length value signal (bootstrap).** Evaluate the values under a
   **teacher-forced length**: read the first `G` emitted values (ignore the end-signal),
   compare 1:1 to `T` → `R²_teacher`. This is *dense* (every gene position gives a gradient
   every eval) and learnable regardless of the (random, on-ramping) end-signal. The input
   is still **free-run** (the brain's own previous output) — the true genes are NEVER fed
   in, so there is no leakage/cheating. Only the *number of steps* is supervised.
2. **Length-shaping reward (length gradient).** `Λ` above — rewards `L → G` separately, so
   there is a gradient toward the right length even before the values are good.
3. **Anneal — hand over the length decision as competence rises.**
   `a = smoothstep(R²_teacher; lo=0.2, hi=0.55)`; effective value
   `Veff = (1−a)·R²_teacher + a·R²_self`. Early creatures are graded on the dense
   teacher-length reconstruction (bootstraps value-generation); as a creature masters the
   values, it is increasingly graded on its **own** self-length emit — so to keep scoring
   it must learn to halt at the right place. The two couple: getting `Λ` right pulls
   `R²_self → R²_teacher`, smoothing the hand-over.

**Selection fitness:**
```
skill = complexityWeight(G) · Veff · (lenFloor + (1−lenFloor)·Λ) · ponderFactor
        lenFloor = 0.6   ponderFactor = 1 − ponderCost·ponder/cap   (read dithering cost)
```
- Improving values (`Veff`) always helps; improving length (`Λ`) always helps → no hard
  valley. The length factor floors at 0.6 (length withheld, never zeroed) so a good-values
  / wrong-length creature is still rewarded *and* pressured to fix its length.
- **Floor 0 by construction.** A blank/random/fresh creature emits a constant `0.5`
  (`emitVal` unconnected or zeroed image) → predict-the-mean → `R²_teacher ≈ 0` → `Veff ≈ 0`
  → `skill ≈ 0`. The vitality gate (unchanged) zeroes empty creatures regardless of `Λ`.

## 5. Honesty (first duty to truth)

- **Selection** uses the curriculum `skill` (needed to bootstrap the search). For the
  CHAMPION (highly evolved, `a → 1`) this ≈ the honest self-length skill.
- **Reported / displayed** always exposes the **genuine** numbers: `R²_self` (self-length
  reconstruction), the creature's emitted length `L` vs its genome length `G`, and whether
  `L → G` over evolution. Smoke + UI show both. No fake-cap up or down.
- **Evolvability wall (stop condition).** If, after a hard bootstrapping effort, the
  length-discovery genuinely cannot get off the ground (`L` never approaches `G`, skill
  stays at the floor), STOP and report it as an honest fork — do **not** silently fall back
  to v6's per-gene readout and call it v7.

## 6. Build surface

| file | change |
|---|---|
| `arch.ts` | `CPPN_OUTPUTS` 9→11; `OUTPUT_IDS` +`emitVal`(16)/`emitEnd`(17); `FIRST_HIDDEN_ID` 18 |
| `cppn.ts` | `evalCompiled` out length 11; minimal-genome on-ramp doc (unchanged wiring) |
| `substrate.ts` | paint `emitVal`/`emitEnd` per neuron; `selfWrite` = read + autoregressive emit |
| `readback.ts` | rewrite: `selfWrite`-based DNA′; full-genome target; `R²_self`+`Λ`+curriculum |
| `fitness.ts` | adapt `readBackUnits`/`iterateLoop`/`targetAtProbes` to the variable-length write |
| `hyperparams.ts` | `emitMaxLen`, `lengthShapeFloor`, `curriculumLo/Hi`; retire `readbackBandwidth` |
| `smoke.ts` | honesty floor; autoregressive-emit + length-discovery (`L→G`) evidence |
| `dashboard.ts`/`index.html` | THE LOOP viz read→autoregressive-write; variable-length DNA′ strip; length readout |
| `genesis.ts` | `ARCHIVE_EPOCH` 6→7 (genome wire format changed → auto-rotate to `genesis-v7`) |
| coordinator | `verify.ts` `CPPN_OUTPUTS`→11, fixture regen, `PROTOCOL_VERSION` bump |

## 7. Citations the writer stands on

- Autoregressive generation with a learned stop / end-of-sequence — seq2seq (Sutskever,
  Vinyals & Le 2014, [1409.3215](https://arxiv.org/abs/1409.3215)).
- Adaptive Computation Time / learned halting — Graves 2016
  ([1603.08983](https://arxiv.org/abs/1603.08983)).
- Curriculum / scheduled hand-over from teacher to self — scheduled sampling (Bengio,
  Vinyals, Jaitly & Shazeer 2015, [1506.03099](https://arxiv.org/abs/1506.03099)) +
  curriculum learning (Bengio et al. 2009).
- RAM evolved hard attention, plasticity, neuromodulation, NEAT/ES-HyperNEAT,
  neural-network quine — as in the v6 note + whitepaper references.

## 8. The honest audit + the cold self-write (overnight pass)

A directed honesty pass against the *actual* code. Straight answers:

- **Emit is REAL-VALUED, not discrete tokens.** Each step emits `value = σ(Σ emitValᵢ·aᵢ)`
  ∈ (0,1) — a continuous gene value, autoregressive (its own previous output feeds back),
  with a learned end-of-sequence halt. NOT a discrete-vocabulary token. "Token" was an
  overclaim; corrected in viz + docs to "a real value per gene, no transformer/LLM."
- **It genuinely reads/thinks before writing.** READ and WRITE are **decoupled**: the brain
  takes N foveated RAM glimpses (a fovea+periphery patch at a CHOSEN fixation = scan +
  learned deviation, deciding where to look next), ingesting each into its recurrent +
  Hebbian state WITHOUT emitting, halting via ACT — THEN it autoregressively writes. In this
  architecture a **glimpse step IS a ponder step** (one per step), so "glimpses" and "ponder"
  are the same count N (the readout now says `GLIMPSED ×N → WROTE L/G genes`, no asymmetry).
- **Plasticity + attention are MASSIVELY load-bearing** (ablation, measured): turning
  plasticity off on the best plastic creature collapses reconstruction R² from ≈0.36 to
  ≈ −3.2 (worse than the mean — the brain genuinely LEARNS within its lifetime); attention
  off ≈0.50→0.27. **Neuromodulation is mild** (≈ +0.03) — honestly reported as such.

**The SKILL-NaN live bug — root-caused, not patched.** The substrate has unbounded
activations + linear outputs + recurrent/Hebbian feedback; over the long write it could
diverge to ±Infinity, and `emitVal·Infinity` → NaN → NaN skill (the UI `?? 0` didn't catch
NaN). ROOT FIX: bound the recurrent state each step (BIBO-stable) so no Infinity/NaN can
arise; defense-in-depth guards in the metric + UI (a NaN skill is never honest → floor 0).

**The cold self-write (the hardest-honest push, stays v7 — fitness only).** The old
curriculum was a CRUTCH: the champion scored ~22% while halting at 3 genes vs 29 (Λ 0.10),
gaming teacher-forced values without getting its own length right. Handing the length
decision over fast (`curriculumHi` 0.55→0.28) + making length load-bearing
(`lengthShapeFloor` 0.6→0.25) makes the displayed champion the genuine self-length
reconstructor: **Λ ≈ 0.9–1.0** (it writes its own gene count), honest **r2self ≈ skill ≈
0.30** at 2000 gens (higher AND honester than the crutch-era 0.22). Floor 0.000.

**The measured WALL (a beautiful honest finding).** A *fully* teacher-free fitness is GAMED
by a degenerate 1-gene write that nails the single highest-variance gene (Λ 0.04, r2self
0.565 from one outlier). So the teacher-length signal is NOT a crutch to be ashamed of — it
is the **anti-gaming signal that forces WHOLE-genome reconstruction**. Fast-anneal cold is
the sweet spot. The metric-semantics shift rotates the world (`ARCHIVE_EPOCH` bump); the
genome wire format is unchanged (coordinator verification untouched).

**The honest frontier (genuine next leap, NOT done tonight):** reconstruct the genome's
STRUCTURE (topology), not just its gene values — true functional self-reproduction. That is a
real architectural leap (variable structured output, graph-edit comparison) and a multi-session
research problem; forcing it tonight would be dishonest. Named, not promised — the v8 frontier.
