import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { buildAgentInstructions } from '../../../packages/shared/src/prompt';
import { ADULTS, VAMSHI_COMPANION_ID, VAMSHI_CUSTOM_VOICE_ID, type Adult } from '../personas';
import { clerkNamePatch, ensureNapsterAvatar, napsterPlan, needsCompanionPhoto, previewUrlOf, syncsClerkName, toAvatarPng, type SeedNapster } from '../napsterAvatar';

const OWN_VOICE = `custom:${VAMSHI_CUSTOM_VOICE_ID}`;

const OLD = { companionId: '65da97bb-old-companion', agentId: '63f2e16f-old-agent' };

function fakeNapster(status = 'completed') {
  return {
    createCompanion: vi.fn(async () => ({ id: 'new-companion-123456' })),
    getCompanion: vi.fn(async (id: string) => ({ id, status })),
    createAgent: vi.fn(async () => ({ id: 'agent-new' })),
  } satisfies SeedNapster;
}

function deps(napster: SeedNapster) {
  return {
    napster,
    pictureUrl: vi.fn(async () => 'https://api.example/m/avatar?exp=1&sig=x'),
    flagFunctionId: 'flag_concern',
    save: vi.fn(),
    onReplace: vi.fn(),
    sleep: vi.fn(async () => {}),
  };
}

describe('napsterPlan', () => {
  it('plans only an agent for a persona with a preset companion, whatever an earlier run left in state', () => {
    const daddy = ADULTS.marcus;
    expect(napsterPlan(daddy, OLD)).toBe('agent');
    expect(napsterPlan(daddy, undefined)).toBe('agent');
    expect(napsterPlan(daddy, { companionId: VAMSHI_COMPANION_ID })).toBe('agent');
    expect(napsterPlan(daddy, { companionId: VAMSHI_COMPANION_ID, agentId: 'a1', voiceId: OWN_VOICE })).toBe('keep');
  });

  it("plans a new agent when the preset companion's agent was made with another voice (Task 29's cedar agent)", () => {
    const daddy = ADULTS.marcus;
    expect(napsterPlan(daddy, { companionId: VAMSHI_COMPANION_ID, agentId: '0140689c' })).toBe('agent');
    expect(napsterPlan(daddy, { companionId: VAMSHI_COMPANION_ID, agentId: '0140689c', voiceId: 'cedar' })).toBe('agent');
  });

  it('keeps the other parents as they are, and creates both only for a parent with nothing yet', () => {
    expect(napsterPlan(ADULTS.sarah, { companionId: 'c', agentId: 'a' })).toBe('keep');
    expect(napsterPlan(ADULTS.sarah, { companionId: 'c' })).toBe('agent');
    expect(napsterPlan(ADULTS.sarah, undefined)).toBe('companion+agent');
    expect(napsterPlan(ADULTS.jess, undefined)).toBe('none');
  });
});

