import { useDeviceSessionSnapshot } from "../lib/device-session-store";
import { memo, useEffect, useMemo, useRef } from "react";
import type { PointerEvent, RefObject } from "react";
import {
  createLatestAnimationFrameScheduler,
  findAccessibilityNodeAt,
  measureAccessibilityViewport,
  type AccessibilityViewport,
  type LatestAnimationFrameScheduler,
  type NormalizedPoint,
} from "../lib/accessibility-hover";
import type { Sender } from "../lib/use-stream";
import type { AccessibilityNode } from "./accessibility-panel";

type Props = {
  canvasRef: RefObject<HTMLCanvasElement>;
  send: Sender;
  accessibilityNodes?: AccessibilityNode[];
  accessibilityEnabled?: boolean;
  highlightedAccessibilityId?: string | null;
  onAccessibilityHover?: (id: string | null) => void;
  deviceSize?: { width: number; height: number } | null;
  keyboardProxyRef?: RefObject<HTMLInputElement>;
  keyboardActive?: boolean;
};

type Point = NormalizedPoint;
type PointerSample = { point: Point; pointerId: number };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function DeviceStream({
  canvasRef,
  send,
  accessibilityNodes = [],
  accessibilityEnabled = false,
  highlightedAccessibilityId = null,
  onAccessibilityHover,
  deviceSize = null,
  keyboardProxyRef,
  keyboardActive = true,
}: Props) {
  const deviceSession = useDeviceSessionSnapshot();
  const activeRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const hoverContextRef = useRef({
    enabled: accessibilityEnabled,
    nodes: accessibilityNodes,
    size: deviceSize as AccessibilityViewport | null,
    onHover: onAccessibilityHover,
    send,
  });
  const lastReportedHoverRef = useRef(highlightedAccessibilityId);
  const pointerMoveSchedulerRef = useRef<LatestAnimationFrameScheduler<PointerSample> | null>(null);
  const accessibilitySize = useMemo(
    () => measureAccessibilityViewport(accessibilityNodes, deviceSize),
    [accessibilityNodes, deviceSize],
  );

  hoverContextRef.current = {
    enabled: accessibilityEnabled,
    nodes: accessibilityNodes,
    size: accessibilitySize,
    onHover: onAccessibilityHover,
    send,
  };

  const reportAccessibilityHover = (id: string | null) => {
    if (id === lastReportedHoverRef.current) return;
    lastReportedHoverRef.current = id;
    hoverContextRef.current.onHover?.(id);
  };

  if (!pointerMoveSchedulerRef.current) {
    pointerMoveSchedulerRef.current = createLatestAnimationFrameScheduler(({ point, pointerId }) => {
      const active = activeRef.current;
      if (active && pointerId === active.id) {
        active.x = point.x;
        active.y = point.y;
        hoverContextRef.current.send(
          { type: "touch", action: "move", x: point.x, y: point.y, pointerId: active.id },
          false,
        );
        return;
      }

      const { enabled, nodes, size } = hoverContextRef.current;
      const hovered = enabled && size ? findAccessibilityNodeAt(nodes, point, size) : null;
      reportAccessibilityHover(hovered?.id ?? null);
    });
  }

  useEffect(() => {
    lastReportedHoverRef.current = highlightedAccessibilityId;
  }, [highlightedAccessibilityId]);

  useEffect(() => {
    activeRef.current = null;
    pointerMoveSchedulerRef.current?.cancel();
    return () => pointerMoveSchedulerRef.current?.cancel();
  }, [deviceSession.revision]);

  useEffect(() => {
    if (accessibilityEnabled) return;
    if (!activeRef.current) pointerMoveSchedulerRef.current?.cancel();
    reportAccessibilityHover(null);
  }, [accessibilityEnabled]);

  const pointFromClient = (clientX: number, clientY: number): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return {
      x: clamp01((clientX - r.left) / r.width),
      y: clamp01((clientY - r.top) / r.height),
    };
  };

  const norm = (e: PointerEvent<HTMLCanvasElement>): Point | null =>
    pointFromClient(e.clientX, e.clientY);

  const sendTouch = (action: "down" | "move" | "up", p: Point, pointerId: number) => {
    send({ type: "touch", action, x: p.x, y: p.y, pointerId }, action !== "move");
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (activeRef.current) return;
    e.preventDefault();
    keyboardProxyRef?.current?.focus({ preventScroll: true });
    const p = norm(e);
    if (!p) return;
    pointerMoveSchedulerRef.current?.cancel();
    reportAccessibilityHover(null);
    canvasRef.current?.setPointerCapture(e.pointerId);
    activeRef.current = { id: e.pointerId, ...p };
    sendTouch("down", p, e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const active = activeRef.current;
    if (active && e.pointerId !== active.id) return;
    const native = e.nativeEvent;
    const coalesced =
      typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : null;
    if (active && e.pointerId === active.id) e.preventDefault();
    const latest = coalesced && coalesced.length > 0 ? coalesced[coalesced.length - 1] : e;
    const point = pointFromClient(latest.clientX, latest.clientY);
    if (point) pointerMoveSchedulerRef.current?.schedule({ point, pointerId: e.pointerId });
  };

  const stopPointer = (e: PointerEvent<HTMLCanvasElement>) => {
    const active = activeRef.current;
    if (!active || e.pointerId !== active.id) return;
    e.preventDefault();
    pointerMoveSchedulerRef.current?.flush();
    const up = norm(e);
    if (up) sendTouch("up", up, active.id);
    try {
      canvasRef.current?.releasePointerCapture(active.id);
    } catch {}
    activeRef.current = null;
  };

  const onPointerLeave = () => {
    if (!activeRef.current) pointerMoveSchedulerRef.current?.cancel();
    reportAccessibilityHover(null);
  };

  return (
    <div className="stream-surface">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
        onContextMenu={(e) => e.preventDefault()}
      />
      {!keyboardActive && (
        <button
          type="button"
          className="keyboard-hint"
          onClick={() => keyboardProxyRef?.current?.focus({ preventScroll: true })}
        >
          Click to resume keyboard input
        </button>
      )}
      {accessibilityEnabled && accessibilitySize && (
        <AccessibilityOverlay
          nodes={accessibilityNodes}
          size={accessibilitySize}
          highlightedId={highlightedAccessibilityId}
        />
      )}
    </div>
  );
}

const AccessibilityOverlay = memo(function AccessibilityOverlay({
  nodes,
  size,
  highlightedId,
}: {
  nodes: readonly AccessibilityNode[];
  size: AccessibilityViewport;
  highlightedId: string | null;
}) {
  const boundsPath = useMemo(
    () =>
      nodes
        .map(({ bounds }) =>
          `M${bounds.left} ${bounds.top}H${bounds.right}V${bounds.bottom}H${bounds.left}Z`)
        .join(""),
    [nodes],
  );
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const highlighted = highlightedId ? nodesById.get(highlightedId) : undefined;

  return (
    <svg
      className="ax-overlay"
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path className="ax-bounds" d={boundsPath} />
      {highlighted ? (
        <rect
          className="ax-bound-active"
          x={highlighted.bounds.left}
          y={highlighted.bounds.top}
          width={highlighted.bounds.right - highlighted.bounds.left}
          height={highlighted.bounds.bottom - highlighted.bounds.top}
        />
      ) : null}
    </svg>
  );
});
