import { describe, expect, it, vi } from 'vitest';
import { COMFORT_FAQS } from '../content/faqs';
import { ensureFaqCollection, ensureKnowledgeBase, knowledgeFileName, setVar, type KnowledgeNapster } from '../setupComfortKnowledge';
import { agentPatch, syncAgents } from '../syncAgents';

function fakeNapster(over: Partial<KnowledgeNapster> = {}): KnowledgeNapster & Record<string, ReturnType<typeof vi.fn>> {
  return {
    listFaqCollections: vi.fn(async () => ({ items: [] })),
    getFaqCollection: vi.fn(async () => ({ id: 'faq1', name: 'x', items: [] })),
    createFaqCollection: vi.fn(async () => ({ id: 'faq1', name: 'x' })),
    addFaqItem: vi.fn(async () => ({})),
    updateFaqItem: vi.fn(async () => ({})),
    listKnowledgeBases: vi.fn(async () => []),
    createKnowledgeBase: vi.fn(async () => ({ id: 'kb1', name: 'x' })),
    listKnowledgeBaseFiles: vi.fn(async () => ({ items: [] })),
    uploadKnowledgeBaseFile: vi.fn(async () => ({ id: 'f1' })),
    ...over,
  } as never;
}

describe('FAQ answers keep the locked rules', () => {
  it('no promised times, never "coming", no secrets kept, no "right here" for the parent; within the 50-pair limit', () => {
    expect(COMFORT_FAQS.length).toBeGreaterThan(10);
    expect(COMFORT_FAQS.length).toBeLessThanOrEqual(50);
    for (const f of COMFORT_FAQS) {
      const a = f.answer.toLowerCase();
      expect(a, f.question).not.toMatch(/\bsoon\b|o'clock|\bat \d|\bi'm coming\b|\bi will come\b|pick you up|on my way/);
      expect(a, f.question).not.toMatch(/\bi'm right here\b/);
      expect(a, f.question).not.toMatch(/\bour (little )?secret\b|\bdon't tell\b/);
    }
  });
  it('is honest: a video helper, and it cannot see the child (the camera is never sent)', () => {
    const answer = (q: RegExp) => COMFORT_FAQS.find((f) => q.test(f.question))!.answer;
    expect(answer(/Are you real/)).toContain('video helper');
    expect(answer(/Can you see me/)).toContain("can't see you");
    expect(answer(/hit me/)).toMatch(/show the grown-up/);
  });
});

describe('ensureFaqCollection', () => {
  it('creates the collection with every pair when none exists', async () => {
    const n = fakeNapster();
    expect(await ensureFaqCollection(n, COMFORT_FAQS)).toEqual({ id: 'faq1', action: 'created', added: COMFORT_FAQS.length, updated: 0 });
    expect(n.createFaqCollection).toHaveBeenCalledWith({ name: 'EverThere: little questions', faqs: [...COMFORT_FAQS] });
  });
  it('syncs an existing one: adds missing questions, updates changed answers, leaves equal ones, deletes nothing', async () => {
    const faqs = [
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2 new' },
      { question: 'Q3?', answer: 'A3' },
    ];
    const n = fakeNapster({
      listFaqCollections: vi.fn(async () => [{ id: 'c9', name: 'EverThere: little questions' }]),
      getFaqCollection: vi.fn(async () => ({
        id: 'c9',
        name: 'EverThere: little questions',
        items: [
          { id: 'i1', question: 'Q1?', answer: 'A1' },
          { id: 'i2', question: ' Q2? ', answer: 'A2 old' },
          { id: 'i0', question: 'Old one?', answer: 'kept' },
        ],
      })),
    });
    expect(await ensureFaqCollection(n, faqs)).toEqual({ id: 'c9', action: 'synced', added: 1, updated: 1 });
    expect(n.addFaqItem).toHaveBeenCalledWith('c9', { question: 'Q3?', answer: 'A3' });
    expect(n.updateFaqItem).toHaveBeenCalledWith('c9', 'i2', { answer: 'A2 new' });
    expect(n.createFaqCollection).not.toHaveBeenCalled();
  });
  it('refuses more than 50 pairs', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ question: `Q${i}`, answer: 'A' }));
    await expect(ensureFaqCollection(fakeNapster(), many)).rejects.toThrow(/50/);
  });
});

