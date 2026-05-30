import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Tests run inside the real `workerd` runtime (via Miniflare) so the Durable
// Object, WebSocket upgrade, WebCrypto verification and KV snapshot paths are
// exercised exactly as they will be in production — not mocked. Two clients in
// one test address the same room name, so they reach the same ArchiveRoom DO.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
});
