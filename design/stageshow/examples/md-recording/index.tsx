import type { ReactNode } from 'react'
import { InfoIcon, MessageCircleIcon } from 'lucide-react'
import { Collapse, Roll, Stage, Swap, Text, Window, type Act, type Layout } from '../../kit'
import { STAGE } from '../md-shared/frame'
import './recording.css'

// Mobile Dev's performance recording card, in the AI chat. Beats: the user
// has asked for a recording; the card sits under the request as Recording and
// its CPU and memory lines draw in live, the readouts stepping at each of the
// three swipes; it turns Finished and the purple change spans settle on the
// charts and the minimap; the pointer drags across the second swipe on the
// CPU chart and the card answers for that range (Selected range, the thread
// shares, Ask about this range); it rests on the button, then moves off.
// The card leaves as one under the request, which stays put, and the next
// recording's card drops into its place. Loops.
//
// What makes it read as the product:
// - The real card's anatomy and words: header with status pill, CPU and
//   Memory (MiB) tracks with their headline metric, the right column's
//   minimap, Threads and the black Ask button. Nothing invented.
// - The range is the product's own interaction: a drag on a chart, the blue
//   band under the pointer on both charts and the minimap, the sidebar
//   switching to that range. The totals in the track headings stay totals,
//   as they do in the product.
// - Lines are drawn once, left to right, at recording speed; the purple
//   change spans only arrive after Finished, as the product reveals them.
// - The chat around it is quiet: a new thread, one black bubble at the top
//   that stays where it is while one card leaves under it and the next arrives.
//
// Real strings: the request, the card's title and meta, the status, the
// track labels and metrics, the minimap heading and times, three threads,
// the actions.

const T = 30
// One CPU reading a second (% of one core): idle, then three swipes
const CPU = [0.2, 0.1, 0.2, 0.3, 0.1, 0.2, 0.4, 9.8, 6.1, 1.2, 0.4, 0.3, 0.2, 0.5, 13.4, 22.7, 8.2, 3.1, 0.6, 0.4, 0.3, 0.2, 18.9, 11.6, 2.4, 0.5, 0.3, 0.2, 0.2, 0.1, 0.2]
// Physical footprint in MiB
const MEM = [266, 266, 266, 266, 266, 266, 266, 265, 260, 259.5, 260.5, 261, 261, 261, 260.5, 257, 256, 257.5, 258, 258, 257.5, 258, 258.5, 260, 259, 255.5, 255, 255, 255, 255, 255]
// The most rapid changes, as the product marks them
const CPU_SPANS: [number, number][] = [[6.6, 8.4], [14.2, 16.3], [21.8, 23.4]]
const MEM_SPANS: [number, number][] = [[7.2, 8.6], [14.6, 16.2], [24.4, 25.6]]
// The minimap marks every metric's changes, overlapping ones as one mark
const ALL_SPANS = [...CPU_SPANS, ...MEM_SPANS].sort((a, b) => a[0] - b[0]).reduce<[number, number][]>((out, [a, b]) => {
  const last = out[out.length - 1]
  if (last && a <= last[1]) last[1] = Math.max(last[1], b)
  else out.push([a, b])
  return out
}, [])
// The range the pointer drags across: the second swipe
const RANGE: [number, number] = [13.4, 17.8]

// Readouts as the recording reaches each swipe (index = swipes recorded)
const PEAK = [0.4, 9.8, 22.7, 22.7]
const DELTA = [0, -6, -10, -11]
const THREADS = [
  { name: 'Thread 2579c4', live: [0.1, 1.2, 2.3, 2.8], range: 9.6 },
  { name: 'com.facebook.react.runtime.JavaScript', live: [0.1, 1.0, 2.0, 2.4], range: 8.1 },
  { name: 'Thread 2c6a3e', live: [0.0, 0.1, 0.2, 0.3], range: 1.1 },
]

const DRAW = 4600
// When each swipe is drawn, as ms into the draw
const SWIPE_AT = [8.2, 15.4, 23.2].map((t) => (t / T) * DRAW)

