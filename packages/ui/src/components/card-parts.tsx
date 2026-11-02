// Pieces the inline cards share, so every card explains itself and switches views the same way.

import type { ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/** The ⓘ beside a heading: the explanation stays one click away instead of under the chart. */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  return <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon-xs" className="recording-info" aria-label={`About ${label}`} title={`About ${label}`}><InfoIcon /></Button></PopoverTrigger>
    <PopoverContent className="recording-info-content" side="bottom" align="start" aria-label={`About ${label}`}>{children}</PopoverContent>
  </Popover>;
}

/** Two or three mutually exclusive views of the same data, such as Bar and Treemap. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return <div className="segmented-control" role="group" aria-label={label}>
    {options.map(option => <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}
