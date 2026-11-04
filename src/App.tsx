import { Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={
        <main className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-data text-[11px] text-crt tracking-[0.08em]">// 404</p>
          <h1 className="font-display text-[28px] text-phosphor">АДРЕС НЕ НАЙДЕН</h1>
          <p className="font-mono text-[16px] text-crt">Такой страницы в WUJI нет.</p>
          <Link to="/" className="font-data text-[12px] text-phosphor tracking-[0.08em] hover:text-white transition-colors duration-300">
            [НА ГЛАВНУЮ]
          </Link>
        </main>
      } />
    </Routes>
  );
}

export default App;
