import { useState, useSyncExternalStore } from "react";
import { CheckIcon, ChevronDownIcon, FolderOpenIcon, LoaderCircleIcon } from "lucide-react";
import type { AppFlowPanel } from "../app-flow-panel.ts";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * App Flow's project selector: the folders App Flow has been used on, plus the system folder
 * picker for any other one. The panel holds the choice, and the server persists it.
 */
export function AppFlowProjectPicker({ panel }: { panel: AppFlowPanel }) {
  const state = useSyncExternalStore(panel.subscribe, panel.getSnapshot);
  const [open, setOpen] = useState(false);
  const selected = state.projects.find(project => project.path === state.projectPath);
  const label = state.projectPath ? selected?.name ?? state.projectPath.split("/").filter(Boolean).at(-1) ?? state.projectPath : "Choose a project";
  const choose = (projectPath: string) => { setOpen(false); void panel.chooseProject(projectPath); };
  return <div className="flex min-w-0 items-center gap-1">
    <Popover open={open} onOpenChange={value => { setOpen(value); if (value) void panel.refreshProjects(); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-w-0 max-w-72 justify-between gap-1.5 font-normal" aria-label="App Flow project" title={state.projectPath || "Choose a React Native project"}>
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDownIcon className="shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-(--radix-popover-content-available-height) w-max min-w-[min(var(--radix-popover-trigger-width),var(--radix-popover-content-available-width))] max-w-(--radix-popover-content-available-width) flex-col gap-1 overflow-y-auto p-1" aria-label="App Flow project">
        {state.projects.map(project => <Button key={project.path} type="button" variant="ghost" data-project-option={project.path} aria-pressed={project.path === state.projectPath}
          className="h-auto min-h-7 min-w-0 flex-1 justify-start rounded-md px-1.5 py-1 text-left font-normal" onClick={() => choose(project.path)}>
          <span className="flex min-w-0 items-center gap-2">
            <CheckIcon className={`size-3.5 shrink-0 ${project.path === state.projectPath ? "opacity-100" : "opacity-0"}`} />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{project.name}</span>
              <span className="truncate text-xs text-muted-foreground">{project.path}</span>
            </span>
          </span>
        </Button>)}
        {state.projects.length === 0 && <p className="px-1.5 py-1 text-xs text-muted-foreground">No projects yet. Choose a folder to map.</p>}
        <Button type="button" variant="ghost" data-project-browse disabled={state.pickingProject} className="h-auto min-h-7 justify-start rounded-md px-1.5 py-1 text-left font-normal" onClick={() => { setOpen(false); void panel.pickProject(); }}>
          <FolderOpenIcon />Choose another folder…
        </Button>
      </PopoverContent>
    </Popover>
    {state.pickingProject && <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" role="status"><LoaderCircleIcon className="animate-spin" />Choose a folder…</span>}
  </div>;
}
