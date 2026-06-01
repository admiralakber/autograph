# 🤲 Autograph — Vision

> **The algorithm of life: a lifeform trying to draw its true self out of the false — and a whole world watching, and helping, a neural network understand its true self.**

This is the single source of truth for *why* Autograph exists — the soul and the two things it tries to teach. Everything else (the [README](./README.md), the [whitepaper](./docs/WHITEPAPER.md), the [blog](./docs/BLOG.md), the [design notes](./docs/notes/)) descends from this page. If a feature, a sentence or a pixel does not serve what is written here, it does not belong.

---

## 1. The Genesis, and the loop 🌅

Autograph is a single, living **strange loop** you join the moment the instrument loads. Every creature that has ever lived in it descends from one canonical seed — the **Genesis** of the world, preserved byte-for-byte:

```text
And yet.... 🦕 a trace.... ✨ of.. the true self... 🐣 exists.... 🐥 within the false 🍗 = 🦖
```

A creature is **two networks that make each other**:

- 🧬 **DNA — the genotype.** A small *connective* CPPN. Hand it two coordinates in space and it answers with **four channels**: *structure* (`weight`, `bias`) and *faculties* (`α` Hebbian plasticity, `modGate` neuromodulation). It is the recipe, and we draw it as a small graph of nodes and edges.
- 🧠 **The brain — the phenotype.** An ES-HyperNEAT *substrate* **grown from the DNA's weight pattern**: its hidden neurons are **placed, made dense, and wired** by a genuine quadtree of that pattern (Risi & Stanley 2012), settling where the pattern carries information. Its wiring **is** the self-portrait the creature sees. The brain **reads** that picture of its own wiring (spherical foveated glimpses) and **writes its EXACT DNA back as a graph** — node activation-types + biases, connection topology + weights — through its own **output neurons**, computed by running.

The loop is literal — and it is the *same function*, read two ways:

```mermaid
flowchart LR
  DNA["🧬 DNA · genotype<br/>(a connective CPPN · 4 channels)"] -->|"weight pattern → ES-HyperNEAT grows the brain"| PHENO["🧠 brain · phenotype<br/>(a plastic, attentive substrate)"]
  PHENO -->|"its wiring rendered<br/>(density↔connection, hue↔activation)"| ART["✨ the self-portrait<br/>(the network, made visible)"]
  ART -->|"the brain READS it (spherical glimpses)"| PHENO
  PHENO -->|"WRITES its DNA back as a GRAPH<br/>topology + activations + weights → DNA′"| DNA2["🧬 DNA′ (the exact recipe)"]
  DNA2 -. "skill = how much of its DNA it writes back<br/>above the mean (R²), length + values — watched live" .-> DNA
```

