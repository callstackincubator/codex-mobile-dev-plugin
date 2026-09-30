import type { RefObject } from 'react';

export function TimelineCursorIndicator({ labelRef }: { labelRef: RefObject<HTMLSpanElement | null> }) {
  return <div aria-hidden="true" className="absolute pointer-events-none z-50 h-full flex items-center"
    style={{ left: 'var(--performance-cursor-x, 0px)', opacity: 'var(--performance-cursor-opacity, 0)' }}>
    <div className="h-1/2 w-px bg-blue-500 absolute -bottom-px" />
    <span ref={labelRef} className="absolute -translate-x-1/2 px-1.5 rounded-full text-[10px] font-mono font-bold text-white whitespace-nowrap bg-blue-500" />
  </div>;
}
