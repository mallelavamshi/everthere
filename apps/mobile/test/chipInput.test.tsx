import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChipInput } from '../src/features/plan/ChipInput';

function Harness({ start = [], onValues, suggestions }: { start?: string[]; onValues?: (v: string[]) => void; suggestions?: { label: string; icon?: string }[] }) {
  const [values, setValues] = useState<string[]>(start);
  return (
    <ChipInput
      label="Nicknames"
      values={values}
      suggestions={suggestions}
      onChange={(v) => {
        setValues(v);
        onValues?.(v);
      }}
    />
  );
}
const box = () => screen.getByRole('textbox', { name: /add to nicknames/i });
const chips = () => screen.queryAllByRole('button', { name: /^Remove / }).map((b) => b.getAttribute('aria-label'));

describe('ChipInput', () => {
  it('typing "Sunshine," adds a chip', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), 'Sunshine,');
    expect(chips()).toEqual(['Remove Sunshine']);
    expect(box()).toHaveValue('');
  });

  it('Enter adds a chip and trims it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '  Mia-bear  {Enter}');
    expect(chips()).toEqual(['Remove Mia-bear']);
  });

  it('a duplicate "sunshine" is ignored (case-insensitive)', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    render(<Harness start={['Sunshine']} onValues={seen} />);
    await user.type(box(), 'sunshine{Enter}');
    expect(chips()).toEqual(['Remove Sunshine']);
    expect(seen).not.toHaveBeenCalled();
  });

  it('a blank entry is ignored', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), '   ,{Enter}');
    expect(chips()).toEqual([]);
  });

  it("a 13th chip is blocked with the hint \"That's plenty!\"", async () => {
    const user = userEvent.setup();
    render(<Harness start={Array.from({ length: 11 }, (_, i) => `c${i}`)} />);
    expect(screen.queryByText("That's plenty!")).toBeNull();
    await user.type(box(), 'twelve{Enter}');
    expect(chips()).toHaveLength(12);
    expect(screen.getByText("That's plenty!")).toBeInTheDocument();
    await user.type(box(), 'thirteen{Enter}');
    expect(chips()).toHaveLength(12);
    expect(screen.queryByRole('button', { name: 'Remove thirteen' })).toBeNull();
    expect(screen.getByText("That's plenty!")).toBeInTheDocument();
    // what was typed is kept, not silently discarded
    expect(box()).toHaveValue('thirteen');
  });

  it('announces the hint politely to screen readers', () => {
    render(<Harness start={Array.from({ length: 12 }, (_, i) => `c${i}`)} />);
    expect(screen.getByText("That's plenty!").closest('[role="status"]')).not.toBeNull();
  });

  it('chips are at most 40 characters', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(box()).toHaveAttribute('maxlength', '40');
    fireEvent.paste(box(), { clipboardData: { getData: () => 'x'.repeat(60) } });
    expect(chips()).toEqual([`Remove ${'x'.repeat(40)}`]);
    await user.click(screen.getByRole('button', { name: `Remove ${'x'.repeat(40)}` }));
    expect(chips()).toEqual([]);
  });

  it('pasting "a, b, c" adds three chips', () => {
    render(<Harness />);
    fireEvent.paste(box(), { clipboardData: { getData: () => 'a, b, c' } });
    expect(chips()).toEqual(['Remove a', 'Remove b', 'Remove c']);
  });

  it('pasting stops at the limit and skips duplicates', () => {
    render(<Harness start={['a']} />);
    fireEvent.paste(box(), { clipboardData: { getData: () => 'A, b\nc, ' + Array.from({ length: 20 }, (_, i) => `n${i}`).join(',') } });
    expect(chips()).toHaveLength(12);
    expect(screen.getByText("That's plenty!")).toBeInTheDocument();
  });

  it('removing a chip frees a slot and clears the hint', async () => {
    const user = userEvent.setup();
    render(<Harness start={Array.from({ length: 12 }, (_, i) => `c${i}`)} />);
    await user.click(screen.getByRole('button', { name: 'Remove c3' }));
    expect(chips()).toHaveLength(11);
    expect(screen.queryByText("That's plenty!")).toBeNull();
  });

  it('suggestion chips add themselves and then disappear', async () => {
    const user = userEvent.setup();
    render(<Harness suggestions={[{ label: 'Bunny', icon: '🐰' }, { label: 'Dinos' }]} />);
    await user.click(screen.getByRole('button', { name: 'Bunny' }));
    expect(chips()).toEqual(['Remove Bunny']);
    expect(screen.queryByRole('button', { name: 'Bunny' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dinos' })).toBeInTheDocument();
  });

  it('blur adds whatever is typed so nothing is lost on Save', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box(), 'Bee');
    await user.tab();
    expect(chips()).toEqual(['Remove Bee']);
  });

  it('shows a per-field error', () => {
    render(<ChipInput label="Nicknames" values={[]} onChange={() => {}} error="Too long" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Too long');
  });
});
