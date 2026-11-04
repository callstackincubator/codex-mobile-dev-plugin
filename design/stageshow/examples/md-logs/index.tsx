import {
  ArrowDownToLine,
  BadgeCheck,
  Camera,
  Carrot,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Copy,
  Heart,
  House,
  Info,
  Layers,
  ListX,
  MessageCircle,
  MousePointer2,
  Pause,
  Search,
  SlidersHorizontal,
  Smartphone,
  Terminal,
  X,
} from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Bar, Collapse, Count, Field, Phone, Stage, Window, type Act, type Layout } from '../../kit'
import { DEVICE_PANE, STAGE } from '../md-shared/frame'
import { HorseTinderPhone } from '../md-shared/HorseTinder'
import './logs.css'

// Mobile Dev's Logs, beside the simulator it reads. The window is the
// product's side-by-side workspace: the log list on the left, the device
// column on the right with HorseTinder running. Beats:
//   1. LIKE is tapped on the simulator: a red error row arrives at the foot
//      of the live list, which follows new logs.
//   2. LIKE twice more: the row stacks, its repeat badge appears and ticks to
//      3 while its timestamp rolls on.
//   3. "recordLike" is typed into Filter logs...: the list closes around the
//      error.
//   4. The row is opened: its details (message, stack trace, Fix in chat)
//      fill the pane under it. Payoff, held.
// The loop resets the way the product would: the row is closed, Escape
// clears the search field, and the logs that streamed in while the filter
// was on reopen beneath the error and carry it out of view. The rows left in
// view are the opening's own, so the last step is invisible.
//
// Real strings: Logs, iOS, the device, Filter logs..., recordLike, the error
// (time, message, stack) and HorseTinder's Monty. Every other log is a line.
//
// Compact: the simulator, cropped at the top inside Monty's photo, stands
// behind the Logs panel, which sits over its foot as the narrow panel does
// under the device; the details drop the stack trace.

type Item = { id: string; kind: 'f'; spec: number } | { id: 'err'; kind: 'e' }

type S = {
  items: Item[]
  /** Rows not yet opened (arriving) */
  closed: string[]
  count: number
  sec: number
  query: string
  focused: boolean
  selected: boolean
  /** The invisible swap back to the opening list */
  seam: boolean
}

// One cycle of filler logs. `lines` are message bar widths as fractions of
// the message column; `keep` is how many typed characters the row still
// matches, so the list closes in a cascade as "recordLike" is typed.
// `from` is the process or tag the product prints first: the app's native
// process and its Metro tag, side by side in one list.
const SPECS: { lines: number[]; keep: number; from?: string }[] = [
  { lines: [0.82], keep: 1, from: 'com.upo.horsetinder:' },
  { lines: [0.96, 0.44], keep: 0 },
  { lines: [0.66], keep: 2, from: 'horsetinder:' },
  { lines: [0.74], keep: 1 },
  { lines: [0.9, 0.28], keep: 3, from: 'com.upo.horsetinder:' },
  { lines: [0.52], keep: 0 },
]
const N = SPECS.length
const OPENING = 16
// Fillers that arrive after the error before the loop ends: a whole number
// of cycles, and enough to fill the list beneath the error
const AFTER = 12

const filler = (i: number): Item => ({ id: `f${i}`, kind: 'f', spec: i % N })
const OPEN_ITEMS: Item[] = Array.from({ length: OPENING }, (_, i) => filler(i))

const initial: S = { items: OPEN_ITEMS, closed: [], count: 1, sec: 48, query: '', focused: false, selected: false, seam: false }

const POSTER: S = {
  items: [...OPEN_ITEMS.slice(-3), { id: 'err', kind: 'e' }, ...Array.from({ length: AFTER }, (_, i) => filler(OPENING + i))],
  closed: [],
  count: 3,
  sec: 50,
  query: 'recordLike',
  focused: false,
  selected: true,
  seam: false,
}

