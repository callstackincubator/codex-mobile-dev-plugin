import { useCallback, useEffect, useState } from "react";
import { useDeviceSessionSnapshot } from "../lib/device-session-store";
import { usePoll } from "../lib/use-poll";
import { AccessibilityNodeList } from "./accessibility-node-list";

export type AccessibilityNode = {
  id: string;
  text: string;
  contentDescription: string;
  resourceId: string;
  className: string;
  packageName: string;
  clickable: boolean;
  enabled: boolean;
  bounds: { left: number; top: number; right: number; bottom: number };
};

type Props = {
  enabled: boolean;
  nodes: AccessibilityNode[];
  highlightedId: string | null;
  onEnabledChange: (enabled: boolean) => void;
  onNodesChange: (nodes: AccessibilityNode[]) => void;
  onHighlight: (id: string | null) => void;
};

type AccessibilitySelector = Partial<
  Pick<
    AccessibilityNode,
    "id" | "text" | "contentDescription" | "resourceId" | "className" | "packageName" | "clickable" | "enabled"
  >
> & { index?: number };

function preferredSelectorForNode(node: AccessibilityNode): AccessibilitySelector {
  if (node.resourceId) return { resourceId: node.resourceId };
  if (node.contentDescription) return { contentDescription: node.contentDescription };
  if (node.text) return { text: node.text };
  if (node.className || node.packageName) {
    return {
      className: node.className || undefined,
      packageName: node.packageName || undefined,
      clickable: node.clickable,
      enabled: node.enabled,
    };
  }
  return { id: node.id };
}

function nodesMatchingSelector(
  nodes: AccessibilityNode[],
  selector: AccessibilitySelector,
): AccessibilityNode[] {
  return nodes.filter((candidate) =>
    Object.entries(selector).every(([key, value]) => {
      if (key === "index" || value === undefined) return true;
      return candidate[key as keyof AccessibilityNode] === value;
    })
  );
}

function selectorForNode(node: AccessibilityNode, nodes: AccessibilityNode[]): AccessibilitySelector {
  const selector = preferredSelectorForNode(node);
  const matches = nodesMatchingSelector(nodes, selector);
  if (matches.length > 1) selector.index = matches.indexOf(node);
  return selector;
}

export function AccessibilityPanel({
  enabled,
  nodes,
  highlightedId,
  onEnabledChange,
  onNodesChange,
  onHighlight,
}: Props) {
  const [status, setStatus] = useState("AX off");
  const deviceSession = useDeviceSessionSnapshot();

  const { refresh } = usePoll({
    enabled: enabled && !deviceSession.transitioning,
    poll: async ({ signal }) => {
      setStatus("Reading...");
      const res = await fetch("/api/accessibility", { cache: "no-store", signal });
      return await res.json() as { ok?: boolean; nodes?: AccessibilityNode[]; error?: string };
    },
    onResult: (json) => {
      if (!json.ok || !json.nodes) {
        setStatus(json.error || "AX unavailable");
        return;
      }
      onNodesChange(json.nodes);
      setStatus(`${json.nodes.length} nodes`);
    },
    onError: (error) => setStatus(error instanceof Error ? error.message : String(error)),
    intervalMs: 3000,
    pollKey: deviceSession.revision,
  });

  useEffect(() => {
    if (enabled && !deviceSession.transitioning) return;
    onNodesChange([]);
    onHighlight(null);
    setStatus(enabled ? "Switching device..." : "AX off");
  }, [deviceSession.transitioning, enabled, onHighlight, onNodesChange]);

  const tapNode = useCallback(async (node: AccessibilityNode) => {
    setStatus("Tapping...");
    try {
      const res = await fetch("/api/accessibility/tap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selector: selectorForNode(node, nodes) }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setStatus(json.error || "Tap failed");
        return;
      }
      setStatus("Tapped");
      refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  }, [nodes, refresh]);

  return (
    <section className="tool-panel accessibility-panel">
      <div className="panel-heading">
        <h2>Accessibility</h2>
        <div className="location-status">{status}</div>
      </div>
      <div className="panel-actions ax-actions">
        <button onClick={() => onEnabledChange(!enabled)}>{enabled ? "Hide" : "Show"}</button>
        <button onClick={() => void refresh()} disabled={!enabled}>
          Refresh
        </button>
      </div>
      {enabled ? (
        <AccessibilityNodeList
          nodes={nodes}
          highlightedId={highlightedId}
          onHighlight={onHighlight}
          onTapNode={tapNode}
        />
      ) : null}
    </section>
  );
}
