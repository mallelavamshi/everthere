import { describe, expect, it, vi } from 'vitest';
import { ensureFlagFunction, flagFunctionDef, sameDefinition } from '../setupFlagTool';

type Fn = { id: string; name?: string; data?: { name?: string; description?: string; parameters?: Record<string, unknown> }; flow?: string };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function fakeNapster(initial: Fn[]) {
  const store = new Map(initial.map((f) => [f.id, clone(f)]));
  return {
    store,
    searchFunctions: vi.fn(async (_s: string) => ({ items: [...store.values()].map((f) => ({ id: f.id, name: f.data?.name })) })),
    getFunction: vi.fn(async (id: string) => clone(store.get(id)!)),
    createFunction: vi.fn(async (def: typeof flagFunctionDef) => {
      store.set('fn_new', { id: 'fn_new', ...clone(def) });
      return { id: 'fn_new' };
    }),
    updateFunction: vi.fn(async (id: string, def: typeof flagFunctionDef) => {
      store.set(id, { id, ...clone(def) });
      return { id, ...clone(def) };
    }),
  };
}

describe('flag_concern definition', () => {
  it('tells the model to call it at once, even for a small bump', () => {
    expect(flagFunctionDef.data.description).toMatch(/immediately/);
    expect(flagFunctionDef.data.description).toMatch(/small/);
  });
  it("asks for the child's exact words in quote", () => {
    expect(flagFunctionDef.data.parameters.properties.quote).toEqual({ type: 'string', description: "the child's exact words, verbatim" });
  });
});

describe('ensureFlagFunction (idempotent create / reuse / update)', () => {
  it('creates the function when none exists', async () => {
    const n = fakeNapster([]);
    expect(await ensureFlagFunction(n)).toEqual({ id: 'fn_new', action: 'created' });
    expect(n.createFunction).toHaveBeenCalledWith(flagFunctionDef);
    expect(n.updateFunction).not.toHaveBeenCalled();
  });

  it('updates (PUT) an existing function whose definition differs, keeping its id; a second run then reuses it', async () => {
    const old = clone(flagFunctionDef);
    (old.data.parameters.properties as Record<string, unknown>).quote = { type: 'string' };
    const n = fakeNapster([{ id: 'fn_1', ...old }]);
    expect(await ensureFlagFunction(n)).toEqual({ id: 'fn_1', action: 'updated' });
    expect(n.updateFunction).toHaveBeenCalledWith('fn_1', flagFunctionDef);
    expect(n.createFunction).not.toHaveBeenCalled();
    n.updateFunction.mockClear();
    expect(await ensureFlagFunction(n)).toEqual({ id: 'fn_1', action: 'reused' });
    expect(n.updateFunction).not.toHaveBeenCalled();
  });

  it('reuses an identical function without writing (extra server fields and key order do not matter)', async () => {
    const same = clone(flagFunctionDef) as Fn & Record<string, unknown>;
    same.data!.parameters = { required: ['category', 'quote', 'severity'], description: null, ...same.data!.parameters };
    const n = fakeNapster([{ id: 'fn_2', ...same, url: null, receiveMessages: false } as Fn]);
    expect(await ensureFlagFunction(n)).toEqual({ id: 'fn_2', action: 'reused' });
    expect(n.updateFunction).not.toHaveBeenCalled();
    expect(n.createFunction).not.toHaveBeenCalled();
  });

  it('sameDefinition notices a changed description, enum, required list or flow', () => {
    const base = clone(flagFunctionDef);
    expect(sameDefinition(base, flagFunctionDef)).toBe(true);
    expect(sameDefinition({ ...base, flow: 'explicit' }, flagFunctionDef)).toBe(false);
    expect(sameDefinition({ ...base, data: { ...base.data, description: 'x' } }, flagFunctionDef)).toBe(false);
    const req = clone(base);
    req.data.parameters.required = ['category'];
    expect(sameDefinition(req, flagFunctionDef)).toBe(false);
    const en = clone(base);
    en.data.parameters.properties.severity.enum = ['low'];
    expect(sameDefinition(en, flagFunctionDef)).toBe(false);
  });
});
