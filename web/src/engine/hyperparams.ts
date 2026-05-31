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
  readonly group: 'Population (MAP-Elites)' | 'Mutation (NEAT)' | 'Speciation' | 'Substrate (ES-HyperNEAT)' | 'The loop' | 'Tempo';
  readonly selfTunes?: boolean;
}

export const PARAMS: readonly ParamSpec[] = [
  { key: 'gridCols', label: 'grid columns', value: 14, group: 'Population (MAP-Elites)', note: 'behaviour-map columns — the complexity axis (matches the coordinator)' },
  { key: 'gridRows', label: 'grid rows', value: 14, group: 'Population (MAP-Elites)', note: 'behaviour-map rows — the mirror-symmetry axis' },
  { key: 'founders', label: 'random founders', value: 24, group: 'Population (MAP-Elites)', note: 'random minimal genomes seeded when a world starts' },
  { key: 'minVitality', label: 'vitality gate', value: 0.05, group: 'Population (MAP-Elites)', note: 'reject near-flat creatures (the trivial empty fixed point)' },
  { key: 'noveltyBias', label: 'novelty bias', value: 0.4, group: 'Population (MAP-Elites)', note: 'when Novelty Search is on, fraction of selections drawn from the frontier — novelty INFORMS exploration without dominating fitness/species' },

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
  { key: 'substrateSteps', label: 'substrate rollout steps', value: 6, group: 'Substrate (ES-HyperNEAT)', note: 'T — the v6 temporal forward pass: synchronous steps the substrate is rolled out per query so recurrent / self / lateral edges do real work (v5 used a fixed 2-pass settle). Forward edges still settle within a step, so a feed-forward-only creature is unchanged; higher = richer recurrent dynamics, slower. See docs/notes/v6-temporal-brain.md' },
  { key: 'plasticityScale', label: 'plasticity scale', value: 1.5, group: 'Substrate (ES-HyperNEAT)', note: 'v6 Phase 2 — max magnitude of the per-connection Hebbian coefficient α (painted by the CPPN’s 3rd output, bounded by tanh×scale). The effective weight during the lifetime rollout is w + α·trace; α starts ~0 (gentle on-ramp) and evolves up.' },
  { key: 'hebbianRate', label: 'Hebbian rate η', value: 0.3, group: 'Substrate (ES-HyperNEAT)', note: 'v6 Phase 2 — learning rate of the bounded Hebbian trace: trace ← (1−η)·trace + η·(pre·post) each rollout step. Decaying EMA ⇒ stable over T steps; higher = faster within-lifetime adaptation.' },
  { key: 'neuromodScale', label: 'neuromod scale', value: 1.0, group: 'Substrate (ES-HyperNEAT)', note: 'v6 Phase 3 — max magnitude of the per-connection neuromodulation gate g (painted by the CPPN’s 5th output, bounded by tanh×scale). The brain emits its own signal m(t)=tanh(mean of emit·activity); the gated Hebbian update is trace ← (1−η)·trace + η·(1 + g·m(t))·(pre·post), so m(t) modulates the learning rate (Backpropamine form, EVOLVED). g starts 0 (gentle on-ramp) and arises by mutation; g=0 or m=0 ⇒ exactly the Phase 2 plastic update.' },

  { key: 'loopRelaxAlpha', label: 'loop relaxation α', value: 0.55, group: 'The loop', note: 'under-relaxation for the fixed-point iteration g←g+α(T(g)−g)' },
  { key: 'loopTol', label: 'loop tolerance', value: 0.012, group: 'The loop', note: 'drift below this counts the iteration as converged' },
  { key: 'readbackBandwidth', label: 'read-back bandwidth', value: 0.7, group: 'The loop', note: 'points-per-gene the brain may sample of its own image when reconstructing DNA′ — a bounded resolution (floored + capped), so closure is honestly hard at EVERY scale and a richer self is no easier to read than a compact one (lower = harder)' },
  { key: 'skillComplexityRef', label: 'skill complexity ref', value: 24, group: 'The loop', note: 'genome size at which a creature earns full credit for its reconstruction; skill = R² × min(1, genes/ref), so closing MORE of yourself is rewarded and a few easy genes is never a free win' },

  { key: 'baseBudget', label: 'offspring / frame', value: 20, unit: '/frame', group: 'Tempo', note: 'creatures evaluated per frame normally' },
  { key: 'turboBudget', label: 'TURBO offspring / frame', value: 60, unit: '/frame', group: 'Tempo', note: 'creatures evaluated per frame with TURBO on' },
  { key: 'followEvery', label: 'follow cadence', value: 48, unit: 'frames', group: 'Tempo', note: 'how often FOLLOW BEST re-selects the champion' },
];

/** Flat key→value map for engine code (e.g. HYPER.addConnRate). */
export const HYPER: Record<string, number> = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));
