import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ScanlineOverlay from '../components/ScanlineOverlay';
import { loadWishForm, sendWish } from '../features/csr/api/shared.ts';
import type { WishForm as WishLink } from '../features/csr/api/shared.ts';
import WishForm from '../features/csr/components/WishForm';
import '../features/workspace/workspace.css';
import '../features/csr/csr.css';

/** The page a wish link opens: an operator picks their name and says which days and hours they would like. */
export default function CsrWish() {
  const { token = '' } = useParams();
  const [form, setForm] = useState<WishLink | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Schedule wishes — Operators Division';
    let alive = true;
    void loadWishForm(token).then(reply => {
      if (!alive) return;
      if (reply.ok) setForm(reply.data);
      else setProblem(reply.trouble === 'not_found' ? 'This link does not exist or was removed. Ask the scheduler for a new one.' : reply.trouble === 'not_connected' ? 'Wishes are not switched on yet. Ask the scheduler to try again later.' : reply.message);
    });
    return () => { alive = false; document.title = previousTitle; };
  }, [token]);

  return (
    <div className="workspace csr csr-wish-page">
      <ScanlineOverlay />
      <main className="csr-wish">
        <p className="ws-kicker ws-green">OPERATORS DIVISION // SCHEDULE WISHES</p>
        <h1 className="font-display">YOUR WISHES<span className="ws-orange">_</span></h1>
        {problem ? <p className="ws-notice" role="alert"><strong>The form could not be opened</strong>{problem}</p>
          : !form ? <p className="csr-hint" role="status">Opening the form…</p>
          : <WishForm weekStart={form.weekStart} operators={form.operators} send={wish => sendWish({ token, ...wish })} />}
      </main>
    </div>
  );
}
