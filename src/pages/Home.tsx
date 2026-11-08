import { useRef, useEffect, useCallback } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import ScanlineOverlay from '../components/ScanlineOverlay';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import HeroSection from '../sections/HeroSection';
import ContrastSection from '../sections/ContrastSection';
import EvidenceSection from '../sections/EvidenceSection';
import RunLogSection from '../sections/RunLogSection';
import StatsSection from '../sections/StatsSection';

gsap.registerPlugin(ScrollTrigger);

export default function Home() {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.08 });
    lenisRef.current = lenis;
    lenis.on('scroll', ScrollTrigger.update);
    const tick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element && lenisRef.current) {
      lenisRef.current.scrollTo(element, { offset: -72 });
    }
  }, []);

  return (
    <div className="min-h-screen" style={{ background: '#000000' }}>
      <ScanlineOverlay />
      <Navigation onNavigate={scrollToSection} />
      <main>
        <HeroSection />
        <ContrastSection />
        <EvidenceSection />
        <RunLogSection />
        <StatsSection />
      </main>
      <Footer />
    </div>
  );
}
