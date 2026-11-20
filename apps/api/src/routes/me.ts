import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import * as s from '../db/schema';
import type { AppEnv } from '../env';

export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/me', async (c) => {
  const me = c.get('me');
  const d = db(c.env);

  const [fam, orgs, conns] = await Promise.all([
    d.select({ id: s.familyMember.familyId }).from(s.familyMember).where(eq(s.familyMember.userId, me.id)),
    d
      .select({ id: s.org.id, name: s.org.name, role: s.orgMember.role })
      .from(s.orgMember)
      .innerJoin(s.org, eq(s.org.id, s.orgMember.orgId))
      .where(eq(s.orgMember.userId, me.id)),
    d
      .select({ familyId: s.child.familyId })
      .from(s.connection)
      .innerJoin(s.child, eq(s.child.id, s.connection.childId))
      .where(and(eq(s.connection.kind, 'home'), eq(s.connection.caregiverUserId, me.id))),
  ]);

  const familyIds = [...new Set(conns.map((r) => r.familyId))];
  const homeCaregiverFamilies: { id: string; label: string }[] = [];
  if (familyIds.length) {
    const parents = await d
      .select({ familyId: s.familyMember.familyId, name: s.user.name })
      .from(s.familyMember)
      .innerJoin(s.user, eq(s.user.id, s.familyMember.userId))
      .where(inArray(s.familyMember.familyId, familyIds));
    for (const id of familyIds) {
      const names = parents.filter((p) => p.familyId === id).map((p) => p.name);
      // "Kim family" from the first parent's last name; fall back to a generic label.
      const last = names[0]?.trim().split(/\s+/).slice(-1)[0];
      homeCaregiverFamilies.push({ id, label: last ? `${last} family` : 'Family' });
    }
  }

  return c.json({
    user: { id: me.id, name: me.name, email: me.email, isDemo: me.isDemo === 1 },
    roles: {
      parent: fam.length > 0,
      adminOrgs: orgs.filter((o) => o.role === 'admin').map(({ id, name }) => ({ id, name })),
      teacherOrgs: orgs.filter((o) => o.role === 'teacher').map(({ id, name }) => ({ id, name })),
      homeCaregiverFamilies,
    },
  });
});
