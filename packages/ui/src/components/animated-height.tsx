import { useLayoutEffect, useRef, useState } from "react";

// Animates height changes of its content. The clip margin keeps focus rings at the edges visible.
export function AnimatedHeight({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div style={{ height }} className="overflow-clip transition-[height] duration-200 ease-out [overflow-clip-margin:6px] motion-reduce:transition-none">
    <div ref={inner}>{children}</div>
  </div>;
}
