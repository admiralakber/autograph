#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PRE-COMMIT SECRET-SCAN GATE
//
// Refuses to commit staged content/filenames that look like secrets. It scans
// for PATTERNS and sensitive FILENAMES only — it deliberately hardcodes NO real
// secret value (account id, token, key), because doing so would itself leak one.
//
// Wired as a git pre-commit hook by scripts/install-git-hooks.mjs (run from
// web/'s "prepare", i.e. on `npm install`). Fast: only staged, text, < 512 KB.
// Bypass for a genuine false positive with `git commit --no-verify`.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let staged = [];
try {
  staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']).split('\0').filter(Boolean);
} catch {
  process.exit(0); // not a git context we can read — don't block
}
if (staged.length === 0) process.exit(0);

// This gate's own sources legitimately mention the patterns below — never scan
// their CONTENT (filename checks below still apply to everything).
const SELF = new Set(['scripts/secret-scan.mjs', 'scripts/install-git-hooks.mjs']);

/** Sensitive filenames that must never be committed (defence-in-depth; most are
 *  also .gitignored, but a `git add -f` or a rename could slip past that). */
function filenameHit(path) {
  const base = path.split('/').pop() ?? path;
  if (base === 'wrangler-account.json') return 'Cloudflare account credentials file';
  if (base === '.dev.vars' || base.startsWith('.dev.vars.')) return 'local worker secrets (.dev.vars)';
  if (/\.(pem|key|p12|pfx|keystore|jks)$/i.test(base)) return 'private key / key material';
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(base)) return 'SSH private key';
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return 'environment secrets (.env)';
  return null;
}

// Secret CONTENT patterns. Assembled from fragments so this very file contains
// no complete secret marker, and never any real secret value.
const PEM = '-' + '----' + 'BEGIN';
const CONTENT = [
  [new RegExp(PEM + ' (?:[A-Z0-9 ]+ )?PRIVATE KEY-' + '----'), 'a PEM PRIVATE KEY block'],
  [/\bCLOUDFLARE_API_TOKEN\b\s*[:=]\s*["'`]?[A-Za-z0-9_-]{30,}/, 'a CLOUDFLARE_API_TOKEN value'],
  [/\b(?:CLOUDFLARE_API_KEY|CF_API_KEY|X-Auth-Key|global[_-]?api[_-]?key)\b["'`]?\s*[:=]\s*["'`]?[0-9a-f]{37}\b/i, 'a Cloudflare global API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'a GitHub token'],
];

const problems = [];
for (const path of staged) {
  const fhit = filenameHit(path);
  if (fhit) problems.push(`  ✖ ${path} — sensitive filename: ${fhit}`);
  if (SELF.has(path)) continue;
  let blob;
  try {
    blob = git(['show', `:${path}`]);
  } catch {
    continue; // unreadable (e.g. submodule) — skip content scan
  }
  if (blob.indexOf('\u0000') !== -1) continue; // binary
  if (blob.length > 512 * 1024) continue; // large file — skip content scan
  for (const [re, label] of CONTENT) {
    if (re.test(blob)) problems.push(`  ✖ ${path} — looks like ${label}`);
  }
}

if (problems.length > 0) {
  process.stderr.write('\n\u{1F6D1} secret-scan: refusing to commit — possible secret(s) detected:\n\n');
  process.stderr.write(problems.join('\n') + '\n');
  process.stderr.write('\nRemove/relocate it (see .gitignore), or — only if you are CERTAIN it is a false\npositive — bypass with: git commit --no-verify\n\n');
  process.exit(1);
}
process.exit(0);
