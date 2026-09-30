import { useState, useCallback, type RefObject } from 'react';

type UseCursorTrackingReturn = {
  cursorX: number | null;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseLeave: () => void;
};

export const useCursorTracking = (
  containerRef: RefObject<HTMLDivElement | null>,
  offsetX: number = 0
): UseCursorTrackingReturn => {
  const [cursorX, setCursorX] = useState<number | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - offsetX;
      if (x >= 0) {
        setCursorX(x);
      } else {
        setCursorX(null);
      }
    }
  }, [containerRef, offsetX]);

  const handleMouseLeave = useCallback(() => {
    setCursorX(null);
  }, []);

  return {
    cursorX,
    handleMouseMove,
    handleMouseLeave,
  };
};
