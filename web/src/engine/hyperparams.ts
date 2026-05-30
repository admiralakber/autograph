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
  readonly group: 'Population (MAP-Elites)' | 'Mutation (NEAT)' | 'Speciation' | 'The loop' | 'Tempo';
  readonly selfTunes?: boolean;
}

export const PARAMS: readonly ParamSpec[] = [
  { key: 'gridCols', label: 'grid columns', value: 12, group: 'Population (MAP-Elites)', note: 'behaviour-map columns — the complexity axis' },
  { key: 'gridRows', label: 'grid rows', value: 12, group: 'Population (MAP-Elites)', note: 'behaviour-map rows — the mirror-symmetry axis' },
  { key: 'founders', label: 'random founders', value: 24, group: 'Population (MAP-Elites)', note: 'random minimal genomes seeded when a world starts' },
  { key: 'minVitality', label: 'vitality gate', value: 0.05, group: 'Population (MAP-Elites)', note: 'reject near-flat creatures (the trivial empty fixed point)' },

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
  { key: 'recurrentRate', label: 'recurrent chance', value: 0.3, group: 'Mutation (NEAT)', note: 'chance an added connection may be a back/lateral edge (option)' },
  { key: 'selfConnRate', label: 'self-connection chance', value: 0.2, group: 'Mutation (NEAT)', note: 'chance an added connection is a self-loop (option)' },

  { key: 'speciesThreshold', label: 'compatibility threshold', value: 0.7, group: 'Speciation', note: 'NEAT compatibility distance above which creatures split species', selfTunes: false },
  { key: 'crossoverRate', label: 'crossover rate', value: 0.15, group: 'Speciation', note: 'fraction of offspring from crossover (else mutation only)' },
  { key: 'respeciateEvery', label: 'respeciate interval', value: 20, unit: 'gen', group: 'Speciation', note: 'recompute species membership every N generations' },

  { key: 'loopRelaxAlpha', label: 'loop relaxation α', value: 0.55, group: 'The loop', note: 'under-relaxation for the fixed-point iteration g←g+α(T(g)−g)' },
  { key: 'loopTol', label: 'loop tolerance', value: 0.012, group: 'The loop', note: 'drift below this counts the iteration as converged' },

  { key: 'baseBudget', label: 'offspring / frame', value: 20, unit: '/frame', group: 'Tempo', note: 'creatures evaluated per frame normally' },
  { key: 'turboBudget', label: 'TURBO offspring / frame', value: 60, unit: '/frame', group: 'Tempo', note: 'creatures evaluated per frame with TURBO on' },
  { key: 'followEvery', label: 'follow cadence', value: 48, unit: 'frames', group: 'Tempo', note: 'how often FOLLOW BEST re-selects the champion' },
];

/** Flat key→value map for engine code (e.g. HYPER.addConnRate). */
export const HYPER: Record<string, number> = Object.fromEntries(PARAMS.map((p) => [p.key, p.value]));
