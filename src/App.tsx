import { lazy, Suspense } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';

const Workspace = lazy(() => import('./pages/Workspace'));

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/workspace" element={
        <Suspense fallback={<div role="status" className="font-data text-phosphor p-8">Loading workspace…</div>}>
          <Workspace />
        </Suspense>
      } />
      <Route path="*" element={
        <main className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-data text-[11px] text-crt tracking-[0.08em]">// 404</p>
          <h1 className="font-display text-[28px] text-phosphor">PAGE NOT FOUND</h1>
          <p className="font-mono text-[16px] text-crt">This page does not exist in WUJI.</p>
          <Link to="/" className="font-data text-[12px] text-phosphor tracking-[0.08em] hover:text-white transition-colors duration-300">
            [HOME]
          </Link>
        </main>
      } />
    </Routes>
  );
}

export default App;
