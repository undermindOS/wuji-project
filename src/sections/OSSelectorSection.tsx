import { useRef, useEffect, useCallback } from 'react';
import gsap from 'gsap';

const UPPERMIND_TAGS = ['AUTO_REPORTING', 'WORKFLOW_ORCH', 'CONTENT_PIPELINES', 'MEETING_SYNTHESIS'];

const UNDERMIND_TAGS = ['CODE_ARCHAEOLOGY', 'SYSTEM_DECOMPOSITION', 'PATTERN_EXTRACTION', 'DEEP_RESEARCH'];

interface OSSelectorSectionProps {
  selectedOS: 'uppermind' | 'undermind' | null;
  onSelect: (os: 'uppermind' | 'undermind' | null) => void;
}

export default function OSSelectorSection({ selectedOS, onSelect }: OSSelectorSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const upperRef = useRef<HTMLDivElement>(null);
  const underRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const animatingRef = useRef(false);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ delay: 0.3 });
      tl.from(upperRef.current, { x: -80, opacity: 0, duration: 0.8, ease: 'power3.out' }, 0);
      tl.from(underRef.current, { x: 80, opacity: 0, duration: 0.8, ease: 'power3.out' }, 0);
      tl.from(controlsRef.current, { y: -20, opacity: 0, duration: 0.5, ease: 'power2.out' }, 0.4);
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  const getCenterOffset = useCallback((el: HTMLElement) => {
    const container = containerRef.current;
    if (!container) return 0;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const containerCenter = containerRect.width / 2;
    const elCenter = elRect.left - containerRect.left + elRect.width / 2;
    return containerCenter - elCenter;
  }, []);

  const animateToCenter = useCallback((os: 'uppermind' | 'undermind') => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    const target = os === 'uppermind' ? upperRef.current : underRef.current;
    const other = os === 'uppermind' ? underRef.current : upperRef.current;
    if (!target || !other) return;
    const offset = getCenterOffset(target);
    const exitX = os === 'uppermind' ? '100vw' : '-100vw';
    const tl = gsap.timeline({ onComplete: () => { animatingRef.current = false; } });
    tl.to(other, { x: exitX, opacity: 0, duration: 0.7, ease: 'power3.inOut' }, 0);
    tl.to(target, { x: offset, duration: 0.7, ease: 'power3.inOut' }, 0);
  }, [getCenterOffset]);

  const resetPanels = useCallback(() => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    gsap.timeline({ onComplete: () => { animatingRef.current = false; } }).to([upperRef.current, underRef.current], { x: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, 0);
  }, []);

  const handleSelect = (os: 'uppermind' | 'undermind') => {
    if (selectedOS === os) return;
    if (!selectedOS) { animateToCenter(os); onSelect(os); return; }
    resetPanels();
    onSelect(null);
    setTimeout(() => { animateToCenter(os); onSelect(os); }, 650);
  };

  const handleSwitch = () => {
    if (!selectedOS || animatingRef.current) return;
    const next = selectedOS === 'uppermind' ? 'undermind' : 'uppermind';
    resetPanels();
    onSelect(null);
    setTimeout(() => { animateToCenter(next); onSelect(next); }, 650);
  };

  const handleClose = () => {
    if (!selectedOS) return;
    resetPanels();
    onSelect(null);
  };

  const handleExplore = () => {
    window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
  };

  return (
    <section ref={sectionRef} className="relative w-full min-h-[100dvh] flex flex-col items-center justify-center pt-[72px] overflow-hidden" style={{ background: '#000000' }}>
      {/* Brain backdrop */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: 0.07, zIndex: 0 }}>
        <img src="/images/brain-bg.png" alt="" aria-hidden="true" className="w-[75vmin] h-[75vmin] object-contain" style={{ filter: 'drop-shadow(0 0 50px rgba(0, 255, 65, 0.4)) drop-shadow(0 0 80px rgba(255, 51, 51, 0.3))' }} />
      </div>

      {/* Switch controls */}
      <div ref={controlsRef} className="relative z-10 flex items-center gap-6 mb-8">
        <button onClick={handleSwitch} disabled={!selectedOS} className="font-mono text-[28px] transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed hover:scale-110 text-crt" aria-label="Previous OS">◀</button>
        <span className="font-data text-[11px] text-crt tracking-[0.1em]">{selectedOS ? '[PRESS_TO_SWITCH]' : '[CHOOSE_YOUR_OS]'}</span>
        <button onClick={handleSwitch} disabled={!selectedOS} className="font-mono text-[28px] transition-all duration-300 disabled:opacity-20 disabled:cursor-not-allowed hover:scale-110 text-crt" aria-label="Next OS">▶</button>
      </div>

      {/* Panels */}
      <div ref={containerRef} className="relative z-10 w-full max-w-[1100px] mx-auto px-6 md:px-10 flex flex-col md:flex-row gap-4 md:gap-0 items-stretch min-h-[60vh]">
        {/* UPPERMIND */}
        <div
          ref={upperRef}
          className="flex-1 relative p-8 md:p-10 transition-colors duration-300 flex flex-col"
          style={{ border: '1px solid #1A1A1A', background: selectedOS === 'uppermind' ? 'rgba(0,255,65,0.04)' : 'rgba(0,255,65,0.01)', minHeight: selectedOS === 'uppermind' ? '60vh' : 'auto' }} onClick={() => handleSelect('uppermind')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelect('uppermind'); }}>
          <div className="flex items-center gap-4 mb-6">
            <span className="font-mono text-[40px] text-phosphor leading-none">▲</span>
            <h2 className="font-display text-white" style={{ fontSize: 'clamp(1.5rem, 4vw, 3.5rem)', lineHeight: 1.1 }}>UPPERMIND <span className="text-phosphor">OS</span></h2>
          </div>
          <p className="font-mono text-[16px] text-crt mb-4">&gt; workflows // reports // productivity_systems</p>
          <div className={`transition-all duration-500 overflow-hidden ${selectedOS === 'uppermind' ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
            <p className="font-mono text-[16px] text-crt mb-6 leading-relaxed max-w-[500px]">Elevated skill presets for streamlined surface operations. Structured output, repeatable processes. One click installs to ChatGPT, Gemini, Claude, Kimi.</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {UPPERMIND_TAGS.map((tag) => (<span key={tag} className="font-data text-[11px] text-phosphor px-3 py-1 border border-phosphor">[{tag}]</span>))}
            </div>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="font-data text-[12px] text-black bg-phosphor px-6 py-3 inline-block hover:bg-white transition-all duration-200">INSTALL_UPPERMIND_OS →</a>
          </div>
          <div className={`transition-all duration-300 ${selectedOS === 'uppermind' ? 'opacity-0' : 'opacity-100'}`}>
            <p className="font-data text-[10px] text-gridline mt-auto">CLICK_TO_EXPAND</p>
          </div>
          {selectedOS === 'uppermind' && (
            <button onClick={(e) => { e.stopPropagation(); handleClose(); }} className="absolute top-4 right-4 font-data text-[11px] text-crt border border-gridline px-3 py-1 hover:border-phosphor hover:text-phosphor transition-all duration-200">[CLOSE]</button>
          )}
        </div>

        {/* Divider */}
        <div className="hidden md:block w-[1px] self-stretch" style={{ background: '#1A1A1A' }} />

        {/* UNDERMIND */}
        <div
          ref={underRef}
          className="flex-1 relative p-8 md:p-10 transition-colors duration-300 flex flex-col"
          style={{ border: '1px solid #1A1A1A', background: selectedOS === 'undermind' ? 'rgba(255,51,51,0.10)' : 'rgba(255,51,51,0.04)', minHeight: selectedOS === 'undermind' ? '60vh' : 'auto' }} onClick={() => handleSelect('undermind')} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelect('undermind'); }}>
          <div className="flex items-center gap-4 mb-6">
            <span className="font-mono text-[40px] leading-none" style={{ color: '#FF3333' }}>▼</span>
            <h2 className="font-display text-white" style={{ fontSize: 'clamp(1.5rem, 4vw, 3.5rem)', lineHeight: 1.1 }}>UNDERMIND <span style={{ color: '#FF3333', textShadow: '0 0 12px rgba(255, 51, 51, 0.6)' }}>OS</span></h2>
          </div>
          <p className="font-mono text-[16px] text-crt mb-4">&gt; deep_analysis // deep_expertise // deep_development</p>
          <div className={`transition-all duration-500 overflow-hidden ${selectedOS === 'undermind' ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}>
            <p className="font-mono text-[16px] text-crt mb-6 leading-relaxed max-w-[500px]">Subterranean skill presets for intensive analytical work. Penetrating beneath the surface of every problem. Deep expertise for ChatGPT, Gemini, Claude, Kimi.</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {UNDERMIND_TAGS.map((tag) => (<span key={tag} className="font-data text-[11px] px-3 py-1 border" style={{ color: '#FF3333', borderColor: '#FF3333', textShadow: '0 0 8px rgba(255, 51, 51, 0.5)' }}>[{tag}]</span>))}
            </div>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" className="font-data text-[12px] text-black px-6 py-3 inline-block transition-all duration-200" style={{ background: '#FF3333', boxShadow: '0 0 12px rgba(255, 51, 51, 0.4)' }} onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#FF5555'; (e.target as HTMLElement).style.boxShadow = '0 0 20px rgba(255, 51, 51, 0.7)'; }} onMouseLeave={(e) => { (e.target as HTMLElement).style.background = '#FF3333'; (e.target as HTMLElement).style.boxShadow = '0 0 12px rgba(255, 51, 51, 0.4)'; }}>INSTALL_UNDERMIND_OS →</a>
          </div>
          <div className={`transition-all duration-300 ${selectedOS === 'undermind' ? 'opacity-0' : 'opacity-100'}`}>
            <p className="font-data text-[10px] text-gridline mt-auto">CLICK_TO_EXPAND</p>
          </div>
          {selectedOS === 'undermind' && (
            <button onClick={(e) => { e.stopPropagation(); handleClose(); }} className="absolute top-4 right-4 font-data text-[11px] text-crt border border-gridline px-3 py-1 hover:text-white hover:border-white transition-all duration-200">[CLOSE]</button>
          )}
        </div>
      </div>

      {/* Explore */}
      <div className="relative z-10 mt-12">
        <button onClick={handleExplore} className="font-data text-[11px] text-crt border border-gridline px-6 py-2 transition-all duration-300 hover:text-phosphor hover:border-phosphor">EXPLORE_MORE ↓</button>
      </div>
    </section>
  );
}
