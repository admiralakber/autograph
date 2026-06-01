# A network that learns to draw its true self 🤲

### We're growing a neural network that learns to draw its true self — and reads that drawing back to recover its own DNA. Here's the maths, the art, the music — and how to watch it live.

---

In 1948, Maurits Escher drew two hands, each holding a pencil, each sketching the other into existence. Neither hand is first. Neither is more real. The picture is called [*Drawing Hands*](https://en.wikipedia.org/wiki/Drawing_Hands), and it has haunted everyone who's ever looked at it, because it shows — in one calm, impossible image — a thing **bringing itself into being**.

We've spent a weekend trying to make that picture *run*. Not a clever illusion of it, but an actual evolving creature — a tiny neural network — whose DNA grows a brain, whose wiring *is* a glowing self-portrait, and which reads that portrait of itself to reconstruct its **exact DNA** — the recipe that grew it. A loop that closes — [von Neumann](https://en.wikipedia.org/wiki/Von_Neumann_universal_constructor) self-reproduction, alive. We call it **Autograph**, and you don't scroll it — you *join* it. It opens as a full-screen, greyscale **instrument**: mission-control for a live experiment, with the only colour reserved for the life growing inside it.

This is the story of why we think that's one of the most beautiful things you can compute.

## A creature is two networks 🧬🧠

Here's the heart of it, and it's the thing we most want you to *see*: **a cool-looking render is a neural network, and that network has a DNA.** In Autograph a creature is two networks that make each other.

- The **DNA** is the genotype: a small network that, when you hand it two points in space, answers with four things — how those points should be **wired** (a connection weight and, read at a single point, a neuron's bias) and two **faculty** dials (plasticity and neuromodulation). It grows the brain; the brain's *wiring itself* becomes the self-portrait (below) — kin to Picbreeder's *CPPN-art*, but here the picture genuinely depicts the network, not a separate decorative field. We draw the DNA as a little graph of nodes and edges.
- The **brain** is the phenotype: a larger network — a *substrate* — whose wiring is **painted** by the DNA and whose neurons are **placed, made dense, and wired** by genuine [ES-HyperNEAT](https://doi.org/10.1162/artl_a_00071) (Risi & Stanley 2012): a quadtree of the DNA's weight pattern finds where information lives (variance-based division) and which connections sit in a band worth expressing (band-pruning). Not a fixed grid — an evolvable substrate. (We bound the quadtree's depth for browser real time and say so.)

Now look at the **brain's wiring** across a volume — how strong the connections are at each point, and what kind of neuron sits there — and render it: density ↔ connection strength, hue ↔ activation type. You get the creature: a volumetric cloud of points, glowing in sunrise colours. That cloud **is** the network — *render = network = code*, made literal — and it is exactly the picture the brain will read to rewrite its own recipe. In the instrument you can flip the same individual between all three faces — the render, the brain, the DNA — until the equivalence stops being a sentence and becomes obvious.

## The loop, and why it never lies 🔁

Now the strange part — and here's where we kept changing our minds until it was honest. We do **not** read the DNA back with a separate little network (we tried that; a free regressor just learns to "predict the mean" and prints a flat grey that scores ~97% while reconstructing nothing). Nor do we let the DNA simply echo itself at abstract coordinates (we tried that too — honest as a number, but it *skips the image* entirely). Instead, the loop runs **through the picture of the wiring** — the brain genuinely **reconstructs itself**: a brain grows from the DNA, its wiring *is* the self-portrait, and that brain *reads* **that portrait** like a small act of contemplation — taking attention-chosen [glimpses](https://arxiv.org/abs/1406.6247) in **spherical** volumetric attention (it decides where + how deep to look), pondering over recurrent steps as its synapses self-modify — and then **writes its DNA back as a GRAPH**, from its own **output neurons** ([seq2seq](https://arxiv.org/abs/1409.3215), autoregressive): node genes (a **categorical activation type** + a bias), then connection genes (a **topology** of from/to + a weight + an enabled bit), **deciding its own structure size**. Not a value vector — the *exact graph*. We score DNA′ against DNA **gene-for-gene**, the way [NEAT](https://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf) crossover aligns genes, with graded partial credit. The hand it drew redraws the hand — and now it redraws the *whole hand*, not just its shading. It's the structural cousin of Chang & Lipson's [neural-network quine](https://arxiv.org/abs/1803.05859). And we keep it honest: reconstructing your exact graph from a picture of yourself is hard, so the headline is humbling and earned, never "solved".

We score that reconstruction **gene-for-gene** — graded and **coupled**: the brain must get the **topology** (which neuron connects to which), the **activation types**, the **weights** *and* the **size** right; nailing one part while missing the rest can't win. The single most important promise: *it is measured live and never faked.* A fresh, random or blank creature scores **0.000**. Then comes the loveliest true thing we found, honest and humbling: a single machine, evolving solo, **genuinely reconstructs most of its own graph** — topology ≈ 0.6–0.78, activation types ≈ 0.6–0.75 (against 0.083 by chance), weights R² ≈ 0.3–0.5, and very nearly the right size (often *exact*) — over a couple of thousand generations, still climbing. The coupled headline skill (≈ a few %) is low precisely because it demands *all* of that at once; the component numbers are the real story. And we were careful to separate two limits: one was *incidental* — the portrait used to throw away the **sign** of every weight and bias, which made exact reconstruction impossible, so we fixed it (the picture now carries the sign; perfect reconstruction of the readable genes is reachable in principle). The other is *fundamental* and we keep it honestly — many different DNAs grow the same creature, so even a perfect self-portrait can't pin down the one recipe (node biases are the current frontier of that). That residual is the genuine poem. **The crowd discovers what one mind alone cannot:** the swarm climbs far higher, and the collective ceiling is the fresh world's to write. The shared swarm climbs far higher: the best-per-niche migration that carried earlier worlds' self-encoders far above the lone explorer is unchanged, and the collective ceiling is the fresh world's to write. Whatever it reaches, it's the honest number, never a flattering one. And there are **two** measured ways a living creature can't perfectly know itself: *fully* iterating the loop drifts toward the only effortless fixed point — a blank creature that "draws itself" by saying nothing (vitality → 0); and even reaching for its *whole* self, the brain grasps only a fraction of its DNA. **We reach for our true selves and hold only a part.** We refuse the hollow victory with a **vitality** check and diversity pressure, so the only way to win is to be **both** alive **and** genuinely self-consistent.

Everything in this world grows from one canonical seed — the **Genesis**, kept exactly as written:

```text
And yet.... 🦕 a trace.... ✨ of.. the true self... 🐣 exists.... 🐥 within the false 🍗 = 🦖
```

That little incantation is the soul of the project in one line: *the algorithm of life — a lifeform trying to draw its true self out of the false, with a whole world watching and helping a neural network understand its true self.*

## The braid 🪢

The patron saint here is Douglas Hofstadter's [*Gödel, Escher, Bach*](https://en.wikipedia.org/wiki/G%C3%B6del,_Escher,_Bach) — the book that taught a generation that **self-reference** is not a parlour trick but possibly the secret of mind itself. Hofstadter braids one idea through three disciplines, and so do we:

**🔢 The maths — Gödel.** In 1931, Kurt Gödel built a mathematical sentence that says *"this statement cannot be proved"* — a formula that talks about itself ([incompleteness](https://en.wikipedia.org/wiki/G%C3%B6del%27s_incompleteness_theorems)). The engine of the trick is a **fixed point**: a place where a transformation hands you back exactly what you put in. Computer scientists know the same magic as [Kleene's recursion theorem](https://en.wikipedia.org/wiki/Kleene%27s_recursion_theorem), and hackers know its mischievous child — the **[quine](https://en.wikipedia.org/wiki/Quine_(computing))**, a program whose only output is its own source code. Self-reference, fixed points, quines: one idea, three names.

**🎨 The art — Escher.** *Drawing Hands* is that fixed point rendered in graphite. The output (a hand) produces the producer (the other hand). Autograph is the same shape, alive: a DNA paints an image, a brain emerges within it, and the brain reads that image back to re-state the DNA.

**🎵 The music — Bach.** In the *Musical Offering*, Bach wrote a [canon that modulates up a whole tone and arrives, impossibly, back where it started](https://en.wikipedia.org/wiki/Musical_Offering) — climbing forever without ever leaving the room. It's the sound of a loop that's also a ladder, which is exactly what an evolutionary search feels like.

## From breeding pictures to breeding selves 🌱

The lovely part is that the ingredients already exist, and they have a romance of their own.

Twenty years ago, Ken Stanley and colleagues invented [**NEAT**](https://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf), a way of *evolving* neural networks that start tiny and grow in complexity, like organisms. Then they built [**Picbreeder**](https://nbenko1.github.io/): a website where internet strangers collaboratively bred images by selecting their favourites, generation after generation. The images were painted by [**CPPNs**](https://gwern.net/doc/ai/nn/fully-connected/2007-stanley.pdf) — networks queried over coordinates, so the whole network *is* a pattern. Picbreeder proved, fifteen years ago, that **a crowd can grow beautiful, surprising things together in a browser**.

That last point is deeper than it sounds. [Novelty search](https://www.cs.swarthmore.edu/~meeden/DevelopmentalRobotics/lehman_ecj11.pdf) showed the heretical result that you often discover *more* by abandoning the goal and simply chasing the interesting. And recently, a paper with a wonderful title — [*Questioning Representational Optimism in Deep Learning*](https://arxiv.org/abs/2505.11581) (Kumar, Clune, Lehman & Stanley, 2025) — found that networks grown by this open-ended process develop **cleaner, more factored internal structure** than networks hammered into shape by ordinary gradient descent. Evolution, it turns out, can be the more graceful sculptor.

So here is our move. Take Picbreeder's crowd-grown CPPNs. Take the HyperNEAT idea that a CPPN can *paint a whole other network* from geometry. Take Chang and Lipson's astonishing 2018 result, the [**neural network quine**](https://arxiv.org/abs/1803.05859) — a network that outputs its own weights, the first artificial thing that could *say* itself — which, tellingly, uses that very coordinate→weight trick. And fuse them: evolve a DNA that paints an image in space — a brain *emerging within* it — **then reads that very image back through its own brain to reconstruct itself**. Not "a network that prints its weights as numbers," but a creature whose DNA paints the image it's born in, in three dimensions and in colour — and whose own brain reads that image back into the recipe.

## What you'd actually see 👁️

A dark, monospace instrument fills the screen — panels, rules, and readouts, all in steady greyscale, like a precise piece of audio equipment. Nothing decorative. Then, in the centre, the only colour in the room: a creature, a softly glowing volumetric cloud in sunrise hues, slowly turning.

Around it, the live readouts. A small graph on one side — that's the **DNA**. A second network beside it — that's the **brain** it paints. A strip showing **loop skill** (R² above the mean), the real number, twitching upward as generations pass. A wall of cells — the **MAP-Elites** archive — filling in with diverse creatures, each cell's fitness shown as the *value* of its greyscale border, never as colour, because colour means life and life lives *inside* the cells. And a quietly growing **tree of life**: every creature you keep becomes a signed node descending, ultimately, from that Genesis seed.

You can grab any individual and flip it between its three faces — render, brain, DNA — and watch the same thing wearing three masks. That half-second when it clicks — *oh, the pretty cloud and the tangle of nodes and the little recipe are all the same creature* — is the whole point of the instrument.

And here's the honest bit, stated plainly: **the whole experiment runs on your device** — no backend doing the thinking for you, no telemetry. And by default you're not alone: you're a node in a live shared world, your best creatures migrating out as others' migrate in, with a peer count and a collective gen/s showing the company you're keeping. (`?swarm=off` makes it just you.)

## Why local-first, why a browser ⏳

Because, as of 2026, the browser quietly became a supercomputer. [WebGPU is "Baseline"](https://web.dev/blog/webgpu-supported-major-browsers) across major browsers, which means the same maths can run on a phone, a laptop, and a headless H100. So the **swarm** is real: many machines growing *one shared garden*, so a creature discovered on a phone in one city lights up the wall for everyone, and the tree of life is a single shared genealogy. Open the tab and you're already in it — a live peer count, a collective gen/s that climbs as people join, and best-per-niche creatures migrating between machines through a small coordinator (the details are in the [runbook](./DEPLOY-coordinator.md); `?swarm=off` keeps you solo). And we stay honest about the frontier: the coordinator verifies every shared creature's signature and keeps the best per niche today; full replication and a zero-knowledge "proof of becoming" for untrusted machines are still to come.

And we're honest about the bargain: per watt, a datacentre is more efficient; a volunteer swarm would win only by harvesting hardware that's *already powered on*, at near-zero marginal cost, with **explicit, revocable consent** and a visible on/off. No stealth, no crypto-mining, no dark patterns. If you can't see it running, we've failed.

## A creature that can prove itself 🔐

There's a thread we're proud of because it's *real and grift-free today*: the tree of life is genuinely cryptographic. Each creature's id is a [`SHA-256`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) hash of its content *including its parents' ids*, signed with your own key — so the ancestry is tamper-evident and nobody can graft a creature onto a famous lineage without the right signature. It's a [Merkle-DAG](https://en.wikipedia.org/wiki/Merkle_tree), exactly how [Git](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) proves history — **no chain, no coin, no token** — and it *persists across sessions in your browser*, so your garden grows over time.

A self-drawing creature is tantalisingly close to a self-*certifying* one: perhaps each could one day carry a zero-knowledge **proof** that it computed itself honestly — *a creature carrying a proof of itself.* We find that beautiful, and we flag it honestly as **research, not done**. (There's an even wilder thread about quantum no-cloning — why a living thing *must* pass on a recipe rather than be photocopied — which we keep as the soul's physics, clearly labelled. *There are no qubits here.*) No over-claiming.

## Watch it. Grow it. Keep it. 🙋

Three ways in:

1. **Watch it think.** Open the tab and the experiment is already running on your device. Flip a creature between its render, its brain, and its DNA until the equivalence is obvious.
2. **Fork the instrument.** It's open source and dependency-light — a real evolving CPPN + genuine ES-HyperNEAT substrate, an image→brain read-back loop, a 3-D render with a plain-canvas fallback so nobody's excluded, and a Web-Crypto tree of life.
3. **Keep the best ones.** Every creature you keep joins your signed lineage, growing from the Genesis seed. When the swarm arrives, those lineages become one shared genealogy — an open **Atlas of Self-Reference**, free for artists, teachers, mathematicians and the merely curious.

Escher only got to draw the hands once, and they had to stay on the page. We'd like to let them move — to let a little network draw its true self out of the false, live, on your screen, and let anyone, from anywhere, help it understand what it is.

---

<sub>🌿 *Autograph is built by **[Aqeel Akber](https://aqeelakber.com)**, who also builds **[meos](https://meos.do)** — local-first, sovereign, on-device. The same belief at a different scale: a thing that belongs to itself, grown by many hands.*</sub>