describe('ensureKnowledgeBase', () => {
  it('creates the base and uploads the file from the public URL', async () => {
    const n = fakeNapster();
    const url = vi.fn(async () => 'https://api/m/knowledge%2Fx.md?sig=1');
    expect(await ensureKnowledgeBase(n, 'calm-corner-abc.md', url)).toEqual({ id: 'kb1', created: true, uploaded: true });
    expect(n.createKnowledgeBase).toHaveBeenCalledWith({ name: 'EverThere: calm-down corner', provider: 'azureOpenAI' });
    expect(n.uploadKnowledgeBaseFile).toHaveBeenCalledWith('kb1', { url: 'https://api/m/knowledge%2Fx.md?sig=1' });
  });
  it('reuses the base and skips the upload when that exact file is already there; a new version is uploaded', async () => {
    const n = fakeNapster({
      listKnowledgeBases: vi.fn(async () => ({ items: [{ id: 'kb7', name: 'EverThere: calm-down corner' }] })),
      listKnowledgeBaseFiles: vi.fn(async () => [{ id: 'f1', originalName: 'calm-corner-abc.md' }]),
    });
    const url = vi.fn(async () => 'u');
    expect(await ensureKnowledgeBase(n, 'calm-corner-abc.md', url)).toEqual({ id: 'kb7', created: false, uploaded: false });
    expect(url).not.toHaveBeenCalled();
    expect(await ensureKnowledgeBase(n, 'calm-corner-def.md', url)).toEqual({ id: 'kb7', created: false, uploaded: true });
    expect(n.createKnowledgeBase).not.toHaveBeenCalled();
  });
  it('the file name follows the text', () => {
    expect(knowledgeFileName('a')).toMatch(/^calm-corner-[0-9a-f]{10}\.md$/);
    expect(knowledgeFileName('a')).not.toBe(knowledgeFileName('b'));
  });
});

describe('setVar', () => {
  const toml = '[ai]\nbinding = "AI"\n\n[vars]\nA = "1"\nNAPSTER_FLAG_FUNCTION_ID = "fn"\n\n[env.x]\nB = "2"\n';
  it('replaces an existing var, or adds it at the end of [vars] (before the next table)', () => {
    expect(setVar(toml, 'A', '9')).toContain('A = "9"');
    const added = setVar(toml, 'NAPSTER_FAQ_COLLECTION_ID', 'faq1');
    expect(added).toBe('[ai]\nbinding = "AI"\n\n[vars]\nA = "1"\nNAPSTER_FLAG_FUNCTION_ID = "fn"\nNAPSTER_FAQ_COLLECTION_ID = "faq1"\n\n[env.x]\nB = "2"\n');
    expect(setVar(added, 'NAPSTER_FAQ_COLLECTION_ID', 'faq2')).toContain('NAPSTER_FAQ_COLLECTION_ID = "faq2"');
  });
});

describe('syncAgents', () => {
  const rows = [
    { avatarId: 'av1', agentId: 'ag1', parentTitle: 'Mommy', ownerName: 'Sarah Johnson' },
    { avatarId: 'av2', agentId: 'ag2', parentTitle: 'Daddy', ownerName: 'Vamshi Krishna' },
    { avatarId: 'av3', agentId: 'ag2', parentTitle: 'Daddy', ownerName: 'Vamshi Krishna' },
  ];
  const vars = { NAPSTER_FAQ_COLLECTION_ID: 'faq1', NAPSTER_KNOWLEDGE_BASE_ID: 'kb1' };
  it('the patch: per-parent comforting instructions, shared FAQ and knowledge, no idle timeout; never a voice', () => {
    const p = agentPatch(rows[1]!, vars);
    expect(p.providerSettings.instructions).toContain('You are Daddy (Vamshi)');
    expect(p.providerSettings.noiseReduction).toEqual({ type: 'farField' });
    expect(p).toMatchObject({ faqCollections: ['faq1'], knowledgeBaseId: 'kb1', disableIdleTimeout: true });
    expect(p).not.toHaveProperty('voiceId');
    expect(p).not.toHaveProperty('functions');
  });
  it('dry run patches nothing; apply patches each agent once and counts failures', async () => {
    const log: string[] = [];
    expect(await syncAgents(rows, vars, null, (s) => log.push(s))).toEqual({ patched: 0, failed: 0 });
    expect(log).toHaveLength(2);
    const patch = vi.fn(async (id: string) => {
      if (id === 'ag2') throw new Error('boom');
    });
    expect(await syncAgents(rows, vars, patch, () => {})).toEqual({ patched: 1, failed: 1 });
    expect(patch).toHaveBeenCalledTimes(2);
  });
});
