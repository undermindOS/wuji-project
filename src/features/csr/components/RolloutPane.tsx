import { useState } from 'react';
import { isShift } from '../model/check.ts';
import { DAY_NAMES, SLOTS, templateById } from '../model/defaults.ts';
import { autoFill, channelLoad, nonvoiceSegments, rangeLabel, rolloutIssues, segmentHolder, shiftLabel } from '../model/rollout.ts';
import { shortDate, weekDates } from '../model/time.ts';
import type { Channel, Operator, Plan, Rollout } from '../model/types.ts';
import { copyTable, escapeHtml } from './clipboard.ts';

interface RolloutPaneProps {
  weekStart: string;
  operators: Operator[];
  plan: Plan | null;
  channels: Channel[];
  rollout: Rollout;
  onHolder: (day: number, channelId: string, slots: number[], operatorId: string | null) => void;
  onTable: (day: number, table: Record<string, (string | null)[]>) => void;
  onAddChannel: () => void;
  onRenameChannel: (id: string, name: string) => void;
  onRemoveChannel: (id: string) => void;
}

function ChannelName({ channel, canRemove, onRename, onRemove }: { channel: Channel; canRemove: boolean; onRename: (name: string) => void; onRemove: () => void }) {
  const [name, setName] = useState(channel.name);
  return (
    <div className="csr-channel-edit">
      <input type="text" maxLength={40} value={name} aria-label={`Name of the channel ${channel.name}`} onChange={event => setName(event.target.value)}
        onBlur={() => { if (name.trim() && name.trim() !== channel.name) onRename(name); else setName(channel.name); }} />
      {canRemove && <button type="button" className="ws-text-button" onClick={onRemove} aria-label={`Remove the channel ${channel.name}`}>Remove</button>}
    </div>
  );
}

