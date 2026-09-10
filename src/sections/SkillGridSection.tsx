import { useRef, useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import SkillCard from '../components/SkillCard';
import SectionLabel from '../components/SectionLabel';

gsap.registerPlugin(ScrollTrigger);

interface Skill {
  name: string;
  os: 'undermind' | 'uppermind';
  description: string;
}

const SKILLS: Skill[] = [
  { name: 'Code Archaeology', os: 'undermind', description: '> Reverse-engineer legacy codebases. Trace intent through commits, docs, and dead paths.' },
  { name: 'System Decomposition', os: 'undermind', description: '> Break complex systems into atomic analyzable units.' },
  { name: 'Pattern Extraction', os: 'undermind', description: '> Identify recurring structures across domains.' },
  { name: 'Deep Research', os: 'undermind', description: '> Multi-source synthesis with source validation.' },
  { name: 'Threat Modeling', os: 'undermind', description: '> Security analysis across attack surfaces.' },
  { name: 'Architecture Review', os: 'undermind', description: '> Evaluate system design against principles.' },
  { name: 'Auto Reporting', os: 'uppermind', description: '> Generate structured reports from raw data.' },
  { name: 'Workflow Orchestration', os: 'uppermind', description: '> Chain AI actions into repeatable pipelines.' },
  { name: 'Content Pipeline', os: 'uppermind', description: '> Draft-edit-publish automation for content.' },
  { name: 'Meeting Synthesis', os: 'uppermind', description: '> Extract decisions and action items from transcripts.' },
  { name: 'Knowledge Base', os: 'uppermind', description: '> Structured memory for recurring contexts.' },
  { name: 'Prompt Chaining', os: 'uppermind', description: '> Multi-step prompt sequences with state.' },
];

interface SkillGridSectionProps {
  selectedOS: 'all' | 'uppermind' | 'undermind';
  onSelectOS: (os: 'all' | 'uppermind' | 'undermind') => void;
}

export default function SkillGridSection({ selectedOS, onSelectOS }: SkillGridSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const filteredSkills = selectedOS === 'all' ? SKILLS : SKILLS.filter((skill) => skill.os === selectedOS);

  useEffect(() => {
    const ctx = gsap.context(() => {
      if (!gridRef.current) return;
      const cards = gridRef.current.querySelectorAll('[data-skill-card]');

      gsap.from(cards, {
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
  }, [selectedOS]);

  const filters = [
    { key: 'all' as const, label: 'ALL' },
    { key: 'uppermind' as const, label: 'UPPERMIND' },
    { key: 'undermind' as const, label: 'UNDERMIND' },
  ];

  return (
    <section
      id="skills"
      ref={sectionRef}
      className="relative w-full py-[8vh] md:py-[12vh]"
      style={{ background: '#000000' }}
    >
      <div className="max-w-[1200px] mx-auto px-6 md:px-10">
        <SectionLabel text="// AVAILABLE_SKILL_PACKS" />

        {/* Filters */}
        <div className="flex gap-2 mb-10">
          {filters.map((filter) => {
            const isActive = selectedOS === filter.key;
            const isUndermind = filter.key === 'undermind';
            const isUppermind = filter.key === 'uppermind';
            return (
              <button
                key={filter.key}
                onClick={() => onSelectOS(filter.key)}
                className="font-data text-[11px] px-4 py-2 transition-all duration-300"
                style={{
                  color: isActive
                    ? '#000000'
                    : isUndermind
                      ? '#FF3333'
                      : isUppermind
                        ? '#00FF41'
                        : '#E8E8E8',
                  backgroundColor: isActive
                    ? isUndermind
                      ? '#FF3333'
                      : isUppermind
                        ? '#00FF41'
                        : '#E8E8E8'
                    : 'transparent',
                  border: isActive ? `1px solid ${isUndermind ? '#FF3333' : isUppermind ? '#00FF41' : '#E8E8E8'}` : '1px solid #1A1A1A',
                }}
              >
                [{filter.label}]
              </button>
            );
          })}
        </div>
        <div
          ref={gridRef}
          className="grid gap-[1px]"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            backgroundColor: '#1A1A1A',
          }}
        >
          {filteredSkills.map((skill, index) => (
            <div
              key={`${skill.name}-${selectedOS}`}
              data-skill-card
              style={{ background: '#000000' }}
            >
              <SkillCard
                name={skill.name}
                os={skill.os}
                description={skill.description}
                index={index}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
