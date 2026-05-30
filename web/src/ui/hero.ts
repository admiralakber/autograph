import { seededGenome } from '../engine/cppn.ts';
import { paintImageData } from '../engine/render/cpu.ts';

// A quiet hero animation: a curated handful of self-portraits, cross-fading on
// two stacked canvases. Pure CPU so it never competes with the live demo's GPU
// device, and it degrades to a single still frame if anything goes wrong.
const SEEDS = ['drawing hands', 'eternal golden braid', 'ouroboros', 'fixed point', 'autograph'];
const RES = 300;

export function startHero(a: HTMLCanvasElement, b: HTMLCanvasElement): void {
  const canvases = [a, b];
  for (const c of canvases) {
    c.width = RES;
    c.height = RES;
  }
  let i = 0;
  let front = 0;

  const paint = (canvas: HTMLCanvasElement, seed: string): void => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(paintImageData(seededGenome(seed), RES, RES), 0, 0);
  };

  paint(canvases[0]!, SEEDS[0]!);
  canvases[0]!.style.opacity = '1';
  canvases[1]!.style.opacity = '0';

  const tick = (): void => {
    i = (i + 1) % SEEDS.length;
    const next = front ^ 1;
    paint(canvases[next]!, SEEDS[i]!);
    canvases[next]!.style.opacity = '1';
    canvases[front]!.style.opacity = '0';
    front = next;
  };

  window.setInterval(tick, 4200);
}
