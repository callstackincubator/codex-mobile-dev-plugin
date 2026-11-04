import type { ReactNode } from 'react'
import { ChartNoAxesCombined } from 'lucide-react'
import { Bar, Collapse, Count, Roll, Stage, Window, type Act } from '../../kit'
import { STAGE, WINDOW } from '../md-shared/frame'
import './comparison.css'

// Mobile Dev's performance comparison card, in the AI chat after a fix.
// Beats: under the agent's answer, the comparison card drops
// into the thread; the "1. Before fix" CPU line draws, its row fills in; the
// "2. After fix" line draws over it, lower, and its row fills in; the cursor
// drags across the swipe burst on the chart and every row rolls to that range.
// Payoff: both lines with the busy range selected, the after line clearly
// under the before line, the table saying it once (Peak CPU 22.7% vs 9.8%).
// The card leaves the thread; the request and the answer stay.
//
// The card follows packages/ui/src/components/comparison-card.tsx: header
// icon and "<n> runs · Aligned at recording start · <d>s timeline", the run
// chips bordered in their run color (COMPARISON_COLORS blue then orange),
// the "CPU · %" track with stepped 1 s samples, a blue ReferenceArea for the
// selection, and the summary table's real columns and number formats.
//
// Real strings: the request, the answer line, the card title and subtitle,
// the two runs, the track label, the table.

const BLUE = '#2583ff'
const ORANGE = '#f57b28'

// One second CPU samples over the same 30 s swipe test, before and after
const BEFORE = [1.2, 0.8, 1.1, 0.9, 1.4, 12.6, 16.8, 6.2, 14.1, 19.4, 8.3, 15.7, 22.7, 9.1, 17.2, 20.3, 7.4, 13.8, 18.6, 6.9, 15.2, 19.8, 8.8, 12.4, 4.1, 1.6, 1.1, 0.9, 1.3, 1.0]
const AFTER = [1.0, 0.7, 0.9, 0.8, 1.1, 5.2, 7.4, 2.8, 6.1, 8.3, 3.2, 6.6, 9.8, 3.5, 7.1, 8.4, 2.9, 5.8, 7.9, 2.6, 6.3, 8.1, 3.3, 5.0, 1.9, 1.2, 0.9, 0.8, 1.0, 0.9]
const DURATION = 30
const Y_MAX = 24
const RANGE = { start: 10, end: 20 }
// Where the cursor rests: the window's empty margin right of the chat
// column (column 720 wide, centered in the 864 body: a 72px margin each side)
const REST = { wide: { x: WINDOW.x + WINDOW.width - 36, y: WINDOW.y + WINDOW.height - 76 }, compact: { x: 344, y: 506 } }

// The card's own formats: seconds(), reading()
const seconds = (v: number) => `${v.toFixed(1)}s`
const pct = (v: number) => `${v.toFixed(1)}%`
const mib = (v: number) => `${v.toFixed(1)} MiB`

function summary(samples: number[], memory: number, range?: { start: number; end: number }) {
  const from = range?.start ?? 0
  const to = range?.end ?? DURATION
  const part = samples.slice(from, to)
  const avg = part.reduce((n, v) => n + v, 0) / part.length
  // Rounded as the card shows them, so a Count lands on the printed figure
  const tenth = (v: number) => Math.round(v * 10) / 10
  return { range: `${seconds(from)}–${seconds(to)}`, avg: tenth(avg), peak: tenth(Math.max(...part)), mem: memory }
}

const RUNS = [
  { title: 'Before fix', color: BLUE, samples: BEFORE, all: summary(BEFORE, 14.2), sel: summary(BEFORE, 6.8, RANGE) },
  { title: 'After fix', color: ORANGE, samples: AFTER, all: summary(AFTER, 1.6), sel: summary(AFTER, 0.4, RANGE) },
]

const ANSWER = 'Recorded the same 30-second swipe test after the fix. Here are both runs:'

type S = { fade: boolean; ghost: boolean; card: boolean; drawn: number; filled: number; range: { start: number; end: number } | null; selected: boolean }

const initial: S = { fade: false, ghost: false, card: false, drawn: 0, filled: 0, range: null, selected: false }
const poster: S = { fade: false, ghost: false, card: true, drawn: 2, filled: 2, range: RANGE, selected: true }

// The plot's geometry per layout: the y-axis gutter, plot width and height
const PLOT = {
  wide: { axis: 30, width: 690, height: 70 },
  compact: { axis: 26, width: 296, height: 84 },
}

