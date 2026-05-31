// Server-side verification of an incoming elite.
//
// This is the anti-forgery heart of the coordinator. It re-implements, byte for
// byte, the genome serialisation (web/src/engine/cppn.ts → genomeBytes) and the
// signed, content-addressed lineage scheme (web/src/engine/lineage.ts). It is
// deliberately self-contained: a Worker must not pull in the browser engine, and
// the contract is pinned by test/fixtures/genuine-elite.json (a real, engine-
// signed elite) so any divergence trips a test rather than passing silently.
//
// WHAT THIS PROVES (v1):
//   • authorship  — (FORMAT-AGNOSTIC, load-bearing) the ECDSA P-256 signature
//                    over the id verifies for the claimed author key, and the id
//                    is the SHA-256 of the canonical content. The canonical form
//                    uses the genomeHash as an OPAQUE hex string, so this core
//                    needs no knowledge of the genome encoding — it can never
//                    reject a genuine elite because the engine's genome format
//                    evolved. You cannot impersonate another key, nor graft a
//                    genome onto a lineage you do not hold the key for.
//   • integrity   — (GENOME-FORMAT-COUPLED, defence-in-depth) the genome bytes
//                    re-hash to the signed genomeHash, catching a tampered or
//                    swapped genome early. This mirrors cppn.ts:genomeBytes and
//                    is therefore the ONE place coupled to the engine's genome
//                    encoding. It is pinned by the genuine fixture + smoke/contract
//                    test so drift is caught loudly, not silently. (If keeping the
//                    mirror in lock-step is ever undesirable, this sub-check can be
//                    delegated to the consuming client, which owns the engine and
//                    is always in sync — the authorship core above still stands.)
//
// WHAT THIS DOES NOT PROVE (honest limits — see README "Trust model"):
//   • that the *claimed* fidelity is the genome's *true* fidelity. A key holder
//     can sign an honest-looking-but-inflated number; the coordinator does not
//     re-run the substrate/fitness loop (kept out of the Worker by design). That
//     correctness layer is roadmap: BOINC-style replication and/or zkML.
//   The bound, signed `fidelity` is what ranking uses, so a forged *unsigned*
//   field cannot win a cell — but a dishonest key still can. Mitigations in v1:
//   signed+attributable provenance (blockable keys), rate-limiting, keep-best.

import type { Evaluation, Genome, LineageEntry, WireElite } from './protocol.ts';

// Mirrors web/src/engine/arch.ts. v6 grew CPPN_OUTPUTS 2→9 (the temporal channels);
// v7 grew it 9→11, adding the autoregressive writer channels (emitVal, emitEnd) — so the
// full set is weight, bias | α, emit, modGate, fixX, fixY, fixScale, halt | emitVal, emitEnd.
// genomeBytes writes this into the header, so the coordinator MUST match the engine or v7
// genomes fail the integrity re-hash. The byte LAYOUT is unchanged from v3 — only this grew.
const CPPN_INPUTS = 7;
const CPPN_OUTPUTS = 11;
// Mirrors web/src/engine/lineage.ts
const LINEAGE_VERSION = 1;

const enc = new TextEncoder();

// Defensive caps so a malicious frame cannot force a huge allocation.
const MAX_NODES = 4096;
const MAX_CONNS = 16384;
const MAX_PARENTS = 64;

const HEX_64 = /^[0-9a-f]{64}$/; // SHA-256 hex (id, genomeHash)
const HEX_128 = /^[0-9a-f]{128}$/; // ECDSA P-256 signature (r||s), raw
const HEX_130 = /^[0-9a-f]{130}$/; // raw uncompressed P-256 public key point

export interface VerifyOutcome {
  readonly ok: boolean;
  /** A short, stable reason code when !ok (e.g. 'bad-signature'). */
  readonly reason?: string;
}

const fail = (reason: string): VerifyOutcome => ({ ok: false, reason });
const OK: VerifyOutcome = { ok: true };

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

// Genome serialisation format version — MIRRORS web/src/engine/cppn.ts:genomeBytes.
// v2 added a per-connection `gater` int32 (conn stride 16 → 20). v3 REMOVED the
// per-creature read-back network (it was a bolt-on regressor; the loop's decode
// half is now the intrinsic CPPN self-quine), so the header is back to 8 bytes
// and no reader weights are appended. v4 = v6 temporal brain: the byte layout is
// UNCHANGED, but CPPN_OUTPUTS grew 2→9 (the temporal channels). v5 = v7 self-writer:
// byte layout still UNCHANGED, CPPN_OUTPUTS grew 9→11 (the writer channels emitVal/emitEnd),
// so the header's OUTPUTS field differs and v6/v7 genomes are mutually non-verifying — the
// epoch rotates (genesis-v7). If the engine's genome encoding changes again,
// `npm run make-fixture && npm run smoke` trips — that is the drift gate.
const GENOME_FORMAT_VERSION = 5;

/** Stable little-endian serialisation — EXACT mirror of cppn.ts:genomeBytes (v3). */
export function genomeBytes(g: Genome): Uint8Array {
  void GENOME_FORMAT_VERSION;
  const nodes = g.nodes.slice().sort((a, b) => a.id - b.id);
  const conns = g.conns.slice().sort((a, b) => a.innov - b.innov);
  const header = 8;
  const buf = new ArrayBuffer(header + nodes.length * 12 + conns.length * 20);
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  dv.setUint16(0, CPPN_INPUTS, true);
  dv.setUint16(2, CPPN_OUTPUTS, true);
  dv.setUint16(4, nodes.length, true);
  dv.setUint16(6, conns.length, true);
  let o = header;
  for (const n of nodes) {
    dv.setInt32(o, n.id, true);
    dv.setUint8(o + 4, n.kind);
    dv.setUint8(o + 5, n.act);
    dv.setFloat32(o + 8, n.bias, true);
    o += 12;
  }
  for (const c of conns) {
    dv.setInt32(o, c.innov, true);
    dv.setInt32(o + 4, c.from, true);
    dv.setInt32(o + 8, c.to, true);
    dv.setFloat32(o + 12, c.enabled ? c.weight : 0, true);
    dv.setInt32(o + 16, c.gater ?? -1, true); // gater node id (-1 = ungated)
    o += 20;
  }
  return bytes;
}

