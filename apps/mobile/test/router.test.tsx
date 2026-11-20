import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the real AuthGate that, like it, owns an absolute-path <Routes> and bounces unknown paths to '/'.
vi.mock('../src/shell/AuthGate', () => ({
  AuthGate: () => {
    const { pathname } = useLocation();
    return (
      <Routes>
        <Route path="/" element={<span>gate home</span>} />
        <Route path="/parent/*" element={<span>gate parent {pathname}</span>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  },
}));
vi.mock('../src/features/dev/ParentPreview', () => ({ default: ({ demo }: { demo: boolean }) => <span>preview parent demo={String(demo)}</span> }));

import { AppRoutes } from '../src/router';

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );

afterEach(() => localStorage.clear());

describe('dev /parent preview route', () => {
  it('without the flag, /parent/* is handled by the normal auth gate (no redirect loop)', async () => {
    at('/parent/avatar');
    expect(await screen.findByText('gate parent /parent/avatar')).toBeInTheDocument();
  });

  it('with the flag, the preview takes over /parent/*', async () => {
    localStorage.setItem('everthere.devPreview', 'parent');
    at('/parent/avatar');
    expect(await screen.findByText('preview parent demo=false')).toBeInTheDocument();
  });

  it('the flag does not affect other paths', async () => {
    localStorage.setItem('everthere.devPreview', 'demo');
    at('/');
    expect(await screen.findByText('gate home')).toBeInTheDocument();
  });
});
