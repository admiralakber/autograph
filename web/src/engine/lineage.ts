import type { Genome } from './cppn.ts';
import { genomeBytes } from './cppn.ts';
import { toHex } from './prng.ts';

// The real, weekend-buildable crypto pillar: a signed, content-addressed
// Merkle-DAG "tree of life". Each creature's id is the hash of its content
// *including its parents' ids*, so the whole ancestry is tamper-evident — this
// is exactly how Git proves provenance, with no blockchain and no token.
// Signatures (ECDSA P-256 via Web Crypto) bind each entry to an author key, so
// nobody can graft a creature onto a famous lineage without the right key.

const LINEAGE_VERSION = 1;
const enc = new TextEncoder();

export interface Identity {
  readonly publicKeyHex: string;
  readonly privateKey: CryptoKey;
}

export interface LineageEntry {
  /** Content hash (hex) — the creature's tamper-evident id. */
  readonly id: string;
  /** Parent ids (0 = founder, 1 = mutation, 2 = crossover). */
  readonly parents: string[];
  /** SHA-256 of the genome bytes. */
  readonly genomeHash: string;
  /** The seed phrase, if this creature was grown from one. */
  readonly seed: string | null;
  /** Self-encoding loop fidelity at the time it was kept, in [0,1]. */
  readonly fidelity: number;
  /** Author's public key (hex, raw EC point). */
  readonly author: string;
  /** ISO timestamp. */
  readonly createdAt: string;
  /** ECDSA signature over the id (hex). */
  readonly signature: string;
}

export interface LineageFile {
  readonly format: 'autograph-lineage';
  readonly version: number;
  readonly entries: LineageEntry[];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toHex(new Uint8Array(digest));
}

export async function hashGenome(g: Genome): Promise<string> {
  return sha256Hex(genomeBytes(g));
}

/** Short, human-friendly fingerprint of a content hash. */
export function fingerprint(hashHex: string): string {
  return hashHex.slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}

export async function generateIdentity(): Promise<Identity> {
  // extractable = false: the PRIVATE key can never be exported (defence-in-depth
  // against private-key exfiltration). We only ever sign with it; the PUBLIC key
  // stays extractable regardless (WebCrypto generates public keys extractable),
  // so the raw public-key export below still works.
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKeyHex: toHex(raw), privateKey: pair.privateKey };
}

function canonical(
  parents: string[],
  genomeHash: string,
  seed: string | null,
  fidelity: number,
  author: string,
  createdAt: string,
): string {
  return [
    LINEAGE_VERSION,
    parents.join(','),
    genomeHash,
    seed ?? '',
    fidelity.toFixed(6),
    author,
    createdAt,
  ].join('|');
}

export async function createEntry(args: {
  genome: Genome;
  parents: string[];
  seed: string | null;
  fidelity: number;
  identity: Identity;
}): Promise<LineageEntry> {
  const { genome, parents, seed, fidelity, identity } = args;
  const genomeHash = await hashGenome(genome);
  const createdAt = new Date().toISOString();
  const content = canonical(parents, genomeHash, seed, fidelity, identity.publicKeyHex, createdAt);
  const id = await sha256Hex(enc.encode(content));
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    enc.encode(id) as BufferSource,
  );
  return {
    id,
    parents,
    genomeHash,
    seed,
    fidelity,
    author: identity.publicKeyHex,
    createdAt,
    signature: toHex(new Uint8Array(sigBuf)),
  };
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export interface VerifyResult {
  readonly valid: boolean;
  readonly checked: number;
  readonly errors: string[];
}

/** Re-derive every id, confirm the hash chain, and verify every signature. */
export async function verifyLineage(file: LineageFile): Promise<VerifyResult> {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const e of file.entries) {
    const content = canonical(e.parents, e.genomeHash, e.seed, e.fidelity, e.author, e.createdAt);
    const expectedId = await sha256Hex(enc.encode(content));
    if (expectedId !== e.id) {
      errors.push(`id mismatch for ${fingerprint(e.id)} — content was altered`);
      continue;
    }
    for (const p of e.parents) {
      if (!ids.has(p)) errors.push(`broken ancestry: parent ${fingerprint(p)} missing or out of order`);
    }
    try {
      const pubKey = await crypto.subtle.importKey(
        'raw',
        hexToBytes(e.author) as BufferSource,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      const ok = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        pubKey,
        hexToBytes(e.signature) as BufferSource,
        enc.encode(e.id) as BufferSource,
      );
      if (!ok) errors.push(`bad signature for ${fingerprint(e.id)}`);
    } catch {
      errors.push(`unverifiable key/signature for ${fingerprint(e.id)}`);
    }
    ids.add(e.id);
  }
  return { valid: errors.length === 0, checked: file.entries.length, errors };
}

export function makeLineageFile(entries: LineageEntry[]): LineageFile {
  return { format: 'autograph-lineage', version: LINEAGE_VERSION, entries };
}
