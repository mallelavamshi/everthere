/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { assertReleaseApiBase, buildOptions } from './releaseEnv';

const ENV_DIR = '../..';

// VITE_* values are read from the repo-root .env (envDir), so the app and the API share one file. A shell variable
// (VITE_API_BASE=... pnpm build) overrides it.
export default defineConfig(({ mode }) => {
  assertReleaseApiBase(mode, loadEnv(mode, ENV_DIR, 'VITE_').VITE_API_BASE);
  return {
    plugins: [react()],
    envDir: ENV_DIR,
    build: buildOptions(mode),
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.{ts,tsx}'],
      css: false,
      // The full suite timed out at default parallelism (one worker per core); 3 keeps it stable on a dev laptop.
      maxWorkers: 3,
    },
  };
});
