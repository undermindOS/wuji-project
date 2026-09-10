import { useState, useCallback } from 'react';
import ProgressiveCodeCanvas from '../components/ProgressiveCodeCanvas';
import Typewriter from '../components/Typewriter';

interface HeroSectionProps {
  selectedOS: 'uppermind' | 'undermind' | null;
}

export default function HeroSection({ selectedOS }: HeroSectionProps) {
  const [typingDone, setTypingDone] = useState(false);

  const handleComplete = useCallback(() => {
    setTypingDone(true);
  }, []);

  return (
    <section
      id="hero"
      className="relative w-full min-h-[100dvh] flex items-center justify-center overflow-hidden"
    >
      {/* Digital rain */}
      <ProgressiveCodeCanvas />

      {/* Brain backdrop */}
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ zIndex: 0, opacity: 0.1 }}
      >
        <img
          src="/images/brain-bg.png"
          alt=""
          aria-hidden="true"
          className="w-[65vmin] h-[65vmin] object-contain"
          style={{ filter: 'drop-shadow(0 0 30px rgba(0, 255, 65, 0.3))' }}
        />
      </div>

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 50% 40% at 50% 50%, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.5) 60%, transparent 100%)',
          zIndex: 1,
        }}
      />

      {/* Content */}
      <div className="relative z-10 text-center px-4" style={{ maxWidth: '900px' }}>
        {/* Uppermind */}
        <h1
          className="font-display phosphor-glow-white mb-1"
          style={{
            fontSize: 'clamp(2.5rem, 9vw, 7rem)',
            lineHeight: 1.1,
          }}
        >
          UPPERMIND{' '}
          <span className="text-phosphor">OS</span>
        </h1>

        {/* Undermind */}
        <h1
          className="font-display phosphor-glow mb-2"
          style={{
            fontSize: 'clamp(2.5rem, 9vw, 7rem)',
            lineHeight: 1.1,
          }}
        >
          UNDERMIND{' '}
          <span style={{ color: '#FF3333' }}>OS</span>
        </h1>

        {/* Tagline */}
        <p className="font-mono text-[18px] md:text-[20px] text-phosphor tracking-[0.08em] mt-6">
          <Typewriter
            text="> AI_SKILL_PRESETS_FOR_WIDE_SPECTRUM_TASKS"
            speed={20}
            delay={800}
            onComplete={handleComplete}
            trigger={true}
          />
        </p>

        {/* Active mode */}
        {selectedOS && (
          <p className="font-data text-[11px] mt-4 transition-all duration-500">
            <span className="text-crt">ACTIVE_MODE: </span>
            {selectedOS === 'uppermind' ? (
              <span className="text-phosphor">UPPERMIND OS</span>
            ) : (
              <span style={{ color: '#FF3333' }}>UNDERMIND OS</span>
            )}
          </p>
        )}

        {/* Scroll cue */}
        <div
          className={`mt-12 transition-opacity duration-1000 ${typingDone ? 'opacity-100' : 'opacity-0'}`}
        >
          <span className="font-mono text-[24px] text-crt animate-chevron-pulse inline-block">
            ⌄
          </span>
        </div>
      </div>
    </section>
  );
}
