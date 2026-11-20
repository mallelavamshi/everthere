const BASE = 'https://napster-api.napster.com/public';

export class NapsterError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryAfterMs?: number,
    message?: string,
  ) {
    super(message ?? `Napster ${status} ${code}`);
    this.name = 'NapsterError';
  }
}

const MAX_RETRY_AFTER_MS = 5000;

/** Retry-After as delta-seconds or HTTP-date, clamped to 5 s. */
export function parseRetryAfter(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined;
  let ms: number;
  if (/^\d+(\.\d+)?$/.test(v.trim())) ms = Number(v) * 1000;
  else {
    const t = Date.parse(v);
    if (Number.isNaN(t)) return undefined;
    ms = Math.max(0, t - now);
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

export interface NapsterOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface FunctionDef {
  data: { name: string; description: string; parameters: Record<string, unknown> };
  flow: 'implicit' | 'explicit';
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Agent `providerSettings` (swagger `CompanionAPI.Application.DTO.Connections.ProviderSettings`). We never send
 * `turnDetection` (Napster's defaults apply); if that ever changes, its ints are non-nullable in Napster's DTO, so
 * send all three fields or none (a missing one would deserialize as 0).
 */
export interface ProviderSettings {
  instructions?: string;
  temperature?: number;
  noiseReduction?: { type: 'nearField' | 'farField' } | null;
  turnDetection?: { threshold: number; prefix_padding_ms: number; silence_duration_ms: number };
}

export interface SessionItem {
  role: 'User' | 'Assistant' | 'System';
  text: string;
  /** Unix SECONDS as Napster sends it (device test P-2); lib/transcript.ts normalizes to epoch ms before storing. */
  timestamp: number | string | null;
}

export interface Recording {
  id: string;
  status: string;
  previewUrl?: string;
  [k: string]: unknown;
}

/**
 * Napster error bodies come in three shapes (docs/notes/napster-events.md 6.3):
 * array `[{code, description, type}]`, object `{code, description, type}`, and ASP.NET validation
 * `{errors:{field:[msg]}}`; some 500s have no body at all.
 */
export function parseErrorBody(body: unknown): { code?: string; message?: string } {
  const first = Array.isArray(body) ? body[0] : body;
  if (typeof first !== 'object' || first === null) return {};
  const o = first as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  const message = str(o.description) ?? str(o.message);
  if (str(o.code)) return { code: str(o.code), message };
  if (typeof o.errors === 'object' && o.errors !== null) {
    for (const [field, msgs] of Object.entries(o.errors as Record<string, unknown>)) {
      const m = Array.isArray(msgs) ? msgs.find((x) => typeof x === 'string') : undefined;
      return { code: 'VALIDATION_ERROR', message: m ? `${field}: ${m}` : field };
    }
  }
  return { message };
}

/**
 * Napster answers an expired connection with `400 ConnectionNotFound` (notes 6.5), not 404.
 * Only this observed shape counts as "already gone"; a plain 404 is not assumed to mean that.
 */
function isConnectionGone(e: unknown): boolean {
  return e instanceof NapsterError && e.code === 'ConnectionNotFound';
}

export function napster(apiKey: string, opts: NapsterOptions = {}) {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function raw(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'X-Api-Key': apiKey };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await doFetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return res;
    let parsed: { code?: string; message?: string } = {};
    try {
      parsed = parseErrorBody(await res.json());
    } catch {
      /* non-JSON error body */
    }
    const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'));
    let code = parsed.code ?? `HTTP_${res.status}`;
    if (parsed.code === 'ConcurrentSessionLimitReached') code = 'BUSY';
    throw new NapsterError(res.status, code, retryAfterMs, parsed.message);
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await raw(method, path, body);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T; // tolerate non-JSON success bodies (void endpoints)
    }
  }

  const enc = encodeURIComponent;

  return {
    createCompanion: (b: { description: string; firstName?: string; lastName?: string; pictureUrl?: string; videoUrl?: string; version: 'v1' | 'v2' }) =>
      call<{ id: string }>('POST', '/companions', b),
    getCompanion: (id: string) => call<Record<string, unknown> & { id: string }>('GET', `/companions/${enc(id)}`),
    listStockCompanions: (q: { search?: string; gender?: string; ethnicity?: string; pageIndex?: number; pageSize?: number } = {}) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(q)) if (v !== undefined) qs.set(k, String(v));
      const s = qs.toString();
      return call<{ items?: { id: string; [k: string]: unknown }[]; [k: string]: unknown }>('GET', `/companions/napster-stock${s ? `?${s}` : ''}`);
    },
    createAgent: (b: {
      companionId: string;
      name: string;
      /**
       * Required for stock and custom companions (400 VoiceIdRequired without it, notes 6.4). Omitted only for a digital
       * twin, which then speaks with its own cloned voice (Napster docs, Agent Configuration > Voice).
       */
      voiceId?: string;
      language?: string;
      providerSettings: ProviderSettings;
      functions?: string[];
      mode?: 'conversation' | 'puppeteer';
      /** At most one FAQ collection per agent (docs, Knowledge > FAQs). */
      faqCollections?: string[];
      knowledgeBaseId?: string;
      disableIdleTimeout?: boolean;
      tags?: Record<string, string>;
    }) => call<{ id: string }>('POST', '/agents', b),
    patchAgent: (id: string, partial: Record<string, unknown>) => call<unknown>('PATCH', `/agents/${enc(id)}`, partial),
    async createConnection(
      agentId: string,
      b: {
        channelType: 'webrtc';
        videoPolicy?: 'deferred';
        externalClientId?: string;
        externalClientProfile?: unknown;
        initialSpeech?: string;
        /** A string-to-string object; an array is rejected with 400 (notes 5). */
        tags?: Record<string, string>;
      },
    ): Promise<{ token: string; connectionId: string }> {
      for (let attempt = 0; ; attempt++) {
        try {
          // The child's camera is never sent: videoPolicy is forced regardless of the caller.
          const r = await call<{ token: string; connection: { id: string } }>('POST', `/agents/${enc(agentId)}/connections`, { ...b, videoPolicy: 'deferred' });
          return { token: r.token, connectionId: r.connection.id };
        } catch (e) {
          if (e instanceof NapsterError && e.status === 429 && attempt < 2) {
            await sleep(e.retryAfterMs ?? 1000);
            continue;
          }
          throw e;
        }
      }
    },
    /** An expired connection (400 ConnectionNotFound) resolves; every other error rejects. */
    deleteConnection: (id: string) => call<void>('DELETE', `/connections/${enc(id)}`).catch((e) => {
      if (!isConnectionGone(e)) throw e;
    }),
    async getSession(id: string): Promise<{ status: string; cost: number | null; closeReason: string | null; items: SessionItem[] }> {
      const r = await call<{ status: string; cost?: number | null; closeReason?: string | null; conversation?: { items?: SessionItem[] } }>(
        'GET',
        `/sessions/${enc(id)}`,
      );
      return { status: r.status, cost: r.cost ?? null, closeReason: r.closeReason ?? null, items: r.conversation?.items ?? [] };
    },
    /**
     * Cleanup deletes do not swallow errors: 404 is not assumed to mean "gone", and a just-finished companion
     * answers 400 CompanionNotCompleted (notes 4, 6.5). Best-effort callers catch and log.
     */
    deleteAgent: (id: string) => call<void>('DELETE', `/agents/${enc(id)}`),
    deleteCompanion: (id: string) => call<void>('DELETE', `/companions/${enc(id)}`),
    deleteSession: (id: string) => call<void>('DELETE', `/sessions/${enc(id)}`),
    createFunction: (def: FunctionDef) => call<{ id: string }>('POST', '/functions', def),
    searchFunctions: (search: string) => call<{ items?: { id: string; name?: string; data?: { name?: string } }[] }>('GET', `/functions?search=${enc(search)}`),
    getFunction: (id: string) => call<Partial<FunctionDef> & { id: string }>('GET', `/functions/${enc(id)}`),
    /** Replaces a function's definition, keeping its id (PUT /public/functions/{functionId}). */
    updateFunction: (id: string, def: FunctionDef) => call<Partial<FunctionDef> & { id: string }>('PUT', `/functions/${enc(id)}`, def),
    // FAQ collections and knowledge bases (task 32): one shared set for every EverThere agent, set up by
    // scripts/napster/setupComfortKnowledge.ts. List responses are tolerated as `{ items }` or a bare array.
    listFaqCollections: () => call<{ items?: FaqCollection[] } | FaqCollection[]>('GET', '/faqs'),
    getFaqCollection: (id: string) => call<FaqCollection>('GET', `/faqs/${enc(id)}`),
    createFaqCollection: (b: { name: string; faqs?: { question: string; answer: string }[] }) => call<FaqCollection>('POST', '/faqs', b),
    addFaqItem: (collectionId: string, b: { question: string; answer: string }) => call<FaqItem>('POST', `/faqs/${enc(collectionId)}/items`, b),
    updateFaqItem: (collectionId: string, itemId: string, b: { question?: string; answer?: string }) =>
      call<FaqItem>('PATCH', `/faqs/${enc(collectionId)}/items/${enc(itemId)}`, b),
    listKnowledgeBases: () => call<{ items?: KnowledgeBase[] } | KnowledgeBase[]>('GET', '/knowledge-bases'),
    createKnowledgeBase: (b: { name: string; provider: 'azureOpenAI' }) => call<KnowledgeBase>('POST', '/knowledge-bases', b),
    listKnowledgeBaseFiles: (id: string) => call<{ items?: KnowledgeFile[] } | KnowledgeFile[]>('GET', `/knowledge-bases/${enc(id)}/files`),
    /** Napster downloads the file from a public URL (ours: a signed /m link to R2). */
    uploadKnowledgeBaseFile: (id: string, b: { url: string }) => call<KnowledgeFile>('POST', `/knowledge-bases/${enc(id)}/files`, b),
    createRecording: (companionId: string, b: { provider: 'openAi' | 'elevenLabs'; voiceId: string; text: string }) =>
      call<Recording>('POST', `/companions/${enc(companionId)}/recordings`, b),
    getRecording: (companionId: string, recordingId: string) => call<Recording>('GET', `/companions/${enc(companionId)}/recordings/${enc(recordingId)}`),
    getRecordingDownloadUrl: (companionId: string, recordingId: string) =>
      call<{ url: string }>('GET', `/companions/${enc(companionId)}/recordings/${enc(recordingId)}/download-url`),
  };
}

export type NapsterClient = ReturnType<typeof napster>;

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}
export interface FaqCollection {
  id: string;
  name: string;
  items?: FaqItem[];
}
export interface KnowledgeBase {
  id: string;
  name: string;
  provider?: string;
}
export interface KnowledgeFile {
  id: string;
  originalName?: string;
  contentType?: string;
}
