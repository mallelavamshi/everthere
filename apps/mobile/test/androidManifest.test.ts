import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AndroidManifest', () => {
  it('opts out of Android backup (no session tokens or acting tokens copied into cloud backups)', () => {
    const xml = readFileSync(path.resolve(import.meta.dirname, '../android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(xml).toMatch(/android:allowBackup="false"/);
    expect(xml).not.toMatch(/android:allowBackup="true"/);
  });
});
