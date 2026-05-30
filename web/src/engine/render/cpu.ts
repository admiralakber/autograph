import type { Genome } from '../cppn.ts';
import { evalInk } from '../cppn.ts';
import { accentRgb, colourise } from '../palette.ts';
import type { CreatureRenderer } from './types.ts';

/** Paint a creature's ink field into a fresh ImageData of the given size. */
export function paintImageData(g: Genome, w: number, h: number): ImageData {
  const accent = accentRgb(g);
  const img = new ImageData(w, h);
  const data = img.data;
  const invW = 2 / (w - 1);
  const invH = 2 / (h - 1);
  for (let yi = 0; yi < h; yi++) {
    const y = yi * invH - 1;
    for (let xi = 0; xi < w; xi++) {
      const v = evalInk(g, xi * invW - 1, y);
      const [r, gg, b] = colourise(v, accent);
      const o = (yi * w + xi) * 4;
      data[o] = r;
      data[o + 1] = gg;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return img;
}

/** Render a small thumbnail to an existing canvas (used by the MAP-Elites grid). */
export function paintThumbnail(g: Genome, canvas: HTMLCanvasElement, size: number): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(paintImageData(g, size, size), 0, 0);
}

/** Canvas2D fallback renderer for the focused creature. Renders at a capped
 *  internal resolution and lets CSS scale it up, keeping CPU cost bounded. */
export class CanvasCreatureRenderer implements CreatureRenderer {
  readonly backend = 'canvas' as const;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly res: number;

  constructor(canvas: HTMLCanvasElement, res = 320) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.res = res;
    canvas.width = res;
    canvas.height = res;
  }

  render(g: Genome): void {
    this.ctx.putImageData(paintImageData(g, this.res, this.res), 0, 0);
  }

  dispose(): void {
    /* nothing to release for the 2D path */
  }
}
