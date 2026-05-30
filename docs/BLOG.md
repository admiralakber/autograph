# A network that learns to draw its true self 🤲

### We're growing a neural network that learns to draw its true self — and reads that drawing back to recover its own DNA. Here's the maths, the art, the music — and how to watch it live.

---

In 1948, Maurits Escher drew two hands, each holding a pencil, each sketching the other into existence. Neither hand is first. Neither is more real. The picture is called [*Drawing Hands*](https://en.wikipedia.org/wiki/Drawing_Hands), and it has haunted everyone who's ever looked at it, because it shows — in one calm, impossible image — a thing **bringing itself into being**.

We've spent a weekend trying to make that picture *run*. Not a clever illusion of it, but an actual evolving creature — a tiny neural network — whose glowing self-portrait can be read back to recover the very DNA that drew it. A loop that closes. We call it **Autograph**, and you don't scroll it — you *join* it. It opens as a full-screen, greyscale **instrument**: mission-control for a live experiment, with the only colour reserved for the life growing inside it.

This is the story of why we think that's one of the most beautiful things you can compute.

## A creature is two networks 🧬🧠

Here's the heart of it, and it's the thing we most want you to *see*: **a cool-looking render is a neural network, and that network has a DNA.** In Autograph a creature is two networks that make each other.

- The **DNA** is the genotype: a small network that, when you hand it the positions of two points in space, tells you how they should be wired — a connection weight, and a gate that decides if the connection exists at all. We draw it as a little graph of nodes and edges.
- The **brain** is the phenotype: a larger network — a *substrate* — whose wiring is **painted** by the DNA and whose neurons are **placed** by the DNA, dropped wherever the incoming pattern carries the most information. (Researchers call this family of tricks HyperNEAT and [ES-HyperNEAT](https://gwern.net/doc/ai/nn/fully-connected/2007-stanley.pdf); we ship a simplified, honest version of the placement and say so.)

Ask that brain, at every point in a volume, "how much life is here, and what colour?" and it answers with a field of density and hue. Render that field and you get the creature: a volumetric cloud of points, glowing in sunrise colours. That cloud **is** the brain, and the brain **is** the DNA, expressed. In the instrument you can flip the same individual between all three faces — the render, the brain, the DNA — until the equivalence stops being a sentence and becomes obvious.

## The loop, and why it never lies 🔁

Now the strange part. Take that finished self-portrait and read the density back at a set of known probe points in space — one probe for each number in the DNA. Line the readings up against the DNA's own numbers. The closer they match, the more the creature has managed to **draw a true picture of itself**.

We call that match **loop fidelity**, and the single most important promise we make is this: *it is measured live, and never faked.* A fresh, random creature tends to sit in the low 0.6s — a blurry guess at itself. As evolution does its work, the lively ones climb into the high 0.8s. It never reaches a perfect 1.0, and that's not a bug we're hiding — it's the truth of the thing. A drawing made of finite ink can't perfectly contain the hand that drew it. There's even a cheat the maths *wants* to take: a blank, empty creature "draws itself" perfectly by drawing nothing. We refuse that hollow victory with a **vitality** check and a diversity pressure (below), so the only way to win is to be **both** alive **and** self-aware-ish.

Everything in this world grows from one canonical seed — the **Genesis**, kept exactly as written:

```text
And yet.... 🦕 a trace.... ✨ of.. the true self... 🐣 exists.... 🐥 within the false 🍗 = 🦖
```

That little incantation is the soul of the project in one line: *the algorithm of life — a lifeform trying to draw its true self out of the false, with a whole world watching and helping a neural network understand its true self.*

## The braid 🪢

The patron saint here is Douglas Hofstadter's [*Gödel, Escher, Bach*](https://en.wikipedia.org/wiki/G%C3%B6del,_Escher,_Bach) — the book that taught a generation that **self-reference** is not a parlour trick but possibly the secret of mind itself. Hofstadter braids one idea through three disciplines, and so do we:

**🔢 The maths — Gödel.** In 1931, Kurt Gödel built a mathematical sentence that says *"this statement cannot be proved"* — a formula that talks about itself ([incompleteness](https://en.wikipedia.org/wiki/G%C3%B6del%27s_incompleteness_theorems)). The engine of the trick is a **fixed point**: a place where a transformation hands you back exactly what you put in. Computer scientists know the same magic as [Kleene's recursion theorem](https://en.wikipedia.org/wiki/Kleene%27s_recursion_theorem), and hackers know its mischievous child — the **[quine](https://en.wikipedia.org/wiki/Quine_(computing))**, a program whose only output is its own source code. Self-reference, fixed points, quines: one idea, three names.

**🎨 The art — Escher.** *Drawing Hands* is that fixed point rendered in graphite. The output (a hand) produces the producer (the other hand). Autograph is the same shape, alive: a DNA paints a brain, the brain paints a self-portrait, and the self-portrait re-states the DNA.

**🎵 The music — Bach.** In the *Musical Offering*, Bach wrote a [canon that modulates up a whole tone and arrives, impossibly, back where it started](https://en.wikipedia.org/wiki/Musical_Offering) — climbing forever without ever leaving the room. It's the sound of a loop that's also a ladder, which is exactly what an evolutionary search feels like.

## From breeding pictures to breeding selves 🌱

The lovely part is that the ingredients already exist, and they have a romance of their own.

Twenty years ago, Ken Stanley and colleagues invented [**NEAT**](https://nn.cs.utexas.edu/downloads/papers/stanley.jair04.pdf), a way of *evolving* neural networks that start tiny and grow in complexity, like organisms. Then they built [**Picbreeder**](https://wiki.santafe.edu/images/1/1e/Secretan_ecj11.pdf): a website where internet strangers collaboratively bred images by selecting their favourites, generation after generation. The images were painted by [**CPPNs**](https://gwern.net/doc/ai/nn/fully-connected/2007-stanley.pdf) — networks queried over coordinates, so the whole network *is* a pattern. Picbreeder proved, fifteen years ago, that **a crowd can grow beautiful, surprising things together in a browser**.

That last point is deeper than it sounds. [Novelty search](https://www.cs.swarthmore.edu/~meeden/DevelopmentalRobotics/lehman_ecj11.pdf) showed the heretical result that you often discover *more* by abandoning the goal and simply chasing the interesting. And recently, a paper with a wonderful title — [*Questioning Representational Optimism in Deep Learning*](https://arxiv.org/abs/2505.11581) (Kumar, Clune, Lehman & Stanley, 2025) — found that networks grown by this open-ended process develop **cleaner, more factored internal structure** than networks hammered into shape by ordinary gradient descent. Evolution, it turns out, can be the more graceful sculptor.

So here is our move. Take Picbreeder's crowd-grown CPPNs. Take the HyperNEAT idea that a CPPN can *paint a whole other network* from geometry. Take Chang and Lipson's astonishing 2018 result, the [**neural network quine**](https://arxiv.org/abs/1803.05859) — a network that outputs its own weights, the first artificial thing that could *say* itself — which, tellingly, uses that very coordinate→weight trick. And fuse them: evolve a DNA whose painted brain renders a self-portrait that **re-encodes the DNA**. Not "a network that prints its weights as numbers," but a creature that **draws** itself in three dimensions, in colour.

## What you'd actually see 👁️

A dark, monospace instrument fills the screen — panels, rules, and readouts, all in steady greyscale, like a precise piece of audio equipment. Nothing decorative. Then, in the centre, the only colour in the room: a creature, a softly glowing volumetric cloud in sunrise hues, slowly turning.

Around it, the live readouts. A small graph on one side — that's the **DNA**. A second network beside it — that's the **brain** it paints. A strip showing **loop fidelity**, the real number, twitching upward as generations pass. A wall of cells — the **MAP-Elites** archive — filling in with diverse creatures, each cell's fitness shown as the *value* of its greyscale border, never as colour, because colour means life and life lives *inside* the cells. And a quietly growing **tree of life**: every creature you keep becomes a signed node descending, ultimately, from that Genesis seed.

You can grab any individual and flip it between its three faces — render, brain, DNA — and watch the same thing wearing three masks. That half-second when it clicks — *oh, the pretty cloud and the tangle of nodes and the little recipe are all the same creature* — is the whole point of the instrument.

And here's the honest bit, stated plainly: **all of this is running on your device, right now, and nowhere else.** No backend, no telemetry. You are a node — today, a node of one.

## Why local-first, why a browser ⏳

Because, as of 2026, the browser quietly became a supercomputer. [WebGPU is "Baseline"](https://web.dev/blog/webgpu-supported-major-browsers) across major browsers, which means the same maths can run on a phone, a laptop, and a headless H100. That makes a future **swarm** plausible: many machines growing *one shared garden*, so a creature discovered on a phone in one city could light up the wall for everyone, and the tree of life could become a single shared genealogy. And because devices run at different speeds and sync only now and then, that swarm would behave like an *archipelago* — an asynchronous island model in which isolated demes emerge on their own, trade their best individuals, and let isolation breed new kinds: the oldest diversity engine there is. We've written down exactly how that coordinator would work — and deliberately *not* deployed it — in the [runbook](./DEPLOY-coordinator.md). It's the roadmap, clearly labelled as such, not a claim about today.

And we're honest about the bargain: per watt, a datacentre is more efficient; a volunteer swarm would win only by harvesting hardware that's *already powered on*, at near-zero marginal cost, with **explicit, revocable consent** and a visible on/off. No stealth, no crypto-mining, no dark patterns. If you can't see it running, we've failed.

## A creature that can prove itself 🔐

There's a thread we're proud of because it's *real and grift-free today*: the tree of life is genuinely cryptographic. Each creature's id is a [`SHA-256`](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) hash of its content *including its parents' ids*, signed with your own key — so the ancestry is tamper-evident and nobody can graft a creature onto a famous lineage without the right signature. It's a [Merkle-DAG](https://en.wikipedia.org/wiki/Merkle_tree), exactly how [Git](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) proves history — **no chain, no coin, no token** — and it *persists across sessions in your browser*, so your garden grows over time.

A self-drawing creature is tantalisingly close to a self-*certifying* one: perhaps each could one day carry a zero-knowledge **proof** that it computed itself honestly — *a creature carrying a proof of itself.* We find that beautiful, and we flag it honestly as **research, not done**. (There's an even wilder thread about quantum no-cloning — why a living thing *must* pass on a recipe rather than be photocopied — which we keep as the soul's physics, clearly labelled. *There are no qubits here.*) No over-claiming.

## Watch it. Grow it. Keep it. 🙋

Three ways in:

1. **Watch it think.** Open the tab and the experiment is already running on your device. Flip a creature between its render, its brain, and its DNA until the equivalence is obvious.
2. **Fork the instrument.** It's open source and dependency-light — a real evolving CPPN + substrate, simplified ES placement, a 3-D render with a plain-canvas fallback so nobody's excluded, and a Web-Crypto tree of life.
3. **Keep the best ones.** Every creature you keep joins your signed lineage, growing from the Genesis seed. When the swarm arrives, those lineages become one shared genealogy — an open **Atlas of Self-Reference**, free for artists, teachers, mathematicians and the merely curious.

Escher only got to draw the hands once, and they had to stay on the page. We'd like to let them move — to let a little network draw its true self out of the false, live, on your screen, and let anyone, from anywhere, help it understand what it is.

---

<sub>🌿 *Autograph is built by **[Aqeel Akber](https://aqeelakber.com)**, who also builds **[meos](https://getmeos.com)** — local-first, sovereign, on-device. The same belief at a different scale: a thing that belongs to itself, grown by many hands.*</sub>
