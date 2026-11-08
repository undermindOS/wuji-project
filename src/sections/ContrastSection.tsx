import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import SectionLabel from '../components/SectionLabel';

gsap.registerPlugin(ScrollTrigger);

const BLACK_BOX_TAGS = ['NO_SOURCE', 'HIDDEN_REASONING', 'CONFIDENCE_SCORE', 'RECHECK_BY_HAND'];

const WUJI_TAGS = ['SOURCE_OF_EVERY_VALUE', 'VISIBLE_RULES', 'INDEPENDENT_CHECK', 'NAMED_UNKNOWNS'];

export default function ContrastSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const scrollTrigger = {
        trigger: sectionRef.current,
        start: 'top 75%',
        toggleActions: 'play none none none',
      };
      gsap.from(leftRef.current, { x: -80, opacity: 0, duration: 0.8, ease: 'power3.out', scrollTrigger });
      gsap.from(rightRef.current, { x: 80, opacity: 0, duration: 0.8, ease: 'power3.out', scrollTrigger });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  return (
    <section
      id="problem"
      ref={sectionRef}
      className="relative w-full py-[8vh] md:py-[12vh] overflow-hidden"
      style={{ background: '#000000' }}
    >
      <div className="relative z-10 max-w-[1100px] mx-auto px-6 md:px-10">
        <SectionLabel text="// THE_MODEL_EXPLAINS_ITSELF. THAT_IS_NOT_EVIDENCE." />

        <div className="flex flex-col md:flex-row gap-4">
          {/* Black box */}
          <div
            ref={leftRef}
            className="flex-1 relative p-8 md:p-10 flex flex-col"
            style={{ border: '1px solid #1A1A1A', background: 'rgba(255,51,51,0.04)' }}
          >
            <div className="flex items-center gap-4 mb-6">
              <span className="font-mono text-[40px] leading-none" style={{ color: '#FF3333' }}>▼</span>
              <h2 className="font-display text-white" style={{ fontSize: 'clamp(1.5rem, 4vw, 3rem)', lineHeight: 1.1 }}>
                BLACK <span style={{ color: '#FF3333' }}>BOX</span>
              </h2>
            </div>
            <p className="font-mono text-[16px] text-crt mb-4">&gt; a_confident_table // no_way_to_check_it</p>
            <p className="font-mono text-[16px] text-crt mb-6 leading-relaxed max-w-[500px]">
              Which numbers came from your file? Which came from a rule? Which did the model fill in because the cell was empty? The explanation reads like proof, so the whole thing gets checked by hand and the hour it saved is gone.
            </p>
            <div className="flex flex-wrap gap-2">
              {BLACK_BOX_TAGS.map((tag) => (
                <span key={tag} className="font-data text-[11px] px-3 py-1 border" style={{ color: '#FF3333', borderColor: '#FF3333' }}>[{tag}]</span>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="hidden md:block w-[1px] self-stretch" style={{ background: '#1A1A1A' }} />

          {/* WuJi */}
          <div
            ref={rightRef}
            className="flex-1 relative p-8 md:p-10 flex flex-col"
            style={{ border: '1px solid #1A1A1A', background: 'rgba(0,255,65,0.04)' }}
          >
            <div className="flex items-center gap-4 mb-6">
              <span className="font-mono text-[40px] text-phosphor leading-none">▲</span>
              <h2 className="font-display text-white" style={{ fontSize: 'clamp(1.5rem, 4vw, 3rem)', lineHeight: 1.1 }}>
                <span className="text-phosphor">WU</span><span style={{ color: '#FF3333' }}>JI</span>
              </h2>
            </div>
            <p className="font-mono text-[16px] text-crt mb-4">&gt; source // rule // check // cost // unknown</p>
            <p className="font-mono text-[16px] text-crt mb-6 leading-relaxed max-w-[500px]">
              The model has one job: write down the conditions, quoting your words so the server can match them. The result comes from a solver, and an independent validator tests it again. You see what changed and what nothing here can know.
            </p>
            <div className="flex flex-wrap gap-2">
              {WUJI_TAGS.map((tag) => (
                <span key={tag} className="font-data text-[11px] text-phosphor px-3 py-1 border border-phosphor">[{tag}]</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
