import { useState } from 'react';

interface NavigationProps {
  onNavigate: (sectionId: string) => void;
  selectedOS: 'uppermind' | 'undermind' | null;
}

export default function Navigation({ onNavigate, selectedOS }: NavigationProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { label: 'SKILLS', href: '#skills' },
    { label: 'DOCS', href: 'https://github.com', external: true },
    { label: 'GITHUB', href: 'https://github.com', external: true },
  ];

  const handleClick = (e: React.MouseEvent, link: (typeof navLinks)[number]) => {
    if (link.external) return;
    e.preventDefault();
    onNavigate(link.href.slice(1));
    setMobileOpen(false);
  };

  return (
    <nav
      className="fixed top-0 left-0 right-0 h-[72px] flex items-center justify-between px-6 md:px-10"
      style={{
        background: 'rgba(0,0,0,0.9)',
        backdropFilter: 'blur(4px)',
        borderBottom: '1px solid #1A1A1A',
        zIndex: 50,
      }}
    >
      {/* Logo */}
      <div className="flex items-center" style={{ gap: '1px' }}>
        <div className="text-center leading-none">
          <div className="font-display text-[28px] tracking-[0.02em] whitespace-nowrap">
            <span className="text-phosphor">WU</span>
            <span style={{ color: '#FF3333' }}>JI</span>
          </div>
          <div className="font-mono text-[28px] text-white">
            <span className="text-crt text-[32px] leading-none">(</span>
            <span className="tracking-[0.06em]">無極</span>
            <span className="text-crt text-[32px] leading-none">)</span>
          </div>
        </div>
        <img
          src="/images/logo-head-mouth.png"
          alt="WU JI"
          className="w-20 h-20 relative -top-3"
          style={{ marginLeft: '-10px', imageRendering: 'pixelated' }}
        />
      </div>

      {/* Selected OS indicator */}
      <div className="hidden lg:block absolute left-1/2 -translate-x-1/2">
        {selectedOS ? (
          <div className="font-data text-[11px]">
            <span className="text-crt">YOU_HAVE_SELECTED </span>
            {selectedOS === 'undermind' ? (
              <>
                <span className="text-white">UNDERMIND </span>
                <span style={{ color: '#FF3333' }}>OS</span>
              </>
            ) : (
              <>
                <span className="text-white">UPPERMIND </span>
                <span className="text-phosphor">OS</span>
              </>
            )}
          </div>
        ) : (
          <div className="font-data text-[11px] text-gridline">
            SELECT_YOUR_OS
          </div>
        )}
      </div>

      {/* Desktop links */}
      <div className="hidden md:flex items-center gap-8">
        {navLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            onClick={(e) => handleClick(e, link)}
            target={link.external ? '_blank' : undefined}
            rel={link.external ? 'noopener noreferrer' : undefined}
            className="font-data text-[12px] text-crt tracking-[0.08em] relative group transition-colors duration-300 hover:text-phosphor"
          >
            {link.label}
            <span className="absolute left-0 bottom-[-2px] w-0 h-[1px] bg-phosphor transition-all duration-300 group-hover:w-full" />
          </a>
        ))}
      </div>

      {/* Mobile toggle */}
      <button
        className="md:hidden flex flex-col gap-1.5"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Toggle menu"
      >
        <span
          className={`w-5 h-[1px] bg-white transition-all duration-300 ${mobileOpen ? 'rotate-45 translate-y-[3.5px]' : ''}`}
        />
        <span
          className={`w-5 h-[1px] bg-white transition-all duration-300 ${mobileOpen ? 'opacity-0' : ''}`}
        />
        <span
          className={`w-5 h-[1px] bg-white transition-all duration-300 ${mobileOpen ? '-rotate-45 -translate-y-[3.5px]' : ''}`}
        />
      </button>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="absolute top-[72px] left-0 right-0 md:hidden flex flex-col items-center gap-6 py-8"
          style={{
            background: 'rgba(0,0,0,0.95)',
            borderBottom: '1px solid #1A1A1A',
          }}
        >

          {selectedOS && (
            <div className="font-data text-[11px]">
              <span className="text-crt">YOU_HAVE_SELECTED </span>
              {selectedOS === 'undermind' ? (
                <>
                  <span className="text-white">UNDERMIND </span>
                  <span style={{ color: '#FF3333' }}>OS</span>
                </>
              ) : (
                <>
                  <span className="text-white">UPPERMIND </span>
                  <span className="text-phosphor">OS</span>
                </>
              )}
            </div>
          )}
          {navLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={(e) => handleClick(e, link)}
              target={link.external ? '_blank' : undefined}
              rel={link.external ? 'noopener noreferrer' : undefined}
              className="font-data text-[13px] text-crt tracking-[0.08em] transition-colors duration-300 hover:text-phosphor"
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}
