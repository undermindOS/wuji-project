import { useEffect, useRef } from 'react';

const STEPS: [string, string][] = [
  ['Set up the team', 'On the left, open an operator and set their time zone, shifts per week, and strong and weak sides. “Never” means the solver will not put them there at all.'],
  ['Choose the week', 'Click the week at the top to open the calendar. Every week is kept separately, so you can prepare the next one without losing this one.'],
  ['Build it, fill it by hand, or both', 'Press “Build the week” and the solver fills every free cell in a few seconds. Or click any cell and choose a shift, a day off or a vacation yourself. What you set by hand is pinned ▣ and stays when you rebuild.'],
  ['Read the checks', 'The checks under the schedule say what holds and what does not: both lines covered, lunch possible, everyone at their number of shifts. Click a check to see its cells.'],
  ['Split the non-voice channels', 'On the “Non-voice channels” tab, pick a day and say who holds each channel through each stretch of the day. “Fill automatically” gives a first draft.'],
  ['Collect wishes', '“Wishes” at the top makes a link for the operators. Each one picks their name, marks days and hours and adds a comment. What they send shows up under “Wishes” and in their card on the left.'],
  ['Save and share', 'Every change is autosaved in this browser. “Save for everyone” puts your copy where everyone who opens this page gets it, and “Save history” above the team keeps the last thirty of those saves. Download the week as a PDF for the chat, or copy it into the team sheet.'],
];

/** The first-visit guide. It opens once, and again from the "Guide" button next to the build button. */
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
        <h2 id="csr-guide-title">How to build a week</h2>
        <ol>
          {STEPS.map(([title, text], index) => <li key={title}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}
        </ol>
        <p className="csr-guide-note">Autosave keeps your work in this browser only. Nobody else sees a change until you press “Save for everyone”. If the page asks for a team key, ask the scheduler for it. This guide opens again from the “Guide” button.</p>
        <button type="button" ref={start} className="ws-primary" onClick={onClose}><span>Start</span><span aria-hidden="true">→</span></button>
      </div>
    </div>
  );
}
