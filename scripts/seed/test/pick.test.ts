import { describe, it, expect, vi } from 'vitest';
import { bestPick, contactSheetHtml, parseScores, scoreAndPick } from '../pick';

describe('pick helpers', () => {
  it('parseScores accepts {scores:[...]}, a bare array, or fenced JSON; rejects wrong lengths and junk', () => {
    expect(parseScores('{"scores":[7,9,8,6]}', 4)).toEqual([7, 9, 8, 6]);
    expect(parseScores('[1, "2", 3, 4]', 4)).toEqual([1, 2, 3, 4]);
    expect(parseScores('```json\n{"scores":[1,2,3,4]}\n```', 4)).toEqual([1, 2, 3, 4]);
    expect(parseScores('{"scores":[1,2,3]}', 4)).toBeNull();
    expect(parseScores('{"scores":[1,2,"x",4]}', 4)).toBeNull();
    expect(parseScores('nope', 4)).toBeNull();
  });

  it('bestPick is 1-based and the earliest wins ties', () => {
    expect(bestPick([7, 9, 8, 9])).toBe(2);
    expect(bestPick([5, 5, 5, 5])).toBe(1);
  });

  it('scoreAndPick sends the images to muse-spark and falls back to 1 on a bad answer', async () => {
    const img = Buffer.from('png');
    const good = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"scores":[3,4,9,1]}' } }] })));
    expect(await scoreAndPick('k', [img, img, img, img], 'warm', good as unknown as typeof fetch)).toEqual({ pick: 3, scores: [3, 4, 9, 1] });
    const body = JSON.parse((good.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.model).toBe('muse-spark-1.3');
    expect(body.messages[0].content.filter((c: { type: string }) => c.type === 'image_url')).toHaveLength(4);
    const bad = vi.fn(async () => new Response('{}', { status: 500 }));
    expect(await scoreAndPick('k', [img, img], 'warm', bad as unknown as typeof fetch)).toEqual({ pick: 1, scores: null });
  });

  it('contactSheetHtml outlines the pick and escapes labels', () => {
    const html = contactSheetHtml([{ key: 'sarah', label: 'Sarah <Mommy>', candidates: ['faces/sarah/1.png', 'faces/sarah/2.png'], pick: 2, scores: [5, 8] }]);
    expect(html).toContain('Sarah &lt;Mommy&gt;');
    expect(html).toMatch(/class="pick"><img loading="lazy" src="faces\/sarah\/2.png">/);
  });
});
