import type { Genome } from '../cppn.ts';

/** A renderer bound to one canvas, able to paint any creature into it. */
export interface CreatureRenderer {
  readonly backend: 'webgpu' | 'canvas';
  render(g: Genome): void;
  dispose(): void;
}
