import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const STATS = [
  { value: 50, suffix: '+', label: 'SKILL_PACKS' },
  { value: 4, suffix: '', label: 'AI_PLATFORMS' },
  { value: 0, suffix: '', label: 'COST_ITS_FREE', prefix: '$' },
  { value: Infinity, suffix: '', label: 'POSSIBILITIES', display: '∞' },
];

export default function StatsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const valueRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      STATS.forEach((stat, i) => {
        const el = valueRefs.current[i];
        if (!el) return;
        if (stat.display) {
          gsap.from(el, { opacity: 0, duration: 1, delay: i * 0.15, ease: 'power2.out', scrollTrigger: { trigger: sectionRef.current, start: 'top 85%', toggleActions: 'play none none none' } });
          return;
        }
        const counter = { val: 0 };
        gsap.to(counter, { val: stat.value, duration: 2, delay: i * 0.15, ease: 'power2.out', snap: { val: 1 }, onUpdate: () => { if (el) el.textContent = `${stat.prefix || ''}${Math.round(counter.val)}${stat.suffix}`; }, scrollTrigger: { trigger: sectionRef.current, start: 'top 85%', toggleActions: 'play none none none' } });
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative w-full py-[6vh]" style={{ background: '#000000', borderTop: '1px solid #1A1A1A', borderBottom: '1px solid #1A1A1A' }}>
      <div className="max-w-[1200px] mx-auto px-6 md:px-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
          {STATS.map((stat, i) => (
            <div key={stat.label} className="text-center">
              <span ref={(el) => { valueRefs.current[i] = el; }} className="font-display block" style={{ color: '#FF8C00', fontSize: 'clamp(2rem, 5vw, 4rem)', lineHeight: 1.2 }}>
                {stat.display ? stat.display : `${stat.prefix || ''}0${stat.suffix}`}
              </span>
              <span className="font-data text-[11px] text-crt tracking-[0.08em]">{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
