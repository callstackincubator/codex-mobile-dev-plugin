import { ActivityIcon, CameraIcon, ChevronDownIcon, CpuIcon, DatabaseIcon, GaugeIcon, HouseIcon, MousePointer2Icon, SmartphoneIcon, SlidersHorizontalIcon, SquareIcon } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { Count, Stage, States, Window, type Act, type Layout } from '../../kit'
import { OVERLAY_PHONE, STAGE, WINDOW } from '../md-shared/frame'
import { HORSES, HorseTinderPhone } from '../md-shared/HorseTinder'
import './perf.css'

// Mobile Dev's Live performance panel. Beats: the panel sits Stopped on the
// last run; Start, and the status rolls to Live as Display FPS, CPU and
// Memory stream in on one timeline, their Current stats rolling with each
// sample; the cursor drags the HorseTinder card on the mirrored phone and,
// while it drags, CPU climbs, FPS dips and Memory steps up, all at the head
// of the timeline; the cursor comes back onto the timeline and the blue
// hairline sits on the spike through all three tracks, the ruler reading the
// time and the CPU track the value; then Stop. The loop opens on that run.
//
// The phone is the satellite over the timeline's empty future: the head of
// the data never reaches it. Real strings: the toolbar's tool, platform and
// device, the app and status, the track names and their stats, the ruler's
// times, the app's name and its card.

type S = {
  live: boolean
  // Samples shown: sample i covers seconds i to i+1
  n: number
  // The previous run fading out as a new one starts
  clearing: boolean
  // The card's drag, in screen points, and whether the finger is down
  drag: number
  held: boolean
  // The hovered time in seconds, kept while the hairline fades
  t: number
  hover: boolean
  // The pointer is over the CPU plot, which shows the value tooltip
  tip: boolean
}

// One sample a second: idle, the drag from 5 s to 8 s, idle again
const FPS = [59.8, 60.0, 59.9, 60.0, 59.9, 51.2, 43.6, 38.4, 46.1, 55.3, 59.6, 60.0, 59.9, 60.0, 60.0, 59.8, 60.0, 59.9, 60.0]
const CPU = [6.2, 4.8, 5.1, 7.4, 5.6, 48.3, 79.6, 86.4, 72.1, 31.5, 9.8, 6.0, 5.2, 4.9, 6.3, 5.5, 4.7, 5.8, 5.1]
const MEM = [211.8, 211.9, 212.0, 211.9, 212.1, 218.4, 226.7, 233.9, 236.2, 231.5, 229.8, 229.4, 229.3, 229.4, 229.2, 229.3, 229.3, 229.4, 229.2]
const END = CPU.length
const TICK = 500
const SPIKE = 7

// The shared frame's overlay phone covers the window's right from this x
// (window coordinates) down: the run, its ticks and the header's controls all
// end before it, and only the timeline's empty future sits under the phone
const PHONE_X = OVERLAY_PHONE.x - WINDOW.x

// Wide: the window is the shared 864 x 460 (422 under the bar): header 46,
// ruler 25, three tracks of 117. The product's 30 s view puts the 19 s run's
// end 18 px short of the phone and the 20 s tick just under its edge.
// `clear` is the plot's width a tick label must fit in to stay readable.
const G = {
  wide: { label: 210, track: 117, view: 30, every: 5, win: WINDOW.width, phone: OVERLAY_PHONE.width, inset: 1, clear: PHONE_X - 210 - 10 },
  compact: { label: 124, track: 64, view: 20, every: 10, win: 326, phone: 0, inset: 12, clear: 326 - 124 },
} as const

const geo = (layout: Layout) => {
  const g = G[layout]
  const plot = g.win - g.label - g.inset
  return { ...g, plot, px: plot / g.view }
}

