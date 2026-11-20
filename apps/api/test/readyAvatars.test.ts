import { describe, it, expect } from 'vitest';
import { makeApp, seedRows } from './helpers';
import { readyAvatarsByChild } from '../src/lib/readyAvatars';

const { env } = makeApp();

describe('readyAvatarsByChild: what the child calls each parent', () => {
  it("uses the plan title, else the avatar's own title (a Daddy avatar with no plan says Daddy), else Mom", async () => {
    await seedRows(env, {
      user: [
        { id: 'ra_mom', name: 'Sarah Lee', email: 'ra_mom@x', created_at: 1 },
        { id: 'ra_dad', name: 'Dan Lee', email: 'ra_dad@x', created_at: 1 },
        { id: 'ra_gp', name: 'Gil Lee', email: 'ra_gp@x', created_at: 1 },
      ],
      family: [{ id: 'ra_F', created_at: 1 }],
      family_member: [
        { family_id: 'ra_F', user_id: 'ra_mom', role: 'parent' },
        { family_id: 'ra_F', user_id: 'ra_dad', role: 'parent' },
        { family_id: 'ra_F', user_id: 'ra_gp', role: 'parent' },
      ],
      child: [{ id: 'ra_C', family_id: 'ra_F', name: 'Mia' }],
      avatar: [
        { id: 'ra_av1', user_id: 'ra_mom', status: 'approved', parent_title: 'Mommy', created_at: 1 },
        { id: 'ra_av2', user_id: 'ra_dad', status: 'approved', parent_title: 'Daddy', created_at: 1 },
        { id: 'ra_av3', user_id: 'ra_gp', status: 'approved', parent_title: '', created_at: 1 },
      ],
      // Mom's plan has a title; Dad has no plan at all; the third avatar has an empty plan title and no own title.
      comfort_plan: [
        { child_id: 'ra_C', avatar_id: 'ra_av1', parent_title: 'Mama', tone: 'calm' },
        { child_id: 'ra_C', avatar_id: 'ra_av3', parent_title: '', tone: 'calm' },
      ],
    });
    const got = (await readyAvatarsByChild(env, ['ra_C'])).get('ra_C');
    expect(got).toEqual([
      { avatarId: 'ra_av1', parentTitle: 'Mama', parentName: 'Sarah' },
      { avatarId: 'ra_av2', parentTitle: 'Daddy', parentName: 'Dan' },
      { avatarId: 'ra_av3', parentTitle: 'Mom', parentName: 'Gil' },
    ]);
  });
});
