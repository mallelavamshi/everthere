// Meta Model API (OpenAI-compatible). Image half: muse-image-1.0.
// Plain fetch (no SDK): works in Workers and Node 22 alike.
const BASE_URL = 'https://api.meta.ai/v1';
const MODEL = 'muse-image-1.0';

export type ImageSize = '1024x1024' | '1792x1024' | '1024x1792';
export type OutputFormat = 'png' | 'webp' | 'jpeg';

export class MetaImageError extends Error {
  override name = 'MetaImageError';
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function post(apiKey: string, path: string, body: unknown): Promise<Buffer[]> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const err = json?.error ?? json;
    throw new MetaImageError(
      err?.message ?? `Meta image request failed (${res.status})`,
      res.status,
      err?.code,
    );
  }
  const items: { b64_json?: string }[] = json.data ?? [];
  return items.filter((d) => d.b64_json).map((d) => Buffer.from(d.b64_json!, 'base64'));
}

export function metaImages(apiKey: string) {
  return {
    generate(opts: {
      prompt: string;
      n: number;
      size: ImageSize;
      outputFormat?: OutputFormat;
    }): Promise<Buffer[]> {
      return post(apiKey, '/images/generations', {
        model: MODEL,
        prompt: opts.prompt,
        n: opts.n,
        size: opts.size,
        response_format: 'b64_json',
        output_format: opts.outputFormat ?? 'png',
      });
    },
    edit(opts: { prompt: string; images: Buffer[]; n: number }): Promise<Buffer[]> {
      return post(apiKey, '/images/edits', {
        model: MODEL,
        prompt: opts.prompt,
        n: opts.n,
        images: opts.images.map((b) => ({
          image_url: `data:image/png;base64,${b.toString('base64')}`,
        })),
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Text half: muse-spark-1.3 chat completions. Buffer-free so it runs in the Worker runtime as-is.

export const TEXT_MODEL = 'muse-spark-1.3';
const CHAT_TIMEOUT_MS = 25_000;

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ResponseFormat = { type: 'json_object' } | { type: 'text' };

export class MetaTextError extends Error {
  override name = 'MetaTextError';
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export function metaText(apiKey: string, fetchImpl?: typeof fetch) {
  const doFetch = fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    /** One chat completion; resolves to the first choice's message content. */
    async chat(opts: { messages: ChatMessage[]; model?: string; responseFormat?: ResponseFormat; maxTokens?: number }): Promise<string> {
      const body: Record<string, unknown> = { model: opts.model ?? TEXT_MODEL, messages: opts.messages };
      if (opts.responseFormat) body.response_format = opts.responseFormat;
      if (opts.maxTokens) body.max_tokens = opts.maxTokens;
      const res = await doFetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
      });
      const text = await res.text();
      let json: any = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        const err = json?.error ?? json;
        throw new MetaTextError(err?.message ?? `Meta chat request failed (${res.status})`, res.status, err?.code);
      }
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new MetaTextError('Meta chat response had no message content', res.status);
      return content;
    },
  };
}
export type MetaText = ReturnType<typeof metaText>;
