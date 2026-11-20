// Automatic portrait picking (muse-spark scores the n:4 candidates) and the contact sheet. Pure helpers + one fetch.
const BASE_URL = 'https://api.meta.ai/v1';
export const SCORE_MODEL = 'muse-spark-1.3';

export const PHOTO_CRITERIA = 'warm, natural, looking at camera, waist-up';
export const CLAY_CRITERIA = 'warm, friendly, looking at the viewer, clean clay-toy style, head and shoulders';

/** Parses `{"scores":[...]}` (or a bare array) into exactly `n` finite numbers; anything else is null. */
export function parseScores(text: string, n: number): number[] | null {
  let v: unknown;
  try {
    v = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  const arr = Array.isArray(v) ? v : (v as { scores?: unknown })?.scores;
  if (!Array.isArray(arr) || arr.length !== n) return null;
  const nums = arr.map((x) => (typeof x === 'number' ? x : Number(x)));
  return nums.every((x) => Number.isFinite(x)) ? nums : null;
}

/** 1-based index of the highest score; the earliest wins ties. */
export function bestPick(scores: number[]): number {
  let best = 0;
  scores.forEach((s, i) => {
    if (s > scores[best]!) best = i;
  });
  return best + 1;
}

/**
 * Asks muse-spark to score each candidate 0-10 against `criteria`. Returns the 1-based pick, or 1 (with a warning)
 * when the model or its answer is unusable, so a seed run never stalls on scoring.
 */
export async function scoreAndPick(apiKey: string, images: Buffer[], criteria: string, fetchImpl: typeof fetch = fetch): Promise<{ pick: number; scores: number[] | null }> {
  const content = [
    {
      type: 'text',
      text:
        `Score each of these ${images.length} portrait candidates from 0 to 10 for: ${criteria}. ` +
        'Penalize distorted hands or faces, extra fingers, odd eyes, text or watermarks. ' +
        `Reply with JSON only: {"scores": [${images.map((_, i) => `<score for image ${i + 1}>`).join(', ')}]}`,
    },
    ...images.map((b) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${b.toString('base64')}` } })),
  ];
  try {
    const res = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: SCORE_MODEL, messages: [{ role: 'user', content }], response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[] };
    const scores = res.ok ? parseScores(json.choices?.[0]?.message?.content ?? '', images.length) : null;
    if (!scores) {
      console.warn(`  scoring unavailable (HTTP ${res.status}); defaulting to candidate 1`);
      return { pick: 1, scores: null };
    }
    return { pick: bestPick(scores), scores };
  } catch (e) {
    console.warn('  scoring failed; defaulting to candidate 1:', (e as Error).message);
    return { pick: 1, scores: null };
  }
}

export type SheetRow = { key: string; label: string; candidates: string[]; pick: number; scores: number[] | null };

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

/** A static HTML contact sheet (paths relative to the sheet). The pick is outlined. */
export function contactSheetHtml(rows: SheetRow[]): string {
  const body = rows
    .map((r) => {
      const cells = r.candidates
        .map((src, i) => {
          const n = i + 1;
          const score = r.scores ? ` · ${r.scores[i]}` : '';
          return `<figure class="${n === r.pick ? 'pick' : ''}"><img loading="lazy" src="${esc(src)}"><figcaption>${n}${score}${n === r.pick ? ' ✓' : ''}</figcaption></figure>`;
        })
        .join('');
      return `<section><h2>${esc(r.label)} <small>${esc(r.key)}</small></h2><div class="r">${cells}</div></section>`;
    })
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>EverThere demo faces</title>
<style>
body{font-family:system-ui;background:#FFF8EC;color:#2B2140;margin:16px}
h2{margin:28px 0 8px;border-bottom:3px solid #FFD23F}small{font-weight:400;opacity:.6}
.r{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}figure{margin:0;border-radius:12px;padding:4px}
figure.pick{outline:5px solid #FF7A59}img{width:100%;display:block;border-radius:10px}figcaption{font-weight:700;font-size:18px}
</style><h1>Demo faces</h1><p>The outlined candidate is the automatic pick. To override, edit <code>picks.json</code> (key → 1-4) and run the seed again.</p>
${body}`;
}
