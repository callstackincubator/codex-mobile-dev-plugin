import { SmartphoneIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";
import type { LogsPanel } from "../logs-panel.ts";
import { SimulatorView } from "./simulator-view";
import { LogsView } from "./logs-view";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export type DeviceLayout = "both" | "ios" | "android";

export function Workspace({ logs, onLayout }: { logs: LogsPanel; onLayout: (layout: DeviceLayout) => void }) {
  const [layout, setLayout] = useState<DeviceLayout>("both");
  return <main className="flex h-dvh flex-col">
    <nav className="workspace-toolbar flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4 max-[600px]:gap-1.5 max-[600px]:px-3" aria-label="Developer tools">
      <div className="mr-auto flex items-center gap-2"><SmartphoneIcon className="size-5" /><h1 className="text-[13px] font-semibold tracking-tight">Mobile Dev</h1></div>
      <Button id="tool-logs" variant="ghost" size="sm" onClick={() => logs.show()}><TerminalIcon />Logs</Button>
      <Select value={layout} onValueChange={value => { const next = value as DeviceLayout; setLayout(next); onLayout(next); }}>
        <SelectTrigger id="device-layout" aria-label="Visible platforms"><SelectValue /></SelectTrigger>
        <SelectContent position="popper" align="end"><SelectItem value="both">iOS + Android</SelectItem><SelectItem value="ios">iOS</SelectItem><SelectItem value="android">Android</SelectItem></SelectContent>
      </Select>
    </nav>
    <div id="workspace-panels" className="flex min-h-0 flex-1 flex-col">
      <div id="simulator-panels" className="flex min-h-0 min-w-0 flex-1" aria-label="Simulators"><SimulatorView platform="ios" /><SimulatorView platform="android" /></div>
      <LogsView panel={logs} />
    </div>
  </main>;
}
