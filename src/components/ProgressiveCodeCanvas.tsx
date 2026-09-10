import { useRef, useEffect } from 'react';

interface Phase {
  name: string;
  color?: string;
  duration: number;
  fontWeight: string;
  glow?: boolean;
}

const PHASES: Phase[] = [
  { name: 'green', color: '#00FF41', duration: 3000, fontWeight: '' },
  { name: 'red', color: '#FF3333', duration: 3000, fontWeight: '' },
  { name: 'chaos', duration: 3000, fontWeight: '' },
  { name: 'white', color: '#FFFFFF', duration: 4000, fontWeight: 'bold', glow: true },
];

const TOTAL_CYCLE = PHASES.reduce((sum, phase) => sum + phase.duration, 0);

export default function ProgressiveCodeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const resize = () => {
      canvas.width = parent.offsetWidth;
      canvas.height = parent.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const fontSize = 18;
    const columns = Math.ceil(canvas.width / fontSize) + 1;
    const drops = new Array(columns).fill(1);
    const speeds = drops.map(() => 0.3 + Math.random() * 0.8);
    const chars = '0123456789'.split('');

    const getPhase = (elapsed: number) => {
      let acc = 0;
      for (let i = 0; i < PHASES.length; i++) {
        acc += PHASES[i].duration;
        if (elapsed < acc) {
          return { phase: PHASES[i], index: i, phaseTime: elapsed - (acc - PHASES[i].duration) };
        }
      }
      return { phase: PHASES[0], index: 0, phaseTime: 0 };
    };

    const getColor = (phase: Phase) => {
      if (phase.name === 'chaos') {
        const roll = Math.random();
        return roll < 0.33 ? '#00FF41' : roll < 0.66 ? '#FF3333' : '#FFFFFF';
      }
      return phase.color ?? '#FFFFFF';
    };

    let startTime = performance.now();

    const draw = (timestamp: number) => {
      if (!ctx || !canvas) return;

      const elapsed = (timestamp - startTime) % TOTAL_CYCLE;
      const { phase, phaseTime } = getPhase(elapsed);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      let currentFontSize = fontSize;
      if (phase.name === 'white') {
        const progress = phaseTime / phase.duration;
        currentFontSize = fontSize + progress * 6;
      }

      ctx.font = `${phase.fontWeight || ''} ${currentFontSize}px VT323`.trim();

      for (let i = 0; i < drops.length; i++) {
        const char = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * currentFontSize;
        const color = getColor(phase) ?? '#FFFFFF';

        ctx.fillStyle = color;
        if (phase.glow) {
          const progress = phaseTime / phase.duration;
          ctx.shadowBlur = 4 + progress * 12;
          ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
        } else {
          ctx.shadowBlur = 0;
          ctx.shadowColor = 'transparent';
        }

        const fade = y > canvas.height - 60 ? Math.max(0, 1 - (y - (canvas.height - 60)) / 60) : 1;

        ctx.globalAlpha = fade * 0.7;
        ctx.fillText(char, x, y);
        ctx.globalAlpha = 1;

        if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;

        drops[i] += speeds[i];
      }

      ctx.shadowBlur = 0;
      animationRef.current = requestAnimationFrame(draw);
    };

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        opacity: 0.18,
        pointerEvents: 'none',
      }}
    />
  );
}
