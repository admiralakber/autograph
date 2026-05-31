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
  { key: 'addConnRate', label: 'add-connection rate', value: 0.14, group: 'Mutation (NEAT)', note: 'NEAT structural: add a new connection' },
  { key: 'addNodeRate', label: 'add-node rate', value: 0.08, group: 'Mutation (NEAT)', note: 'NEAT structural: split a connection with a new node' },
  { key: 'toggleRate', label: 'enable-toggle rate', value: 0.02, group: 'Mutation (NEAT)', note: 'flip a connection on/off' },
  { key: 'addGateRate', label: 'add-gate rate', value: 0.05, group: 'Mutation (NEAT)', note: 'neataptic-style: let a neuron gate a connection (option)' },
  { key: 'recurrentRate', label: 'recurrent chance', value: 0.3, group: 'Mutation (NEAT)', note: 'chance an added connection may be a back/lateral edge (recurrent — ON by default)' },
  { key: 'selfConnRate', label: 'self-connection chance', value: 0.2, group: 'Mutation (NEAT)', note: 'chance an added connection is a self-loop (option)' },

  { key: 'speciesThreshold', label: 'compatibility threshold', value: 0.7, group: 'Speciation', note: 'NEAT compatibility distance above which creatures split species', selfTunes: false },
  { key: 'crossoverRate', label: 'crossover rate', value: 0.3, group: 'Speciation', note: 'fraction of offspring from innovation-aligned crossover (else mutation only) — balanced against novelty' },
  { key: 'respeciateEvery', label: 'respeciate interval', value: 20, unit: 'gen', group: 'Speciation', note: 'recompute species membership every N generations' },

  // Genuine ES-HyperNEAT (Risi & Stanley 2012): the CPPN paints a weight pattern
  // over the substrate; a quadtree decides WHERE hidden neurons sit, how DENSE
  // they are, and which connections express — no fixed/uniform grid. The depth
  // caps below are the one honest approximation: a browser instrument bounds the
  // quadtree resolution (the paper itself sets a max resolution rm for the same
  // reason). Thresholds match the paper's defaults (0.03).
  { key: 'esInitialDepth', label: 'initial quad depth', value: 1, group: 'Substrate (ES-HyperNEAT)', note: 'minimum quadtree resolution sampled before variance decides (2^d × 2^d grid)' },
  { key: 'esMaxDepth', label: 'max quad depth', value: 2, group: 'Substrate (ES-HyperNEAT)', note: 'upper bound on quadtree resolution — the browser-real-time resolution cap (rm in the paper); higher = more neurons, slower' },
  { key: 'esDivisionThreshold', label: 'division threshold', value: 0.03, group: 'Substrate (ES-HyperNEAT)', note: 'subdivide a quad while its weight variance exceeds this (more neurons where there is more information)' },
  { key: 'esVarianceThreshold', label: 'variance threshold', value: 0.03, group: 'Substrate (ES-HyperNEAT)', note: 'recurse pruning while a quad’s variance exceeds this' },
  { key: 'esBandThreshold', label: 'band threshold', value: 0.05, group: 'Substrate (ES-HyperNEAT)', note: 'express a connection only if it sits in a band (min neighbour-difference exceeds this) — the band-pruning step' },
  { key: 'esIterationLevel', label: 'iteration level', value: 1, group: 'Substrate (ES-HyperNEAT)', note: 'how many times placement is re-applied from newly-discovered hidden neurons (hidden→hidden discovery)' },
  { key: 'esMaxHidden', label: 'max hidden neurons', value: 32, group: 'Substrate (ES-HyperNEAT)', note: 'defensive upper bound on discovered hidden neurons (browser memory/throughput guard)' },
  { key: 'substrateWeight', label: 'substrate weight scale', value: 3.0, group: 'Substrate (ES-HyperNEAT)', note: 'max magnitude a painted CPPN weight maps to in the substrate (max_weight)' },

  { key: 'loopRelaxAlpha', label: 'loop relaxation α', value: 0.55, group: 'The loop', note: 'under-relaxation for the fixed-point iteration g←g+α(T(g)−g)' },
  { key: 'loopTol', label: 'loop tolerance', value: 0.012, group: 'The loop', note: 'drift below this counts the iteration as converged' },

  { key: 'baseBudget', label: 'offspring / frame', value: 20, unit: '/frame', group: 'Tempo', note: 'creatures evaluated per frame normally' },
  { key: 'turboBudget', label: 'TURBO offspring / frame', value: 60, unit: '/frame', group: 'Tempo', note: 'creatures evaluated per frame with TURBO on' },
  { key: 'followEvery', label: 'follow cadence', value: 48, unit: 'frames', group: 'Tempo', note: 'how often FOLLOW BEST re-selects the champion' },
];

/** Flat key→value map for engine code (e.g. HYPER.addConnRate). */
export const HYPER: Record<string, number> = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));
