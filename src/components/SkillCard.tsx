const PLATFORMS = ['GPT', 'GEMINI', 'CLAUDE', 'KIMI'];

interface SkillCardProps {
  name: string;
  os: 'undermind' | 'uppermind';
  description: string;
  index: number;
}

export default function SkillCard({ name, os, description, index }: SkillCardProps) {
  const isUndermind = os === 'undermind';
  const accentColor = isUndermind ? '#FF3333' : '#00FF41';

  return (
    <div
      className="group relative p-8 transition-colors duration-300 hover:bg-[#0A0A0A]"
      style={{ borderLeft: `4px solid ${accentColor}` }}
      data-os={os}
      tabIndex={0}
    >
      {/* Accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[4px] transition-all duration-300 group-hover:w-[6px]"
        style={{ backgroundColor: accentColor }}
      />

      {/* OS badge */}
      <span
        className="font-data text-[10px] inline-block px-2 py-0.5 mb-3"
        style={{
          color: accentColor,
          border: `1px solid ${accentColor}`,
        }}
      >
        {isUndermind ? 'UM' : 'UP'}
      </span>

      {/* Skill name */}
      <h3 className="font-mono text-[22px] text-white mb-2">{name}</h3>

      {/* Description */}
      <p className="font-mono text-[16px] text-crt mb-4 leading-relaxed">
        {description}
      </p>

      {/* Platform tags */}
      <div className="flex flex-wrap gap-2 mb-5">
        {PLATFORMS.map((platform) => (
          <span
            key={platform}
            className="font-data text-[10px] text-crt px-2 py-0.5"
            style={{ border: '1px solid #1A1A1A' }}
          >
            {platform}
          </span>
        ))}
      </div>

      {/* Install link */}
      <a
        href="https://github.com"
        target="_blank"
        rel="noopener noreferrer"
        className="font-data text-[11px] tracking-[0.08em] inline-flex items-center gap-1 transition-all duration-200 hover:translate-x-1 relative"
        style={{ color: accentColor }}
      >
        INSTALL_→
      </a>

      {/* Index */}
      <span
        className="absolute top-4 right-4 font-data text-[10px]"
        style={{ color: '#1A1A1A' }}
      >
        {String(index + 1).padStart(2, '0')}
      </span>
    </div>
  );
}
