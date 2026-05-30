# A hand that draws itself 🤲

### We're crowd-growing a neural network that learns to draw its own beginning. Here's the maths, the art, the music — and how to lend it a hand.

---

In 1948, Maurits Escher drew two hands, each holding a pencil, each sketching the other into existence. Neither hand is first. Neither is more real. The picture is called [*Drawing Hands*](https://en.wikipedia.org/wiki/Drawing_Hands), and it has haunted everyone who's ever looked at it, because it shows — in one calm, impossible image — a thing **bringing itself into being**.

We've spent a weekend trying to make that picture *real*. Not a clever illusion of it, but an actual evolving creature — a tiny neural network — bred until the image it paints turns out to be an encoding of the very network that painted it. A loop that closes. We call it **Autograph**, and you can help grow it from a browser tab.

This is the story of why we think that's one of the most beautiful things you can compute.

## The braid 🪢

The patron saint of this project is Douglas Hofstadter's [*Gödel, Escher, Bach*](https://en.wikipedia.org/wiki/G%C3%B6del,_Escher,_Bach) — the book that taught a generation that **self-reference** is not a parlour trick but possibly the secret of mind itself. Hofstadter braids one idea through three disciplines, and so do we:

**🔢 The maths — Gödel.** In 1931, Kurt Gödel built a mathematical sentence that says *"this statement cannot be proved"* — a formula that talks about itself, and in doing so blows a hole clean through the dream of a complete, self-contained mathematics ([incompleteness](https://en.wikipedia.org/wiki/G%C3%B6del%27s_incompleteness_theorems)). The engine of the trick is a **fixed point**: a place where a transformation hands you back exactly what you put in. Computer scientists know the same magic as [Kleene's recursion theorem](https://en.wikipedia.org/wiki/Kleene%27s_recursion_theorem), and hackers know its mischievous child — the **[quine](https://en.wikipedia.org/wiki/Quine_(computing))**, a program whose only output is its own source code. Self-reference, fixed points, quines: one idea, three names.

**🎨 The art — Escher.** *Drawing Hands* is that fixed point rendered in graphite. The output (a hand) produces the producer (the other hand). There is no outside, no ground floor, no "and then a real artist drew both" — the system is closed and yet it exists.

**🎵 The music — Bach.** In the *Musical Offering*, Bach wrote a [canon that modulates up a whole tone and arrives, impossibly, back where it started](https://en.wikipedia.org/wiki/Musical_Offering) — so that it seems to climb forever without ever leaving the room. Hofstadter calls it the Ever-Rising Canon. It's the sound of a loop that's also a ladder.

Autograph is all three at once: a quine (maths) you can watch draw itself (art), discovered by a search that never stops climbing (music).

## From breeding pictures to breeding selves 🧬

Here's the lovely part — the ingredients already exist, and they have a romance of their own.

Twenty years ago, Ken Stanley and colleagues invented [**NEAT**](https://nn.cs.utexas.edu/downloads/papers/stanley.jair04.pdf), a way of *evolving* neural networks that start tiny and grow in complexity, like organisms. Then they built [**Picbreeder**](https://wiki.santafe.edu/images/1/1e/Secretan_ecj11.pdf): a website where internet strangers collaboratively bred images by selecting their favourites, generation after generation. The images were painted by [**CPPNs**](https://nbenko1.github.io/) — networks that take a coordinate and return a colour, so the whole network *is* a picture. Picbreeder proved, fifteen years ago, that **a crowd can grow beautiful, surprising things together in a browser**, with no objective in mind but "ooh, that one."

That last point is deeper than it sounds. [Novelty search](https://www.cs.swarthmore.edu/~meeden/DevelopmentalRobotics/lehman_ecj11.pdf) showed the heretical result that you often discover *more* by abandoning the goal and simply chasing the interesting. And only last year, a paper with a wonderful title — [*Questioning Representational Optimism in Deep Learning*](https://arxiv.org/abs/2505.11581) (Kumar, Clune, Lehman & Stanley, 2025) — found that CPPNs grown by this open-ended, serendipitous process develop **cleaner, more elegant internal structure** than networks hammered into shape by ordinary gradient descent. Evolution, it turns out, can be the more graceful sculptor. The brute-force, hoard-the-GPUs approach might not even be the prettiest road.

So here is our move. Take Picbreeder's crowd-grown CPPNs. Take Chang and Lipson's astonishing 2018 result, the [**neural network quine**](https://arxiv.org/abs/1803.05859) — a network trained to output its own weights, the first artificial thing that could *say* itself. And fuse them: evolve a CPPN whose *picture* is a faithful encoding of its *own genome*. Not "a network that prints its weights as numbers," but a network that **draws** them — a self-portrait in the literal, recursive sense. Escher's hands, but made of evolved silicon thought.

## What you'd actually see 👁️

A dark canvas. On the left, a little tangle of glowing nodes — the network. On the right, the picture it currently paints: at first, noise. A counter ticks: *generation 3,417 · 8,902 machines lending hands.*

Then the picture sharpens, and you realise with a small shock that it's resolving into a pair of hands — and each hand is sketching the other, and the strokes they draw are the network's own wiring. The loop tightens. And at some blessed generation, the final pen-stroke of the drawn hand completes the first node of the network you've been watching the whole time. The thing has drawn its own beginning.

That's the artwork. It is also, quietly, a real experiment in **open-ended evolution** — the research direction a 2024 DeepMind position paper argues is [essential for the next era of AI](https://arxiv.org/abs/2406.04268). We're just running it as a public, joyful, crowd-powered gallery instead of behind a fence.

## Why a crowd, why a browser ⏳

Because, as of 2026, the browser quietly became a supercomputer. [WebGPU is "Baseline"](https://web.dev/blog/webgpu-supported-major-browsers) across major browsers, which means we can write our maths *once* and run that identical code on a phone, a laptop, and a headless H100. Spare compute is everywhere — charging on desks, idling in pockets — and Autograph is exactly the kind of *embarrassingly parallel* search that loves a big, scrappy, intermittent crowd.

And we're honest about the bargain: per watt, a datacentre is more efficient; a volunteer swarm wins by harvesting hardware that's *already powered on*, at near-zero marginal cost, with **explicit, revocable consent** and a visible on/off. No stealth, no crypto-mining, no dark patterns. If you can't see it running, we've failed.

## A creature that can prove itself 🔐

There's a final thread we're still pulling, and we'll be upfront that it's **under research, not done**. A self-drawing creature is tantalisingly close to a self-*certifying* one: if a genome encodes itself, perhaps it can also carry a cryptographic **proof** of itself — a [Merkle-DAG](https://en.wikipedia.org/wiki/Merkle_tree) of its lineage, a zero-knowledge attestation that it computed itself honestly. *A creature carrying a proof of itself.* That same primitive happens to solve a grubby practical problem — how do you trust results from a swarm of strangers' machines? — but mostly we just find it beautiful: Gödel's self-reference, grown up into self-evidence. (There's an even wilder thread about quantum no-cloning and the limits of self-replication. We've parked it, clearly labelled, until the maths is solid. No over-claiming here.)

## Lend a hand 🙋

Three ways in:
1. **Lend compute.** Open the tab, flip the switch, watch the gallery fill. Your phone on the charger can grow strange loops while you sleep.
2. **Fork the engine.** It's open source — one WGSL core, graceful fallback all the way down to plain JavaScript so nobody's excluded.
3. **Keep the best ones.** Every creature the swarm discovers goes into an open **Atlas of Self-Reference** — a public gallery of all the ways a thing can draw its own beginning, free for artists, teachers, mathematicians and the merely curious.

Escher only got to draw the hands once, and they had to stay on the page. We'd like to let them move — and to let anyone, from anywhere, lend the hand that helps them learn to draw.

---

<sub>🌿 *Autograph is built by **[Aqeel Akber](https://aqeelakber.com)**, who also builds **[meos](https://getmeos.com)** — local-first, sovereign, on-device. The same belief at a different scale: a thing that belongs to itself.*</sub>
