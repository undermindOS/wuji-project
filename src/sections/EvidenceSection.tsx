import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import SectionLabel from '../components/SectionLabel';

gsap.registerPlugin(ScrollTrigger);

const LABELS = [
  { name: 'Source', description: '> The file, sheet, row and column the shift came from.' },
  { name: 'Condition', description: '> The priority behind this option, and any absence that covers the shift.' },
  { name: 'Check', description: '> Whether the new person is available, with the row that says so. Unknown stays unknown.' },
  { name: 'Calculation', description: "> The pay difference for this shift, with its terms and the rate's source. A missing rate is never zero." },
  { name: 'Server check', description: '> How many checks the independent validator ran, its version, the rules it covered and links to the source cells.' },
];

export default function EvidenceSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (!gridRef.current) return;
      gsap.from(gridRef.current.querySelectorAll('[data-label-card]'), {
        y: 40,
        opacity: 0,
        duration: 0.6,
        stagger: 0.08,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: gridRef.current,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="evidence"
      ref={sectionRef}
      className="relative w-full py-[8vh] md:py-[12vh]"
      style={{ background: '#000000' }}
    >
      <div className="max-w-[1200px] mx-auto px-6 md:px-10">
        {/* a zero-width space after each underscore: the long label wraps at a word on a phone */}
        <SectionLabel text={'// EVERY_CALCULATED_CHANGE_CARRIES_FIVE_LABELS'.replaceAll('_', '_\u200B')} />

        <div
          ref={gridRef}
          className="grid gap-[1px]"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            backgroundColor: '#1A1A1A',
          }}
        >
          {LABELS.map((label, index) => (
            <div key={label.name} data-label-card style={{ background: '#000000' }}>
              <div className="relative p-8 h-full" style={{ borderLeft: '4px solid #00FF41' }}>
                <h3 className="font-mono text-[22px] text-white mb-2">{label.name}</h3>
                <p className="font-mono text-[16px] text-crt leading-relaxed">{label.description}</p>
                <span className="absolute top-4 right-4 font-data text-[10px]" style={{ color: '#1A1A1A' }}>
                  {String(index + 1).padStart(2, '0')}
                </span>
              </div>
            </div>
          ))}

          {/* What is deliberately not on the list */}
          <div data-label-card style={{ background: '#000000' }}>
            <div className="relative p-8 h-full" style={{ borderLeft: '4px solid #FF3333' }}>
              <h3 className="font-mono text-[22px] mb-2" style={{ color: '#FF3333' }}>Confidence score</h3>
              <p className="font-mono text-[16px] text-crt leading-relaxed">
                &gt; Not on the list. No invented percentages, no single opaque rating.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