type S = {
  /** Which of the two card slots holds the current recording */
  gen: 0 | 1
  /** The other slot is the finished card leaving (else it waits, empty) */
  out: boolean
  rec: 'idle' | 'live' | 'done'
  swipes: number
  spans: boolean
  range: [number, number] | null
  picked: boolean
}

const initial: S = { gen: 0, out: false, rec: 'idle', swipes: 0, spans: false, range: null, picked: false }
const poster: S = { gen: 0, out: false, rec: 'done', swipes: 3, spans: true, range: RANGE, picked: true }
// What the finished card shows while it leaves, and the waiting one shows
const DONE: S = poster

// Chart geometry per layout
const GEO = {
  wide: { w: 470, plot: 75 },
  compact: { w: 300, plot: 82 },
}
const AXIS_W = 36
const PAD_R = 10
const PAD_T = 6
const AXIS_H = 16

// Where the pointer rests: on empty surface in the window body's right margin,
// beside the chat column (wide), or beside the bubble (compact)
const REST = { wide: { x: 876, y: 300 }, compact: { x: 60, y: 44 } }

const pct = (n: number) => `${n.toFixed(1)}%`
const secs = (n: number) => `${n.toFixed(1)}s`

async function script(a: Act<S>) {
  await a.wait(400)
  a.mark('live')
  a.put({ rec: 'live' })
  let at = 0
  for (let i = 0; i < SWIPE_AT.length; i++) {
    await a.wait(SWIPE_AT[i]! - at)
    at = SWIPE_AT[i]!
    a.put({ swipes: i + 1 })
  }
  await a.wait(DRAW - at + 150)
  a.mark('finished')
  a.put({ rec: 'done' })
  await a.wait(250)
  a.put({ spans: true })
  await a.wait(900)

  // Onto the CPU chart at the start of the second swipe, then across it
  a.mark('drag')
  const box = a.rect('plot-cpu')
  const x = (t: number) => box.x + (t / T) * box.width
  const y = box.y + box.height * 0.42
  await a.move({ x: x(RANGE[0]), y }, { duration: 800 })
  await a.wait(200)
  const t0 = RANGE[0]
  // A range drag on a plot, not a text selection: the band grows from the
  // crosshair and stays under it every frame
  await a.move({ x: x(RANGE[1]), y }, {
    duration: 700,
    path: (e, from, to) => ({ x: from.x + (to.x - from.x) * e, y: from.y }),
    onMove: (p) => {
      const t = Math.max(t0, Math.min(T, ((p.x - box.x) / box.width) * T))
      a.put({ range: t - t0 > 0.15 ? [t0, t] : null })
    },
  })
  a.put({ range: RANGE })
  a.mark('picked')
  a.put({ picked: true })
  await a.wait(1100)

  a.mark('ask')
  await a.move({ at: 'ask', x: 0.95, y: 0.66 }, { duration: 750 })
  await a.wait(1900)
  await a.move(REST[a.layout], { duration: 600 })
  await a.wait(500)

  // The finished card leaves under the request and the next recording's card
  // drops into its place: a new card, so no data rewinds in view
  a.mark('exit')
  a.put({ gen: 1, out: true, rec: 'idle', swipes: 0, spans: false, range: null, picked: false })
  await a.wait(600)
  // The closed slot empties out of sight, then the two slots, now holding the
  // same new card, swap back unseen so the loop starts where it began
  a.put({ out: false })
  await a.wait(550)
  a.snap({ gen: 0 })
  await a.wait(60)
}

// A step line for CPU (one reading held until the next), straight for memory
function linePath(data: number[], fx: (i: number) => number, fy: (v: number) => number, step: boolean) {
  let d = `M${fx(0)},${fy(data[0]!)}`
  for (let i = 1; i < data.length; i++) d += step ? `H${fx(i)}V${fy(data[i]!)}` : `L${fx(i)},${fy(data[i]!)}`
  return d
}

function Info() {
  return <InfoIcon className="mr-info" size={13} strokeWidth={2} aria-hidden />
}

