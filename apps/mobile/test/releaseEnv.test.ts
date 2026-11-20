import { describe, expect, it } from 'vitest';
import { assertReleaseApiBase, buildOptions } from '../releaseEnv';

describe('release build guard (VITE_API_BASE)', () => {
  it('a production build without VITE_API_BASE fails, naming the variable', () => {
    expect(() => assertReleaseApiBase('production', undefined)).toThrow(/VITE_API_BASE/);
    expect(() => assertReleaseApiBase('production', '')).toThrow(/VITE_API_BASE/);
    expect(() => assertReleaseApiBase('production', '   ')).toThrow(/VITE_API_BASE/);
  });

  it.each(['http://localhost:8787', 'http://127.0.0.1:8787', 'http://10.0.2.2:8787', 'https://LOCALHOST'])(
    'a production build pointing at a local address (%s) fails',
    (base) => {
      expect(() => assertReleaseApiBase('production', base)).toThrow(/VITE_API_BASE/);
    },
  );

  it('a production build with the deployed API passes', () => {
    expect(() => assertReleaseApiBase('production', 'https://everthere-api.example.workers.dev')).not.toThrow();
  });

  it('dev and test builds may use anything (the emulator talks to 10.0.2.2)', () => {
    expect(() => assertReleaseApiBase('development', 'http://10.0.2.2:8787')).not.toThrow();
    expect(() => assertReleaseApiBase('test', undefined)).not.toThrow();
  });

  it('ships no source maps in production; keeps them elsewhere', () => {
    expect(buildOptions('production').sourcemap).toBe(false);
    expect(buildOptions('development').sourcemap).toBe(true);
  });
});
