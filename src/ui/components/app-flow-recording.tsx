import { useState } from 'react';
import { CameraIcon, CircleIcon, SquareIcon } from 'lucide-react';
import { flowRunning, type FlowRun } from '../../shared/app-flow.ts';
import type { AppFlowPanel } from '../app-flow-panel.ts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect, NativeSelectOption } from './ui/native-select';

export function AppFlowRecording({ panel, run, ready, busy, group, selectGroup }: {
  panel: AppFlowPanel; run?: FlowRun; ready: boolean; busy: boolean; group: string; selectGroup: (group: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('Sign in');
  const [step, setStep] = useState('');
  const [saving, setSaving] = useState(false);
  const running = flowRunning(run);
  const record = async () => {
    await panel.recordFlow(name.trim());
    const recording = panel.getSnapshot().run?.recording;
    if (recording) { setOpen(false); selectGroup(recording.groupId); }
  };
  return <div className="app-flow-recording">
    <div className="app-flow-flow-actions">
      {!!run?.groups?.length && <label>Show<NativeSelect aria-label="Show flow" value={group} onChange={event => selectGroup(event.target.value)}>
        <NativeSelectOption value="all">All screens</NativeSelectOption>
        <NativeSelectOption value="routes">Route map</NativeSelectOption>
        {run.groups.map(group => <NativeSelectOption key={group.id} value={group.id}>{group.name}</NativeSelectOption>)}
      </NativeSelect></label>}
      {run?.recording ? <>
        <Input aria-label="Step name" placeholder="Step name (optional)" maxLength={80} value={step} onChange={event => setStep(event.target.value)} />
        <Button variant="outline" size="sm" disabled={saving || run.phase !== 'recording'} onClick={async () => { setSaving(true); try { await panel.captureStep(step); setStep(''); } finally { setSaving(false); } }}><CameraIcon />Capture step</Button>
        <Button variant="outline" size="sm" onClick={() => { void panel.stop(); }}><SquareIcon />Finish recording</Button>
      </> : <Button variant="ghost" size="sm" disabled={running || busy || !ready} aria-expanded={open} onClick={() => setOpen(value => !value)}><CircleIcon />Record a flow</Button>}
    </div>
    {run?.recording && <p role="status">{run.recording.message}</p>}
    {open && !running && <form onSubmit={event => { event.preventDefault(); void record(); }}>
      <p>Open the first screen of a flow, such as sign-in or onboarding. Move through it in the app; each settled screen joins this map. You control sign-in, sign-out, and form submission.</p>
      <div className="app-flow-flow-actions"><label>Flow name<Input aria-label="Flow name" value={name} maxLength={80} onChange={event => setName(event.target.value)} required /></label>
        <Button type="submit" size="sm" disabled={busy || !ready || !name.trim()}><CircleIcon />Start recording</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>}
  </div>;
}
