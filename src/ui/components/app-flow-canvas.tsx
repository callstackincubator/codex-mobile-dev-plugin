import { memo, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { GitForkIcon } from 'lucide-react';
import { layoutFlow, visibleFlowNodes, type FlowRun, type FlowViewport } from '../../shared/app-flow.ts';
import type { AppFlowPanel } from '../app-flow-panel.ts';
import { recordUiTiming, setUiGauge } from '../telemetry.ts';

type Props = {
  panel: AppFlowPanel;
  run?: FlowRun;
  graph: ReturnType<typeof layoutFlow>;
  images: Record<string, string>;
  scale: number;
  selected?: string;
  select: (id: string) => void;
  viewport: RefObject<HTMLDivElement | null>;
};

export const AppFlowCanvas = memo(function AppFlowCanvas({ panel, run, graph, images, scale, selected, select, viewport }: Props) {
  const arrowId = useId();
  const [bounds, setBounds] = useState<FlowViewport>({ x: 0, y: 0, width: 1200, height: 800 });
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setBounds({ x: element.scrollLeft / scale, y: element.scrollTop / scale, width: element.clientWidth / scale, height: element.clientHeight / scale });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(element); element.addEventListener('scroll', schedule, { passive: true }); measure();
    return () => { observer.disconnect(); element.removeEventListener('scroll', schedule); cancelAnimationFrame(frame); };
  }, [scale, viewport]);
  const visible = useMemo(() => {
    const started = performance.now();
    const result = visibleFlowNodes(graph.positions, bounds);
    recordUiTiming('ui.app_flow.viewport', performance.now() - started);
    setUiGauge('ui.app_flow.visible_nodes', result.size);
    return result;
  }, [graph, bounds]);
  const nodes = run?.nodes.filter(node => visible.has(node.id)) ?? [];
  const imageKey = nodes.flatMap(node => node.image ? [node.image] : []).join('|');
  useEffect(() => { panel.visible(imageKey ? imageKey.split('|') : []); }, [panel, imageKey]);
  return <div ref={viewport} className="app-flow-viewport" onPointerDown={event => {
    if ((event.target as HTMLElement).closest('button') || event.button !== 0) return;
    const element = event.currentTarget; drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }; element.setPointerCapture(event.pointerId);
  }} onPointerMove={event => { if (drag.current) { event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX; event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY; } }} onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
    {!run?.nodes.length ? <div className="app-flow-empty"><GitForkIcon size={36} /><h3>Your app, screen by screen</h3><p>Find routes from source, then follow the links available in your running app.</p></div> : <div style={{ width: graph.width * scale, height: graph.height * scale }}><div className="app-flow-canvas" style={{ width: graph.width, height: graph.height, transform: `scale(${scale})` }}>
      <svg width={bounds.width} height={bounds.height} style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }} className="app-flow-edges" aria-hidden="true">
        <defs><marker id={arrowId} viewBox="0 0 8 8" refX="8" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor" /></marker></defs>
        {run.edges.map(edge => {
          const tree = graph.treeEdges.has(`${edge.from}:${edge.to}`);
          if (!tree && edge.from !== selected && edge.to !== selected) return null;
          if (!visible.has(edge.to)) return null;
          const a = graph.positions.get(edge.from), b = graph.positions.get(edge.to);
          if (!a || !b || Math.max(a.x + 202, b.x) < bounds.x || Math.min(a.x, b.x) > bounds.x + bounds.width || Math.max(a.y + 28, b.y + 28) < bounds.y || Math.min(a.y, b.y) > bounds.y + bounds.height) return null;
          // Paths use local CSS pixels, just like cards. Do not introduce a second
          // SVG viewBox transform when the canvas already handles pan and zoom.
          const x = a.x + 202 - bounds.x, y = a.y + 28 - bounds.y, endX = b.x - bounds.x, endY = b.y + 28 - bounds.y;
          return <path key={`${edge.from}:${edge.to}`} d={`M${x},${y} C${x + 24},${y} ${endX - 24},${endY} ${endX},${endY}`} data-to={edge.to} data-kind={tree ? 'contains' : 'navigation'} markerEnd={`url(#${arrowId})`} />;
        })}
      </svg>
      {nodes.map(node => { const position = graph.positions.get(node.id)!; const image = node.image && images[node.image]; return <button key={node.id} type="button" className="app-flow-node" data-node-id={node.id} data-kind={node.kind} data-status={node.status} data-selected={selected === node.id} style={{ left: position.x, top: position.y }} onClick={() => select(node.id)} title={node.path.join(' → ') || node.name}>
        <span className="app-flow-node-title">{node.name}</span>
        {node.kind === 'screen' && <><span className="app-flow-thumbnail">{image ? <img src={image} alt={`${node.name} screen`} decoding="async" draggable={false} /> : <span>{node.status === 'capturing' ? 'Capturing…' : node.status === 'needs-data' ? 'Needs real data' : node.status === 'blocked' ? 'Blocked' : node.status === 'timed-out' ? 'Not captured' : node.status === 'captured' ? 'Loading screenshot…' : 'Waiting'}</span>}</span><span className="app-flow-node-status">{node.status.replaceAll('-', ' ')}</span></>}
      </button>; })}
    </div></div>}
  </div>;
});
