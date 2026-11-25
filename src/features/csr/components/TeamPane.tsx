import { useEffect, useRef, useState } from 'react';
import { instantOf, isValidZone, offsetLabel, weekRange } from '../model/time.ts';
import type { Band, Line, Operator, Rating, Wish } from '../model/types.ts';
import { whenLabel, wishLines } from '../model/wishes.ts';

const RATINGS: Rating[] = ['strong', 'normal', 'weak', 'never'];
const RATING_LABEL: Record<Rating, string> = { strong: 'Strong', normal: 'Normal', weak: 'Weak', never: 'Never' };
const LINES: [Line, string, string][] = [['voice', 'Voice', 'voice'], ['nonvoice', 'Non-voice', 'non-voice']];
const BANDS: [Band, string, string][] = [['early', 'Early', 'early shifts'], ['day', 'Day', 'day shifts'], ['late', 'Late', 'late shifts']];

// Generic zones only: a fixed offset, or a region where clocks change. Etc/GMT signs are inverted by definition.
const ZONES: { value: string; label: string }[] = [
  ...Array.from({ length: 27 }, (_, index) => index - 12).map(offset => ({ value: offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`, label: `UTC${offset < 0 ? '−' : '+'}${Math.abs(offset)} all year` })),
  { value: 'WET', label: 'Western Europe (clocks change)' }, { value: 'CET', label: 'Central Europe (clocks change)' }, { value: 'EET', label: 'Eastern Europe (clocks change)' },
  { value: 'America/New_York', label: 'US Eastern' }, { value: 'America/Chicago', label: 'US Central' }, { value: 'America/Denver', label: 'US Mountain' }, { value: 'America/Los_Angeles', label: 'US Pacific' },
].filter(zone => isValidZone(zone.value));

interface TeamPaneProps {
  operators: Operator[];
  weekStart: string;
  notice: { tone: 'ok' | 'error'; text: string } | null;
  /** Wishes sent through wish links, for every operator. */
  wishes: Wish[];
  onRemoveWish: (id: string) => void;
  onOpenWishes: () => void;
  onUpdate: (id: string, patch: Partial<Operator>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

function Count({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="csr-field" htmlFor={id}><span>{label}</span>
      <input id={id} type="number" inputMode="numeric" min={0} max={7} value={value} onChange={event => { const next = Number(event.target.value); if (event.target.value !== '' && Number.isInteger(next) && next >= 0 && next <= 7) onChange(next); }} />
    </label>
  );
}

function RatingSelect({ id, label, value, onChange }: { id: string; label: string; value: Rating; onChange: (value: Rating) => void }) {
  return (
    <label className="csr-field" htmlFor={id}><span>{label}</span>
      <select id={id} value={value} data-rating={value} onChange={event => onChange(event.target.value as Rating)}>
        {RATINGS.map(rating => <option key={rating} value={rating}>{RATING_LABEL[rating]}</option>)}
      </select>
    </label>
  );
}

function OperatorCard({ operator, weekStart, canRemove, wishes, onRemoveWish, onUpdate, onRemove }: { operator: Operator; weekStart: string; canRemove: boolean; wishes: Wish[]; onRemoveWish: (id: string) => void; onUpdate: (patch: Partial<Operator>) => void; onRemove: () => void }) {
  const [nick, setNick] = useState(operator.nick);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { setNick(operator.nick); }, [operator.nick]);
  const offset = operator.timeZone ? offsetLabel(operator.timeZone, instantOf(weekStart, 12 * 60)) : 'time zone not set';
  const marks = [...LINES.map(([line, , subject]) => [operator.lines[line], subject] as const), ...BANDS.map(([band, , subject]) => [operator.bands[band], subject] as const)].filter(([rating]) => rating !== 'normal');
  const zones = operator.timeZone && !ZONES.some(zone => zone.value === operator.timeZone) ? [...ZONES, { value: operator.timeZone, label: operator.timeZone }] : ZONES;
  return (
    <details className="csr-operator">
      <summary>
        <strong>{operator.nick}</strong>
        <small>{offset} · {operator.shiftsPerWeek} shifts a week{operator.shortShifts ? ` · up to ${operator.shortShifts} short` : ''}</small>
        <span className="csr-marks">{marks.length ? marks.map(([rating, subject]) => <i key={subject} data-rating={rating}>{RATING_LABEL[rating]}: {subject}</i>) : <i data-rating="normal">No strong or weak sides set</i>}{wishes.length > 0 && <i data-rating="wish">{wishes.length} wish{wishes.length === 1 ? '' : 'es'}</i>}</span>
      </summary>
      <div className="csr-operator-body">
        <div className="csr-field-row">
          <label className="csr-field" htmlFor={`nick-${operator.id}`}><span>Work nickname</span>
            <input id={`nick-${operator.id}`} type="text" maxLength={40} value={nick} onChange={event => setNick(event.target.value)}
              onBlur={() => { const next = nick.trim(); if (next && next !== operator.nick) onUpdate({ nick: next }); else setNick(operator.nick); }} />
          </label>
          <label className="csr-field" htmlFor={`zone-${operator.id}`}><span>Time zone</span>
            <select id={`zone-${operator.id}`} value={operator.timeZone ?? ''} onChange={event => onUpdate({ timeZone: event.target.value || null })}>
              <option value="">Not set</option>
              {zones.map(zone => <option key={zone.value} value={zone.value}>{zone.label}</option>)}
            </select>
          </label>
        </div>
        <div className="csr-field-row">
          <Count id={`norm-${operator.id}`} label="Shifts per week" value={operator.shiftsPerWeek} onChange={shiftsPerWeek => onUpdate({ shiftsPerWeek })} />
          <Count id={`short-${operator.id}`} label="Short 2-8 shifts, up to" value={operator.shortShifts} onChange={shortShifts => onUpdate({ shortShifts })} />
        </div>
        <p className="csr-group">Shift type</p>
        <div className="csr-field-row">
          {LINES.map(([line, label]) => <RatingSelect key={line} id={`${line}-${operator.id}`} label={label} value={operator.lines[line]} onChange={rating => onUpdate({ lines: { ...operator.lines, [line]: rating } })} />)}
        </div>
        <p className="csr-group">Time of the shift</p>
        <div className="csr-field-row csr-field-row-3">
          {BANDS.map(([band, label]) => <RatingSelect key={band} id={`${band}-${operator.id}`} label={label} value={operator.bands[band]} onChange={rating => onUpdate({ bands: { ...operator.bands, [band]: rating } })} />)}
        </div>
        <p className="csr-hint">Early is 6-2.30. Day is 8-4.30 and 9.30-6. Late is 11.30-8 and the short 2-8.</p>
        <p className="csr-group">Wishes</p>
        {wishes.length ? (
          <ul className="csr-wish-list">
            {wishes.map(wish => (
              <li key={wish.id}>
                <strong>Week of {weekRange(wish.weekStart)}</strong>
                {wishLines(wish).map(line => <p key={line}>{line}</p>)}
                <small>{whenLabel(wish.createdAt)} · <button type="button" className="ws-text-button" onClick={() => onRemoveWish(wish.id)}>Remove</button></small>
              </li>
            ))}
          </ul>
        ) : <p className="csr-hint">{operator.nick} has sent no wishes.</p>}
        {canRemove && (confirmRemove
          ? <p className="csr-confirm">Remove {operator.nick} from the team and from every saved week? <button type="button" className="ws-text-button ws-red" onClick={onRemove}>Remove</button> <button type="button" className="ws-text-button" onClick={() => setConfirmRemove(false)}>Keep</button></p>
          : <button type="button" className="ws-text-button csr-remove" onClick={() => setConfirmRemove(true)}>Remove operator</button>)}
      </div>
    </details>
  );
}

export default function TeamPane({ operators, weekStart, notice, wishes, onRemoveWish, onOpenWishes, onUpdate, onAdd, onRemove, onExport, onImport }: TeamPaneProps) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="csr-actions">
        <button type="button" onClick={onExport}>Save to file ↓</button>
        <button type="button" onClick={() => file.current?.click()}>Load from file ↑</button>
        <button type="button" onClick={onAdd}>Add operator +</button>
        <button type="button" onClick={onOpenWishes}>Wish link and wishes</button>
      </div>
      <input ref={file} type="file" accept="application/json,.json" className="ws-sr-only" tabIndex={-1} aria-label="Load team and weeks from a file"
        onChange={event => { const picked = event.target.files?.[0]; if (picked) onImport(picked); event.target.value = ''; }} />
      {notice && <p className={notice.tone === 'error' ? 'ws-notice csr-pane-notice' : 'csr-pane-status'} role="status">{notice.text}</p>}
      <p className="csr-hint csr-pane-hint">Open an operator to edit. Strong sides are preferred, weak ones avoided, and “Never” is a ban.</p>
      <div className="csr-team">
        {operators.map(operator => <OperatorCard key={operator.id} operator={operator} weekStart={weekStart} canRemove={operators.length > 1} wishes={wishes.filter(wish => wish.operatorId === operator.id)} onRemoveWish={onRemoveWish} onUpdate={patch => onUpdate(operator.id, patch)} onRemove={() => onRemove(operator.id)} />)}
      </div>
    </>
  );
}
