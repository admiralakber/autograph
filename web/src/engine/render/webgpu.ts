import { WEIGHT_COUNT, BIAS_COUNT, GENOME_DIM } from '../arch.ts';
import type { Genome } from '../cppn.ts';
import { accentRgb } from '../palette.ts';
import type { CreatureRenderer } from './types.ts';
import { buildShaderCode } from './wgsl.ts';

// Primary render path: one WGSL core evaluating the CPPN per pixel, exactly as
// the project's runtime story describes. Falls back to Canvas2D if WebGPU is
// unavailable or device creation fails for any reason.

class WebGPUCreatureRenderer implements CreatureRenderer {
  readonly backend = 'webgpu' as const;
  private readonly paramData = new Float32Array(GENOME_DIM);
  private readonly actData = new Uint32Array(BIAS_COUNT);
  private readonly uniformData = new Float32Array(8);
  private readonly start = performance.now();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly context: GPUCanvasContext,
    private readonly device: GPUDevice,
    private readonly pipeline: GPURenderPipeline,
    private readonly params: GPUBuffer,
    private readonly acts: GPUBuffer,
    private readonly uniforms: GPUBuffer,
    private readonly bindGroup: GPUBindGroup,
  ) {}

  render(g: Genome): void {
    this.paramData.set(g.weights, 0);
    this.paramData.set(g.biases, WEIGHT_COUNT);
    for (let i = 0; i < BIAS_COUNT; i++) this.actData[i] = g.acts[i]!;
    const accent = accentRgb(g);
    this.uniformData[0] = this.canvas.width;
    this.uniformData[1] = this.canvas.height;
    this.uniformData[2] = (performance.now() - this.start) / 1000;
    this.uniformData[3] = 0;
    this.uniformData[4] = accent[0] / 255;
    this.uniformData[5] = accent[1] / 255;
    this.uniformData[6] = accent[2] / 255;
    this.uniformData[7] = 0;

    const q = this.device.queue;
    q.writeBuffer(this.params, 0, this.paramData);
    q.writeBuffer(this.acts, 0, this.actData);
    q.writeBuffer(this.uniforms, 0, this.uniformData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    q.submit([encoder.finish()]);
  }

  dispose(): void {
    this.params.destroy();
    this.acts.destroy();
    this.uniforms.destroy();
  }
}

export async function createWebGPURenderer(
  canvas: HTMLCanvasElement,
): Promise<CreatureRenderer | null> {
  if (!('gpu' in navigator) || !navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    if (!context) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const module = device.createShaderModule({ code: buildShaderCode() });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });

    const params = device.createBuffer({
      size: GENOME_DIM * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const acts = device.createBuffer({
      size: Math.max(16, BIAS_COUNT * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const uniforms = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: acts } },
        { binding: 2, resource: { buffer: uniforms } },
      ],
    });

    return new WebGPUCreatureRenderer(
      canvas,
      context,
      device,
      pipeline,
      params,
      acts,
      uniforms,
      bindGroup,
    );
  } catch {
    return null;
  }
}
