import { useRef, useState, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import SectionLabel from '../components/SectionLabel';
import Typewriter from '../components/Typewriter';

gsap.registerPlugin(ScrollTrigger);

/* What the workspace journal records: observed events, never the model's
   thoughts. The week is synthetic, and the section says so on screen. */
const TERMINAL_LINES = [
  '> source: 18 people recognised, 2 rates missing',
  '> task: "Anna is out on Tuesday. Keep every shift covered."',
  '> draft: conditions written, every quote found in the task',
  '> you: conditions confirmed, version 2',
  '> solver: 2 valid options',
  '> validator: 2 of 2 pass, tested separately',
  '> unknown: pay for 2 people, no rate on file',
  '> waiting for your approval',
];

export default function RunLogSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [visibleLines, setVisibleLines] = useState(0);
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (!terminalRef.current) return;
      gsap.from(terminalRef.current, {
        y: 60,
        opacity: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 75%',
          toggleActions: 'play none none none',
          onEnter: () => setStarted(true),
        },
      });
    }, sectionRef);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    if (!started || visibleLines >= TERMINAL_LINES.length) {
      if (visibleLines >= TERMINAL_LINES.length) setAllDone(true);
      return;
    }
    const timeout = setTimeout(() => {
      setVisibleLines((prev) => prev + 1);
    }, visibleLines === 0 ? 500 : 400);
    return () => clearTimeout(timeout);
  }, [started, visibleLines]);

  return (
    <section id="run" ref={sectionRef} className="relative w-full py-[12vh]" style={{ background: '#000000' }}>
      <div className="max-w-[1200px] mx-auto px-6 md:px-10">
        <SectionLabel text="// ONE_WEEK_OF_SHIFTS // SYNTHETIC_DATA" />

        {/* Terminal window */}
        <div ref={terminalRef} className="mx-auto max-w-[800px]" style={{ border: '1px solid #1A1A1A' }}>
          {/* Title bar */}
          <div className="flex items-center gap-2 px-4" style={{ height: '32px', background: '#0A0A0A' }}>
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: '#1A1A1A' }} />
              <span className="w-2 h-2 rounded-full" style={{ background: '#1A1A1A' }} />
              <span className="w-2 h-2 rounded-full" style={{ background: '#1A1A1A' }} />
            </div>
            <span className="font-data text-[10px] text-crt mx-auto pr-12">run_journal</span>
          </div>

          {/* Output */}
          <div className="p-6 md:p-8 min-h-[300px]" style={{ background: '#000000' }}>
            <div className="font-mono text-[16px] md:text-[18px] leading-[1.8]" style={{ color: '#FF8C00' }}>
              {TERMINAL_LINES.slice(0, visibleLines).map((line, i) => (
                <div key={i}>
                  {i === visibleLines - 1 && !allDone ? (
                    <Typewriter text={line} speed={20} trigger={true} showCursor={false} />
                  ) : (
                    <span>{line}</span>
                  )}
                </div>
              ))}
              {allDone && (
                <span className="animate-blink">_</span>
              )}
            </div>
          </div>
        </div>

        {/* Status */}
        <p className="font-data text-[11px] text-crt text-center tracking-[0.08em] mt-10">
          IN_DEVELOPMENT // HOSTED_DEMO_WITH_PREPARED_OPTIONS // LIVE_RUNS_NEED_A_LOCAL_SERVER
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8">
          <a
            href="https://khrestenkov.com/wuji"
            className="font-data text-[13px] uppercase px-8 py-3.5 transition-all duration-200 hover:-translate-y-0.5"
            style={{ background: '#FF8C00', color: '#000000' }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#FFA500'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = '#FF8C00'; }}
          >
            READ_THE_PRODUCT_PAGE →
          </a>
          <a
            href="mailto:daniil@khrestenkov.com"
            className="font-data text-[13px] uppercase px-8 py-3.5 border transition-all duration-200"
            style={{ color: '#E8E8E8', borderColor: '#1A1A1A' }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#FF8C00'; (e.target as HTMLElement).style.borderColor = '#FF8C00'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#E8E8E8'; (e.target as HTMLElement).style.borderColor = '#1A1A1A'; }}
          >
            WRITE_TO_THE_OFFICE →
          </a>
        </div>
      </div>
    </section>
  );
}