async function script(a: Act<S>) {
  // The agent has answered under the request; the tool's card arrives
  await a.wait(500)
  a.mark('card')
  a.put({ card: true })
  await a.wait(1000)
  // Run 1 draws, then its row reads out; run 2 draws over it, lower
  a.mark('before')
  a.put({ drawn: 1 })
  await a.wait(1250)
  a.put({ filled: 1 })
  await a.wait(500)
  a.mark('after')
  a.put({ drawn: 2 })
  await a.wait(1250)
  a.put({ filled: 2 })
  await a.wait(700)
  // Drag across the swipe burst: the same range for both runs
  const plot = a.rect('plot')
  const g = PLOT[a.layout]
  const xAt = (t: number) => plot.x + g.axis + (t / DURATION) * (g.width - g.axis)
  const tAt = (x: number) => Math.round(Math.max(0, Math.min(DURATION, ((x - plot.x - g.axis) / (g.width - g.axis)) * DURATION)) * 10) / 10
  const y = plot.y + g.height * 0.42
  a.mark('select')
  await a.move({ x: xAt(RANGE.start), y }, { duration: 750 })
  await a.drag({ x: xAt(RANGE.end), y: y + 4 }, (at) => {
    const t = tAt(at.x)
    if (t > RANGE.start) a.put({ range: { start: RANGE.start, end: t } })
  }, { duration: 1100, cursor: 'preserve' })
  a.put({ range: RANGE, selected: true })
  a.mark('payoff')
  await a.wait(500)
  await a.move(a.layout === 'wide' ? REST.wide : REST.compact, { duration: 700 })
  await a.wait(2300)
  // The thread crossfades to its opening picture (a copy of it, laid over),
  // rather than scrolling backward; the real thread resets under the copy
  a.mark('exit')
  a.put({ fade: true, ghost: true })
  await a.wait(650)
  await a.snap({ ...initial, fade: true, ghost: true })
  // Hand back under cover: the reset thread fades in under the copy, then
  // the copy fades off it, the same picture throughout
  a.put({ fade: false })
  await a.wait(320)
  a.put({ ghost: false })
  await a.wait(320)
}

function steps(samples: number[], w: number, h: number, axis: number) {
  const x = (t: number) => axis + (t / DURATION) * (w - axis)
  const y = (v: number) => h - (v / Y_MAX) * h
  let d = `M${x(0)} ${y(samples[0]!)}`
  samples.forEach((v, i) => {
    if (i > 0) d += `V${y(v)}`
    d += `H${x(i + 1)}`
  })
  return d
}

// A reading: the card's "—" until the run's row fills, then a Count that
// rolls up or down to each new figure; both share one right-aligned cell
function Reading({ on, value, format }: { on: boolean; value: number; format: (n: number) => string }) {
  return (
    <span className="mdc-cell">
      <span className="mdc-layer" data-on={!on || undefined}>—</span>
      <span className="mdc-layer" data-on={on || undefined}><Count value={value} format={format} duration={520} stagger={30} /></span>
    </span>
  )
}

// The thread before the card: the earlier turns (placeholder, with the
// before run's recording card), the request and the agent's answer
function History() {
  return (
    <>
      <div className="mdc-past">
        <Bar w={170} h={30} r={15} tone={1} className="mdc-past-q" />
        <Bar w="74%" h={8} r={4} tone={2} />
        <Bar w="48%" h={8} r={4} tone={2} />
      </div>
      <div className="mdc-past">
        <Bar w={130} h={30} r={15} tone={1} className="mdc-past-q" />
        <Bar w="62%" h={8} r={4} tone={2} />
        <div className="mdc-past-card">
          <div className="mdc-past-head">
            <div className="mdc-heading">
              <div className="mdc-past-title">HorseTinder card swiping</div>
              <div className="mdc-sub">iPhone 17 Pro · 30s · 16:49</div>
            </div>
            <span className="mdc-badge">Finished</span>
          </div>
          <svg className="mdc-past-plot" viewBox="0 0 300 40" preserveAspectRatio="none">
            <path d={steps(BEFORE, 300, 40, 0)} stroke={BLUE} />
          </svg>
        </div>
        <Bar w="70%" h={8} r={4} tone={2} />
        <Bar w="56%" h={8} r={4} tone={2} />
      </div>
      <div className="mdc-q"><span>Record the swipe test again and compare it with the run before the fix</span></div>
      <p className="mdc-a">{ANSWER}</p>
    </>
  )
}

