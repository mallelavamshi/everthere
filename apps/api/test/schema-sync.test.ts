import { describe, it, expect } from 'vitest';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as schema from '../src/db/schema';
import { makeApp } from './helpers';

type Info = { name: string; type: string; notnull: number; pk: number };

describe('drizzle schema <-> migration SQL sync', () => {
  const tables = (Object.values(schema) as unknown as SQLiteTable[]).filter(
    (v) => typeof v === 'object' && v !== null && Symbol.for('drizzle:IsDrizzleTable') in v,
  );

  it('covers the expected tables', () => {
    expect(tables.map((t) => getTableConfig(t).name).sort()).toEqual(
      [
        'alert', 'avatar', 'child', 'classroom', 'classroom_child', 'classroom_staff', 'comfort_plan', 'comfort_session',
        'connection', 'credit_guard', 'device', 'enrollment', 'family', 'family_member', 'invite_code', 'org',
        'org_member', 'pin_attempt', 'session_flag', 'staff_pin', 'usage_ledger', 'user', 'webhook_event',
        'rate_limit', 'demo_persona', 'demo_fixture',
      ].sort(),
    );
  });

  for (const table of tables) {
    const cfg = getTableConfig(table);
    it(`${cfg.name}: columns match`, async () => {
      const { env } = makeApp();
      const { results } = await env.DB.prepare(`PRAGMA table_info(\`${cfg.name}\`)`).all<Info>();
      const actual = results.map((r) => ({ name: r.name, type: r.type.toLowerCase(), notnull: !!r.notnull }));
      const expected = cfg.columns.map((c) => ({
        name: c.name,
        type: c.getSQLType(),
        // SQLite reports notnull=0 for a lone INTEGER PRIMARY KEY-less text pk; compare only non-pk columns strictly
        notnull: c.notNull,
      }));
      expect(actual.map((a) => a.name)).toEqual(expected.map((e) => e.name));
      expect(actual.map((a) => a.type)).toEqual(expected.map((e) => e.type));
      expect(actual.map((a) => a.notnull)).toEqual(expected.map((e) => e.notnull));
      const pkActual = results.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk).map((r) => r.name);
      const pkExpected = cfg.primaryKeys.length
        ? cfg.primaryKeys[0]!.columns.map((c) => c.name)
        : cfg.columns.filter((c) => c.primary).map((c) => c.name);
      expect(pkActual).toEqual(pkExpected);
    });
  }
});
