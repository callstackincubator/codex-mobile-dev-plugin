import React from "react";

type ChartToolTipProps = {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: number;
  postfix?: string;
};

export const ChartToolTip: React.FC<ChartToolTipProps> = ({
  active,
  payload,
  postfix = "",
}) => {
  const isVisible = active && payload && payload.length > 0;
  const value = payload?.[0]?.value;
  const displayValue = typeof value === "number" && postfix === "%" ? value.toFixed(1) : value;

  return (
    <div
      className="rounded border bg-popover px-1 text-popover-foreground shadow-sm"
      style={{ visibility: isVisible ? "visible" : "hidden" }}
    >
      <div className="text-[10px] font-mono font-bold whitespace-nowrap">
        {displayValue} {postfix}
      </div>
    </div>
  );
};
