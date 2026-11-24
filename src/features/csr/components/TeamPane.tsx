import { useEffect, useRef, useState } from 'react';
import { instantOf, isValidZone, offsetLabel } from '../model/time.ts';
import type { Band, Line, Operator, Rating } from '../model/types.ts';

const RATINGS: Rating[] = ['strong', 'normal', 'weak', 'never'];
const RATING_LABEL: Record<Rating, string> = { strong: 'Strong', normal: 'Normal', weak: 'Weak', never: 'Never' };
const LINES: [Line, string][] = [['voice', 'Voice (v)'], ['nonvoice', 'Non-voice (n/v+v)']];
const BANDS: [Band, string][] = [['early', 'Early · 6-2.30'], ['day', 'Day · 8-4.30, 9.30-6'], ['late', 'Late · 11.30-8, 2-8']];

// Generic zones only: a fixed offset, or a region where clocks change. Etc/GMT signs are inverted by definition.
const ZONES: { value: string; label: string }[] = [
  ...Array.from({ length: 27 }, (_, index) => index - 12).map(offset => ({ value: offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`, label: `UTC${offset < 0 ? '−' : '+'}${Math.abs(offset)} all year` })),
  { value: 'WET', label: 'Western Europe (WET/WEST)' }, { value: 'CET', label: 'Central Europe (CET/CEST)' }, { value: 'EET', label: 'Eastern Europe (EET/EEST)' },
  { value: 'America/New_York', label: 'US Eastern' }, { value: 'America/Chicago', label: 'US Central' }, { value: 'America/Denver', label: 'US Mountain' }, { value: 'America/Los_Angeles', label: 'US Pacific' },
].filter(zone => isValidZone(zone.value));

interface TeamPaneProps {
  operators: Operator[];
  weekStart: string;
  notice: { tone: 'ok' | 'error'; text: string } | null;
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

function OperatorCard({ operator, weekStart, canRemove, onUpdate, onRemove }: { operator: Operator; weekStart: string; canRemove: boolean; onUpdate: (patch: Partial<Operator>) => void; onRemove: () => void }) {
  const [nick, setNick] = useState(operator.nick);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { setNick(operator.nick); }, [operator.nick]);
  const offset = operator.timeZone ? offsetLabel(operator.timeZone, instantOf(weekStart, 12 * 60)) : 'zone not set';
  const marks = [...LINES.map(([line, label]) => [operator.lines[line], label.split(' ')[0].toLowerCase()] as const), ...BANDS.map(([band]) => [operator.bands[band], band] as const)].filter(([rating]) => rating !== 'normal');
  const zones = operator.timeZone && !ZONES.some(zone => zone.value === operator.timeZone) ? [...ZONES, { value: operator.timeZone, label: operator.timeZone }] : ZONES;
  return (
    <details className="csr-operator">
      <summary>
        <strong>{operator.nick}</strong>
        <small>{offset} · {operator.shiftsPerWeek} shifts/week{operator.shortShifts ? ` · up to ${operator.shortShifts}× 2-8` : ''}</small>
        <span className="csr-marks">{marks.length ? marks.map(([rating, label]) => <i key={label} data-rating={rating}>{label} {RATING_LABEL[rating].toLowerCase()}</i>) : <i data-rating="normal">no strong or weak sides set</i>}</span>
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
          <Count id={`short-${operator.id}`} label="6-hour 2-8 shifts, up to" value={operator.shortShifts} onChange={shortShifts => onUpdate({ shortShifts })} />
        </div>
        <p className="ws-kicker csr-group">Shift type</p>
        <div className="csr-field-row">
          {LINES.map(([line, label]) => (
            <label className="csr-field" key={line} htmlFor={`${line}-${operator.id}`}><span>{label}</span>
              <select id={`${line}-${operator.id}`} value={operator.lines[line]} data-rating={operator.lines[line]} onChange={event => onUpdate({ lines: { ...operator.lines, [line]: event.target.value as Rating } })}>
                {RATINGS.map(rating => <option key={rating} value={rating}>{RATING_LABEL[rating]}</option>)}
              </select>
            </label>
          ))}
        </div>
        <p className="ws-kicker csr-group">Time of the shift</p>
        <div className="csr-field-row csr-field-row-3">
          {BANDS.map(([band, label]) => (
            <label className="csr-field" key={band} htmlFor={`${band}-${operator.id}`}><span>{label}</span>
              <select id={`${band}-${operator.id}`} value={operator.bands[band]} data-rating={operator.bands[band]} onChange={event => onUpdate({ bands: { ...operator.bands, [band]: event.target.value as Rating } })}>
                {RATINGS.map(rating => <option key={rating} value={rating}>{RATING_LABEL[rating]}</option>)}
              </select>
            </label>
          ))}
        </div>
        {canRemove && (confirmRemove
          ? <p className="csr-confirm">Remove {operator.nick} from the team and from every saved week? <button type="button" className="ws-text-button ws-red" onClick={onRemove}>Remove</button> <button type="button" className="ws-text-button" onClick={() => setConfirmRemove(false)}>Keep</button></p>
          : <button type="button" className="ws-text-button csr-remove" onClick={() => setConfirmRemove(true)}>Remove operator</button>)}
      </div>
    </details>
  );
}

export default function TeamPane({ operators, weekStart, notice, onUpdate, onAdd, onRemove, onExport, onImport }: TeamPaneProps) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="ws-pane-heading"><span className="ws-kicker ws-green">01 // TEAM</span><div><h2 id="team-heading">Operators and their sides</h2><span className="ws-version">{operators.length}</span></div></div>
      <div className="ws-pane-scroll">
        <div className="ws-source-controls">
          <div className="ws-source-actions">
            <button type="button" onClick={onExport}>SAVE TO FILE ↓</button>
            <button type="button" onClick={() => file.current?.click()}>LOAD FROM FILE ↑</button>
            <button type="button" onClick={onAdd}>ADD OPERATOR +</button>
          </div>
          <input ref={file} type="file" accept="application/json,.json" className="ws-sr-only" tabIndex={-1} aria-label="Load team and weeks from a file"
            onChange={event => { const picked = event.target.files?.[0]; if (picked) onImport(picked); event.target.value = ''; }} />
          {notice && <p className={notice.tone === 'error' ? 'ws-notice' : 'ws-transfer-status'} role="status">{notice.text}</p>}
        </div>
        <p className="ws-note csr-pane-note">Strong sides are preferred, weak ones avoided, and “Never” is a ban. Everything here stays in this browser; pass it to a colleague with “Save to file”.</p>
        <div className="csr-team">
          {operators.map(operator => <OperatorCard key={operator.id} operator={operator} weekStart={weekStart} canRemove={operators.length > 1} onUpdate={patch => onUpdate(operator.id, patch)} onRemove={() => onRemove(operator.id)} />)}
        </div>
      </div>
    </>
  );
}
