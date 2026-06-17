import React from 'react';
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';

interface AnimatedNumberProps {
  value: number;
  formatter?: (n: number) => string;
  style?: React.CSSProperties;
}

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({ value, formatter, style }) => {
  const animated = useAnimatedNumber(value, { duration: 600 });
  return (
    <span style={style}>
      {formatter ? formatter(animated) : animated.toString()}
    </span>
  );
};
