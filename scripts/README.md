# Repo scripts

## Pre-commit secret-scan gate

A git **pre-commit hook** that blocks accidentally committing secrets. It is a
defence-in-depth companion to `.gitignore` (it also catches `git add -f` and
renamed files), and it enforces the project's "don't commit secrets" contract.

- **Scanner:** [`secret-scan.mjs`](./secret-scan.mjs) — scans only *staged*, text,
  `< 512 KB` files. It matches **patterns and sensitive filenames only** and
  hardcodes **no real secret value** (account id, token, key).
- **Installer:** [`install-git-hooks.mjs`](./install-git-hooks.mjs) — writes the
  hook into `.git/hooks/pre-commit`. It is **best-effort** and never fails a
  build/CI.
- **How it's wired:** `web/package.json`'s `"prepare"` runs the installer, so a
  plain **`npm install`** in `web/` activates the hook. Nothing dangling.

### What it blocks

| Kind | Examples |
|---|---|
| Sensitive filenames | `wrangler-account.json`, `.dev.vars` / `.dev.vars.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`/`id_ed25519`, `.env*` (not `.env.example`) |
| Secret content patterns | a PEM `PRIVATE KEY` block, a `CLOUDFLARE_API_TOKEN` value, a Cloudflare global API key, an AWS access-key id, a GitHub token |

### Usage

```sh
cd web && npm install          # installs the hook (via "prepare")
git commit                     # the hook runs automatically on staged files
git commit --no-verify         # bypass — ONLY for a verified false positive
```

A non-secret resource id (e.g. the Cloudflare **KV namespace id** in
`coordinator/wrangler.jsonc`) is intentionally *not* flagged — it is a benign
handle, not a credential.