function Plot({ s, layout }: { s: S; layout: 'wide' | 'compact' }) {
  const { axis, width, height } = PLOT[layout]
  const x = (t: number) => axis + (t / DURATION) * (width - axis)
  const ticks = layout === 'wide' ? [0, 7.5, 15, 22.5, 30] : [0, 15, 30]
  return (
    <div className="mdc-plot" data-target="plot" style={{ width, height: height + 18 }}>
      <svg width={width - axis} height={height + 1} viewBox={`${axis} -0.5 ${width - axis} ${height + 1}`} className="mdc-svg" style={{ marginLeft: axis }}>
        {[0, 6, 12, 18, 24].map((v) => {
          const y = height - (v / Y_MAX) * height
          return <line key={v} x1={axis} x2={width} y1={y} y2={y} className="mdc-grid" />
        })}
        {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={height} className="mdc-grid" />)}
        {s.range && (
          <rect className="mdc-range" x={x(s.range.start)} y={0} width={x(s.range.end) - x(s.range.start)} height={height} />
        )}
        {RUNS.map((run, i) => (
          <path key={run.title} d={steps(run.samples, width, height, axis)} pathLength={1} className="mdc-line" stroke={run.color} data-on={s.drawn > i || undefined} />
        ))}
      </svg>
      {[0, 6, 12, 18, 24].map((v) => (
        <span key={v} className="mdc-ytick" style={{ top: height - (v / Y_MAX) * height, width: axis - 6 }}>{v}</span>
      ))}
      {ticks.map((t) => (
        <span key={t} className="mdc-xtick" style={{ left: x(t), top: height + 5 }} data-edge={t === DURATION || undefined}>{seconds(t)}</span>
      ))}
    </div>
  )
}

// Wide: the chat window, whole on the shared md-* frame (md-shared/frame.ts;
// `unframed` on the Stage, since the shared frame (md-shared/frame.ts) asks for the window whole in an
// even 48/40 gutter). Compact: the chat column alone on the page, since a
// window cut to the phone column's width would read taller than wide
function Frame({ compact, children }: { compact: boolean; children: ReactNode }) {
  if (compact) return <div className="mdc-body mdc-page">{children}</div>
  return (
    <Window title="Fix card swipe lag" className="md-window mdc-win" body={{ className: 'mdc-surface' }}>
      <div className="mdc-body">{children}</div>
    </Window>
  )
}

export default function MdComparison() {
  return (
    <Stage<S> width={STAGE.width} height={STAGE.height} unframed compact={{ below: 640, width: 358, height: 520 }} initial={initial} poster={poster} script={script}
      cursor={{ at: REST }} className="mdc">
      {(s, _rect, layout) => {
        const compact = layout === 'compact'
        return (
          <Frame compact={compact}>
              <div className="mdc-thread" data-crop data-fade={s.fade || undefined}>
                <History />
                <Collapse open={s.card} reveal="drop" from="below" className="mdc-slot">
                  <article className="mdc-card" aria-label="Performance comparison">
                    <header className="mdc-head">
                      <span className="mdc-icon"><ChartNoAxesCombined size={compact ? 18 : 20} strokeWidth={2} /></span>
                      <div className="mdc-heading">
                        <div className="mdc-title">Card swiping before and after fix</div>
                        <div className="mdc-sub">2 runs · Aligned at recording start · 30s timeline</div>
                      </div>
                    </header>
                    <div className="mdc-cbody">
                      <div className="mdc-legend">
                        {RUNS.map((run, i) => (
                          <span key={run.title} className="mdc-run" style={{ borderColor: run.color }}>
                            <span className="mdc-swatch" style={{ background: run.color }} />
                            <span className="mdc-run__text">
                              <strong>{i + 1}. {run.title}</strong>
                              <small>iPhone 17 Pro · 30s</small>
                            </span>
                          </span>
                        ))}
                      </div>
                      <div className="mdc-track">
                        <div className="mdc-label">CPU · %</div>
                        <Plot s={s} layout={layout} />
                      </div>
                      <table className="mdc-table">
                        <thead>
                          <tr>
                            <th>Run</th>
                            {!compact && <th>Range</th>}
                            {!compact && <th>Avg CPU</th>}
                            <th>Peak CPU</th>
                            <th>Memory change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {RUNS.map((run, i) => {
                            const v = s.selected ? run.sel : run.all
                            const on = s.filled > i
                            return (
                              <tr key={run.title}>
                                <th><span className="mdc-swatch" style={{ background: run.color }} />{i + 1}. {run.title}</th>
                                {!compact && <td><Roll align="end">{on ? v.range : '—'}</Roll></td>}
                                {!compact && <td><Reading on={on} value={v.avg} format={pct} /></td>}
                                <td><Reading on={on} value={v.peak} format={pct} /></td>
                                <td><Reading on={on} value={v.mem} format={mib} /></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </article>
                </Collapse>
              </div>
              {/* The opening picture, laid over the thread for the loop's
                  crossfade back to the start */}
              <div className="mdc-thread mdc-ghost" data-crop data-on={s.ghost || undefined} aria-hidden>
                <History />
                {/* The closed card slot's place, so the thread's gaps match */}
                <div />
              </div>
          </Frame>
        )
      }}
    </Stage>
  )
}
