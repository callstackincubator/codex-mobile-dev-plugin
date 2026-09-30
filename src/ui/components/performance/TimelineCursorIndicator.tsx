import React from 'react';
import { COLORS } from '../../performance/constants';
import { formatTime } from '../../performance/utils';

type TimelineCursorIndicatorProps = {
  cursorX: number | null;
  cursorTime: number | null;
};

export const TimelineCursorIndicator: React.FC<TimelineCursorIndicatorProps> = ({
  cursorX,
  cursorTime,
}) => {
  if (cursorX === null || cursorTime === null) return null;

  return (
    <div
      className="absolute pointer-events-none z-50 h-full flex items-center"
      style={{ left: `${cursorX}px`}}
    >
           <div className='h-1/2 w-px bg-blue-500 absolute -bottom-px'/>
      <div
        className="absolute -translate-x-1/2 px-1.5 rounded-full text-[10px] font-mono font-bold text-white whitespace-nowrap bg-blue-500"
      >
        {formatTime(cursorTime)}
      </div>

    </div>
  );
};
