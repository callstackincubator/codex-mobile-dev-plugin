import React from 'react';
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { SIDEBAR_WIDTH } from '../../performance/constants';
import { Button } from '../ui/button';

type Metric = {
  label: string;
  value: string;
};

type TrackLabelProps = {
  label: string;
  icon?: React.ReactNode;
  metrics?: Metric[];
  isExpanded?: boolean;
  onToggle?: () => void;
  title?: string;
  wrapLabel?: boolean;
};

export const TrackLabel: React.FC<TrackLabelProps> = ({ label, icon, metrics, isExpanded, onToggle, title, wrapLabel }) => {
  const labelClass = wrapLabel ? 'text-xs leading-tight font-semibold text-muted-foreground line-clamp-2 break-words [overflow-wrap:anywhere]'
    : 'text-xs font-semibold text-muted-foreground truncate';
  return (
    <div
      className="p-2 flex flex-col shrink-0 border-r border-b border-border bg-muted/30 group-hover:bg-muted/50"
      title={title}
      style={{ width: `${SIDEBAR_WIDTH}px` }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-1.5 min-w-0">
          {icon && (
            <div >
              {icon}
            </div>
          )}
          <span className={labelClass}>{label}</span>
        </div>
        {onToggle && (
          <Button variant="ghost" size="icon-sm"
            onClick={onToggle}
            title={isExpanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-label={isExpanded ? `Collapse ${label}` : `Expand ${label}`} aria-expanded={isExpanded} className="size-5 -mt-0.5 -mr-0.5"
          >{isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}</Button>
        )}
      </div>
      {metrics && metrics.length > 0 && (
        <div className="mt-auto">
          {metrics.map((metric, index) => (
            <div key={index} className="flex justify-between items-center text-[10px]">
              <span className="text-muted-foreground">{metric.label}</span>
              <span className="text-muted-foreground font-medium">{metric.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
