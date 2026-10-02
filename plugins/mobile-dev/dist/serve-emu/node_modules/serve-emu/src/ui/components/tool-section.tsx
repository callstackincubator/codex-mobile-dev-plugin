import { useState, type ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

/**
 * An accessible disclosure that does not mount its body until it is opened.
 *
 * Keeping collapsed children out of the React tree is important here: most
 * tool panels read device state as soon as they mount, and some start a poll.
 */
export function ToolSection({
  id,
  title,
  children,
  defaultExpanded = false,
  onExpandedChange,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const headingId = `${id}-heading`;
  const bodyId = `${id}-body`;

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    onExpandedChange?.(next);
  };

  return (
    <div className={expanded ? "tool-section expanded" : "tool-section"}>
      <h2 className="tool-section-heading" id={headingId}>
        <button
          type="button"
          className="tool-section-toggle"
          aria-controls={bodyId}
          aria-expanded={expanded}
          onClick={toggle}
        >
          <span>{title}</span>
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
            <path d="M5 6.5L8 9.5L11 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h2>
      {/* Panel components already provide their own named section/aside. */}
      <div
        id={bodyId}
        className="tool-section-body"
        hidden={!expanded}
      >
        {expanded ? children : null}
      </div>
    </div>
  );
}