/** Who holds each non-voice channel through a day, cut into stretches by the non-voice shifts of that day. */
export default function RolloutPane({ weekStart, operators, plan, channels, rollout, onHolder, onTable, onAddChannel, onRenameChannel, onRemoveChannel }: RolloutPaneProps) {
  const [day, setDay] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const dates = weekDates(weekStart);
  const nick = (id: string) => operators.find(operator => operator.id === id)?.nick ?? 'Removed operator';
  const segments = plan ? nonvoiceSegments(plan, operators, day) : [];
  const table = rollout[day] ?? {};
  const issues = rolloutIssues(segments, channels, table);
  const onNonvoice = plan ? operators.flatMap(operator => {
    const cell = plan[operator.id]?.[day];
    const template = isShift(cell) && cell.kind === 'nv' ? templateById(cell.templateId) : undefined;
    return template ? [{ operator, template }] : [];
  }).sort((a, b) => a.template.start - b.template.start) : [];
  const load = channelLoad(channels, table);

  const copy = async () => {
    const rows = [['Time', ...channels.map(channel => channel.name)], ...segments.map(segment => [rangeLabel(segment.from, segment.to),
      ...channels.map(channel => { const holder = segmentHolder(table, channel.id, segment); return holder && holder !== 'mixed' ? nick(holder) : ''; })])];
    const shifts = [['Employee', 'Shift'], ...onNonvoice.map(({ operator, template }) => [operator.nick, shiftLabel(template.start, template.end)])];
    const html = [rows, shifts].map(grid => `<table>${grid.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</table>`).join('<br>');
    const text = [rows, shifts].map(grid => grid.map(row => row.join('\t')).join('\n')).join('\n\n');
    setNote(await copyTable(html, text) ? 'Copied: the channel table and the shifts under it.' : 'The browser refused to copy.');
  };

  return (
    <div className="csr-rollout">
      <div className="ws-segmented csr-days" aria-label="Day of the week">
        {DAY_NAMES.map((name, index) => <button type="button" key={name} aria-pressed={day === index} onClick={() => { setDay(index); setNote(null); }}>{name}<small>{shortDate(dates[index])}</small></button>)}
      </div>
      {!plan ? <p className="ws-notice csr-pane-notice"><strong>There is no schedule for this week yet</strong>The channel table is cut from the non-voice shifts of the day. Build the week or fill it by hand on the “Week schedule” tab first.</p>
        : !onNonvoice.length ? <p className="ws-notice csr-pane-notice"><strong>Nobody is on a non-voice shift on {DAY_NAMES[day]}</strong>Put at least one operator on a non-voice shift that day, and the table appears.</p> : (
          <>
            <div className="csr-bar">
              <p className={issues.unassigned + issues.invalid + issues.uncovered ? 'ws-orange' : 'ws-green'} role="status">
                {issues.unassigned + issues.invalid + issues.uncovered === 0 ? `Every channel is held through the whole day: ${issues.cells} of ${issues.cells} cells.`
                  : [issues.unassigned && `${issues.unassigned} of ${issues.cells} cells have nobody yet`, issues.invalid && `${issues.invalid} name someone who is not on non-voice then`, issues.uncovered && `${issues.uncovered} stretch of the day has nobody on non-voice at all`].filter(Boolean).join('; ') + '.'}
              </p>
              <div className="csr-exports">
                <button type="button" className="ws-outline" onClick={() => { onTable(day, autoFill(segments, channels)); setNote('Filled automatically: channels are spread evenly and stay with the same person where they can. Change any cell you like.'); }}>Fill automatically</button>
                <button type="button" className="ws-outline" onClick={() => void copy()}>Copy the table</button>
                <button type="button" className="ws-outline" onClick={() => { onTable(day, Object.fromEntries(channels.map(channel => [channel.id, Array<string | null>(SLOTS).fill(null)]))); setNote(null); }}>Clear the day</button>
              </div>
            </div>
            {note && <p className="csr-pane-status" role="status">{note}</p>}
            <div className="csr-grid-wrap">
              <table className="csr-channels" aria-label={`Non-voice channels, ${DAY_NAMES[day]} ${shortDate(dates[day])}`}>
                <thead><tr><th scope="col">Time, Pacific</th>{channels.map(channel => <th scope="col" key={channel.id}>{channel.name}</th>)}</tr></thead>
                <tbody>
                  {segments.map(segment => (
                    <tr key={segment.from}>
                      <th scope="row">{rangeLabel(segment.from, segment.to)}</th>
                      {!segment.operatorIds.length ? <td colSpan={channels.length} className="ws-red">Nobody is on a non-voice shift</td> : channels.map(channel => {
                        const holder = segmentHolder(table, channel.id, segment);
                        const stray = holder !== null && holder !== 'mixed' && !segment.operatorIds.includes(holder);
                        return (
                          <td key={channel.id} data-state={holder === null ? 'empty' : holder === 'mixed' || stray ? 'invalid' : 'ok'}>
                            <select value={holder === 'mixed' ? '__mixed' : holder ?? ''} aria-label={`${channel.name}, ${rangeLabel(segment.from, segment.to)}`}
                              onChange={event => onHolder(day, channel.id, segment.slots, event.target.value || null)}>
                              <option value="">Nobody yet</option>
                              {holder === 'mixed' && <option value="__mixed" disabled>Changes within this stretch</option>}
                              {stray && <option value={holder}>{nick(holder)} (not on non-voice now)</option>}
                              {segment.operatorIds.map(id => <option key={id} value={id}>{nick(id)}</option>)}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="csr-detail">
              <section className="csr-editor" aria-label="Non-voice shifts of the day">
                <span className="ws-kicker">NON-VOICE SHIFTS · {DAY_NAMES[day]}, {shortDate(dates[day])}</span>
                <table className="csr-shifts">
                  <thead><tr><th scope="col">Operator</th><th scope="col">Shift, Pacific</th><th scope="col">Channel hours</th></tr></thead>
                  <tbody>{onNonvoice.map(({ operator, template }) => <tr key={operator.id}><th scope="row">{operator.nick}</th><td>{shiftLabel(template.start, template.end)}</td><td>{(load[operator.id] ?? 0) / 2}</td></tr>)}</tbody>
                </table>
                <p className="csr-hint">Channel hours add up every channel a person holds: two channels for one hour count as two.</p>
              </section>
              <section className="csr-checks-block" aria-label="Channels">
                <div className="csr-block-head"><span className="ws-kicker">CHANNELS</span><span className="ws-kicker">{channels.length} in the table</span></div>
                {channels.map(channel => <ChannelName key={`${channel.id}/${channel.name}`} channel={channel} canRemove={channels.length > 1} onRename={name => onRenameChannel(channel.id, name)} onRemove={() => onRemoveChannel(channel.id)} />)}
                {channels.length < 12 && <button type="button" className="ws-text-button" onClick={onAddChannel}>Add a channel +</button>}
                <p className="csr-hint">The list is the same for every week. Removing a channel removes its column from every week.</p>
              </section>
            </div>
          </>
        )}
    </div>
  );
}
