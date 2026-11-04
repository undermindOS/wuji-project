import { useState, useCallback } from 'react';
import ProgressiveCodeCanvas from '../components/ProgressiveCodeCanvas';
import Typewriter from '../components/Typewriter';

export default function HeroSection() {
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
        <h1
          className="font-display phosphor-glow-white mb-2"
          style={{
            fontSize: 'clamp(3rem, 12vw, 9rem)',
            lineHeight: 1.05,
          }}
        >
          <span className="text-phosphor">WU</span>
          <span style={{ color: '#FF3333' }}>JI</span>
        </h1>

        {/* Tagline */}
        <p className="font-mono text-[18px] md:text-[20px] text-phosphor tracking-[0.08em] mt-6">
          <Typewriter
            text="> DECISIONS_YOU_CAN_CHECK"
            speed={20}
            delay={800}
            onComplete={handleComplete}
            trigger={true}
          />
        </p>

        <p className="font-mono text-[18px] md:text-[20px] text-crt mt-6 mx-auto leading-relaxed" style={{ maxWidth: '640px' }}>
          Describe a change in plain language. Get options with their evidence attached.
        </p>

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
