#!/usr/bin/env node
// Installs the repo's pre-commit secret-scan (scripts/secret-scan.mjs) as a git
// pre-commit hook. Wired via web/package.json "prepare", so a plain `npm install`
// in web/ activates it. BEST-EFFORT: it never fails an install/CI build — if there
// is no git dir (a dependency install, a CI checkout without hooks, a worktree
// quirk) it simply skips. It writes NO secret; it only points the hook at the
// committed scanner.
import { execFileSync } from 'node:child_process';
import { writeFileSync, chmodSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // repo root
  const hooksRel = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' }).trim();
  const hooksDir = resolve(root, hooksRel);
  if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
  const hookPath = join(hooksDir, 'pre-commit');
  // The hook runs from the repo top-level (git's contract) and execs the scanner.
  const hook = [
    '#!/bin/sh',
    '# Auto-installed by scripts/install-git-hooks.mjs (web "prepare").',
    '# Do not edit here — the scanner lives at scripts/secret-scan.mjs.',
    'root="$(git rev-parse --show-toplevel)"',
    'exec node "$root/scripts/secret-scan.mjs"',
    '',
  ].join('\n');
  writeFileSync(hookPath, hook);
  chmodSync(hookPath, 0o755);
  console.log('\u2713 pre-commit secret-scan hook installed');
} catch (err) {
  console.warn('\u2022 skipped git hook install (non-fatal):', err && err.message ? err.message : err);
}
