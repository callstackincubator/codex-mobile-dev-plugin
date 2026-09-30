import React from 'react';
import { COLORS } from '../../performance/constants';

type CursorIndicatorProps = {
  cursorX: number | null;
};

export const CursorIndicator: React.FC<CursorIndicatorProps> = ({
  cursorX,
}) => {
  if (cursorX === null) return null;

  return (
    <div
      className="absolute top-0 -bottom-1 w-px bg-blue-500 pointer-events-none z-50"
      style={{ left: `${cursorX}px` }}
    />
  );
};
