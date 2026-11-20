import type { Env as AppEnvBindings } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends AppEnvBindings {
      TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    }
  }
}