A brain **grows from the DNA**; its wiring **is** the self-portrait; then the brain **reads that portrait of its own wiring** and **reconstructs its EXACT DNA** — the genome graph itself ([von Neumann](https://en.wikipedia.org/wiki/Von_Neumann_universal_constructor) self-reproduction). The brain takes attention-chosen, foveated **glimpses** in **spherical (r, θ, φ)** volumetric attention (it decides where + how deep to look, [RAM](https://arxiv.org/abs/1406.6247)-style — *evolved* hard attention), reading four channels — density, activation-hue, and the **signed** weight + **signed** bias (so excitatory/inhibitory and bias-apart-from-strength are readable) — **ponders** over a handful of recurrent steps — its synapses self-modifying *as it looks*, under its own [neuromodulation](https://arxiv.org/abs/2002.10585) — and then **writes its DNA back as a GRAPH** *from its own output neurons*, autoregressively ([seq2seq](https://arxiv.org/abs/1409.3215)): node genes (a categorical **activation type** + a bias), then connection genes (a **topology** of from/to slots + a weight + an enabled bit), **deciding its own structure size**. DNA′ is scored against DNA **gene-for-gene** — [NEAT](https://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf)-innovation-aligned, graded partial credit; the writer is the creature's own evolved network, a continuous cousin of Chang & Lipson's [neural-network quine](https://arxiv.org/abs/1803.05859) made structural. **Skill** is that gene-for-gene match — graded and **coupled** (you must get the structure *and* the activations *and* the weights *and* the size; half-solutions can't win) — measured live, never faked: a blank creature scores **0.000**; a single garden recovers most of its topology (≈ 0.78) and activation types (≈ 0.60 vs 0.083 chance), a third of its weights (R² ≈ 0.34) and very nearly the right size, with the coupled selection skill ≈ 9% — humbling, earned, always climbing, never "solved".

Then comes the honest, humbling part — and it is a **measured, structural truth** with two halves we are careful to tell apart. One limit was **incidental, and we removed it**: the self-portrait used to discard the *sign* of every weight and bias (an `abs`), so exact reconstruction of the readable genes was literally impossible — now the portrait carries the sign (an oracle reader recovers it at 95.8% / 98.2%), so perfect reconstruction of the readable genes is reachable *in principle*. The other is **fundamental, and we keep it**: a creature is grown from its DNA by a deterministic but *expansive* development, and many different DNAs grow the same creature — so reading even a perfect picture of the grown self cannot pin down the one exact recipe. So, reaching for its *whole* self, the brain still grasps only a **fraction**: a single garden recovers most of its **topology** (≈ 0.6–0.78) and **activation types** (≈ 0.6–0.75, against 0.083 by chance), a good fraction of its **weights** (R² ≈ 0.3–0.5, lifted now the sign is readable), and very nearly the right *size* (often exact) — the node biases are the honest frontier (the information is now present; evolution hasn't yet routed it). The selection skill (≈ few %) is the coupled product of that whole-graph reconstruction; we report the smaller, truer, structural number rather than a flattering one. That residual non-identifiability is the genuine poem. So **"life is imperfect self-knowledge"** is no longer only a poem we chose; it is a result the instrument *discovered about itself*: **we reach for our true selves and hold only a part — and the reaching is the life.** A living creature can only ever *approach* closure, never rest there — and the vitality gate + quality-diversity (see §3) hold the search on the living side.

---

## 2. Two things we show, never lecture 📐

Autograph is an *explorable explanation*. It earns its two teaching goals by making them visible and toggle-able, not by writing them on a slide.

### Goal A — what an indirect encoding really is (ES-HyperNEAT)

The deepest comprehension goal: **a beautiful render *is* a neural network, and that neural network *has* a DNA.** The instrument lets you view the *same* individual three ways and flip between them:

```mermaid
flowchart LR
  V1["🧬 (c) its DNA<br/>(the CPPN graph)"] --- V2["🧠 (b) its brain<br/>(the phenotype network)"] --- V3["✨ (a) its image<br/>(the 3-D render)"]
  V3 -. "same individual, three faces" .-> V1
```

Seeing genotype → substrate → render as three views of one thing teaches *indirect encoding* — the genome is a small recipe that grows a much larger body — in a way no diagram can. The neurons aren't placed on a fixed grid; a genuine **ES-HyperNEAT** quadtree of the DNA's weight pattern decides where information lives, how dense the neurons are, and which connections express (Risi & Stanley 2012). We implement the real algorithm and name its one honest bound — a browser-capped quadtree depth — in §3.

### Goal B — what distributed compute is for (a live swarm)

Autograph runs **on your own device and joins a shared world**. There is no account, and nothing leaves the tab but the elites you choose to share; you are one node among many. Many devices grow *one shared garden* through a coordinator, so a creature discovered on a phone in one city **migrates** to illuminate the wall for everyone, and the tree of life is a single shared genealogy — with a live peer count and a collective gen/s you can watch climb as machines join. (`?swarm=off` keeps you fully local.) The deploy details are in the [coordinator runbook](./docs/DEPLOY-coordinator.md). The teaching is gentle and true: *idle, consenting, ordinary hardware can grow something beautiful together*, and the commons is protected by openness, not by a coin.

**The shape the swarm takes is an archipelago.** Because devices run at wildly different speeds and sync only now and then, the swarm is an *asynchronous island model*: isolated demes form on their own — with no designed topology — simply because a fast desktop and a throttled phone drift apart between syncs. Best-per-niche elites migrate through the coordinator; isolation breeds *allopatric speciation*; speciation breeds diversity. A planetary archipelago of emergent islands, all feeding one signed genealogy, is the prize. **Honestly:** the swarm, the coordinator, live peer count and best-per-niche migration are real today; the coordinator's trust layer is signed-lineage + rate-limiting + keep-best merge, with full replication and a zkML "proof of becoming" for untrusted machines still to come.

**And the crowd genuinely out-discovers the lone mind — the point, made measurable.** This loop is hard — reconstructing your *exact graph* from a picture of your own wiring: a single machine evolving alone is humbled, reaching a real partial self-reconstruction over a couple of thousand generations (topology ≈ 0.78, activation types ≈ 0.60, weights R² ≈ 0.34, size near-exact), still climbing (a blank or random creature scores **0.000**; closing *more* of yourself counts for more — it is *not* a freebie; ablation confirms plasticity + attention are load-bearing, so the brain genuinely *reads* its portrait before it writes). The crowd climbs far higher: the swarm dynamics that carried earlier worlds' self-encoders far above the lone explorer are unchanged, and the collective ceiling is the fresh world's to write as the islands run it. *No mind knows itself alone* is not only the soul of the piece; here it is a measured result.

---

## 3. The honesty ethic 🫶

The project lives or dies on not over-claiming. Three rules, no exceptions:

- **Real is labelled real; illustrative is labelled illustrative.** Today the DNA evolved by NEAT augmenting topologies (add-node / add-connection with innovation numbers, recurrent links) + speciation + textbook innovation-aligned crossover, the genuine ES-HyperNEAT substrate (quadtree division + band-pruning placement/density/connectivity), an optional Novelty Search mode, the **network-depiction** 3-D volumetric render (density ↔ connection strength, hue ↔ activation type — the wiring made visible), the **structural self-writer** loop (the brain reconstructs its exact DNA graph) and its honest graded, complexity-weighted skill (topology · activations · weights · size), the signed lineage that auto-records the champion line and persists across sessions, the MAP-Elites diversity map, and the **live shared swarm** (peer count, collective gen/s, best-per-niche migration through the coordinator) are **real and running**. The honestly-flagged approximations are the *bounded* ES-HyperNEAT quadtree depth, its 2-D placement sheet (with a 3-D swept render), and the heterogeneous-activation / CPPN-bias extensions. The brain genuinely **reads then writes**: it takes attention-chosen, foveated **glimpses** (spherical r,θ,φ) of its self-portrait ([RAM](https://arxiv.org/abs/1406.6247)-style *evolved* hard attention), **ponders** over recurrent steps with CPPN-painted **Hebbian plasticity** + **[Backpropamine](https://arxiv.org/abs/2002.10585)-style neuromodulation** active, **halts** when it has seen enough ([ACT](https://arxiv.org/abs/1603.08983)), then **writes its DNA back as a graph** — every behaviour computed by *running* the network, read from its own **output neurons**, never painted into the DNA (the genotype↔phenotype boundary kept clean). It is, in plain and literally-true words, a *thinking, self-modifying, recurrent, self-writing, neuroevolved* network — **no transformer, no LLM**. And it discovered a humbling truth about itself: it reconstructs *most* of its DNA graph but never *all* — *measured*, not assumed (§1). Still **directions**, clearly marked: the honest frontier — close the **remaining gaps** (node biases, the last of the exact topology) + a **behavioural-equivalence** fitness (score DNA′ on whether it grows the *same brain*, not just gene-for-gene match), *not built*; a single dedicated evolution **Web Worker** + **WASM/SIMD** for smoother throughput (a multi-core eval pool is precluded — it would change the honest numbers); and the zero-knowledge "proof of becoming", full verification of untrusted machines, and the quantum framing. All of these we mark plainly wherever they appear — none is claimed as implemented.
- **No grift.** No coin, no token, no manufactured scarcity, no pay-to-participate. Provenance is proved the way [Git](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) proves it — content-addressed and signed — with no blockchain.
- **Self-reference must be load-bearing.** A blank creature "encodes itself" with nothing to reconstruct — it scores ~0 skill (no variance) *and* is refused by the vitality gate. So closure alone is never rewarded: a **vitality gate** plus **MAP-Elites quality-diversity** keep the population pushing against a real world, exactly as a self-replicator coupled to a task must ([Chang & Lipson](https://arxiv.org/abs/1803.05859)'s lesson).

---

## 4. The aesthetic doctrine 🎛️

> **A precise greyscale instrument framing vivid, sunrise-coloured life.**

Autograph is not a scrolling marketing page; it is a full-screen **instrument** — mission-control for a live experiment. The discipline is borrowed from high-end audio and the restraint of Dieter Rams' Braun: nothing decorative, everything legible.

```mermaid
flowchart TB
  subgraph CHROME["⬜ The instrument — strictly GREYSCALE + MONOSPACE"]
    direction LR
    P["panels · rules · labels"]
    R["readouts · counters · borders"]
  end
  subgraph LIFE["🌅 Life — the ONLY colour: the sunrise palette"]
    direction LR
    C["creature renders"]
    A["living-thing accents"]
  end
  CHROME -. "the frame never competes with the life it frames" .-> LIFE
```

- **The chrome is monochrome.** Every panel, rule, label, readout and the fitness borders on the population grid are greyscale and monospace. Value, not hue, carries meaning.
- **Colour means life, and nothing else.** The only colour anywhere is the **sunrise** palette — the [HSLuv](https://www.hsluv.org/) colour space (MIT), at Lightness 72, Saturation 100, with hue swept the full 0→360 and an alpha around 0.7. It colours *living things only*: the creatures' images and the accents that stand for life. HSLuv gives a perceptually even sweep, so the cycle glows like a sunrise with no muddy or blown-out arcs.

When you are unsure whether something should have colour, the answer is almost always no. Colour is reserved for the life inside the machine.

---

<sub>🌿 Autograph is built by **[Aqeel Akber](https://aqeelakber.com)**, who also builds **[meos](https://meos.do)** — local-first, sovereign, on-device. The same belief at a different scale: a thing that belongs to itself, grown by many hands. 🤲↺</sub>
