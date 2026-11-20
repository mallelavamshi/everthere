import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['assets/test/**/*.test.ts', 'napster/test/**/*.test.ts', 'seed/test/**/*.test.ts'] } });
