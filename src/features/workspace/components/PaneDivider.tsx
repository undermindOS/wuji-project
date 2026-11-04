import { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export type PanelWidths = [number, number, number];
const MIN_WIDTH = 22;

interface PaneDividerProps {
  index: 0 | 1;
  widths: PanelWidths;
  setWidths: Dispatch<SetStateAction<PanelWidths>>;
}

export default function PaneDivider({ index, widths, setWidths }: PaneDividerProps) {
  const drag = useRef<{ x: number; widths: PanelWidths; width: number } | null>(null);
  const update = (original: PanelWidths, delta: number) => {
    const next: PanelWidths = [...original];
    const boundedDelta = Math.max(MIN_WIDTH - original[index], Math.min(original[index + 1] - MIN_WIDTH, delta));
    next[index] += boundedDelta;
    next[index + 1] -= boundedDelta;
    setWidths(next);
  };
  return (
    <div
      className="ws-divider" role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={index === 0 ? 'Ширина исходника и задачи' : 'Ширина задачи и сценария'}
      aria-controls={index === 0 ? 'workspace-source workspace-task' : 'workspace-task workspace-scenario'}
      aria-valuenow={Math.round(widths[index])} aria-valuemin={MIN_WIDTH} aria-valuemax={Math.round(widths[index] + widths[index + 1] - MIN_WIDTH)}
      aria-valuetext={`${Math.round(widths[index])}% ширины; стрелки изменяют размер, Home восстанавливает пропорции`}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); update(widths, event.key === 'ArrowRight' ? 2 : -2);
        } else if (event.key === 'Home') { event.preventDefault(); setWidths([35, 30, 35]); }
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const parent = event.currentTarget.parentElement;
        if (!parent) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, widths: [...widths], width: parent.clientWidth - 18 };
      }}
      onPointerMove={event => {
        if (drag.current) update(drag.current.widths, (event.clientX - drag.current.x) / drag.current.width * 100);
      }}
      onPointerUp={event => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
    ><span aria-hidden="true">⋮</span></div>
  );
}
