import { afterEach, describe, expect, it, vi } from 'vitest';
import { metaImages, MetaImageError } from '../src/meta/client';

const b64 = (s: string) => btoa(s);

afterEach(() => vi.restoreAllMocks());

function mockFetch(status: number, body: unknown) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('metaImages.generate', () => {
  it('sends model muse-image-1.0 and decodes b64_json', async () => {
    const spy = mockFetch(200, { data: [{ b64_json: b64('one') }, { b64_json: b64('two') }] });
    const out = await metaImages('k').generate({
      prompt: 'p',
      n: 2,
      size: '1792x1024',
      outputFormat: 'png',
    });
    expect(out.map((b) => b.toString())).toEqual(['one', 'two']);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://api.meta.ai/v1/images/generations');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      model: 'muse-image-1.0',
      prompt: 'p',
      n: 2,
      size: '1792x1024',
      response_format: 'b64_json',
      output_format: 'png',
    });
  });

  it('throws MetaImageError with code on content_policy_violation', async () => {
    mockFetch(400, { error: { code: 'content_policy_violation', message: 'no' } });
    await expect(
      metaImages('k').generate({ prompt: 'p', n: 1, size: '1024x1024' }),
    ).rejects.toMatchObject({ name: 'MetaImageError', code: 'content_policy_violation', status: 400 });
    expect(MetaImageError).toBeDefined();
  });
});

describe('metaImages.edit', () => {
  it('posts reference images as base64 data URLs to /images/edits', async () => {
    const spy = mockFetch(200, { data: [{ b64_json: b64('x') }] });
    const out = await metaImages('k').edit({ prompt: 'p', images: [Buffer.from('ref')], n: 1 });
    expect(out[0]!.toString()).toBe('x');
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://api.meta.ai/v1/images/edits');
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe('muse-image-1.0');
    expect(body.images).toEqual([{ image_url: `data:image/png;base64,${btoa('ref')}` }]);
  });
});
