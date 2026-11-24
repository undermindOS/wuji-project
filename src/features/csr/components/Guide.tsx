import { useEffect, useRef } from 'react';

const STEPS: [string, string][] = [
  ['Set up the team', 'On the left, open an operator and set their time zone, shifts per week, and strong and weak sides. “Never” means the solver will not put them there at all.'],
  ['Choose the week', 'Click the week at the top to open the calendar. Every week is kept separately, so you can prepare the next one without losing this one.'],
  ['Pin what is already known', 'Click any cell in the schedule to pin a day off, a vacation or a fixed shift. Pinned cells stay as they are.'],
  ['Build the week', 'Press “Build the week”. In a few seconds the solver fills every free cell so that both lines are covered, everyone can take lunch and everyone gets their number of shifts.'],
  ['Read the checks and share', 'The checks under the schedule say what holds and what does not. Download the week as a PDF for the chat, or copy it into the team sheet.'],
];

/** The first-visit guide. It opens once, and again from "How it works" in the header. */
export default function Guide({ onClose }: { onClose: () => void }) {
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    start.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      // One control in the dialog, so focus stays on it.
      if (event.key === 'Tab') { event.preventDefault(); start.current?.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [onClose]);
  return (
    <div className="csr-guide-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="csr-guide" role="dialog" aria-modal="true" aria-labelledby="csr-guide-title">
        <p className="ws-kicker ws-green">HOW IT WORKS</p>
        <h2 id="csr-guide-title">Build a week in five steps</h2>
        <ol>
          {STEPS.map(([title, text], index) => <li key={title}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}
        </ol>
        <p className="csr-guide-note">Everything you enter stays in this browser. Use “Save to file” to pass the team and the weeks to a colleague.</p>
        <button type="button" ref={start} className="ws-primary" onClick={onClose}><span>Start</span><span aria-hidden="true">→</span></button>
      </div>
    </div>
  );
}
