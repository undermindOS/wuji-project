import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isShift } from '../model/check.ts';
import { TEMPLATES } from '../model/defaults.ts';
import type { Cell, Request, ShiftKind } from '../model/types.ts';

interface CellMenuProps {
  /** Where the clicked cell is on screen. */
  anchor: DOMRect;
  title: string;
  cell: Cell | undefined;
  pinned: boolean;
  onPick: (request: Request) => void;
  onClose: () => void;
}

/** The menu that opens on a cell: every value the cell can take, one click each. */
export default function CellMenu({ anchor, title, cell, pinned, onPick, onClose }: CellMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: anchor.left, top: anchor.bottom + 6 });
  useLayoutEffect(() => {
    const box = menu.current!.getBoundingClientRect();
    // Under the cell when it fits, above it when it does not, and never off the screen either way.
    const below = anchor.bottom + 6, above = anchor.top - box.height - 6;
    const wanted = below + box.height <= window.innerHeight - 8 || above < 8 ? below : above;
    setPlace({
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(wanted, window.innerHeight - box.height - 8)),
    });
    (menu.current!.querySelector<HTMLButtonElement>('[data-current="true"]') ?? menu.current!.querySelector<HTMLButtonElement>('button'))?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    // The menu is pinned to the screen, so it closes rather than drift when the schedule scrolls under it.
    const scrolled = (event: Event) => { if (!menu.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); window.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  const is = (templateId: string, kind: ShiftKind) => isShift(cell) && cell.templateId === templateId && cell.kind === kind;
  return (
    <div className="csr-menu" ref={menu} role="dialog" aria-label={`Set ${title}`} style={{ left: place.left, top: place.top }}>
      <strong>{title}</strong>
      <div className="csr-menu-pair">
        <button type="button" data-kind="off" data-current={cell === 'off' && pinned} onClick={() => onPick('off')}>Day off</button>
        <button type="button" data-kind="vacation" data-current={cell === 'vacation'} onClick={() => onPick('vacation')}>Vacation</button>
      </div>
      <div className="csr-menu-shifts">
        {TEMPLATES.map(template => (
          <div key={template.id}>
            <span>{template.label}</span>
            <button type="button" data-kind="v" data-current={is(template.id, 'v')} aria-label={`${template.label}, voice`} onClick={() => onPick({ templateId: template.id, kind: 'v' })}>Voice</button>
            <button type="button" data-kind="nv" data-current={is(template.id, 'nv')} aria-label={`${template.label}, non-voice`} onClick={() => onPick({ templateId: template.id, kind: 'nv' })}>Non-voice</button>
          </div>
        ))}
      </div>
      {pinned
        ? <button type="button" className="ws-text-button" onClick={() => onPick('auto')}>Unpin: let the solver decide this cell</button>
        : <p className="csr-hint">What you set here is pinned ▣ and kept when the week is rebuilt.</p>}
    </div>
  );
}
