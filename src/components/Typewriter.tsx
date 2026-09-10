import { useState, useEffect, useRef } from 'react';

interface TypewriterProps {
  text: string;
  speed?: number;
  delay?: number;
  className?: string;
  onComplete?: () => void;
  showCursor?: boolean;
  trigger?: boolean;
}

export default function Typewriter({
  text,
  speed = 30,
  delay = 0,
  className = '',
  onComplete,
  showCursor = true,
  trigger = true,
}: TypewriterProps) {
  const [displayed, setDisplayed] = useState('');
  const [cursorVisible, setCursorVisible] = useState(true);
  const indexRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!trigger || startedRef.current) return;

    startedRef.current = true;

    const timeout = setTimeout(() => {
      const interval = setInterval(() => {
        indexRef.current++;
        setDisplayed(text.slice(0, indexRef.current));

        if (indexRef.current >= text.length) {
          clearInterval(interval);
          onComplete?.();
        }
      }, speed);

      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timeout);
  }, [trigger, text, speed, delay, onComplete]);

  useEffect(() => {
    if (displayed.length < text.length || !showCursor) return;

    const interval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 800);

    return () => clearInterval(interval);
  }, [displayed, text, showCursor]);

  if (!trigger) return null;

  return (
    <span className={className} aria-live="polite">
      {displayed}
      {showCursor && (
        <span
          style={{
            opacity: cursorVisible ? 1 : 0,
            transition: 'opacity 0.1s',
          }}
        >
          _
        </span>
      )}
    </span>
  );
}
