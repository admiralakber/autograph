import {
  LAYERS,
  TRANSITIONS,
  WEIGHT_COUNT,
  MAX_WIDTH,
  WEIGHT_OFFSETS,
  NODE_OFFSETS,
} from '../arch.ts';
import { INK, PAPER } from '../palette.ts';

// Generate the CPPN fragment shader from the shared architecture constants, so
// the GPU path is provably the same network as the CPU path — only the device
// changes (the project's whole "one portable core" thesis, in miniature).

const f = (n: number): string => {
  const s = n.toString();
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

function forwardPass(): string {
  let body = `  var cur: array<f32, ${MAX_WIDTH}u>;\n`;
  body += `  cur[0] = x; cur[1] = y; cur[2] = sqrt(x * x + y * y); cur[3] = 1.0;\n`;
  for (let t = 0; t < TRANSITIONS; t++) {
    const inSize = LAYERS[t]!;
    const outSize = LAYERS[t + 1]!;
    const wOff = WEIGHT_OFFSETS[t]!;
    const biasNodeBase = WEIGHT_COUNT + NODE_OFFSETS[t]!;
    const actBase = NODE_OFFSETS[t]!;
    body += `  var nxt${t}: array<f32, ${MAX_WIDTH}u>;\n`;
    body += `  for (var j: u32 = 0u; j < ${outSize}u; j = j + 1u) {\n`;
    body += `    var s: f32 = params[${biasNodeBase}u + j];\n`;
    body += `    for (var i: u32 = 0u; i < ${inSize}u; i = i + 1u) {\n`;
    body += `      s = s + cur[i] * params[${wOff}u + i * ${outSize}u + j];\n`;
    body += `    }\n`;
    body += `    nxt${t}[j] = activate(acts[${actBase}u + j], s);\n`;
    body += `  }\n`;
    body += `  for (var k: u32 = 0u; k < ${outSize}u; k = k + 1u) { cur[k] = nxt${t}[k]; }\n`;
  }
  return body;
}

export function buildShaderCode(): string {
  const ink = `vec3f(${f(INK[0] / 255)}, ${f(INK[1] / 255)}, ${f(INK[2] / 255)})`;
  const paper = `vec3f(${f(PAPER[0] / 255)}, ${f(PAPER[1] / 255)}, ${f(PAPER[2] / 255)})`;
  return /* wgsl */ `
struct Uniforms { res: vec2f, time: f32, pad0: f32, accent: vec4f };
@group(0) @binding(0) var<storage, read> params: array<f32>;
@group(0) @binding(1) var<storage, read> acts: array<u32>;
@group(0) @binding(2) var<uniform> U: Uniforms;

fn activate(id: u32, x: f32) -> f32 {
  switch id {
    case 0u { return sin(x); }
    case 1u { return exp(-x * x); }
    case 2u { return tanh(x); }
    case 3u { return 1.0 / (1.0 + exp(-x)); }
    case 4u { let a = abs(x); return select(a, 1.0, a > 1.0); }
    default { return clamp(x, -1.0, 1.0); }
  }
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / U.res;
  let x = uv.x * 2.0 - 1.0;
  let y = uv.y * 2.0 - 1.0;
${forwardPass()}
  let ink = clamp(cur[0] * 0.5 + 0.5, 0.0, 1.0);

  let t = smoothstep(0.0, 1.0, ink);
  let base = mix(${ink}, ${paper}, t);
  let glow = pow(1.0 - abs(2.0 * ink - 1.0), 1.5) * 0.55;
  // Barely-perceptible breathing so the creature feels alive, not frozen.
  let breath = 1.0 + 0.05 * sin(U.time * 0.7 + ink * 6.2831);
  let col = mix(base, U.accent.rgb, clamp(glow * breath, 0.0, 1.0));
  return vec4f(col, 1.0);
}
`;
}