const time = (s: number) => {
  const whole = Math.floor(s)
  const ms = Math.floor((s - whole) * 1000)
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

const stats = (data: number[], n: number) => {
  if (n === 0) return null
  const seen = data.slice(0, n)
  const avg = seen.reduce((a, b) => a + b, 0) / n
  return { current: seen[n - 1]!, avg, max: Math.max(...seen), min: Math.min(...seen) }
}

const f = (v: number) => v.toFixed(1)
// CPU is written with two whole digits, the leading zero under 10% drawn
// clear (data-lead), so the value keeps its columns as it crosses 10% and
// the tens digit rolls in rather than appearing
const pct = (v: number) => `${v < 10 ? '0' : ''}${v.toFixed(1)}%`
const mib = (v: number) => `${v.toFixed(1)} MiB`

// The real chart: a step area for CPU and Memory, a line for FPS, each
// from its sample times, in its own fixed domain
function Series({ data, step, lo, hi, color, px, h, id }: { data: number[]; step: boolean; lo: number; hi: number; color: string; px: number; h: number; id: string }) {
  const top = 14
  const y = (v: number) => (top + (1 - (v - lo) / (hi - lo)) * (h - top - 2)).toFixed(2)
  let d = ''
  if (step) {
    d = `M0 ${y(data[0]!)}`
    data.forEach((v, i) => {
      if (i > 0) d += ` V${y(v)}`
      d += ` H${((i + 1) * px).toFixed(2)}`
    })
  } else {
    d = `M0 ${y(data[0]!)}`
    data.forEach((v, i) => (d += ` L${((i + 0.5) * px).toFixed(2)} ${y(v)}`))
    d += ` L${(data.length * px).toFixed(2)} ${y(data.at(-1)!)}`
  }
  const w = data.length * px
  return (
    <svg className="ml-series" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.42} />
          <stop offset="100%" stopColor={color} stopOpacity={0.06} />
        </linearGradient>
      </defs>
      <path d={`${d} V${h} H0 Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  )
}

// A stat's value: figures that roll with each sample (up as they rise, down
// as they fall), and the plain text between them
type Part = string | { v: number; fmt: (n: number) => string }
const num = (v: number, fmt: (n: number) => string): Part => ({ v, fmt })

// A stat: between a run and no run the value and its dash crossfade in one
// slot; during a run only its changed digits move
function Metric({ label, value, empty }: { label: string; value: Part[] | null; empty: string }) {
  const last = useRef<Part[]>(value ?? [empty])
  if (value !== null) last.current = value
  return (
    <div className="ml-metric">
      <span>{label}</span>
      <States
        className="ml-metric__value"
        align="end"
        value={value === null ? 'empty' : 'data'}
        states={{
          empty,
          data: (
            <span className="ml-parts">
              {last.current.map((p, i) =>
                typeof p === 'string' ? (
                  <span key={i}>{p}</span>
                ) : (
                  <Count key={i} value={p.v} format={p.fmt} duration={260} stagger={16} data-lead={(p.fmt === pct && p.v < 10) || undefined} />
                ),
              )}
            </span>
          ),
        }}
      />
    </div>
  )
}

type TrackProps = { s: S; layout: Layout; name: string; icon: ReactNode; metrics: { label: string; value: Part[] | null; empty?: string }[]; chevron?: boolean; children: ReactNode; tip?: string | null; target: string }

function Track({ s, layout, name, icon, metrics, chevron, children, tip, target }: TrackProps) {
  const g = geo(layout)
  // The tooltip keeps its last value while it fades
  const lastTip = useRef('')
  if (tip) lastTip.current = tip
  const reveal = s.n * g.px
  const x = s.t * g.px
  return (
    <div className="ml-track" style={{ height: g.track }}>
      <div className="ml-label" style={{ width: g.label }}>
        <div className="ml-label__head">
          {icon}
          <span className="ml-label__name">{name}</span>
          {chevron && <ChevronDownIcon className="ml-label__chev" size={14} />}
        </div>
        <div className="ml-metrics">
          {metrics.map((m) => (
            <Metric key={m.label} label={m.label} value={m.value} empty={m.empty ?? '—'} />
          ))}
        </div>
      </div>
      <div className="ml-plot" data-target={target}>
        <Grid layout={layout} />
        <div className="ml-reveal" data-crop data-clearing={s.clearing || undefined} style={{ width: reveal }}>
          {children}
        </div>
        <span className="ml-hair" data-on={s.hover || undefined} style={{ transform: `translateX(${x}px)` }} />
        {tip !== undefined && (
          <span className="ml-tip" data-on={(s.hover && s.tip && tip !== null) || undefined} style={{ transform: `translate(${x + 6}px, ${g.track / 2 - 9}px)` }}>
            {lastTip.current}
          </span>
        )}
      </div>
    </div>
  )
}

function Grid({ layout }: { layout: Layout }) {
  const g = geo(layout)
  const ticks: number[] = []
  for (let t = g.every; t < g.view; t += g.every) ticks.push(t)
  return (
    <>
      {ticks.map((t) => (
        <span key={t} className="ml-grid" style={{ left: t * g.px }} />
      ))}
    </>
  )
}

async function script(a: Act<S>) {
  const layout = a.layout
  const g = geo(layout)
  await a.wait(700)
  a.mark('start')
  // The cursor opens on the button that stopped the last run
  await a.click()
  a.put({ live: true, clearing: true })
  // The old run fades; while it is clear its reveal runs back to the start
  await a.wait(240)
  a.put({ n: 0 })

  // The stream: one sample every TICK, on its own clock beside the cursor
  const stream = (async () => {
    for (let i = 1; i <= END; i++) {
      await a.wait(TICK)
      a.put({ n: i, clearing: false })
    }
  })()

  if (layout === 'wide') {
    // Over to the phone while the first samples land
    await a.wait(600)
    const card = a.rect('card')
    const grip = { x: card.x + card.width * 0.62, y: card.y + card.height * 0.42 }
    await a.move(grip, { duration: 1150 })
    await a.wait(Math.max(0, 5 * TICK + 140 - 1990))
    a.mark('drag')
    // Pixels per screen point: the kit's iPhone is 402 points of screen
    // inside a 13 point band each side
    const scale = a.rect('phone').width / 428
    // Dragging left toward Pass, not far enough to throw: the card follows
    // the pointer, then springs back to the deck on release
    a.put({ held: true })
    await a.drag(
      { x: grip.x - 78, y: grip.y + 8 },
      (at, from) => a.put({ drag: (at.x - from.x) / scale }),
      { duration: 1500, cursor: 'preserve' },
    )
    a.put({ held: false, drag: 0 })
    await a.wait(700)
  } else {
    // No phone in the narrow design: the cursor steps off the button onto
    // the header's empty middle and waits while the spike streams in
    await a.wait(500)
    const toggle = a.rect('toggle')
    await a.move({ x: toggle.x - 78, y: toggle.y + toggle.height * 0.7 }, { duration: 700 })
    // As long as the wide design's drag takes, so both reach the spike together
    await a.wait(3600)
  }

  // Back onto the timeline, on the spike in the CPU track
  a.mark('hover')
  const plot = a.rect('cpu-plot')
  const phone = layout === 'wide' ? a.rect('phone') : { x: Infinity, y: Infinity, width: 0, height: 0 }
  const spike = { x: plot.x + (SPIKE + 0.45) * g.px, y: plot.y + plot.height * 0.62 }
  const tracks = { top: a.rect('fps-plot').y, bottom: a.rect('mem-plot').y + a.rect('mem-plot').height }
  const over = (pt: { x: number; y: number }) =>
    pt.x >= plot.x && pt.x <= plot.x + g.plot && pt.y >= tracks.top && pt.y <= tracks.bottom &&
    !(pt.x >= phone.x && pt.y >= phone.y)
  // The hairline follows the pointer over the tracks, as the panel's does;
  // leaving, it fades where it was
  let on = false
  const follow = (pt: { x: number; y: number }) => {
    if (over(pt)) {
      on = true
      a.put({ hover: true, t: (pt.x - plot.x) / g.px, tip: pt.y >= plot.y && pt.y <= plot.y + plot.height })
    } else if (on) {
      on = false
      a.put({ hover: false, tip: false })
    }
  }
  await a.move(spike, { duration: 1100, onMove: follow })
  await a.wait(2600)

  // Up to Stop as the last samples land
  a.mark('stop')
  await a.move({ at: 'toggle', x: 0.5, y: 0.55 }, { duration: 1100, onMove: follow })
  await stream
  await a.wait(200)
  await a.click()
  a.put({ live: false })
  await a.wait(700)
  // The hairline is long gone: its time goes back unseen, once the status
  // and the button have settled
  await a.snap({ t: INITIAL.t })
  await a.wait(300)
}

const INITIAL: S = { live: false, n: END, clearing: false, drag: 0, held: false, t: SPIKE + 0.45, hover: false, tip: false }
const POSTER: S = { live: true, n: 18, clearing: false, drag: 0, held: false, t: SPIKE + 0.45, hover: true, tip: true }

export default function PerformanceLive() {
  return (
    <Stage<S>
      width={STAGE.width}
      height={STAGE.height}
      // The shared frame (md-shared/frame.ts) asks for the window whole on the shared frame, an even 48/40
      // gutter, so film's floating-window check stands down, as in the other md-* scenes
      unframed
      compact={{ below: 720, width: 358, height: 340 }}
      initial={INITIAL}
      poster={POSTER}
      script={script}
      cursor={{ at: { at: 'toggle', x: 0.5, y: 0.55 } }}
      className="ml"
    >
      {(s, _rect, layout) => {
        const g = geo(layout)
        const wide = layout === 'wide'
        const fps = s.clearing ? null : stats(FPS, s.n)
        const cpu = s.clearing ? null : stats(CPU, s.n)
        const mem = s.clearing ? null : stats(MEM, s.n)
        const at = Math.floor(s.t)
        const tip = at < s.n ? `${f(CPU[at]!)} %` : null
        return (
          <>
            <Window
              className="md-window ml-win"
              style={wide ? undefined : { width: g.win }}
              lead={
                <div className="ml-tools">
                  <span className="ml-pick">
                    <ActivityIcon size={14} />
                    Performance
                    <ChevronDownIcon size={13} className="ml-pick__chev" />
                  </span>
                  <span className="ml-pick">
                    iOS
                    <ChevronDownIcon size={13} className="ml-pick__chev" />
                  </span>
                  {wide && (
                    <span className="ml-pick">
                      <span className="ml-device">
                        <SmartphoneIcon size={14} />
                        <i />
                      </span>
                      iPhone 17 Pro · iOS 26.3
                      <ChevronDownIcon size={13} className="ml-pick__chev" />
                    </span>
                  )}
                </div>
              }
              toolbar={
                wide ? (
                  <div className="ml-icons">
                    <HouseIcon size={15} />
                    <CameraIcon size={15} />
                    <MousePointer2Icon size={15} />
                  </div>
                ) : undefined
              }
            >
              <div className="ml-panel">
                <header className="ml-head">
                  <ActivityIcon size={16} className="ml-head__icon" />
                  <div className="ml-head__text">
                    <div>com.upo.horsetinder</div>
                    <div className="ml-head__sub">iPhone 17 Pro</div>
                  </div>
                  <span className="ml-status">
                    <States value={s.live ? 'live' : 'stopped'} align="end" states={{ live: 'Live', stopped: 'Stopped' }} />
                  </span>
                  <span className="ml-icon-btn" data-target="toggle">
                    <States value={s.live ? 'stop' : 'start'} states={{ start: <ActivityIcon size={15} />, stop: <SquareIcon size={14} /> }} />
                  </span>
                  <span className="ml-icon-btn">
                    <SlidersHorizontalIcon size={15} />
                  </span>
                </header>
                <div className="ml-ruler">
                  <div className="ml-ruler__label" style={{ width: g.label }}>
                    <span>Live performance</span>
                  </div>
                  <div className="ml-ruler__plot">
                    {Array.from({ length: Math.ceil(g.view / g.every) - 1 }, (_, i) => (i + 1) * g.every).filter((t) => t * g.px + 66 <= g.clear).map((t) => (
                      <span key={t} className="ml-tick" data-under={(s.hover && Math.abs(s.t * g.px - (t * g.px + 34)) < 64) || undefined} style={{ left: t * g.px }}>
                        {time(t)}
                      </span>
                    ))}
                    <span className="ml-pill" data-on={s.hover || undefined} style={{ transform: `translateX(${s.t * g.px}px)` }}>
                      <span>{time(s.t)}</span>
                    </span>
                  </div>
                </div>
                <Track
                  s={s}
                  layout={layout}
                  target="fps-plot"
                  name="Display FPS"
                  icon={<GaugeIcon size={16} className="ml-ic ml-ic--fps" />}
                  metrics={[
                    { label: 'Current', value: fps ? [num(fps.current, f)] : null },
                    ...(wide ? [{ label: 'Avg', value: fps ? [num(fps.avg, f)] : null }, { label: 'Max', value: fps ? [num(fps.max, f)] : null }] : []),
                    { label: 'Min', value: fps ? [num(fps.min, f)] : null },
                  ]}
                >
                  <Series id="ml-fps" data={FPS} step={false} lo={14} hi={64} color="#22c55e" px={g.px} h={g.track - 1} />
                </Track>
                <Track
                  s={s}
                  layout={layout}
                  target="cpu-plot"
                  name="CPU"
                  chevron
                  tip={tip}
                  icon={<CpuIcon size={16} className="ml-ic ml-ic--cpu" />}
                  metrics={[
                    { label: 'Current', value: cpu ? [num(cpu.current, pct)] : null },
                    ...(wide ? [{ label: 'Avg', value: cpu ? [num(cpu.avg, pct)] : null }] : []),
                    { label: 'Max', value: cpu ? [num(cpu.max, pct)] : null },
                    ...(wide ? [{ label: 'Threads', value: cpu ? ['16'] : null, empty: '0' }] : []),
                  ]}
                >
                  <Series id="ml-cpu" data={CPU} step lo={0} hi={96} color="#3b82f6" px={g.px} h={g.track - 1} />
                </Track>
                <Track
                  s={s}
                  layout={layout}
                  target="mem-plot"
                  name="Memory"
                  icon={<DatabaseIcon size={16} className="ml-ic ml-ic--mem" />}
                  metrics={[
                    { label: 'Current', value: mem ? [num(mem.current, mib)] : null },
                    ...(wide ? [{ label: 'Avg', value: mem ? [num(mem.avg, mib)] : null }] : []),
                    { label: 'Max', value: mem ? [num(mem.max, mib)] : null },
                    ...(wide ? [{ label: 'Min', value: mem ? [num(mem.min, mib)] : null }] : []),
                  ]}
                >
                  <Series id="ml-mem" data={MEM} step lo={196} hi={240} color="#f97316" px={g.px} h={g.track - 1} />
                </Track>
              </div>
            </Window>
            {wide && (
              // The shared HorseTinder (md-shared): the card follows the
              // drag and springs back over Juniper, next in the deck
              <HorseTinderPhone
                width={g.phone}
                phoneClassName="md-overlay-phone ml-phone"
                phoneProps={{ 'data-target': 'phone' }}
                next={HORSES.juniper}
                card={{
                  className: 'ml-card',
                  'data-target': 'card',
                  'data-held': s.held || undefined,
                  style: { transform: `translate(${s.drag}px, ${-Math.abs(s.drag) * 0.06}px) rotate(${s.drag * 0.02}deg)` },
                }}
              />
            )}
          </>
        )
      }}
    </Stage>
  )
}
