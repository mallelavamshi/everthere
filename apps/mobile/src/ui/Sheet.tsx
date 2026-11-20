import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion as fm, useDragControls } from 'framer-motion';
import { motion } from '../theme/motion';
import { backdrop } from '../theme/tokens';
import { sheetStack } from './sheetStack';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  /** Sticky action row at the bottom (e.g. a Save button). */
  footer?: ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

const CLOSE_DISTANCE = 110;
const CLOSE_VELOCITY = 500;

export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const controls = useDragControls();

  // Register in the sheet stack (which locks the page), handle Esc and Tab at document level, guard focusin, restore focus on close.
  useEffect(() => {
    if (!open) return;
    // Read the trigger BEFORE registering: registering locks the page (inert root), which can move focus.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { id, unregister } = sheetStack.register(() => closeRef.current());

    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const inPanel = (n: EventTarget | null) => !!panelRef.current && n instanceof Node && panelRef.current.contains(n);

    // Document-level handlers so the trap holds even when focus has escaped the panel.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!sheetStack.isTop(id)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = focusables();
      const panel = panelRef.current;
      if (nodes.length === 0) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const firstEl = nodes[0]!;
      const lastEl = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (!inPanel(active)) {
        e.preventDefault();
        (e.shiftKey ? lastEl : firstEl).focus();
      } else if (e.shiftKey && (active === firstEl || active === panel)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!sheetStack.isTop(id) || inPanel(e.target)) return;
      (focusables()[0] ?? panelRef.current)?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      unregister();
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50" key="sheet-root">
          <fm.div
            className="absolute inset-0"
            style={{ background: backdrop }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
            data-testid="sheet-backdrop"
          />
          <fm.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            {...motion.slideUp}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > CLOSE_DISTANCE || info.velocity.y > CLOSE_VELOCITY) onClose();
            }}
            className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full [@media(max-height:699px)]:max-h-[96dvh] max-w-[640px] flex-col rounded-t-sheet border-x-[3px] border-t-[3px] border-ink bg-cream shadow-sheet outline-none"
          >
            <div
              className="shrink-0 cursor-grab touch-none select-none px-5 pb-1 pt-2.5 active:cursor-grabbing"
              onPointerDown={(e) => controls.start(e)}
            >
              <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-11 rounded-full bg-track" />
              <div className="flex items-center justify-between gap-3">
                <h2 id={titleId} className="text-[20px] font-bold leading-tight text-ink">
                  {title}
                </h2>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-[18px] text-ink hover:bg-ink/5"
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-1">{children}</div>
            {/* Always rendered: it carries the bottom inset whether or not a footer renders anything (CSS :empty), so
                the last control is never under the Android nav bar (device test P-1). */}
            <div className="sheet-footer shrink-0 px-5">{footer}</div>
          </fm.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
