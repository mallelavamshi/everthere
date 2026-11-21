import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhoneFrame, phoneScale, shouldFrame } from '../src/shell/PhoneFrame';

describe('shouldFrame (the web build on a wide screen shows the app inside a phone)', () => {
  const base = { native: false, isTop: true, width: 1440, search: '' };
  it('frames a wide desktop browser', () => {
    expect(shouldFrame(base)).toBe(true);
  });
  it('never frames the Android app, even on a tablet', () => {
    expect(shouldFrame({ ...base, native: true })).toBe(false);
  });
  it('never frames a phone browser (narrower than 700px)', () => {
    expect(shouldFrame({ ...base, width: 699 })).toBe(false);
  });
  it('the app inside the frame does not frame itself again', () => {
    expect(shouldFrame({ ...base, isTop: false })).toBe(false);
  });
  it('?frame=0 opens the full-width app (the classroom-tablet layout)', () => {
    expect(shouldFrame({ ...base, search: '?frame=0' })).toBe(false);
    expect(shouldFrame({ ...base, search: '?x=1&frame=0' })).toBe(false);
  });
});

describe('phoneScale', () => {
  it('is 1 when the window is tall enough, and shrinks the phone to fit a short window', () => {
    expect(phoneScale(1200)).toBe(1);
    expect(phoneScale(700)).toBeLessThan(1);
    expect(phoneScale(700)).toBeGreaterThan(0.7);
  });
});

describe('PhoneFrame', () => {
  it('runs the real app in a phone-sized iframe that may use the microphone, on the same path', () => {
    window.history.pushState({}, '', '/parent?x=1');
    render(<PhoneFrame />);
    const frame = screen.getByTitle('EverThere app') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('/parent?x=1');
    expect(frame.getAttribute('allow')).toContain('microphone');
    expect(frame.getAttribute('allow')).toContain('autoplay');
    expect(frame.style.width).toBe('390px');
    expect(frame.style.height).toBe('844px');
  });
  it('tells judges how to try it and links the APK, the source and the full-width view', () => {
    window.history.pushState({}, '', '/');
    render(<PhoneFrame />);
    expect(screen.getByText(/Try the demo/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Android APK/ })).toHaveAttribute('href', 'https://github.com/mallelavamshi/everthere-app/releases/latest');
    expect(screen.getByRole('link', { name: /Source code/ })).toHaveAttribute('href', 'https://github.com/mallelavamshi/everthere');
    expect(screen.getByRole('link', { name: /Classroom tablet view/ })).toHaveAttribute('href', '/?frame=0');
  });
});
