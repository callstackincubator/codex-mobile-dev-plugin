import { memo, type ComponentType } from "react";
import { AccessibilityPanel, type AccessibilityNode } from "./accessibility-panel";
import { AppManagementPanel } from "./app-management-panel";
import { FontScalePanel, NetworkPanel, NightModePanel, OrientationPanel } from "./device-panel";
import { LocationPanel } from "./location-panel";
import { LogcatPanel } from "./logcat-panel";
import { SessionPanel } from "./session-panel";
import { ToolSection } from "./tool-section";

type Props = {
  accessibilityEnabled: boolean;
  accessibilityNodes: AccessibilityNode[];
  highlightedAccessibilityId: string | null;
  onAccessibilityEnabledChange: (enabled: boolean) => void;
  onAccessibilityNodesChange: (nodes: AccessibilityNode[]) => void;
  onAccessibilityHighlight: (id: string | null) => void;
};

type StaticToolProps = {
  id: string;
  title: string;
  panel: ComponentType;
};

const StaticTool = memo(function StaticTool({ id, title, panel: Panel }: StaticToolProps) {
  return (
    <ToolSection id={id} title={title}>
      <Panel />
    </ToolSection>
  );
});

/**
 * A memoized boundary around every device tool. Stream statistics and other
 * App-level state can update without re-rendering this subtree. Static tools
 * have an additional boundary so accessibility hover only updates the AX tool.
 */
export const SideTools = memo(function SideTools({
  accessibilityEnabled,
  accessibilityNodes,
  highlightedAccessibilityId,
  onAccessibilityEnabledChange,
  onAccessibilityNodesChange,
  onAccessibilityHighlight,
}: Props) {
  return (
    <>
      <StaticTool id="network-tool" title="Network" panel={NetworkPanel} />
      <StaticTool id="theme-tool" title="Theme" panel={NightModePanel} />
      <StaticTool id="font-size-tool" title="Font Size" panel={FontScalePanel} />
      <StaticTool id="orientation-tool" title="Orientation" panel={OrientationPanel} />
      <ToolSection
        id="accessibility-tool"
        title="Accessibility"
        onExpandedChange={(expanded) => {
          if (expanded) return;
          onAccessibilityEnabledChange(false);
          onAccessibilityNodesChange([]);
          onAccessibilityHighlight(null);
        }}
      >
        <AccessibilityPanel
          enabled={accessibilityEnabled}
          nodes={accessibilityNodes}
          highlightedId={highlightedAccessibilityId}
          onEnabledChange={onAccessibilityEnabledChange}
          onNodesChange={onAccessibilityNodesChange}
          onHighlight={onAccessibilityHighlight}
        />
      </ToolSection>
      <StaticTool id="location-tool" title="Location" panel={LocationPanel} />
      <StaticTool id="apps-tool" title="Apps" panel={AppManagementPanel} />
      <StaticTool id="logcat-tool" title="Logcat" panel={LogcatPanel} />
      <StaticTool id="session-tool" title="Session" panel={SessionPanel} />
    </>
  );
});