function Track({ name, label, metricLabel, metric, data, lo, hi, ticks, tickLabel, color, step, spans, s, layout, live }: {
  name: string; label: string; metricLabel: string; metric: ReactNode; data: number[]; lo: number; hi: number; ticks: number[]; tickLabel: (n: number) => string
  color: string; step: boolean; spans: [number, number][]; s: S; layout: Layout; live: boolean
}) {
  const g = GEO[layout]
  const pw = g.w - AXIS_W - PAD_R
  const H = PAD_T + g.plot + AXIS_H
  const fx = (t: number) => AXIS_W + (t / T) * pw
  const fy = (v: number) => PAD_T + g.plot - ((v - lo) / (hi - lo)) * g.plot
  const line = linePath(data, fx, fy, step)
  const area = `${line}V${fy(lo)}H${fx(0)}Z`
  const xTicks = [0, 8, 16, 24, 30]
  const range = s.range
  return (
    <div className="mr-track">
      <div className="mr-track-head">
        <span className="mr-h">{label}</span>
        <Info />
        <span className="mr-metric"><span className="mr-dot">·</span>{metricLabel} <strong>{metric}</strong></span>
      </div>
      <div className="mr-chart" style={{ width: g.w, height: H }}>
        <svg className="mr-grid" width={g.w} height={H}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={AXIS_W} x2={AXIS_W + pw} y1={fy(t)} y2={fy(t)} />
              <text x={AXIS_W - 5} y={fy(t)} textAnchor="end" dominantBaseline="central">{tickLabel(t)}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={t}>
              <line x1={fx(t)} x2={fx(t)} y1={PAD_T} y2={PAD_T + g.plot} />
              <text x={fx(t)} y={PAD_T + g.plot + 11} textAnchor={t === 0 ? 'start' : t === T ? 'end' : 'middle'}>{secs(t)}</text>
            </g>
          ))}
          <g className="mr-spans" data-on={s.spans || undefined}>
            {spans.map(([a, b]) => <rect key={a} x={fx(a)} y={PAD_T} width={fx(b) - fx(a)} height={g.plot} />)}
          </g>
        </svg>
        {/* The line and its area, uncovered left to right as the recording runs */}
        <svg className="mr-line" data-rec={s.rec} width={g.w} height={H} style={{ ['--mr-l' as string]: `${AXIS_W}px`, ['--mr-r' as string]: `${PAD_R}px` }}>
          <path d={area} fill={color} fillOpacity={0.07} />
          <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
        </svg>
        <svg className="mr-range" width={g.w} height={H} data-on={range ? '' : undefined}>
          {range && <rect x={fx(range[0])} y={PAD_T} width={fx(range[1]) - fx(range[0])} height={g.plot} />}
        </svg>
        <div className="mr-plot" data-target={live ? `plot-${name}` : undefined} data-cursor="crosshair" style={{ left: AXIS_W, top: PAD_T, width: pw, height: g.plot }} />
      </div>
    </div>
  )
}

