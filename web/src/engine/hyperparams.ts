// THE one place every tunable lives. Engine modules import `HYPER` (flat
// key→number); the UI renders `PARAMS` into a read-only panel and the whitepaper
// documents the same list. Single source of truth — no value is written twice.
//
// Self-tuning: none adapt automatically yet. The honest candidate is the
// speciation threshold (NEAT's classic dynamic-compatibility-threshold trick,
// nudged to hold a target species count); it is fixed today and flagged below.

export interface ParamSpec {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly unit?: string;
  readonly note: string;
  readonly group: 'Population (MAP-Elites)' | 'Diversity (open-endedness)' | 'Mutation (NEAT)' | 'Speciation' | 'Substrate (ES-HyperNEAT)' | 'The loop' | 'Tempo';
  readonly selfTunes?: boolean;
}

export const PARAMS: readonly ParamSpec[] = [
  { key: 'gridCols', label: 'grid columns', value: 14, group: 'Population (MAP-Elites)', note: 'behaviour-map columns — the complexity axis (matches the coordinator)' },
  { key: 'gridRows', label: 'grid rows', value: 14, group: 'Population (MAP-Elites)', note: 'behaviour-map rows — the mirror-symmetry axis' },
  { key: 'founders', label: 'random founders', value: 24, group: 'Population (MAP-Elites)', note: 'random minimal genomes seeded when a world starts' },
  { key: 'minVitality', label: 'vitality gate', value: 0.05, group: 'Population (MAP-Elites)', note: 'reject near-flat creatures (the trivial empty fixed point)' },
  { key: 'noveltyBias', label: 'novelty bias', value: 0.4, group: 'Population (MAP-Elites)', note: 'when Novelty Search is on, fraction of selections drawn from the frontier — novelty INFORMS exploration without dominating fitness/species' },

  // Diversifiers (NOT a claim of perpetual open-endedness — that is v6's structural
  // job). When the shared map matures, these spread peers across behaviour space
  // and keep a single node exploring rather than all refining one champion.
  { key: 'noveltyStallBoost', label: 'novelty stall boost', value: 0.4, group: 'Diversity (open-endedness)', note: 'extra frontier-selection bias added (on top of novelty bias) as the search STALLS — auto-pushes toward “different” when the frontier flatlines; ramps 0→this over the stall window' },
  { key: 'stallWindow', label: 'stall window', value: 80, unit: 'gen', group: 'Diversity (open-endedness)', note: 'generations with no new champion AND no new niche before the search counts as fully stalled (ramps the novelty boost to full)' },
  { key: 'freshBloodEvery', label: 'fresh-blood interval', value: 220, unit: 'gen', group: 'Diversity (open-endedness)', note: 'inject a few fresh random genomes this often — a gentle perturbation to escape a saturated basin; 0 = off. Keep-best + the vitality gate mean it can only fill gaps, never degrade a cell' },
  { key: 'freshBloodCount', label: 'fresh-blood / injection', value: 3, group: 'Diversity (open-endedness)', note: 'how many fresh random genomes per injection (small — exploration pressure, not churn)' },

  { key: 'weightMutRate', label: 'weight-mutate rate', value: 0.7, group: 'Mutation (NEAT)', note: 'fraction of connection weights perturbed per mutation' },
  { key: 'weightMutSigma', label: 'weight σ', value: 0.4, group: 'Mutation (NEAT)', note: 'std-dev of the Gaussian weight perturbation' },
  { key: 'weightResetRate', label: 'weight-reset rate', value: 0.06, group: 'Mutation (NEAT)', note: 'chance a weight is re-drawn from scratch' },
  { key: 'biasMutRate', label: 'bias-mutate rate', value: 0.3, group: 'Mutation (NEAT)', note: 'fraction of node biases perturbed per mutation' },
  { key: 'biasMutSigma', label: 'bias σ', value: 0.3, group: 'Mutation (NEAT)', note: 'std-dev of the Gaussian bias perturbation' },
  { key: 'activationMutRate', label: 'activation-swap rate', value: 0.08, group: 'Mutation (NEAT)', note: 'chance a node changes its activation function' },
  { key: 'addConnRate', label: 'add-connection rate', value: 0.2, group: 'Mutation (NEAT)', note: 'NEAT structural: add a new connection' },
  { key: 'addNodeRate', label: 'add-node rate', value: 0.12, group: 'Mutation (NEAT)', note: 'NEAT structural: split a connection with a new node (drives genuine complexification)' },
  { key: 'toggleRate', label: 'enable-toggle rate', value: 0.02, group: 'Mutation (NEAT)', note: 'flip a connection on/off' },
  { key: 'addGateRate', label: 'add-gate rate', value: 0.07, group: 'Mutation (NEAT)', note: 'neataptic-style: let a neuron gate a connection (ON by default)' },
  { key: 'recurrentRate', label: 'recurrent chance', value: 0.5, group: 'Mutation (NEAT)', note: 'chance an added connection may be a back/lateral edge (recurrent — ON by default)' },
  { key: 'selfConnRate', label: 'self-connection chance', value: 0.3, group: 'Mutation (NEAT)', note: 'chance an added connection is a self-loop (self-connections ON by default)' },

  { key: 'speciesThreshold', label: 'compatibility threshold', value: 0.4, group: 'Speciation', note: 'NEAT compatibility distance above which creatures split species — tuned so multiple species coexist', selfTunes: false },
  { key: 'crossoverRate', label: 'crossover rate', value: 0.3, group: 'Speciation', note: 'fraction of offspring from innovation-aligned crossover (else mutation only) — balanced against novelty' },
  { key: 'respeciateEvery', label: 'respeciate interval', value: 20, unit: 'gen', group: 'Speciation', note: 'recompute species membership every N generations' },

  // Genuine ES-HyperNEAT (Risi & Stanley 2012): the CPPN paints a weight pattern
  // over the substrate; a quadtree decides WHERE hidden neurons sit, how DENSE
  // they are, and which connections express — no fixed/uniform grid. The depth
  // caps below are the one honest approximation: a browser instrument bounds the
  // quadtree resolution (the paper itself sets a max resolution rm for the same
  // reason). Thresholds match the paper's defaults (0.03).
  { key: 'esInitialDepth', label: 'initial quad depth', value: 1, group: 'Substrate (ES-HyperNEAT)', note: 'minimum quadtree resolution sampled before variance decides (2^d × 2^d grid)' },
  { key: 'esMaxDepth', label: 'max quad depth', value: 3, group: 'Substrate (ES-HyperNEAT)', note: 'upper bound on quadtree resolution — the browser-real-time resolution cap (rm in the paper); higher = more neurons (richer brain), slower' },
  { key: 'esDivisionThreshold', label: 'division threshold', value: 0.03, group: 'Substrate (ES-HyperNEAT)', note: 'subdivide a quad while its weight variance exceeds this (more neurons where there is more information)' },
  { key: 'esVarianceThreshold', label: 'variance threshold', value: 0.03, group: 'Substrate (ES-HyperNEAT)', note: 'recurse pruning while a quad’s variance exceeds this' },
  { key: 'esBandThreshold', label: 'band threshold', value: 0.05, group: 'Substrate (ES-HyperNEAT)', note: 'express a connection only if it sits in a band (min neighbour-difference exceeds this) — the band-pruning step' },
  { key: 'esIterationLevel', label: 'iteration level', value: 1, group: 'Substrate (ES-HyperNEAT)', note: 'how many times placement is re-applied from newly-discovered hidden neurons (hidden→hidden discovery)' },
  { key: 'esMaxHidden', label: 'max hidden neurons', value: 48, group: 'Substrate (ES-HyperNEAT)', note: 'defensive upper bound on discovered hidden neurons (browser memory/throughput guard)' },
  { key: 'substrateWeight', label: 'substrate weight scale', value: 3.0, group: 'Substrate (ES-HyperNEAT)', note: 'max magnitude a painted CPPN weight maps to in the substrate (max_weight)' },
  { key: 'plasticityScale', label: 'plasticity scale', value: 1.5, group: 'Substrate (ES-HyperNEAT)', note: 'max magnitude of the per-connection Hebbian coefficient α (painted by the CPPN’s α channel, bounded by tanh×scale). The effective weight during the read/write rollout is w + α·trace; α starts ~0 (gentle on-ramp) and evolves up (differentiable plasticity, Miconi et al.).' },
  { key: 'hebbianRate', label: 'Hebbian rate η', value: 0.3, group: 'Substrate (ES-HyperNEAT)', note: 'learning rate of the bounded Hebbian trace: trace ← (1−η)·trace + η·(pre·post) each rollout step. Decaying EMA ⇒ stable over the read/write rollout; higher = faster within-lifetime adaptation.' },
  { key: 'neuromodScale', label: 'neuromod scale', value: 1.0, group: 'Substrate (ES-HyperNEAT)', note: 'max magnitude of the per-connection neuromodulation gate g (painted by the CPPN’s modGate channel, bounded by tanh×scale). The brain’s own m OUTPUT NEURON gives m(t); the gated Hebbian update is trace ← (1−η)·trace + η·(1 + g·m(t))·(pre·post), so m(t) modulates the learning rate (Backpropamine form, EVOLVED). g starts 0 (gentle on-ramp) and arises by mutation; g=0 or m=0 ⇒ exactly the plain plastic update.' },
  { key: 'glimpseRes', label: 'glimpse grid res', value: 16, group: 'Substrate (ES-HyperNEAT)', note: 'v6 Phase 4 — resolution of the static-image grid (res×res, z=0 slice) the attention rollout renders once, then glimpses by interpolation. Phase 5 puts this read IN the eval loop, so the res is modest for now; the perf-hardening phase (workers/WASM/cache) makes higher res affordable. See docs/notes/v6-temporal-brain.md.' },
  { key: 'glimpseFovea', label: 'glimpse fovea radius', value: 0.12, group: 'Substrate (ES-HyperNEAT)', note: 'v6 Phase 4 — base radius (in image space [-1,1]) of the FINE fovea ring of a foveated glimpse; the brain’s chosen scale zooms it. RAM-style multi-resolution: a fine fovea + a coarse periphery.' },
  { key: 'glimpsePeriphery', label: 'glimpse periphery radius', value: 0.5, group: 'Substrate (ES-HyperNEAT)', note: 'v6 Phase 4 — base radius (in image space [-1,1]) of the COARSE periphery ring of a foveated glimpse; the brain’s chosen scale zooms it.' },
  { key: 'ponderMaxSteps', label: 'ponder hard cap', value: 8, group: 'Substrate (ES-HyperNEAT)', note: 'v6 Phase 5 — hard cap on READ/ponder glimpse steps (Adaptive Computation Time). The brain accumulates a halt signal and stops when it crosses 1.0, else at this cap — it can think variably, never forever. Halt is OFF at birth ⇒ a fresh creature ponders to the cap, and evolution learns to halt earlier (the ponder cost rewards it).' },
  { key: 'emitMaxLen', label: 'write hard cap', value: 96, group: 'Substrate (ES-HyperNEAT)', note: 'v7 — hard cap on the AUTOREGRESSIVE WRITE: the brain emits its DNA element by element from its own neurons until its end-signal fires, else at this cap (it can never write forever). We run min(this, 2·G) steps per eval (G = gene count) so one rollout yields both the dense teacher-length read (first G) and the honest self-length read. Off at birth ⇒ a fresh creature writes a constant and runs to the cap.' },
  { key: 'ponderCost', label: 'ponder cost', value: 0.06, group: 'The loop', note: 'v6 Phase 5 — gentle fitness penalty per READ/ponder step used (Graves ACT ponder cost): skill ×= (1 − ponderCost·ponderSteps/cap). Penalises dithering so the brain is pressured to halt as soon as it has seen enough, without dominating the reconstruction objective.' },

  { key: 'loopRelaxAlpha', label: 'loop relaxation α', value: 0.55, group: 'The loop', note: 'under-relaxation for the fixed-point iteration g←g+α(T(g)−g)' },
  { key: 'loopTol', label: 'loop tolerance', value: 0.012, group: 'The loop', note: 'drift below this counts the iteration as converged' },
  { key: 'lengthShapeFloor', label: 'length-shape floor', value: 0.25, group: 'The loop', note: 'v7 — the length-shaping factor floor. skill ×= floor + (1−floor)·Λ, where Λ = 1−|selfLen−G|/G rewards the creature writing the RIGHT LENGTH. Lowered to 0.25 (the cold self-write): the length is genuinely LOAD-BEARING — a wrong-length write loses most of its credit, so the creature must learn to halt at its own gene count, not game the teacher.' },
  { key: 'curriculumLo', label: 'curriculum lo (R²)', value: 0.1, group: 'The loop', note: 'v7 cold self-write — below this teacher-length R², a creature is graded mostly on the dense teacher read (first G values, free-run, no leakage). This is MINIMAL scaffolding, and it is NECESSARY: a fully-cold fitness (no teacher) is gamed by degenerate 1-gene writes that nail the single highest-variance gene (measured) — the teacher forces WHOLE-genome reconstruction, not cherry-picking.' },
  { key: 'curriculumHi', label: 'curriculum hi (R²)', value: 0.28, group: 'The loop', note: 'v7 cold self-write — above this teacher-length R² a creature is graded almost entirely on its OWN self-length write (r2self × Λ): minimal hand-holding, so the displayed champion is the genuine self-length reconstructor (length-match Λ ≈ 0.95), not an early-halting teacher-gamer. The fast hand-over is what makes the headline honest.' },
  { key: 'skillComplexityRef', label: 'skill complexity ref', value: 24, group: 'The loop', note: 'genome size at which a creature earns full credit for its reconstruction; skill = R² × min(1, genes/ref), so closing MORE of yourself is rewarded and a few easy genes is never a free win' },

  { key: 'baseBudget', label: 'offspring / frame', value: 20, unit: '/frame', group: 'Tempo', note: 'creatures evaluated per frame normally' },
  { key: 'turboBudget', label: 'TURBO offspring / frame', value: 60, unit: '/frame', group: 'Tempo', note: 'creatures evaluated per frame with TURBO on' },
  { key: 'followEvery', label: 'follow cadence', value: 48, unit: 'frames', group: 'Tempo', note: 'how often FOLLOW BEST re-selects the champion' },
];

/** Flat key→value map for engine code (e.g. HYPER.addConnRate). */
export const HYPER: Record<string, number> = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));
