export function CursorIndicator() {
  return <div aria-hidden="true" className="absolute top-0 -bottom-1 w-px bg-blue-500 pointer-events-none z-50"
    style={{ left: 'var(--performance-cursor-x, 0px)', opacity: 'var(--performance-cursor-opacity, 0)' }} />;
}
