import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const handlers: Record<string, (e: unknown) => void> = {};
const exitApp = vi.fn();
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name: string, cb: (e: unknown) => void) => {
      handlers[name] = cb;
      return { remove: async () => { delete handlers[name]; } };
    }),
    exitApp: () => exitApp(),
  },
}));

import { useBackButton } from '../src/lib/native';
import { sheetStack } from '../src/ui/sheetStack';
import { toast, toastStore } from '../src/ui/toast';

const wrap = (initial: string[], index?: number) =>
  function W({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initial} initialIndex={index}>{children}</MemoryRouter>;
  };

async function mount(initial: string[], index?: number) {
  const r = renderHook(() => ({ back: useBackButton('/parent'), loc: useLocation() }), { wrapper: wrap(initial, index) });
  await act(async () => {});
  return r;
}
const press = () => act(() => { handlers.backButton!({ canGoBack: true }); });

beforeEach(() => {
  exitApp.mockClear();
  toast.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('hardware back button', () => {
  it('closes the top sheet first and does nothing else', async () => {
    const close = vi.spyOn(sheetStack, 'closeTop').mockReturnValue(true);
    const r = await mount(['/parent', '/parent/history'], 1);
    press();
    expect(close).toHaveBeenCalledTimes(1);
    expect(r.result.current.loc.pathname).toBe('/parent/history');
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('navigates back when no sheet is open and the location is not a role root', async () => {
    vi.spyOn(sheetStack, 'closeTop').mockReturnValue(false);
    const r = await mount(['/parent', '/parent/history'], 1);
    press();
    expect(r.result.current.loc.pathname).toBe('/parent');
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('on a role root shows a toast first, exits only on a second press within 2 s', async () => {
    vi.spyOn(sheetStack, 'closeTop').mockReturnValue(false);
    await mount(['/parent']);
    press();
    expect(exitApp).not.toHaveBeenCalled();
    expect(toastStore.getSnapshot().map((t) => t.message)).toContain('Press back again to exit');
    press();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('a second press after 2 s only re-arms', async () => {
    vi.spyOn(sheetStack, 'closeTop').mockReturnValue(false);
    vi.useFakeTimers({ toFake: ['Date'] });
    await mount(['/admin']);
    press();
    vi.advanceTimersByTime(2100);
    press();
    expect(exitApp).not.toHaveBeenCalled();
    press();
    expect(exitApp).toHaveBeenCalledTimes(1);
  });

  it('a deep link with no history goes to the role home instead of exiting', async () => {
    vi.spyOn(sheetStack, 'closeTop').mockReturnValue(false);
    const r = await mount(['/parent/history']);
    press();
    expect(r.result.current.loc.pathname).toBe('/parent');
    expect(exitApp).not.toHaveBeenCalled();
  });
});