export async function hashGenome(g: Genome): Promise<string> {
  return sha256Hex(genomeBytes(g));
}

/** EXACT mirror of lineage.ts:canonical — the string whose SHA-256 is the id. */
function canonical(e: LineageEntry): string {
  return [
    LINEAGE_VERSION,
    e.parents.join(','),
    e.genomeHash,
    e.seed ?? '',
    e.fidelity.toFixed(6),
    e.author,
    e.createdAt,
  ].join('|');
}

const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isInt = (x: unknown): x is number => isFiniteNum(x) && Number.isInteger(x);

/** Reject malformed/junk shapes early, before any crypto work. */
function validateShape(elite: WireElite): VerifyOutcome {
  if (!elite || typeof elite !== 'object') return fail('malformed');
  const { genome, evaluation, lineage } = elite;

  if (!genome || !Array.isArray(genome.nodes) || !Array.isArray(genome.conns)) return fail('malformed-genome');
  if (genome.nodes.length === 0 || genome.nodes.length > MAX_NODES) return fail('genome-size');
  if (genome.conns.length > MAX_CONNS) return fail('genome-size');
  for (const n of genome.nodes) {
    if (!isInt(n?.id) || (n.kind !== 0 && n.kind !== 1 && n.kind !== 2)) return fail('bad-node');
    if (!isInt(n.act) || !isFiniteNum(n.bias)) return fail('bad-node');
  }
  for (const c of genome.conns) {
    if (!isInt(c?.innov) || !isInt(c.from) || !isInt(c.to)) return fail('bad-conn');
    if (!isFiniteNum(c.weight) || typeof c.enabled !== 'boolean') return fail('bad-conn');
    if (c.gater !== undefined && !isInt(c.gater)) return fail('bad-conn');
  }

  if (!evaluation || !Array.isArray(evaluation.bd) || evaluation.bd.length !== 2) return fail('malformed-eval');
  if (!isFiniteNum(evaluation.bd[0]) || !isFiniteNum(evaluation.bd[1])) return fail('bad-bd');
  if (!isFiniteNum(evaluation.fidelity) || evaluation.fidelity < 0 || evaluation.fidelity > 1) return fail('bad-fidelity');
  if (!isFiniteNum(evaluation.vitality) || !isFiniteNum(evaluation.liveConns)) return fail('malformed-eval');

  if (!lineage || typeof lineage !== 'object') return fail('malformed-lineage');
  if (!HEX_64.test(lineage.id)) return fail('bad-id-format');
  if (!HEX_64.test(lineage.genomeHash)) return fail('bad-genomehash-format');
  if (!HEX_130.test(lineage.author)) return fail('bad-author-format');
  if (!HEX_128.test(lineage.signature)) return fail('bad-signature-format');
  if (!Array.isArray(lineage.parents) || lineage.parents.length > MAX_PARENTS) return fail('bad-parents');
  for (const p of lineage.parents) if (!HEX_64.test(p)) return fail('bad-parent-format');
  if (!(lineage.seed === null || typeof lineage.seed === 'string')) return fail('bad-seed');
  if (!isFiniteNum(lineage.fidelity) || lineage.fidelity < 0 || lineage.fidelity > 1) return fail('bad-lineage-fidelity');
  if (typeof lineage.createdAt !== 'string' || lineage.createdAt.length > 64) return fail('bad-createdat');

  return OK;
}

/** The signed `fidelity` is what we rank by; require the (unsigned) evaluation
 *  fidelity to match it so a forged evaluation field cannot spoof the merge. */
function fidelityBound(evaluation: Evaluation, lineage: LineageEntry): boolean {
  return Math.abs(evaluation.fidelity - lineage.fidelity) <= 1e-6;
}

/**
 * Full verification of one wire elite. Order: cheap structural checks → genome
 * integrity (hash binding) → content-id derivation → fidelity binding → ECDSA
 * signature. The first failure short-circuits with a stable reason code.
 */
export async function verifyElite(elite: WireElite): Promise<VerifyOutcome> {
  const shape = validateShape(elite);
  if (!shape.ok) return shape;

  const { genome, evaluation, lineage } = elite;

  // 1) Genome integrity: the bytes must hash to the entry's genomeHash.
  const computedHash = await hashGenome(genome);
  if (computedHash !== lineage.genomeHash) return fail('genome-hash-mismatch');

  // 2) Content-addressed id: the id must be SHA-256 of the canonical content.
  const computedId = await sha256Hex(enc.encode(canonical(lineage)));
  if (computedId !== lineage.id) return fail('id-mismatch');

  // 3) Bind the ranking key to the signed fidelity.
  if (!fidelityBound(evaluation, lineage)) return fail('fidelity-unbound');

  // 4) Authorship: ECDSA P-256 signature over the id verifies for the author.
  let verified: boolean;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      hexToBytes(lineage.author) as BufferSource,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      hexToBytes(lineage.signature) as BufferSource,
      enc.encode(lineage.id) as BufferSource,
    );
  } catch {
    return fail('unverifiable-key');
  }
  if (!verified) return fail('bad-signature');

  return OK;
}
