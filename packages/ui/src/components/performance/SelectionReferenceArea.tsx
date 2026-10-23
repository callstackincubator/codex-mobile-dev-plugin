import React from 'react';
import { Rectangle } from 'recharts';
import type { RectangleProps } from 'recharts';

export const renderSelectionReferenceArea = (props: RectangleProps) => {
  const width = typeof props.width === 'number' ? props.width : 0;
  const height = typeof props.height === 'number' ? props.height : 0;
  const strokeDasharray = width > 0 && height > 0 ? `0 ${width} ${height} 0` : undefined;

  return (
    <Rectangle
      {...props}
      width={width}
      height={height}
      strokeDasharray={strokeDasharray}
    />
  );
};
