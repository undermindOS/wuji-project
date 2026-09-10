import { useState, useRef, useEffect, useCallback } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ScanlineOverlay from '../components/ScanlineOverlay';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import OSSelectorSection from '../sections/OSSelectorSection';
import HeroSection from '../sections/HeroSection';
import SkillGridSection from '../sections/SkillGridSection';
import TerminalPreviewSection from '../sections/TerminalPreviewSection';
import StatsSection from '../sections/StatsSection';

gsap.registerPlugin(ScrollTrigger);

type OSType = 'uppermind' | 'undermind';

export default function Home() {
  const [selectedOS, setSelectedOS] = useState<OSType | null>(null);
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.08 });
    lenisRef.current = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => {
      lenis.raf(time * 1000);
    });
    gsap.ticker.lagSmoothing(0);
    return () => {
      lenis.destroy();
    };
  }, []);

  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element && lenisRef.current) {
      lenisRef.current.scrollTo(element, { offset: -72 });
    }
  }, []);

  const gridFilter = selectedOS ?? 'all';
  const handleSelectOS = useCallback((os: 'all' | OSType) => {
    setSelectedOS(os === 'all' ? null : os);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: '#000000' }}>
      <ScanlineOverlay />
      <Navigation onNavigate={scrollToSection} selectedOS={selectedOS} />
      <main>
        <OSSelectorSection selectedOS={selectedOS} onSelect={setSelectedOS} />
        <HeroSection selectedOS={selectedOS} />
        <SkillGridSection selectedOS={gridFilter} onSelectOS={handleSelectOS} />
        <TerminalPreviewSection />
        <StatsSection />
      </main>
      <Footer />
    </div>
  );
}
