import type { Phenotype } from '../substrate.ts';
import { substrateForward, ablateHidden } from '../substrate.ts';
import { lifeRgb, lifeRgbF } from '../palette.ts';

// Sampling the phenotype's volumetric self-portrait. The substrate's density
// field becomes alpha; its hue field is mapped through the sunrise (HSLuv)
// palette. Used by the 3D point cloud and the 2D fallback / thumbnails.

export interface PointCloud {
  readonly positions: Float32Array; // n * 3
  readonly colors: Float32Array; // n * 3 (sunrise rgb, 0..1)
  readonly alphas: Float32Array; // n
  readonly count: number;
}

const o2: [number, number] = [0, 0];

/** Sample the unit ball densely; keep voxels above a soft `threshold` with a
 *  smoothstep-contrasted alpha so the additive point cloud reads as a cohesive,
 *  glowing *volume* (a form), not scattered confetti. Higher density → brighter
 *  and slightly larger points (size carried in `alphas`, the shader reads it). */
export function volumeCloud(p: Phenotype, gridN = 42, threshold = 0.34): PointCloud {
  const pos: number[] = [];
  const col: number[] = [];
  const alp: number[] = [];
  const inv = 2 / (gridN - 1);
  const span = 1 - threshold;
  for (let zi = 0; zi < gridN; zi++) {
    const z = zi * inv - 1;
    for (let yi = 0; yi < gridN; yi++) {
      const y = yi * inv - 1;
      for (let xi = 0; xi < gridN; xi++) {
        const x = xi * inv - 1;
        if (x * x + y * y + z * z > 1.02) continue; // clip to the unit ball
        const r = substrateForward(p, x, y, z, o2);
        const d = r[0];
        if (d < threshold) continue;
        const t = (d - threshold) / span;
        const soft = t * t * (3 - 2 * t); // smoothstep → contrasted form
        // tiny deterministic jitter breaks the sampling lattice → reads as a
        // continuous volume, not a regular grid of dots.
        const h = Math.sin((xi * 12.9898 + yi * 78.233 + zi * 37.719) * 43758.5453);
        const jx = (((h * 1.7) % 1) - 0.5) * inv * 0.7;
        const jy = (((h * 2.3) % 1) - 0.5) * inv * 0.7;
        const jz = (((h * 3.1) % 1) - 0.5) * inv * 0.7;
        pos.push(x + jx, y + jy, z + jz);
        const [cr, cg, cb] = lifeRgbF(r[1]);
        col.push(cr, cg, cb);
        alp.push(soft);
      }
    }
  }
  return { positions: new Float32Array(pos), colors: new Float32Array(col), alphas: new Float32Array(alp), count: alp.length };
}

/** Paint a 2-D projection of the volume (the 2D fallback and grid thumbnails):
 *  max-density along z, coloured by the sunrise palette over a near-black field. */
export function paintProjection(p: Phenotype, canvas: HTMLCanvasElement, size: number): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const zs = [-0.55, -0.28, 0, 0.28, 0.55];
  const inv = 2 / (size - 1);
  for (let yi = 0; yi < size; yi++) {
    const y = yi * inv - 1;
    for (let xi = 0; xi < size; xi++) {
      const x = xi * inv - 1;
      let best = 0;
      let hue = 0;
      for (const z of zs) {
        const r = substrateForward(p, x, y, z, o2);
        if (r[0] > best) {
          best = r[0];
          hue = r[1];
        }
      }
      const o = (yi * size + xi) * 4;
      const a = best < 0.5 ? 0 : (best - 0.5) / 0.5;
      const [cr, cg, cb] = lifeRgb(hue);
      // composite over near-black instrument ground
      data[o] = Math.round(cr * a);
      data[o + 1] = Math.round(cg * a);
      data[o + 2] = Math.round(cb * a);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Paint a flat 2-D *slice* of the field at depth `z` — the high-contrast,
 *  CPPN-style pattern view (the "2D mode"). density → brightness, hue → sunrise. */
export function paintSlice(p: Phenotype, canvas: HTMLCanvasElement, size: number, z = 0): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const inv = 2 / (size - 1);
  for (let yi = 0; yi < size; yi++) {
    const y = yi * inv - 1;
    for (let xi = 0; xi < size; xi++) {
      const x = xi * inv - 1;
      const r = substrateForward(p, x, y, z, o2);
      const a = smooth(0.38, 0.82, r[0]); // contrast curve → structure pops
      const [cr, cg, cb] = lifeRgb(r[1]);
      const o = (yi * size + xi) * 4;
      data[o] = Math.round(cr * a);
      data[o + 1] = Math.round(cg * a);
      data[o + 2] = Math.round(cb * a);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const o3: [number, number] = [0, 0];

/** A hidden neuron's receptive field: where silencing it changes the self-portrait
 *  most (ablation diff over the z-slice), drawn as a white heat — the
 *  genotype→brain→image link a neuroscientist can read. */
export function paintReceptiveField(base: Phenotype, j: number, canvas: HTMLCanvasElement, size: number, z = 0): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const abl = ablateHidden(base, j);
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const inv = 2 / (size - 1);
  for (let yi = 0; yi < size; yi++) {
    const y = yi * inv - 1;
    for (let xi = 0; xi < size; xi++) {
      const x = xi * inv - 1;
      const d0 = substrateForward(base, x, y, z, o2)[0];
      const d1 = substrateForward(abl, x, y, z, o3)[0];
      const v = Math.round(Math.min(1, Math.abs(d0 - d1) * 3.2) * 255);
      const o = (yi * size + xi) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
