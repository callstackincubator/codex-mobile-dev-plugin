import type { CpuPoint } from '../../shared/cpu.ts';

export const generateTicks = (maxTime: number, currentZoomDuration: number, minTime = 0): number[] => {
  if (currentZoomDuration <= 0) return [];
  const desiredInterval = currentZoomDuration / 6;
  const logarithm = Math.log10(desiredInterval);
  const exponent = Math.floor(logarithm);
  const magnitude = 10 ** exponent;
  const fraction = desiredInterval / magnitude;
  let step = 10;
  if (fraction <= 1) step = 1;
  else if (fraction <= 2) step = 2;
  else if (fraction <= 5) step = 5;
  const interval = step * magnitude;
  const firstTick = Math.ceil(minTime / interval);
  const ticks: number[] = [];
  for (let index = firstTick; index * interval <= maxTime; index++) {
    ticks.push(index * interval);
  }
  return ticks;
};

export const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const ms = Math.floor((seconds % 1) * 1000);
  const wholeSeconds = Math.floor(secs);
  const minuteText = String(mins);
  const secondText = String(wholeSeconds);
  const millisecondText = String(ms);
  const minutes = minuteText.padStart(2, '0');
  const secondsText = secondText.padStart(2, '0');
  const milliseconds = millisecondText.padStart(3, '0');
  return `${minutes}:${secondsText}.${milliseconds}`;
};

export const getAxisYDomain = (
  data: CpuPoint[],
  from: number | undefined,
  to: number | undefined,
  offset: number,
): [number | string, number | string] => {
  if (from != null && to != null) {
    const refData = data.filter((d): d is { time: number; value: number } =>
      d.value !== null && d.time >= from && d.time <= to);
    if (refData.length === 0) return ['dataMin', 'dataMax+10'];

    let bottom = refData[0].value;
    let top = refData[0].value;
    refData.forEach(d => {
      if (d.value > top) top = d.value;
      if (d.value < bottom) bottom = d.value;
    });

    return [(bottom | 0) - offset, (top | 0) + offset];
  }
  return ['dataMin', 'dataMax+10'];
};
