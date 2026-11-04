import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const STATS = [
  { value: 5, label: 'EVIDENCE_LABELS' },
  { value: 3, label: 'LINKED_PANELS' },
  { value: 0, label: 'CONFIDENCE_SCORES' },
  { value: 0, label: 'STAFF_LISTS_SENT_TO_THE_MODEL' },
];

export default function StatsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const valueRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      STATS.forEach((stat, i) => {
        const el = valueRefs.current[i];
        if (!el) return;
        const counter = { val: 0 };
        gsap.to(counter, { val: stat.value, duration: 2, delay: i * 0.15, ease: 'power2.out', snap: { val: 1 }, onUpdate: () => { if (el) el.textContent = `${Math.round(counter.val)}`; }, scrollTrigger: { trigger: sectionRef.current, start: 'top 85%', toggleActions: 'play none none none' } });
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
                0
              </span>
              {/* a zero-width space after each underscore: long labels wrap at a word on a phone */}
              <span className="font-data text-[11px] text-crt tracking-[0.08em]">{stat.label.replaceAll('_', '_\u200B')}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