const MESSAGE = "horsetinder: [recordLike] Failed to record like: TypeError: Cannot read property 'id' of undefined"
const STACK = [
  'at recordLike (src/api/recordLike.ts:14:28)',
  'at onLike (src/screens/Swipe.tsx:42:7)',
  'at onPress (src/components/LikeButton.tsx:18:5)',
]

const REST = { wide: { x: 568, y: 474 }, compact: { x: 318, y: 150 } }
// The message column's width in each layout, for the filler bars
const COL = { wide: 450, compact: 210 }

const shows = (it: Item, q: string) => !q || it.kind === 'e' || q.length <= SPECS[it.spec]!.keep

// The list keeps the rows it can show and a few above, as the product's
// virtualized list does: the oldest filler leaves as each log arrives
function push(items: Item[], item: Item) {
  const out = [...items, item]
  while (out.length > OPENING) out.splice(out.findIndex((it) => it.kind === 'f'), 1)
  return out
}

async function arrive(a: Act<S>, item: Item) {
  await a.set((s) => ({ items: push(s.items, item), closed: [...s.closed, item.id] }))
  a.put((s) => ({ closed: s.closed.filter((id) => id !== item.id) }))
}

let next = OPENING

async function script(a: Act<S>) {
  next = OPENING
  const more = () => arrive(a, filler(next++))
  await a.wait(700)

  // 1. LIKE on the simulator: the error arrives at the foot of the list
  a.mark('like')
  await a.move({ at: 'like', x: 0.62, y: 0.7 })
  await a.wait(120)
  await a.click()
  await a.wait(140)
  await arrive(a, { id: 'err', kind: 'e' })
  await a.wait(900)
  await more()

  // 2. Twice more: it stacks; the badge appears, then ticks
  await a.wait(500)
  await a.click()
  await a.wait(140)
  a.put({ count: 2, sec: 49 })
  a.mark('badge')
  await a.wait(700)
  await a.click()
  await a.wait(140)
  a.put({ count: 3, sec: 50 })
  await a.wait(500)
  await more()
  await a.wait(300)

  // 3. Filter: the list closes around the error
  a.mark('filter')
  await a.move({ at: 'filter', x: 0.5, y: 0.5 })
  await a.wait(100)
  await a.click()
  a.put({ focused: true })
  await a.wait(250)
  await a.type('query', 'recordLike', { interval: 75 })
  // Logs keep streaming; filtered out, they wait unseen below the error
  let streaming = true
  const stream = (async () => {
    while (streaming && next < OPENING + AFTER) {
      await more()
      await a.wait(420)
    }
  })()

  // 4. Open the row: its details fill the pane under it
  a.mark('open')
  await a.move({ at: 'err', x: 0.86, y: 0.42 }, { duration: 420 })
  await a.wait(40)
  await a.click()
  a.put({ selected: true, focused: false })
  await a.wait(450)
  await a.move('rest')
  a.mark('payoff')
  await a.wait(2400)

  // Reset with causes: Escape clears the search and the logs that waited
  // reopen, carrying the error up out of the list; closing the details lets
  // the list grow back over the pane
  a.mark('reset')
  await a.click('filter')
  a.put({ focused: true })
  streaming = false
  await stream
  while (next < OPENING + AFTER) await a.set((s) => ({ items: push(s.items, filler(next++)) }))
  await a.wait(150)
  await a.key('esc')
  a.put({ query: '', focused: false })
  await a.wait(200)
  await a.move({ at: 'detail-x', x: 0.5, y: 0.5 }, { duration: 480 })
  await a.wait(40)
  await a.click()
  a.put({ selected: false })
  await a.wait(300)
  await a.move('rest', { duration: 900 })
  await a.wait(400)
  // The rows in view are the opening's own (same cycle, same order): swap in
  // the opening list under data-snap, which looks the same frame to frame
  await a.set({ seam: true })
  next = OPENING
  await a.snap({ ...initial, seam: true })
  await a.wait(50)
  await a.snap({ seam: false })
}

