import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearSelectedChild } from '../src/lib/selectedChild';

afterEach(() => {
  cleanup();
  clearSelectedChild();
});

// jsdom lacks matchMedia (framer-motion reads prefers-reduced-motion through it).
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
