import { useState, useEffect, useRef } from 'react';

const easeOutExpo = (t: number): number => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

export function useAnimatedNumber(targetValue: number, options?: { duration?: number; delay?: number }): number {
  const { duration = 800, delay = 0 } = options || {};
  const [displayValue, setDisplayValue] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      if (elapsed < delay) { animationRef.current = requestAnimationFrame(animate); return; }
      const progress = Math.min((elapsed - delay) / duration, 1);
      const eased = easeOutExpo(progress);
      setDisplayValue(Math.round(targetValue * eased));
      if (progress < 1) animationRef.current = requestAnimationFrame(animate);
    };
    startTimeRef.current = null;
    animationRef.current = requestAnimationFrame(animate);
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [targetValue, duration, delay]);

  return displayValue;
}
