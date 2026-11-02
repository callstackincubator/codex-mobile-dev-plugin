import { animate, type DitherOptions } from './dither';

type Message =
  | ({ type: 'init'; id: number; canvas: OffscreenCanvas } & DitherOptions)
  | { type: 'size'; id: number; width: number; height: number }
  | { type: 'visible'; id: number; on: boolean }
  | { type: 'motion'; id: number; still: boolean }
  | { type: 'dispose'; id: number };

const runs = new Map<number, ReturnType<typeof animate>>();

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'init') {
    const run = animate(message.canvas, message);
    runs.set(message.id, run);
    return;
  }
  const run = runs.get(message.id);
  if (run === undefined) return;
  switch (message.type) {
    case 'size':
      run.setSize(message.width, message.height);
      break;
    case 'visible':
      run.setVisible(message.on);
      break;
    case 'motion':
      run.setStill(message.still);
      break;
    case 'dispose':
      run.dispose();
      runs.delete(message.id);
      break;
  }
};