export default function MdLogs() {
  return (
    <Stage<S>
      width={STAGE.width}
      height={STAGE.height}
      // The shared md frame is the developer's call: the window whole on
      // the 16:9 stage with even gutters, nothing bleeding
      unframed
      compact={{ below: 600, width: 358, height: 572 }}
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: REST }}
      className="mdl"
    >
      {(s, _rect, layout) => {
        const logs = (
          <section className="mdl-logs">
            <div className="mdl-tools">
              <Field
                className="mdl-filter"
                value={s.query}
                placeholder="Filter logs..."
                focused={s.focused}
                leading={<Search size={14} strokeWidth={2} className="mdl-filter-icon" />}
                box={{ 'data-target': 'filter', 'data-cursor': 'ibeam' }}
              />
              {layout === 'wide' && (
                <>
                  <IconButton icon={CircleHelp} />
                  <IconButton icon={Layers} pressed />
                  <IconButton icon={ArrowDownToLine} pressed />
                  <IconButton icon={Pause} />
                  <IconButton icon={ListX} />
                </>
              )}
              <IconButton icon={SlidersHorizontal} />
            </div>
            <div className="mdl-split">
              <Viewport whole={s.query.length >= 4} seam={s.seam}>
                {s.items.map((it) => (
                  <Collapse key={it.id} open={!s.closed.includes(it.id) && shows(it, s.query)}>
                    {it.kind === 'e' ? <ErrorRow s={s} /> : <FillerRow spec={it.spec} layout={layout} />}
                  </Collapse>
                ))}
              </Viewport>
              <Collapse open={s.selected} className="mdl-detail-wrap">
                <Details layout={layout} />
              </Collapse>
            </div>
          </section>
        )
        return (
          <>
            {layout === 'wide' ? (
              <Window className="md-window mdl-win" lead={<Toolbar />} body={{ className: 'mdl-body' }}>
                {logs}
                <section className="mdl-device md-device-pane">
                  <Simulator width={DEVICE_PANE.phone} />
                </section>
              </Window>
            ) : (
              <>
                {/* The simulator, cropped above Monty's name, behind the
                    Logs panel that sits over its foot */}
                <div className="mdl-phone-sat">
                  <Simulator width={200} />
                </div>
                <div className="mdl-card">{logs}</div>
              </>
            )}
            <span data-target="rest" className="mdl-rest" style={{ left: REST[layout].x, top: REST[layout].y }} />
          </>
        )
      }}
    </Stage>
  )
}

