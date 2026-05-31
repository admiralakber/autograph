# Autograph: Crowd-Evolved Self-Referential Networks as Generative Art

**A working paper.** *Version 0.1.*
**Author:** Aqeel Akber.
**Design notes (further reading):** [architecture & the swarm](./notes/architecture.md) · [runtime & GPU](./notes/runtime-and-gpu.md) · [cryptography](./notes/cryptography.md) · [quantum](./notes/quantum.md) · [prior art & novelty](./notes/prior-art.md).

---

## Abstract

We describe **Autograph**, a browser-native instrument for a live evolutionary experiment in which small neural networks evolve toward **self-reference**. Each individual is *two* networks bound in a loop: a small **connective [CPPN](#references)** (the genotype, or "DNA") that, given a pair of 3-D substrate-node positions, emits a connection (a weight and a link-expression gate); and a **HyperNEAT substrate** (the phenotype, or "brain") whose connection weights are *painted* by the CPPN and whose hidden neurons are *placed* by it using a simplified **ES-HyperNEAT** criterion. Queried over space, the substrate outputs a density-and-hue field, rendered as a volumetric 3-D **self-portrait**. The strange loop is literal: DNA → phenotype → self-portrait → fed through a small **per-creature read-back network** (co-evolved with the writer) → DNA′, a [fixed point](#references) of the compose-and-read-back map and the artwork analogue of a *quine* — the continuous, evolutionary cousin of the [neural network quine](#references) of Chang & Lipson (2018), which itself adopts the HyperNEAT coordinate→weight encoding. We frame self-reference, self-replication and (prospectively) cryptographic self-commitment as instances of a single fixed-point construction, the same diagonal trick underlying Gödel's incompleteness and Kleene's recursion theorem. The population is illuminated by **MAP-Elites** quality-diversity (a grid keyed by structural complexity × mirror symmetry) and the loop's closure (**loop fidelity**) is *measured live, never faked*; because the trivial near-empty creature is a degenerate fixed point, a **vitality gate** keeps self-reference load-bearing. The instrument renders on-device (Three.js with a Canvas 2D fallback) and **joins a live shared swarm by default**: a PartyServer-on-Cloudflare coordinator holds one shared archive, with a live peer count, a collective generation rate, and best-per-niche migration between machines (an offline mode is one click away). Scaling evaluation across device tiers on a portable WGSL core (phones to headless H100-class GPUs) and *verifying* untrusted machines (BOINC-style replication, then zkML) remain the roadmap. We state the system's central claim in falsifiable form, are explicit about where exactness is impossible (cross-device floating-point non-determinism), and we are scrupulous about the maturity of the two technical pillars: a signed, content-addressed Merkle-DAG lineage that is **built and real today** (and persisted across sessions in IndexedDB), a zkML "proof of becoming" named honestly as a **research north star**, and a quantum framing kept strictly as **metaphor and lineage, never mechanism**.

---

## Key findings (what the live instrument actually shows)

1. **The self-encoding loop is a real neural quine.** A creature's DNA grows a brain that draws a self-portrait, which is then fed through the creature's **own co-evolved read-back network** that outputs DNA′; **loop fidelity** — how faithfully it reconstructs its DNA — is *measured live, never faked* (a random reader scores ~0.81; co-evolved creatures climb to ~0.95; §3.1).
2. **Each creature reads itself — there is no universal mirror.** A single *shared* read-back network (linear and MLP) does **not** invert render→DNA across the population (held-out $R^2 \approx 0$), so the reader is **per-creature**, co-evolved, each learning its own inverse. And *fully iterating* the loop drives any creature to the only perfect fixed point — the trivial flat creature (vitality 0). So **life is imperfect self-knowledge**: a living creature can only ever *approach* closure (§3.1).
3. **The search is open-ended — it does not plateau.** With Novelty Search + MAP-Elites quality-diversity + NEAT complexification, behavioural **novelty** and **QD-score** keep climbing long after fidelity saturates (headless: novelty ~6×, fidelity flat) — it keeps discovering new *kinds*, never converged-and-static (§3.3).
4. **Real NEAT, made visible.** The DNA starts minimal and **augments its own topology** (add-node / add-connection with innovation numbers; optional recurrent + gated links), with compatibility-distance **speciation** protecting new structure; node/connection counts grow on screen (§3.2).
5. **An honest, signed tree of life + an archipelago swarm.** Champions are content-addressed and ECDSA-signed into a *branching* Merkle-DAG phylogeny (crossover → two parents); the swarm is **live** — an asynchronous **island model** (best-per-niche migration, a live peer count and collective gen/s) behind a swap-able archive seam, one shared garden today; planetary-scale GPU evaluation and full untrusted-machine verification remain roadmap (§3.4, §3.6, §3.8).

The framing throughout is **Hofstadter's strange loop of consciousness** [10] — a process that models itself until an "I" precipitates — held honestly as structure made visible, never a claim of consciousness.

---

## 1. Introduction

Most contemporary machine learning optimises a fixed objective on a fixed architecture with gradient descent at industrial scale. An older, stranger tradition asks a different question: *can a process be open-ended* — endlessly generating novel, interesting, learnable artefacts — and *what do the artefacts so produced look like on the inside?* Recent position work argues open-endedness is essential to the next era of capable AI [9], and recent empirical work suggests that artefacts produced by open-ended evolutionary search can possess markedly cleaner internal structure than their gradient-trained counterparts [11].

Autograph takes the most self-contained possible target for such a search — **a network that refers to itself** — and makes the search a public, browser-based **instrument** one joins on load. The contribution is not a new algorithm; it is a *synthesis*: Picbreeder-style crowd-evolved CPPNs [6], indirect HyperNEAT/ES-HyperNEAT encoding (the CPPN paints and places a larger substrate) [1,6], the neural-network quine [12], MAP-Elites illumination [5], and — as a documented direction — a one-runtime volunteer-compute substrate, arranged so that the scientific object (an approximate fixed point of self-encoding) and the aesthetic object (Escher's *Drawing Hands*, alive) are literally the same thing. The instrument **joins a live shared swarm by default** (with a one-click offline mode); what remains roadmap is its planetary *scale* — GPU-tier evaluation and full verification of untrusted machines.

The framing we reach for is **Hofstadter's strange loop of consciousness** [10]: a self is a process that models itself modelling itself until an "I" precipitates — consciousness as a loop that closes on itself. Autograph makes **no claim that its creatures are conscious**; it makes the *structure* of self-reference literal, evolvable and measurable, so the idea can be *seen* rather than asserted — and it is honest that perfect closure is the empty fixed point, so what evolution actually finds are lively, *imperfect* self-loops.

We emphasise honesty throughout. The strange loop is real and computable; several adjacent ideas we find beautiful (notably the quantum angle, §3.7) are **speculative and labelled as such**.

---

## 2. Background and related work

**Self-reference and fixed points.** Gödel's incompleteness theorems [13] construct a sentence asserting its own unprovability via a diagonal/fixed-point lemma. The computational counterpart is Kleene's recursion theorem [14], which guarantees the existence of programs with access to their own description; a [*quine*](#references) is the minimal instance — a fixed point of the execution map, `run(p) = p`. Hofstadter's *Gödel, Escher, Bach* [15] popularised the thesis that such "strange loops" are a deep structural motif across logic, visual art (Escher's *Drawing Hands* [16]) and music (Bach's endlessly rising canon [17]); his later *I Am a Strange Loop* [10] argues the self itself is such a loop.

**Self-replication.** Von Neumann's universal constructor [18] established that machines can build copies of themselves given a description they both *interpret* and *copy*; Langton's loops [19] are a minimal cellular-automaton realisation. Chang & Lipson [12] brought this into deep learning with the **neural network quine** — a network trained (by gradient descent and/or a "regeneration" fixed-point iteration) to output its own weights via coordinate indexing — and observed a trade-off between auxiliary-task performance and replication fidelity, echoing the biological tension between reproduction and other functions.

**Neuroevolution and indirect encodings.** NEAT [1] evolves both weights and topology, complexifying from minimal structure. CPPNs [6,25] are compositional networks queried over coordinates to produce regular, symmetric patterns. In their *connective* form a CPPN maps a pair of node coordinates to a connection weight, and **HyperNEAT** uses this to paint the weights of a much larger substrate from geometry — an *indirect encoding* in which a small genome grows a large phenotype. **ES-HyperNEAT** extends this by also *deciding where the hidden neurons go*, placing them where the connectivity pattern carries the most information (the original method uses an adaptive quadtree to find regions of high variance / "information"); evaluating the CPPN over all `(source, target)` substrate-coordinate pairs is an embarrassingly-parallel `map`, shipped, e.g., as TensorNEAT's `FullSubstrate` [3]. Picbreeder [6] demonstrated crowd-powered, branch-from-each-other CPPN evolution in the browser; Galactic Arms Race used implicit player behaviour as the fitness signal [26].

**Open-endedness and quality-diversity.** Novelty search [2] abandons the objective in favour of behavioural novelty and frequently outperforms objective-based search on deceptive tasks. MAP-Elites [5] keeps the best solution per cell of a behaviour-descriptor grid, yielding a *map* of diverse high performers ("illumination"). POET [7] co-evolves problems and solutions; ELM [8] uses learned operators inside MAP-Elites. The position paper of Hughes et al. [9] argues open-endedness is essential for superhuman AI; Kumar, Clune, Lehman & Stanley [11] report that open-endedly evolved CPPNs approach a "unified factored representation" (UFR), whereas conventional SGD tends toward a "fractured entangled representation" (FER) — directly relevant to *why* an evolved self-portrait might be legible.

**Volunteer compute and its perils.** BOINC [20] established the playbook for untrusted distributed computation (replication, quorum, homogeneous redundancy, adaptive replication); JSDoop [21] showed browser-based volunteer neural-network training is feasible. WebGPU reaching Baseline in 2026 [22] makes a single GPU-compute runtime spanning phones to servers practical for the first time.

---

## 3. The system

### 3.1 Task: self-reference as an (approximate) fixed point

Let $g \in \mathcal{G}$ be a genome — a small *connective* CPPN (the DNA): heterogeneous activations, evolvable weights and biases, with inputs $(x_1,y_1,z_1,x_2,y_2,z_2,\text{bias})$ and outputs $(\text{weight},\,\text{leo})$, where `leo` is a link-expression gate. Three maps define the loop:

- a **development** map $B:\mathcal{G}\to\mathcal{P}$ that builds the phenotype (the substrate "brain") from the DNA — §3.2 — painting every connection weight and *placing* the hidden neurons;
- a **render** map $R:\mathcal{P}\to\mathcal{X}$ that queries the phenotype across 3-D space to produce the volumetric self-portrait $x=R(B(g))$ — a field of density and hue;
- a **read-back** map $E:\mathcal{X}\to\mathcal{G}$ — a small **per-creature read-back network** whose weights live in the genome and co-evolve — that samples the self-portrait at $F$ fixed probes and, queried at each DNA parameter's probe coordinate, outputs the reconstructed parameter DNA′. (This replaces the earlier *analytic* read-back, where the painted density at a probe was taken directly as the parameter.)

The target is a genome $g^\star$ that is a **fixed point of $E\circ R\circ B$**:

$$ E(R(B(g^\star))) \approx g^\star . $$

Equivalently, $R(B(g^\star))$ is a *self-describing artefact* — the self-portrait encodes the DNA that drew it, and the creature's own network can read it back. (Chang & Lipson's quine is the discrete cousin where a network outputs its own weights at coordinate indices; here a co-evolved network reads the rendered portrait and outputs DNA′ [12].) We do **not** assume exact fixed points are reachable: the portrait is a finite, lossy view and §3.5 explains why bitwise exactness is impossible across heterogeneous hardware anyway. So the operational quantity is **loop fidelity** $\in[0,1]$ — one minus the (normalised) root-mean-square error between the read-back network's DNA′ and the DNA's own values — and it is **measured and displayed live, never faked**.

**The degenerate fixed point, and the vitality gate.** A blank, near-flat creature trivially "encodes itself" (the *zero quine*) and says nothing. We therefore never reward fidelity alone: a **vitality** term (volumetric contrast, ≈0 for empty creatures) gates fitness, and the **quality-diversity** pressure (§3.3) preserves the *space* of lively self-encoders rather than collapsing onto one. Self-reference is only interesting when it is load-bearing against a world [12].

**The read-back network, and why it is per-creature.** The read-back map $E$ is a genuine network: a small fixed-topology MLP that takes the self-portrait (sampled at $F$ probes) plus a parameter's probe coordinate and outputs that parameter. Its weights live in the genome and **co-evolve** with the writer CPPN, so each creature learns to read *itself*. Why per-creature, and not one shared "mirror brain" for everyone? Because a shared one does not generalise: fitting a single encoder (linear, and a small MLP) from a fixed portrait fingerprint to a fixed DNA fingerprint across the whole population gives held-out $R^2 \approx 0$, barely beating the mean. The render→DNA inverse is *creature-specific*, so the reader must be too. **Measured, honestly:** a random reader already reaches loop fidelity ≈ 0.81 — the DNA parameters cluster near the centre of their range, so "predict the mean" is a strong baseline — and co-evolution lifts lively creatures to ≈ 0.95; the gain above the baseline is the reader genuinely reading the portrait. The deeper truth is invariant to the choice of $E$: **fully iterating** $E\circ R\circ B$ drives any creature toward the *only* perfect fixed point — the trivial flat zero-quine (vitality 0). Perfect self-encoding is emptiness; a living creature can only ever *approach* closure. So we score one-step fidelity and let the vitality gate + quality-diversity hold the population lively-but-imperfect. **Life is imperfect self-knowledge** — and we never fake the closure.

```mermaid
flowchart LR
  G["🧬 DNA g (connective CPPN)"] -->|"B: develop<br/>(paint + place)"| P["🧠 phenotype B(g) (substrate)"]
  P -->|"R: render over 3-D"| X["✨ self-portrait x = R(B(g))<br/>(density + hue field)"]
  X -->|"E: read-back network → DNA′"| G2["🧬 recovered g′ = E(R(B(g)))"]
  G2 -. "loop fidelity = 1 − ‖g′ − g‖  →  fixed point (measured live)" .-> G
```

### 3.2 Representation and development

**The DNA (genotype).** A *connective* CPPN [6,25] evolved by genuine **NEAT — augmenting topologies** [1]. The genome is a *graph*: node genes (each with a heterogeneous activation drawn from `sin`, `gauss`, `tanh`, `sigmoid`, `abs`, `cos`, `relu`, `triangle`, `identity`) and connection genes carrying **innovation numbers** (historical markings). It **starts minimal** — every input wired straight to every output — and *complexifies* over generations through the structural operators **add-connection** and **add-node** (which splits an existing connection), with **recurrent links permitted** (a compiled, recurrence-aware evaluator runs a few propagation passes). Crossover aligns genes by innovation number (matching genes from either parent, disjoint/excess from the fitter). It still maps a pair of 3-D node positions to a `weight` and a link-expression gate (`leo`). The genome **also carries the read-back network's weights** — a small fixed-topology MLP (the loop's decode half) that mutates and is inherited like any gene, so the reader co-evolves with the writer. Because the DNA grows, so does the loop: the read-back network must reconstruct **one value per parameter** (connection weight or bias) from the *same* fixed-size portrait, so a more complex creature faces a strictly harder self-encoding problem — complexity is not free.

**The brain (phenotype).** A HyperNEAT substrate whose feature inputs are a queried point $(x, y, z, r=\lVert p\rVert, \text{bias})$ and whose two outputs are `density` and `hue`. It is not stored in the genome; it is *developed* from the DNA by the map $B$:

1. **Placement — simplified ES-HyperNEAT.** From a fixed set of candidate sites, each candidate is scored by the **variance of its incoming weight pattern** (the CPPN's weights from the input nodes to that site); the highest-information sites are kept as the hidden neurons. This is the operational core of [ES-HyperNEAT](#references) — *put neurons where the connectivity carries information* — without the full machinery. **Full quadtree band-pruning ES-HyperNEAT is named as the direction; we ship this simplified placement now**, and label it as such.
2. **Painting.** Every substrate connection's weight is then read off the CPPN from the two endpoints' positions, gated on by `leo`. Painting all `(source, target)` pairs is the embarrassingly-parallel `map` that HyperNEAT/TensorNEAT call a full-substrate evaluation [3].

CPPNs are an ideal substrate here for two reasons: they are coordinate-queried (so painting and rendering are embarrassingly parallel), and open-ended CPPN evolution is empirically prone to *factored* internal structure [11], which a self-encoding task should reward.

### 3.3 Archive: MAP-Elites illumination

The archive is a grid keyed by a **2-D behaviour descriptor** computed from the rendered self-portrait; each cell retains the best (highest loop-fidelity, vitality-gated) self-encoder found for it. **Speciation** is layered on top: creatures are grouped by NEAT compatibility distance (excess/disjoint genes + mean matching-weight difference [1]) and reproduction draws a *species* before a member, so each species — including a lone, newly-complexified one — gets an equal share and novel structure is not out-competed before it matures. The instrument also offers an optional **Novelty Search** mode [2]: reproduction is biased toward the *frontier* of behaviour space (elites bordering unfilled cells), rewarding behavioural novelty over fidelity to push coverage into unexplored forms. The shipped descriptor is:

| Axis | Meaning (from the rendered volume) |
|---|---|
| **structural complexity** | spatial detail of the self-portrait (mean local gradient of the volume's projection) |
| **mirror symmetry** | left↔right regularity of the projection |

These two axes give a legible 2-D wall the visitor watches fill, with each cell's **fitness shown as a greyscale border value (no colour)** — colour is reserved for the living self-portraits inside the cells (the aesthetic doctrine: a greyscale instrument framing sunrise-coloured life — see [VISION.md](../VISION.md)). Further axes (e.g. loop directness, genome compression) are candidates for future tuning. The illuminated archive *is* the exhibited artwork: a wall of diverse self-portraits, each the champion of its kind.

### 3.4 Rendering the self-portrait, and the one-runtime direction

**Shipping (real, on-device).** The render map $R$ samples the substrate's density-and-hue field over a 3-D grid: density becomes alpha, hue is mapped through the **sunrise** palette (HSLuv; colour for life only — see [VISION.md](../VISION.md)), and the surviving voxels are drawn as a volumetric **point cloud** via [Three.js](https://threejs.org/). A **Canvas 2D** path renders a projection of the same field as a graceful fallback and as the population-grid thumbnails — the same network, only the device changes. All of this runs locally; nothing leaves the tab.

**Direction (for the swarm).** Swarm-scale *evaluation* kernels (substrate painting; loop-fidelity scoring; mutation/crossover; atomic MAP-Elites insert) can be authored **once in WGSL** and run via WebGPU in browsers and, unchanged, headless via Deno/Dawn on server GPUs, with a layered fallback `WebGPU → WebGL2 → WASM SIMD+threads → scalar JS` and tensorisation (fixed max-topology + masks, or padded population tensors) following TensorNEAT [3] and QDax [4]. The protocol is invariant across tiers; only batch size, precision and replication policy vary. This is the roadmap, not the shipping instrument.

### 3.5 Trust, and the determinism caveat

The coordinator verifies signatures and keeps best-per-niche, but it does **not** re-run evaluation — loop fidelity is computed canonically on each device and the signed value is trusted — so the cross-device concerns below sharpen as evaluation moves to shared GPU tiers (§3.4). WGSL provides **no bit-exactness guarantee** across GPUs/drivers/WASM (FMA contraction, reassociation, per-built-in accuracy bounds; no `fast-math` flag) [23]. Two consequences:

1. **Self-encoding must be defined up to tolerance $\varepsilon$**, not bitwise — the loop "closes" within a stated metric (loop fidelity, §3.1), and the metric must be numerically stable (prefer fixed-point read-outs and order-independent reductions). This holds even on a single device, because the substrate field cannot exactly reproduce its own DNA.
2. **No single self-reported score is trusted (swarm).** We adopt BOINC's mechanisms [20]: replication + quorum (default 2×, escalate on disagreement), tolerance comparison, homogeneous redundancy, and authoritative server-side recomputation of archive *elites*. Quality-diversity is noise-tolerant by construction [4], which materially helps a churny volunteer swarm.

### 3.6 Pillar 1: cryptographic self-proof

Self-reference (§3.1) and swarm trust (§3.5) are, at the limit, the *same* mechanism: a genome that can prove itself is its own validator. We separate this pillar into three honest maturity tiers.

**Built and real today.** Each creature carries a signed commitment to itself and sits in a tamper-evident phylogeny. A genome's id is a content hash `SHA-256(genome ‖ parent-ids ‖ seed ‖ fidelity)`; because each child commits to its parents' ids, the archive becomes a **signed, content-addressed Merkle DAG** — a verifiable tree of life with tamper-evident ancestry, attribution and anti-fraud, rendered in the instrument as a navigable greyscale tree. Everything descends from the canonical **Genesis** seed. Signatures (ECDSA P-256 via the Web Crypto API) bind each entry to an author key, so a creature cannot be grafted onto a lineage without the right key. This is *Git for genomes* — content-addressing as in [Git](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects); append-only transparency as in [Certificate Transparency (RFC 6962)](https://datatracker.ietf.org/doc/html/rfc6962) — a few hundred lines, no chain, no token. The lineage **persists across sessions in IndexedDB**, so it grows over time, and is round-trip-verifiable: export it, re-import it, and every hash and signature is re-checked (tampered content and forged signatures are both rejected). The swarm is live, so this **is** one shared genealogy across all participants: the coordinator re-verifies every pushed elite's signature server-side before a keep-best merge. (Verifying the *computation* behind a claimed fidelity — not just its signature — is the zkML north star below.)

**Research north star.** Replace replication + quorum (§3.5) with succinct verifiable computation: each elite emits a [zero-knowledge proof](https://en.wikipedia.org/wiki/Zero-knowledge_proof) that it evaluated genome $g$ on seeded task $s$ and obtained fitness $\varphi$ and descriptor $bd$ — the coordinator *verifies* rather than re-runs. The prover/verifier asymmetry that makes [zkML](https://github.com/zkonduit/ezkl) punishing for large models is a *gift* for our tiny nets: [Kang et al. (2022)](https://arxiv.org/abs/2210.08674) verify ImageNet-scale inference with a ~5 KB proof in ~1 s. A zk circuit also pins a canonical fixed-point arithmetic, dissolving §3.5's cross-device non-determinism. The horizon is recursive proof composition ([Nova](https://eprint.iacr.org/2021/370); IVC/PCD; [Mina](https://minaprotocol.com/blog/22kb-sized-blockchain-a-technical-reference) folds an entire chain into ~22 KB), so the archive root could one day be a single recursive proof of the population's whole becoming. **The gate is proving cost:** we would prove *selectively* (elites, on opt-in / beast nodes) and verify everywhere. We therefore name this a telescope, not a feature.

**Deliberately off the critical path.** An *exact* crypto-hash quine — a network whose output literally equals `H(W)` — is a partial-preimage search, essentially proof-of-work mining. Beautiful to state; we ship the carried/soft commitment instead.

> 🚩 **Anti-grift red line.** Cryptography-as-mathematics, never coins: hashes, commitments, signatures, and eventually zk — no token, no manufactured scarcity. If a feature only makes sense with a coin attached, it is not in Autograph.

### 3.7 Pillar 2: the quantum angle — the soul's physics, not the runtime

We assessed the quantum connection sceptically and reached a clear verdict: it adds real *conceptual* depth and **zero** engineering value to a browser piece. We lean in conceptually and build nothing quantum.

The genuinely deep resonance is not invented for this project — it is a 60-year-old tension in physics. The [no-cloning theorem](https://en.wikipedia.org/wiki/No-cloning_theorem) ([Wootters & Zurek 1982](https://www.nature.com/articles/299802a0)) forbids copying an arbitrary unknown quantum state, which would *kill* self-replication — except that replication was never about cloning the live thing. Von Neumann's universal constructor passes on a **description** (copied) and regrows the **body** (built); [Marletto (2015)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4345487/) shows description-based self-reproduction is fully compatible with quantum theory and categorically distinct from cloning. *The prohibition is the gift:* it is exactly what forces reproduction to work the way life does — and the way a CPPN genome (§3.1) already does. Two supporting beauties, both peer-reviewed: a system cannot accurately measure its own state from the inside ([Breuer 1995](https://www.cambridge.org/core/journals/philosophy-of-science/article/impossibility-of-accurate-state-selfmeasurements/80B368D210379DA587D41603B551B95D)) — the measurement-theoretic twin of Gödel; and Gödel/Turing undecidability surfaces in real physics — the [spectral gap is undecidable](https://www.nature.com/articles/nature16059) (Cubitt, Pérez-García & Wolf 2015 [24]).

> ⚛️ **Honest quantum note.** There are no qubits here. Quantum mechanics is our metaphor and our lineage, *not* our runtime. We claim no quantum speedup — [none exists](https://scottaaronson.blog/?p=198) for this embarrassingly-parallel, classical workload; quantum neural nets suffer barren plateaus; browser state-vector simulators cap at ~16–20 qubits. The single honest hook — *"a creature that cannot be cloned, only re-grown"* — is enough, and it is literally true.

---

### 3.8 Hyperparameters

Every tunable lives in **one config** (`web/src/engine/hyperparams.ts`) — the single source of truth that the engine imports, the UI renders read-only in a **TUNING** panel, and this table documents. Defaults:

| Group | Parameter | Value | Meaning |
|---|---|---|---|
| Population | grid columns × rows | 14 × 14 | MAP-Elites behaviour grid (complexity × symmetry) — 196 niches |
| Population | random founders | 24 | minimal genomes seeded at world start |
| Population | vitality gate | 0.05 | reject the trivial empty fixed point |
| Population | novelty bias | 0.4 | with Novelty Search on, fraction of selections from the frontier — novelty informs, never dominates |
| Mutation | weight-mutate rate / σ | 0.7 / 0.4 | fraction of weights perturbed, and step size |
| Mutation | weight-reset rate | 0.06 | chance a weight is re-drawn |
| Mutation | bias-mutate rate / σ | 0.3 / 0.3 | as above, for node biases |
| Mutation | activation-swap rate | 0.08 | chance a node changes its squash function |
| Mutation | add-connection rate | 0.14 | NEAT structural: new edge |
| Mutation | add-node rate | 0.08 | NEAT structural: split an edge |
| Mutation | enable-toggle rate | 0.02 | flip a connection on/off |
| Mutation | add-gate rate | 0.05 | neataptic-style gating — **ON by default** |
| Mutation | recurrent / self-conn chance | 0.3 / 0.2 | back-edges (**recurrent ON by default**) / self-loops |
| Mutation | reader-mutate rate / σ | 0.7 / 0.3 | perturb the per-creature read-back network's weights (co-evolved) |
| Speciation | compatibility threshold | 0.7 | distance above which creatures split species |
| Speciation | crossover rate | 0.3 | offspring from innovation-aligned crossover (disjoint/excess from the fitter parent), balanced against novelty |
| Speciation | respeciate interval | 20 gen | how often species membership is recomputed |
| The loop | relaxation α / tolerance | 0.55 / 0.012 | the fixed-point iteration $g \leftarrow g + \alpha(T(g)-g)$ |
| The loop | read-back features / hidden | 12 / 10 | the per-creature read-back network: self-portrait samples in → hidden units → DNA′ |
| Tempo | offspring/frame (normal / TURBO) | 20 / 60 | search throughput |
| Tempo | follow cadence | 48 frames | how often FOLLOW BEST re-selects |

**Self-tuning.** None adapt automatically today; values were hand-set for a legible, lively search on a single device. The honest candidate for self-tuning is the **speciation threshold** — NEAT's classic *dynamic compatibility threshold*, nudged each generation to hold a target species count — which we have deliberately left fixed and flagged as future work rather than implying adaptivity we do not yet have.

## 4. The central claim, and how it is falsifiable

**Claim.** *Open-ended quality-diversity search discovers a diverse population of approximate self-encoding creatures (CPPN-painted, ES-placed substrates) that (a) cannot be matched, in joint diversity-and-fidelity, by objective-only search, and (b) exhibit more factored internal representations than gradient-descent-trained self-encoders of equal output fidelity.*

This is deliberately testable, and each clause can fail:

| Prediction | How it could be falsified |
|---|---|
| **P1.** QD (MAP-Elites) yields higher **loop fidelity** *and* greater archive coverage than objective-only search. | If an objective-only baseline matches or beats QD on **both** fidelity and coverage, the open-ended premise fails for this task. |
| **P2.** Evolved self-encoders show less "fracture" than SGD-trained self-encoders, by the neuron-visualisation / factoredness metric of [11]. | If evolved and SGD solutions of equal fidelity are indistinguishable on the FER/UFR metric, the representational argument collapses. |
| **P3.** A self-certifying genome (Pillar 1) verifies more cheaply than it re-computes. | If verification cost ≥ recomputation cost at our scale, the trust rationale for Pillar 1 is void — we fall back to replication (§3.5). |

**Where it must fail (stated up front).** Exact, bitwise self-encoding is impossible — the substrate field has finite expressivity, and heterogeneous hardware compounds it (§3.5); we predict only $\varepsilon$-approximate loops, and report loop fidelity live rather than as a fixed guarantee. Following Chang & Lipson [12], we also expect a **fidelity-vs-other-function trade-off**: pushing a creature to also be lively and visually striking (the art) will cost loop-closure accuracy. Reporting that trade-off curve honestly is part of the result, not a failure of it.

---

## 5. Limitations and ethics

- **It is an artwork and an experiment, not a theorem.** The contribution is a synthesis and a public instrument; the falsifiable claims (§4) are modest and bounded.
- **No over-claiming.** §3.7 (quantum) is metaphor and lineage, never mechanism — there are no qubits in Autograph. In §3.6, the signed Merkle-DAG lineage is built and real (and persisted in IndexedDB); the zkML "proof of becoming" is named as a research north star, not a result. The **swarm / shared archive is live** — a live peer count, a collective gen/s, and best-per-niche migration through the coordinator; what remains roadmap is planetary-scale GPU evaluation and **full verification of untrusted machines** (today the trust layer is signed-lineage + rate-limiting + keep-best merge; replication/quorum and zkML are to come) (§3.5, §3.6). Neuron placement is the **simplified** ES-HyperNEAT criterion; **full quadtree band-pruning ES-HyperNEAT is named as the direction, not shipped** (§3.2).
- **Energy honesty.** Per watt, datacentres win; the swarm's value is harvesting *idle, already-powered* hardware for embarrassingly-parallel QD search at ~zero marginal cost — not efficiency, and emphatically not frontier-model training [20].
- **Consent and transparency.** Donated compute requires explicit, revocable opt-in with visible resource use; never crypto-mining by stealth.
- **Accessibility.** A scalar-JS path ensures no device is excluded; colour-blind-safe palettes; no dark patterns.
- **Provenance and credit.** Outputs and lineage are open (CC BY-SA); the intellectual debts in §2 are acknowledged in full.

---

## 6. Future work

- **Atlas of Self-Reference.** Publish the illuminated archive as an open, browsable dataset — every discovered *kind* of strange loop, with lineage — in the spirit of citizen-science corpora.
- **Literal-impact path.** Citizen-science games have produced real artefacts: [Foldit](https://pmc.ncbi.nlm.nih.gov/articles/PMC2956414/) players solved and then *designed* proteins, and [EteRNA](https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1007059) designs were synthesised in a wet lab. The analogous ambition for Autograph is that crowd-discovered self-certifying / self-describing structures (Pillar 1) become genuinely useful primitives for trustworthy distributed computation — not merely a metaphor.
- **Self-reference as a benchmark for open-endedness.** Because the target is maximally self-contained, the self-encoding fixed point may be a clean, cheap testbed for comparing open-ended algorithms (POET [7], ELM [8], MAP-Elites [5]) on representation quality [11].
- **Scale the swarm.** The coordinator is live (PartyServer on Cloudflare, behind the existing `Archive` seam — see the [deploy runbook](./DEPLOY-coordinator.md)); next is many islands at GPU-tier throughput and a stronger trust layer (replication/quorum, then zkML proof-of-fitness) so untrusted machines can be *verified*, not only signature-checked.
- **Full ES-HyperNEAT.** Replace the simplified, variance-scored placement (§3.2) with the full quadtree band-pruning algorithm, so neuron resolution adapts to the information in the connectivity pattern.
- **Advance the pillars.** §3.6's signed lineage is built and persistent; the next step is a scoped zkML proof-of-fitness for archive elites on opt-in nodes, then recursive composition. §3.7 stays narrative by design.

---

## References

1. K. O. Stanley & R. Miikkulainen. *Evolving Neural Networks through Augmenting Topologies* (NEAT). Evolutionary Computation, 2002. https://nn.cs.utexas.edu/downloads/papers/stanley.jair04.pdf
2. J. Lehman & K. O. Stanley. *Abandoning Objectives: Evolution Through the Search for Novelty Alone*. Evolutionary Computation 19(2):189–223, 2011. https://www.cs.swarthmore.edu/~meeden/DevelopmentalRobotics/lehman_ecj11.pdf
3. L. Wang et al. *Tensorized NEAT (TensorNEAT): GPU-accelerated NeuroEvolution*. arXiv:2404.01817. https://arxiv.org/abs/2404.01817
4. F. Lim et al. *Accelerated Quality-Diversity through Massive Parallelism* (QDax). arXiv:2202.01258. https://arxiv.org/abs/2202.01258
5. J.-B. Mouret & J. Clune. *Illuminating Search Spaces by Mapping Elites* (MAP-Elites). arXiv:1504.04909. https://arxiv.org/abs/1504.04909
6. J. Secretan, K. O. Stanley et al. *Picbreeder: A Case Study in Collaborative Evolutionary Exploration of Design Space* (CPPNs). Evolutionary Computation 19(3):373–403, 2011. Picbreeder (live, authoritative): https://nbenko1.github.io/
7. R. Wang, J. Lehman, J. Clune & K. O. Stanley. *Paired Open-Ended Trailblazer (POET)*. arXiv:1901.01753. https://arxiv.org/abs/1901.01753
8. J. Lehman, J. Gordon, S. Jain, K. Ndousse, C. Yeh & K. O. Stanley. *Evolution through Large Models (ELM)*. arXiv:2206.08896. https://arxiv.org/abs/2206.08896
9. E. Hughes, M. Dennis, J. Parker-Holder, F. Behbahani, A. Mavalankar, Y. Shi, T. Schaul & T. Rocktäschel. *Open-Endedness is Essential for Artificial Superhuman Intelligence*. ICML 2024. arXiv:2406.04268. https://arxiv.org/abs/2406.04268
10. D. Hofstadter. *I Am a Strange Loop*, 2007. https://en.wikipedia.org/wiki/I_Am_a_Strange_Loop
11. A. Kumar, J. Clune, J. Lehman & K. O. Stanley. *Questioning Representational Optimism in Deep Learning: The Fractured Entangled Representation Hypothesis* (FER/UFR). arXiv:2505.11581, 2025. https://arxiv.org/abs/2505.11581
12. O. Chang & H. Lipson. *Neural Network Quine*. arXiv:1803.05859, 2018. https://arxiv.org/abs/1803.05859
13. K. Gödel. *On Formally Undecidable Propositions* (incompleteness theorems), 1931. https://en.wikipedia.org/wiki/G%C3%B6del%27s_incompleteness_theorems
14. S. C. Kleene. *Recursion theorem*. https://en.wikipedia.org/wiki/Kleene%27s_recursion_theorem · *Quine (computing)*: https://en.wikipedia.org/wiki/Quine_(computing)
15. D. Hofstadter. *Gödel, Escher, Bach: An Eternal Golden Braid*, 1979. https://en.wikipedia.org/wiki/G%C3%B6del,_Escher,_Bach
16. M. C. Escher. *Drawing Hands* (lithograph), 1948. https://en.wikipedia.org/wiki/Drawing_Hands
17. J. S. Bach. *The Musical Offering* (endlessly rising canon), 1747. https://en.wikipedia.org/wiki/Musical_Offering
18. J. von Neumann. *Theory of Self-Reproducing Automata* (universal constructor). https://en.wikipedia.org/wiki/Von_Neumann_universal_constructor
19. C. Langton. *Self-reproduction in cellular automata* (Langton's loops), 1984. https://en.wikipedia.org/wiki/Langton%27s_loops
20. D. P. Anderson. *BOINC*: job replication & homogeneous redundancy. https://github.com/BOINC/boinc/wiki/Job-replication · https://github.com/BOINC/boinc/wiki/Homogeneous-Redundancy
21. J. Á. Morell et al. *JSDoop: browser-based volunteer deep-learning*. arXiv:1910.07402. https://arxiv.org/pdf/1910.07402
22. *WebGPU now in all major browsers (Baseline)*, web.dev, 2026. https://web.dev/blog/webgpu-supported-major-browsers
23. *WGSL specification — floating-point evaluation* (no bit-exactness guarantee). https://github.com/gpuweb/gpuweb/blob/main/wgsl/index.bs
24. T. Cubitt, D. Pérez-García & M. M. Wolf. *Undecidability of the Spectral Gap*. Nature 2015. arXiv:1502.04573. https://arxiv.org/abs/1502.04573 *(referenced only by the speculative §3.7)*
25. K. O. Stanley. *Compositional Pattern Producing Networks* (CPPNs); connective CPPNs and the HyperNEAT / ES-HyperNEAT substrate-encoding lineage. GPEM, 2007. https://gwern.net/doc/ai/nn/fully-connected/2007-stanley.pdf *(ES-HyperNEAT's adaptive quadtree placement is the named direction; we ship a simplified variance-scored placement, §3.2.)*
26. M. Hastings, R. Guha & K. O. Stanley. *Evolving Content in the Galactic Arms Race Video Game* (cgNEAT; implicit, behavioural fitness). IEEE Computational Intelligence and Games, 2009. https://en.wikipedia.org/wiki/Galactic_Arms_Race