// One recording's card. Two are kept, so the next recording's card can drop
// in as the finished one leaves; only the current one carries targets
function Card({ s, layout, live }: { s: S; layout: Layout; live: boolean }) {
  const wide = layout === 'wide'
  const picked = s.picked
  return (
    <div className="mr-card">
      <div className="mr-header">
        <div className="mr-heading">
          <div className="mr-title">HorseTinder card swiping</div>
          <div className="mr-sub">iPhone 17 Pro · 30s · 16:49</div>
        </div>
        <span className="mr-status"><Swap id={s.rec === 'done' ? 'done' : 'rec'}>{s.rec === 'done' ? 'Finished' : 'Recording'}</Swap></span>
      </div>
      <div className="mr-cols">
        <div className="mr-charts">
          <Track name="cpu" label="CPU" metricLabel="Peak" metric={<Roll align="start">{pct(PEAK[s.swipes]!)}</Roll>} data={CPU} lo={0} hi={100} ticks={[0, 25, 50, 75, 100]} tickLabel={(n) => `${n}%`} color="#2583ff" step spans={CPU_SPANS} s={s} layout={layout} live={live} />
          {wide && <Track name="mem" label="Memory (MiB)" metricLabel="Δ" metric={<Roll align="start">{`${DELTA[s.swipes]!} MiB`}</Roll>} data={MEM} lo={251} hi={267} ticks={[251, 255, 259, 263, 267]} tickLabel={(n) => `${n}`} color="#f57b28" step={false} spans={MEM_SPANS} s={s} layout={layout} live={live} />}
        </div>
        <div className="mr-rule mr-rule--cols" />
        <div className="mr-side">
          <div className="mr-overview">
            <div className="mr-sechead">
              <span className="mr-h"><Swap id={picked ? 'range' : 'all'}>{picked ? 'Selected range' : 'Entire recording'}</Swap></span>
              <Info />
              <span className="mr-clear" data-on={picked || undefined}>Clear</span>
            </div>
            <div className="mr-mini">
              {ALL_SPANS.map(([a, b], i) => (
                <span key={a} className="mr-mini-change" data-on={s.spans || undefined} style={{ left: `${(a / T) * 100}%`, width: `${((b - a) / T) * 100}%`, transitionDelay: s.spans ? `${i * 50}ms` : '0ms' }} />
              ))}
              <span className="mr-mini-range" data-on={s.range ? '' : undefined} style={s.range ? { left: `${(s.range[0] / T) * 100}%`, width: `${((s.range[1] - s.range[0]) / T) * 100}%` } : { left: `${(RANGE[0] / T) * 100}%`, width: 0 }} />
            </div>
            <div className="mr-mini-labels">
              <span><Roll>{secs(picked ? RANGE[0] : 0)}</Roll></span>
              <span><Roll align="end">{secs(picked ? RANGE[1] : T)}</Roll></span>
            </div>
          </div>
          <div className="mr-rule" />
          <div className="mr-threads">
            <div className="mr-sechead"><span className="mr-h">Threads</span><Info /></div>
            <div className="mr-list">
              {THREADS.map((t) => (
                <div className="mr-thread-row" key={t.name}>
                  <span className="mr-thread-name">{t.name}</span>
                  <span className="mr-thread-value"><Roll align="end">{pct(picked ? t.range : t.live[s.swipes]!)}</Roll></span>
                </div>
              ))}
            </div>
          </div>
          <div className="mr-rule" />
          <div className="mr-actions">
            <span className="mr-ask" data-target={live ? 'ask' : undefined} data-cursor="pointer">
              <span className="mr-layer" data-on={!picked || undefined}><MessageCircleIcon size={14} strokeWidth={2} aria-hidden />Ask about recording</span>
              <span className="mr-layer" data-on={picked || undefined}><MessageCircleIcon size={14} strokeWidth={2} aria-hidden />Ask about this range</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MdRecording() {
  return (
    <Stage
      width={STAGE.width}
      height={STAGE.height}
      // The shared md-* frame keeps the window whole in an even 48/40 gutter
      // (UNIFY.md), so film's floating-window check stands down
      unframed
      compact={{ below: 720, width: 358, height: 578 }}
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: REST }}
      className="mr"
    >
      {(s, _rect, layout) => {
        const wide = layout === 'wide'
        const thread = (
            <div className="mr-thread">
              <div className="mr-q"><Text>Make a performance recording and swipe 3 cards</Text></div>
              {/* The next recording's card opens above the finished one as it leaves */}
              {[1, 0].map((i) => (
                <Collapse key={i} open={s.gen === i} reveal="drop" className="mr-slot">
                  <Card s={s.gen === i ? s : s.out ? DONE : initial} layout={layout} live={s.gen === i} />
                </Collapse>
              ))}
            </div>
        )
        // Narrow: the chat column on the page, no desktop window
        return wide ? <Window title="Profile card swipe lag" className="md-window mr-win" body={{ className: 'mr-body' }}>{thread}</Window> : <div className="mr-page">{thread}</div>
      }}
    </Stage>
  )
}