// The list's viewport. Like the product's virtualized list it doesn't paint
// rows scrolled wholly past its top
function Viewport({ whole, seam, children }: { whole: boolean; seam: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const list = ref.current
      if (list) {
        const top = list.getBoundingClientRect().top
        for (const row of list.firstElementChild?.children ?? []) {
          const el = row as HTMLElement
          const above = el.getBoundingClientRect().bottom <= top + 0.5
          if (above !== (el.style.visibility === 'hidden')) el.style.visibility = above ? 'hidden' : ''
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={ref} className="mdl-list" data-whole={whole || undefined} data-snap={seam || undefined}>
      <div className="mdl-track">{children}</div>
    </div>
  )
}

function Toolbar() {
  return (
    <span className="mdl-bar">
      <span className="mdl-select">
        <Terminal size={14} strokeWidth={2} />
        Logs
        <ChevronDown size={13} strokeWidth={2} className="mdl-chev" />
      </span>
      {(
        <>
          <span className="mdl-select">
            iOS
            <ChevronDown size={13} strokeWidth={2} className="mdl-chev" />
          </span>
          <span className="mdl-select mdl-device-pick">
            <span className="mdl-phone-glyph">
              <Smartphone size={14} strokeWidth={2} />
              <span className="mdl-running" />
            </span>
            iPhone 17 Pro · iOS 26.3
            <ChevronDown size={13} strokeWidth={2} className="mdl-chev" />
          </span>
          <IconButton icon={House} />
          <IconButton icon={Copy} />
          <IconButton icon={Camera} />
          <IconButton icon={MousePointer2} />
        </>
      )}
    </span>
  )
}

function IconButton({ icon: I, pressed }: { icon: typeof X; pressed?: boolean }) {
  return (
    <span className="mdl-icon-btn" data-pressed-look={pressed || undefined}>
      <I size={14} strokeWidth={2} />
    </span>
  )
}

function FillerRow({ spec, layout }: { spec: number; layout: Layout }) {
  const col = COL[layout]
  return (
    <div className="mdl-row" data-level="info">
      <Info size={14} strokeWidth={2} className="mdl-sev" />
      <span className="mdl-line">
        <Bar w={52} h={6} style={{ background: "#e6e6e6" }} />
      </span>
      <span className="mdl-rule" />
      <span className="mdl-msg">
        {SPECS[spec]!.lines.map((f, i) => {
          const from = i === 0 ? SPECS[spec]!.from : undefined
          // A mono character is 0.6em: the bar takes the line's rest
          const w = Math.round(f * col - (from ? (from.length + 1) * 7.2 : 0))
          return (
            <span key={i} className="mdl-line">
              {from && <span className="mdl-prefix">{from}</span>}
              <Bar w={Math.max(36, w)} h={6} style={{ background: '#d3e2f3' }} />
            </span>
          )
        })}
      </span>
    </div>
  )
}

function ErrorRow({ s }: { s: S }) {
  return (
    <div className="mdl-row" data-level="error" data-target="err" data-selected={s.selected || undefined} data-stacked={s.count > 1 || undefined}>
      <CircleAlert size={14} strokeWidth={2} className="mdl-sev" />
      <span className="mdl-time">
        16:38:
        <Count value={s.sec} format={(n) => String(n).padStart(2, '0')} duration={420} />
      </span>
      <span className="mdl-rule" />
      <span className="mdl-msg">{MESSAGE}</span>
      <span className="mdl-count" data-show={s.count > 1 || undefined}>
        <Count value={Math.max(2, s.count)} duration={420} />
      </span>
    </div>
  )
}

function Details({ layout }: { layout: Layout }) {
  return (
    <aside className="mdl-detail" data-level="error">
      <div className="mdl-detail-head">
        <CircleAlert size={16} strokeWidth={2} className="mdl-sev" />
        <span className="mdl-detail-title">Error</span>
        <span className="mdl-icon-btn mdl-detail-x" data-target="detail-x">
          <X size={14} strokeWidth={2} />
        </span>
      </div>
      <div className="mdl-detail-body">
        <div className="mdl-section">
          <div className="mdl-label">
            Time
            <Copy size={13} strokeWidth={2} />
          </div>
          <div className="mdl-value">16:38:50</div>
        </div>
        <div className="mdl-section">
          <div className="mdl-label">
            Message
            <Copy size={13} strokeWidth={2} />
          </div>
          <div className="mdl-pre">{MESSAGE}</div>
        </div>
        {layout === 'wide' && (
          <div className="mdl-section">
            <div className="mdl-label">
              Stack trace
              <Copy size={13} strokeWidth={2} />
            </div>
            <div className="mdl-pre">
              {STACK.map((l) => (
                <div key={l}>{l}</div>
              ))}
            </div>
          </div>
        )}
        <span className="mdl-fix">
          <MessageCircle size={14} strokeWidth={2} />
          Fix in chat
        </span>
      </div>
    </aside>
  )
}

// HorseTinder, the shared app (md-shared), on the kit's iPhone
function Simulator({ width }: { width: number }) {
  return <HorseTinderPhone width={width} phoneClassName="mdl-sim" buttons={{ like: { 'data-target': 'like' } }} />
}