describe('ensureNapsterAvatar', () => {
  it('skips companion creation for a persona with a pre-existing companion id and puts the agent on it', async () => {
    const n = fakeNapster();
    const d = deps(n);
    const { rec, replaced } = await ensureNapsterAvatar(ADULTS.marcus, OLD, d);

    expect(n.createCompanion).not.toHaveBeenCalled();
    expect(d.onReplace).toHaveBeenCalledWith(OLD);
    expect(d.pictureUrl).not.toHaveBeenCalled(); // no portrait is sent anywhere
    expect(n.getCompanion).toHaveBeenCalledWith(VAMSHI_COMPANION_ID);
    expect(n.createAgent).toHaveBeenCalledTimes(1);
    // A digital twin speaks with its cloned voice when the agent has no stock voiceId (Napster docs, Agent
    // Configuration > Voice), so the custom voice is selected by sending none.
    expect(n.createAgent).toHaveBeenCalledWith({
      companionId: VAMSHI_COMPANION_ID,
      name: `everthere-demo.av.marcus-${VAMSHI_COMPANION_ID.slice(-6)}`,
      language: 'en',
      mode: 'conversation',
      providerSettings: { instructions: buildAgentInstructions('Vamshi', 'Daddy'), temperature: 0.6, noiseReduction: { type: 'farField' } },
      functions: ['flag_concern'],
      disableIdleTimeout: true,
    });
    expect('voiceId' in n.createAgent.mock.calls[0]![0]).toBe(false);
    expect(rec).toEqual({ companionId: VAMSHI_COMPANION_ID, agentId: 'agent-new', voiceId: OWN_VOICE });
    // The earlier companion and agent are only reported (for state.retired); nothing deletes them.
    expect(replaced).toEqual(OLD);
    expect(d.save).toHaveBeenLastCalledWith({ companionId: VAMSHI_COMPANION_ID, agentId: 'agent-new', voiceId: OWN_VOICE });
  });

  it("replaces the preset companion's agent made with a stock voice, reporting it before anything is saved", async () => {
    const n = fakeNapster();
    const d = deps(n);
    const order: string[] = [];
    d.onReplace.mockImplementation(() => order.push('retire'));
    d.save.mockImplementation(() => order.push('save'));
    const cedarAgent = { companionId: VAMSHI_COMPANION_ID, agentId: '0140689c-cedar' };
    const { rec, replaced } = await ensureNapsterAvatar(ADULTS.marcus, cedarAgent, d);
    expect(replaced).toEqual(cedarAgent);
    expect(order[0]).toBe('retire');
    expect(n.createCompanion).not.toHaveBeenCalled();
    expect(n.createAgent).toHaveBeenCalledTimes(1);
    expect(rec).toEqual({ companionId: VAMSHI_COMPANION_ID, agentId: 'agent-new', voiceId: OWN_VOICE });
  });

  it('does nothing when the preset companion already has its agent (idempotent re-run)', async () => {
    const n = fakeNapster();
    const d = deps(n);
    const done = { companionId: VAMSHI_COMPANION_ID, agentId: 'agent-1', voiceId: OWN_VOICE };
    expect(await ensureNapsterAvatar(ADULTS.marcus, done, d)).toEqual({ rec: done, replaced: undefined });
    expect(n.createCompanion).not.toHaveBeenCalled();
    expect(n.getCompanion).not.toHaveBeenCalled();
    expect(n.createAgent).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
    expect(d.onReplace).not.toHaveBeenCalled();
  });

  it('waits for the preset companion to be ready before creating the agent, and fails on a failed one', async () => {
    const n = fakeNapster();
    n.getCompanion.mockResolvedValueOnce({ id: VAMSHI_COMPANION_ID, status: 'pending' });
    const d = deps(n);
    await ensureNapsterAvatar(ADULTS.marcus, undefined, d);
    expect(n.getCompanion).toHaveBeenCalledTimes(2);
    expect(d.sleep).toHaveBeenCalledTimes(1);

    const bad = fakeNapster('failed');
    await expect(ensureNapsterAvatar(ADULTS.marcus, undefined, deps(bad))).rejects.toThrow(/failed/);
    expect(bad.createAgent).not.toHaveBeenCalled();
  });

  it('still creates a companion from the portrait for a parent without a preset one (and saves it first)', async () => {
    const n = fakeNapster();
    const d = deps(n);
    const { rec } = await ensureNapsterAvatar(ADULTS.sarah, undefined, d);
    expect(d.pictureUrl).toHaveBeenCalledTimes(1);
    expect(n.createCompanion).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Sarah', version: 'v1' }));
    expect(d.save).toHaveBeenNthCalledWith(1, { companionId: 'new-companion-123456' });
    expect(rec).toEqual({ companionId: 'new-companion-123456', agentId: 'agent-new', voiceId: 'marin' });
    expect(n.createAgent).toHaveBeenCalledWith(expect.objectContaining({ voiceId: 'marin' }));
  });
});

describe('companion photo', () => {
  it('is (re)made only for a preset companion that the current photo was not made from', () => {
    expect(needsCompanionPhoto(ADULTS.marcus, undefined)).toBe(true);
    expect(needsCompanionPhoto(ADULTS.marcus, 'some-other-companion')).toBe(true);
    expect(needsCompanionPhoto(ADULTS.marcus, VAMSHI_COMPANION_ID)).toBe(false);
    expect(needsCompanionPhoto(ADULTS.sarah, undefined)).toBe(false);
  });

  it('reads an https previewUrl and refuses a missing one', () => {
    expect(previewUrlOf({ id: 'c', previewUrl: 'https://cdn.example/x.jpg' })).toBe('https://cdn.example/x.jpg');
    expect(() => previewUrlOf({ id: 'c', previewUrl: '' })).toThrow(/previewUrl/);
    expect(() => previewUrlOf({ id: 'c', previewUrl: 'http://cdn.example/x.jpg' })).toThrow(/previewUrl/);
  });

  it('converts the JPEG preview to PNG and downscales it until it fits the size limit', async () => {
    const noise = Buffer.alloc(1200 * 675 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
    const jpeg = await sharp(noise, { raw: { width: 1200, height: 675, channels: 3 } }).jpeg().toBuffer();

    const png = await toAvatarPng(jpeg);
    expect((await sharp(png).metadata()).format).toBe('png');
    expect((await sharp(png).metadata()).width).toBe(1200); // small enough: never resized

    const limit = Math.floor(png.length / 2);
    const small = await toAvatarPng(jpeg, limit);
    const meta = await sharp(small).metadata();
    expect(small.length).toBeLessThanOrEqual(limit);
    expect(meta.format).toBe('png');
    expect(meta.width! / meta.height!).toBeCloseTo(1200 / 675, 1);
  });
});

describe('syncsClerkName', () => {
  it('only renames the Clerk users of personas on a preset companion (the AI-face demo users are never touched)', () => {
    expect(syncsClerkName(ADULTS.marcus)).toBe(true);
    expect(syncsClerkName(ADULTS.sarah)).toBe(false);
    expect(syncsClerkName(ADULTS.jess)).toBe(false);
  });
});

describe('clerkNamePatch', () => {
  const daddy: Adult = ADULTS.marcus;
  it('renames the existing Clerk user only when the shown name differs', () => {
    expect(clerkNamePatch(daddy, { first_name: 'Marcus', last_name: 'Johnson' })).toEqual({ first_name: 'Vamshi', last_name: 'Krishna' });
    expect(clerkNamePatch(daddy, { first_name: 'Vamshi', last_name: 'Krishna' })).toBeNull();
  });
});
