# Design notes & further reading 📓

Deeper dives behind [Autograph](../../README.md), for the curious — the engineering, the mathematics, and the honest analysis of what is real versus what is roadmap. They are companions to the [whitepaper](../WHITEPAPER.md): where the paper is the formal account, these are the working design notes.

| Note | What's inside |
|---|---|
| [**Architecture & the swarm**](./architecture.md) | The realised architecture, the swap-able `Archive` seam that makes the swarm possible, the archipelago island model — and a clear table of **what's implemented today vs roadmap**. |
| [**Runtime & GPU**](./runtime-and-gpu.md) | The "one runtime, phone to H100" plan: the layered WebGPU → WebGL2 → WASM → JS stack, NEAT/CPPN on the GPU, MAP-Elites with atomics, headless evaluation, BOINC-style trust, and the honest energy maths. |
| [**Cryptography**](./cryptography.md) | The verifiable tree of life: the mathematics of self-reference, the signed content-addressed Merkle-DAG lineage that ships today, and the zkML "proof of becoming" north star — all grift-free, no coins. |
| [**Quantum**](./quantum.md) | An honest, sceptical assessment of the quantum connection: genuinely deep as *lineage and metaphor* (no-cloning ↔ re-grow), and explicitly **not** a mechanism. There are no qubits here. |
| [**Prior art & novelty**](./prior-art.md) | The shoulders Autograph stands on — NEAT, CPPNs, HyperNEAT, Picbreeder, the neural quine, MAP-Elites, open-endedness — and a candid account of what the synthesis genuinely adds. |

Everything here follows the same discipline as the rest of the project: real is labelled real, roadmap is labelled roadmap, and the credit is paid to the lineage in full.
