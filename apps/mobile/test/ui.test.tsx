import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Illustration,
  Segmented,
  Sheet,
  sheetStack,
  toast,
  Toaster,
  Field,
  Screen,
  TabBar,
  Badge,
  Avatar,
  Skeleton,
} from '../src/ui';
import { toastStore } from '../src/ui/toast';
import { alt } from '../src/assets/alt';
import { img } from '../src/assets/manifest';
import { colors, contrast } from '../src/theme/tokens';

describe('Button', () => {
  it('a loading Button is disabled and aria-busy', () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole('button', { name: /save/i });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });

  it('fires onClick when idle and not when loading', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} loading>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: /go/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState', () => {
  it("renders the asset's alt text, title, body and the action", () => {
    render(
      <EmptyState
        asset="empty.noSessions"
        title="No chats yet"
        body="Once Mia talks to your avatar it shows up here."
        action={<Button>Set up avatar</Button>}
      />,
    );
    expect(screen.getByAltText(alt['empty.noSessions'])).toBeInTheDocument();
    expect(screen.getByText('No chats yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up avatar' })).toBeInTheDocument();
  });

  it('accepts a {label,onClick} action', async () => {
    const onClick = vi.fn();
    render(<EmptyState asset="empty.noChildren" title="t" action={{ label: 'Add a child', onClick }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a child' }));
    expect(onClick).toHaveBeenCalled();
  });

  it('ErrorState offers a retry and never shows raw error text', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('Segmented', () => {
  it('calls onChange with the value', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        aria-label="Tone"
        value="calm"
        onChange={onChange}
        options={[
          { value: 'calm', label: 'Calm' },
          { value: 'playful', label: 'Playful' },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Playful' }));
    expect(onChange).toHaveBeenCalledWith('playful');
    expect(screen.getByRole('radio', { name: 'Calm' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Chip', () => {
  it('onRemove calls back and the remove control has an accessible label', async () => {
    const onRemove = vi.fn();
    render(<Chip onRemove={onRemove}>Bunny</Chip>);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bunny' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('is a toggle when selected is provided with onClick', async () => {
    const onClick = vi.fn();
    render(<Chip selected onClick={onClick}>Dinos</Chip>);
    const b = screen.getByRole('button', { name: 'Dinos' });
    expect(b).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Sheet', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <Sheet
        open={open}
        title="Add a favorite"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <button>Inside</button>
      </Sheet>
    );
  }

  it('closes on Escape and is registered in the sheet stack while open', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Add a favorite' })).toBeInTheDocument();
    expect(sheetStack.size()).toBe(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(sheetStack.size()).toBe(0);
  });

  it('closeTop() (Android back) closes the top sheet and reports it handled', () => {
    const onClose = vi.fn();
    render(<Sheet open title="Hi" onClose={onClose}>x</Sheet>);
    expect(sheetStack.closeTop()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeTop() returns false when nothing is open', () => {
    expect(sheetStack.closeTop()).toBe(false);
  });

  it('moves focus into the dialog and traps Tab', async () => {
    render(
      <Sheet open title="Trap" onClose={() => {}}>
        <button>One</button>
        <button>Two</button>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    screen.getByRole('button', { name: 'Two' }).focus();
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  // Device test P-1: with 3-button navigation the profile sheet's "Sign out" sat half under the nav bar, because a
  // sheet that keeps its buttons in the body had no bottom safe-area padding (only the footer had it).
  // Fix round 1: the footer slot itself carries the inset, whether or not anything renders in it (CSS :empty), so a
  // footer component that renders null can't drop it, and the inset is never added twice.
  const sheetCss = () => readFileSync(resolve(__dirname, '../src/theme/global.css'), 'utf8').replace(/\r\n/g, '\n');
  const ruleOf = (css: string, sel: string) => {
    const at = css.indexOf(`${sel} {`);
    expect(at, sel).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it('every sheet ends in the footer slot, which carries the bottom inset; the body keeps the normal spacing', () => {
    render(
      <Sheet open title="Your profile" onClose={() => {}}>
        <button>Sign out</button>
      </Sheet>,
    );
    const body = screen.getByRole('button', { name: 'Sign out' }).parentElement!;
    expect(body).toHaveClass('pb-4');
    const slot = body.nextElementSibling!;
    expect(slot).toHaveClass('sheet-footer');
    expect(slot).toBeEmptyDOMElement();
    expect(slot).not.toHaveClass('empty:hidden');
  });

  it('a footer component that renders null still leaves the inset (the slot is :empty, not removed)', () => {
    const Nothing = () => null;
    render(
      <Sheet open title="Edit" onClose={() => {}} footer={<Nothing />}>
        <p>fields</p>
      </Sheet>,
    );
    const slot = screen.getByText('fields').parentElement!.nextElementSibling!;
    expect(slot).toHaveClass('sheet-footer');
    expect(slot).toBeEmptyDOMElement();
    expect(ruleOf(sheetCss(), '.sheet-footer:empty')).toMatch(/padding-bottom:\s*var\(--et-safe-bottom\)/);
  });

  it('a real footer gets the inset or 16px, whichever is larger', () => {
    render(
      <Sheet open title="Edit" onClose={() => {}} footer={<button>Save</button>}>
        <p>fields</p>
      </Sheet>,
    );
    expect(screen.getByRole('button', { name: 'Save' }).parentElement).toHaveClass('sheet-footer');
    expect(ruleOf(sheetCss(), '.sheet-footer')).toMatch(/padding-bottom:\s*max\(var\(--et-safe-bottom\), 16px\)/);
  });
});

// Fix round 1: one source for the safe-area insets. Capacitor 8's SystemBars either passes the insets through to the
// WebView (WebView >= 140: env() and its injected --safe-area-inset-* agree) or pads the window itself and reports 0
// (older WebViews). `--et-safe-*` is the larger of the two, defined once in global.css; nothing else reads env().
describe('safe-area insets', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
  const css = readFileSync(resolve(__dirname, '../src/theme/global.css'), 'utf8').replace(/\r\n/g, '\n');

  it('defines --et-safe-{top,right,bottom,left} once, from env() and the inset Capacitor injects', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain(`--et-safe-${side}: max(env(safe-area-inset-${side}, 0px), var(--safe-area-inset-${side}, 0px));`);
    }
  });

  it('nothing else reads env(safe-area-inset-*) directly', () => {
    const src = resolve(__dirname, '../src');
    const offenders = walk(src)
      .filter((f) => /\.(tsx?|css)$/.test(f))
      .flatMap((f) => {
        const text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
        return text
          .split('\n')
          .filter((l) => l.includes('env(safe-area-inset') && !/^\s*--et-safe-(top|right|bottom|left): max\(env\(/.test(l) && !/^\s*(\*|\/\/|\/\*)/.test(l))
          .map((l) => `${f}: ${l.trim()}`);
      });
    expect(offenders).toEqual([]);
  });

  it('the controls dock, sticky footers, the tab bar and the safe utilities all use --et-safe-*', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, '../src', p), 'utf8');
    expect(read('live/LiveSession.tsx')).toContain('pb-[max(var(--et-safe-bottom),12px)]');
    expect(read('ui/Screen.tsx')).toContain('pb-[max(var(--et-safe-bottom),16px)]');
    expect(read('ui/TabBar.tsx')).toContain('pb-[max(var(--et-safe-bottom),6px)]');
    expect(css).toMatch(/\.pb-safe \{ padding-bottom: var\(--et-safe-bottom\); \}/);
    expect(css).toMatch(/\.pt-safe \{ padding-top: var\(--et-safe-top\); \}/);
  });
});

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stacks at most 3 (oldest dropped)', () => {
    render(<Toaster />);
    act(() => {
      toast.info('one');
      toast.success('two');
      toast.error('three');
      toast.info('four');
    });
    expect(screen.queryByText('one')).toBeNull();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.getByText('three')).toBeInTheDocument();
    expect(screen.getByText('four')).toBeInTheDocument();
  });

  it('a toast can carry its own icon instead of the kind icon (task 26c round 2: "🎵 Singing…" without 💡)', () => {
    render(<Toaster />);
    act(() => {
      toast.info('Singing "Twinkle"', { icon: '🎵' });
      toast.info('Plain info');
    });
    const [song, plain] = toastStore.getSnapshot();
    expect(song).toMatchObject({ kind: 'info', message: 'Singing "Twinkle"', icon: '🎵' });
    const songRow = screen.getByText('Singing "Twinkle"').parentElement!;
    expect(songRow).toHaveTextContent('🎵');
    expect(songRow).not.toHaveTextContent('💡');
    expect(plain!.icon).toBeUndefined();
    expect(screen.getByText('Plain info').parentElement!).toHaveTextContent('💡');
  });

  it('auto-dismisses after 3.5s and sits in a polite live region', async () => {
    render(<Toaster />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    act(() => {
      toast.success('Saved!');
    });
    expect(screen.getByText('Saved!')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3400);
    });
    expect(toastStore.getSnapshot()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(toastStore.getSnapshot()).toHaveLength(0);
    // the exit animation needs real frames
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByText('Saved!')).toBeNull());
  });
});

describe('Illustration', () => {
  it('sets explicit width/height, lazy loading and a density srcset', () => {
    render(<Illustration asset="empty.noChildren" size={160} />);
    const el = screen.getByAltText(alt['empty.noChildren']);
    expect(el).toHaveAttribute('width', '160');
    expect(el).toHaveAttribute('height', '160');
    expect(el).toHaveAttribute('loading', 'lazy');
    expect(el.getAttribute('srcset')).toMatch(/1x.*2x.*3x/);
  });

  it('eager when priority, and decorative stickers are hidden from AT', () => {
    const { container } = render(
      <>
        <Illustration asset="onboarding.hero" size={300} priority />
        <Illustration asset="sticker.stars" size={48} />
      </>,
    );
    const imgs = container.querySelectorAll('img');
    expect(imgs[0]).toHaveAttribute('loading', 'eager');
    expect(imgs[0]).toHaveAttribute('height', String(Math.round((300 * 800) / 1400)));
    expect(imgs[1]).toHaveAttribute('alt', '');
    expect(imgs[1]).toHaveAttribute('aria-hidden', 'true');
  });

  it('alt map covers every manifest key with friendly text (no raw keys)', () => {
    for (const key of Object.keys(img)) {
      expect(alt).toHaveProperty([key]);
      expect(alt[key as keyof typeof alt]).not.toMatch(/\./);
    }
  });
});

describe('Field', () => {
  it('links label, hint and error to the input', () => {
    render(<Field label="Child's name" hint="First name is fine" error="We need a name" defaultValue="" />);
    const input = screen.getByLabelText("Child's name");
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('We need a name');
  });
});

describe('Screen & TabBar', () => {
  it('renders a title, back button and footer', async () => {
    const onBack = vi.fn();
    render(
      <Screen title="Comfort plan" back={onBack} footer={<Button>Save</Button>}>
        <p>Body</p>
      </Screen>,
    );
    expect(screen.getByRole('heading', { name: 'Comfort plan' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('TabBar marks the current tab and reports changes', async () => {
    const onChange = vi.fn();
    render(
      <TabBar
        value="home"
        onChange={onChange}
        items={[
          { key: 'home', label: 'Home', icon: '🏠' },
          { key: 'sessions', label: 'Sessions', icon: '💬', badge: 2 },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /home/i })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: /sessions/i }));
    expect(onChange).toHaveBeenCalledWith('sessions');
  });

  it('TabBar labels stay on one line at large system text (ellipsis at the tab edge, task 26c)', () => {
    render(<TabBar value="home" onChange={() => {}} items={[{ key: 'home', label: 'Caregivers', icon: '👥' }]} />);
    const label = screen.getByText('Caregivers');
    expect(label).toHaveClass('truncate', 'max-w-full', 'block');
    expect(screen.getByRole('button', { name: 'Caregivers' })).toHaveAttribute('title', 'Caregivers');
  });
});

describe('small pieces', () => {
  it('Badge, Avatar and Skeleton render', () => {
    render(
      <>
        <Badge tone="mint">Mom ready</Badge>
        <Avatar emoji="👧🏼" name="Mia" />
        <Skeleton shape="card" />
      </>,
    );
    expect(screen.getByText('Mom ready')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Mia' })).toBeInTheDocument();
  });
});

describe('theme tokens', () => {
  it('body text meets WCAG AA (4.5:1) on cream', () => {
    expect(contrast(colors.ink, colors.cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.mutedText, colors.cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.danger, colors.cream)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.mintInk, colors.mint)).toBeGreaterThanOrEqual(4.5);
  });
  it('button label ink on every button fill meets AA', () => {
    for (const fill of [colors.sun, colors.coral, colors.white, colors.mint, colors.sky]) {
      expect(contrast(colors.ink, fill)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('touch targets (>= 44px)', () => {
  const ok = /(min-h-touch|min-h-\[(4[4-9]|[5-9]\d)px\]|\bh-11\b|before:h-11)/;

  it('Chip main and remove controls carry a centred 44px-tall hit area', () => {
    render(<Chip onClick={() => {}} onRemove={() => {}}>Bunny</Chip>);
    for (const name of ['Bunny', 'Remove Bunny']) {
      const cls = screen.getByRole('button', { name }).className;
      expect(cls).toContain('before:absolute');
      expect(cls).toContain('before:h-11');
    }
  });

  it('chip hit areas cannot overlap: each is only as wide as its own button, and remove is a real 44px box', () => {
    render(<Chip onClick={() => {}} onRemove={() => {}}>A</Chip>);
    const label = screen.getByRole('button', { name: 'A' }).className;
    const remove = screen.getByRole('button', { name: 'Remove A' }).className;
    for (const cls of [label, remove]) {
      expect(cls).toContain('before:w-full'); // never wider than its button
      expect(cls).toContain('before:left-0'); // anchored to the button, no sideways overhang
      expect(cls).not.toMatch(/before:-(inset-x|left|right|translate-x)/);
      expect(cls).not.toContain('before:min-w-11'); // would overhang a short label into the remove button
    }
    expect(remove).toMatch(/(^| )w-11( |$)/);
    expect(remove).not.toMatch(/(^| )w-6( |$)/);
  });

  it('a lone interactive chip may widen its hit area to 44px (nothing next to it to overlap)', () => {
    render(<Chip onClick={() => {}}>A</Chip>);
    expect(screen.getByRole('button', { name: 'A' }).className).toContain('before:min-w-11');
  });

  it('gallery chip rows keep >= 6px horizontal and >= 10px vertical gaps', () => {
    const src = readFileSync(resolve(__dirname, '../src/features/dev/Gallery.tsx'), 'utf8');
    expect(src).not.toMatch(/flex flex-wrap gap-2b/);
    expect(src).toContain('gap-x-2 gap-y-3');
  });

  it('every other interactive control has a 44px minimum', () => {
    const { container } = render(
      <>
        <Button size="sm">Small</Button>
        <Segmented value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />
        <TabBar value="a" onChange={() => {}} items={[{ key: 'a', label: 'A', icon: 'x' }]} />
        <Screen title="T" back={() => {}}>x</Screen>
        <Sheet open title="S" onClose={() => {}}>x</Sheet>
      </>,
    );
    const buttons = [...container.querySelectorAll('button'), ...document.querySelectorAll('[role=dialog] button')];
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const b of buttons) expect(b.className, b.outerHTML).toMatch(ok);
  });
});

describe('no hard-coded palette hex outside tokens.ts', () => {
  it('src/ui, motion.ts and global.css contain no hex colours', () => {
    const root = resolve(__dirname, '../src');
    const files = [
      ...readdirSync(join(root, 'ui')).map((f) => join(root, 'ui', f)),
      join(root, 'theme/motion.ts'),
      join(root, 'theme/global.css'),
    ];
    const offenders = files.filter((f) => /#[0-9A-Fa-f]{3,8}\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('Sheet focus management and page lock', () => {
  it('returns focus to the trigger on close and releases the page lock', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open it</button>
          <Sheet open={open} title="Hello" onClose={() => setOpen(false)}>
            <button>Inside</button>
          </Sheet>
        </>
      );
    }
    render(<Host />, { container: root });
    const trigger = screen.getByRole('button', { name: 'Open it' });
    trigger.focus();
    await userEvent.click(trigger);
    expect(root).toHaveAttribute('inert');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {});
    expect(trigger).toHaveFocus();
    expect(root).not.toHaveAttribute('inert');
    expect(root).not.toHaveAttribute('aria-hidden');
    expect(document.body.style.overflow).toBe('');
    root.remove();
  });

  it('pulls focus back in when it escapes, and Tab from outside enters the panel', async () => {
    render(
      <>
        <button>Outside</button>
        <Sheet open title="Trap" onClose={() => {}}>
          <button>One</button>
          <button>Two</button>
        </Sheet>
      </>,
    );
    const dialog = screen.getByRole('dialog');
    screen.getByRole('button', { name: 'Outside' }).focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('stacked sheets keep the lock until the last one closes', async () => {
    function Two({ a, b }: { a: boolean; b: boolean }) {
      return (
        <>
          <Sheet open={a} title="A" onClose={() => {}}>a</Sheet>
          <Sheet open={b} title="B" onClose={() => {}}>b</Sheet>
        </>
      );
    }
    const { rerender } = render(<Two a b />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Two a b={false} />);
    await act(async () => {});
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Two a={false} b={false} />);
    await act(async () => {});
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Skeleton and Segmented fallbacks', () => {
  it('Skeleton is aria-busy with an sr-only Loading label', () => {
    const { container } = render(<Skeleton shape="line" count={2} />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.getByText('Loading')).toHaveClass('sr-only');
  });

  it('Segmented keeps one tab stop on the first option when value matches nothing', () => {
    render(
      <Segmented value={'zzz' as string} onChange={() => {}} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />,
    );
    const stops = screen.getAllByRole('radio').filter((r) => r.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent('A');
  });
});
