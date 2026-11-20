import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const HERMETIC_TEST_VARS = {
  DEV_ROUTES: '0',
  SPIKE_AGENT_ID: '',
  NAPSTER_API_KEY: 'test-napster-key-not-a-secret',
  NAPSTER_WEBHOOK_SECRET: '',
  CLERK_SECRET_KEY: 'sk_test_not_a_secret',
  META_API_KEY: 'test-meta-key-not-a-secret',
  ADMIN_TOKEN: '',
  ACTING_TOKEN_KEY: 'test-acting-token-key-not-a-secret',
  MEDIA_SIGNING_KEY: 'test-media-signing-key-not-a-secret',
};

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.test.toml' },
        // wrangler also loads a local .dev.vars (real secrets, DEV_ROUTES=1 for `wrangler dev`); pin every
        // var/secret the code reads to test values so the suite never sees them.
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, ...HERMETIC_TEST_VARS } },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  };
});
