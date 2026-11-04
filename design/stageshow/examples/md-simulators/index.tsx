import { CameraIcon, Check, ChevronDown, CopyIcon, HouseIcon, Info, Layers, MousePointer2Icon, Search, SlidersHorizontal, SmartphoneIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Bar, Field, Popover, Roll, Stage, Window, type Act } from '../../kit'
import { DEVICE_PANE, STAGE, WINDOW } from '../md-shared/frame'
import { HORSES, HorseTinderPhone } from '../md-shared/HorseTinder'
import './simulators.css'

// Mobile Dev's simulators: live devices in the panel, iOS and Android side by
// side. Beats: one iPhone streams HorseTinder (context); the cursor opens the
// platform menu and adds Android, so the label becomes Both (action); the
// Android emulator slides in beside the iPhone showing the same app on a
// different card, Juniper (payoff); the cursor swipes Juniper away on the
// emulator and the next card, Clover, comes up; then the
// menu takes Android away again (the visible reset) and its deck is put back
// while its pane is closed.
//
// Real strings: Mobile Dev, the platform menu (iOS, Android, Both), the two
// device names, HorseTinder, Monty, 9, Juniper, 5 and Clover, 7 with their
// lines. Both phones run the shared HorseTinder (md-shared/HorseTinder.tsx).
//
// Wide: the shared md-* frame (examples/md-shared). The window's body is the
// product's side-by-side workspace: a quiet Logs column on the left (the
// window's width less the two device panes) and the device panes on the
// right, each phone whole and centered in its pane. Each pane's device
// toolbar sits in the window bar over its pane, as the Logs preview puts its
// device picker there; the platform select ends the Logs column's stretch
// of the bar, so its menu opens over the logs, never over a phone.
// Compact keeps its own design: the phones run off the bottom of a window.

type Flick = { ms: number; ease: string }
// pick: Android ticked in the menu (label reads Both); android: its pane is open
type S = { pick: boolean; android: boolean; menu: boolean; dx: number; flick: Flick | null; swiped: boolean }

const initial: S = { pick: false, android: false, menu: false, dx: 0, flick: null, swiped: false }
const poster: S = { pick: true, android: true, menu: false, dx: 0, flick: null, swiped: false }

// The Logs column takes what the two device panes leave of the window
const LOGS = WINDOW.width - 2 * DEVICE_PANE.width
// The platform select ends this far before the Logs column's divider
const SELECT_END = LOGS - 10

// Compact only: the wide window comes from the shared frame
const COMPACT = { win: { x: 16, y: 16, w: 326, h: 420 }, phone: 140 }
// The cursor's rest: wide, in the empty band between the Logs column and the
// lone iPhone; compact, beside the iPhone
const REST = {
  wide: { x: WINDOW.x + LOGS + 78, y: WINDOW.y + 270 },
  compact: { x: 290, y: 160 },
}

// The Pixel's width in screen points, band and glass included (the kit's
// android frame: a 412pt screen, 2pt band, 9pt glass): a phone of width w
// draws w / ANDROID_PT stage px per screen point, which turns a drag in
// stage px into the card's own points
const ANDROID_PT = 412 + 2 * (2 + 9)

async function script(a: Act<S>) {
  await a.wait(450)

  // 1. Open the platform menu and add Android
  a.mark('menu')
  await a.click({ at: 'platform', x: 0.84, y: 0.62 })
  a.put({ menu: true })
  await a.wait(550)
  await a.move({ at: 'opt-android', x: 0.62, y: 0.55 })
  await a.wait(220)
  await a.click()
  a.put({ pick: true })
  await a.wait(320)
  // The menu is gone before the panes move, so nothing fades over them
  a.put({ menu: false })
  await a.wait(260)
  a.put({ android: true })
  a.mark('split')
  if (a.layout === 'compact') {
    // The cursor clears the way while the emulator slides in
    void a.move({ at: 'stage-ios', x: 0.86, y: 0.44 }, { duration: 900 })
  }
  await a.wait(2600)
  a.mark('both')

  // 2. Swipe Juniper away on the emulator
  const card = a.rect('adeck')
  const y = card.y + card.height * 0.42
  const from = card.x + card.width * 0.3
  await a.move({ x: from, y })
  await a.wait(260)
  a.mark('swipe')
  const samples: { x: number; t: number }[] = []
  await a.drag(
    { x: card.x + card.width * 0.78, y: y + 6 },
    (at) => {
      samples.push({ x: at.x, t: performance.now() })
      a.put({ dx: at.x - from })
    },
    { duration: 300, cursor: 'preserve', path: (t, p0, p1) => ({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }) },
  )
  // The card leaves at the speed the pointer let go of it
  a.mark('throw')
  const last = samples.slice(-4)
  const v = last.length > 1 ? Math.abs(last[last.length - 1]!.x - last[0]!.x) / Math.max(1, last[last.length - 1]!.t - last[0]!.t) : 1
  const dx = samples.length ? samples[samples.length - 1]!.x - from : 0
  const to = card.width * 1.35
  const ms = 360
  const x1 = 0.25
  const y1 = Math.min(0.95, (x1 * v * ms) / Math.max(1, to - dx))
  a.put({ flick: { ms, ease: `cubic-bezier(${x1}, ${y1.toFixed(3)}, 0.35, 1)` }, dx: to, swiped: true })
  await a.wait(500)
  // The pointer moves off the card, toward the menu it will use next: wide,
  // into the gap between the phones; compact, beside the emulator
  void a.move(a.layout === 'wide' ? { at: 'stage-ios', x: 0.93, y: 0.42 } : { at: 'stage-android', x: 0.86, y: 0.3 }, { duration: 700 })
  await a.wait(2300)
  a.mark('payoff')

  // 3. Take Android away again: the menu is the cause, the pane closes
  await a.click({ at: 'platform', x: 0.84, y: 0.62 })
  a.put({ menu: true })
  await a.wait(500)
  await a.move({ at: 'opt-android', x: 0.62, y: 0.55 })
  await a.wait(200)
  await a.click()
  a.put({ pick: false })
  await a.wait(320)
  a.put({ menu: false })
  await a.wait(260)
  a.put({ android: false })
  a.mark('close')
  await a.wait(950)
  // The emulator's pane is shut: its deck goes back out of sight
  await a.snap({ dx: 0, flick: null, swiped: false })
  await a.move(REST[a.layout], { duration: 600 })
}

function Toolbar({ name, tools }: { name: string; tools: 'all' | 'bar' | 'none' }) {
  return (
    <div className="mds-bar">
      <span className="mds-picker">
        <span className="mds-picker__icon">
          <SmartphoneIcon size={15} strokeWidth={1.75} />
          <span className="mds-picker__dot" />
        </span>
        <span className="mds-picker__label">{name}</span>
        <ChevronDown className="mds-picker__chev" size={14} strokeWidth={1.75} />
      </span>
      {tools !== 'none' && (
        <>
          <span className="mds-icon"><HouseIcon size={14} strokeWidth={1.75} /></span>
          <span className="mds-icon"><CopyIcon size={14} strokeWidth={1.75} /></span>
          <span className="mds-icon"><CameraIcon size={14} strokeWidth={1.75} /></span>
          {tools === 'all' && <span className="mds-icon"><MousePointer2Icon size={14} strokeWidth={1.75} /></span>}
        </>
      )}
    </div>
  )
}

// The Logs column: filler only, quiet beside the devices. Each entry is a
// row's message lines as fractions of the message column; a few carry the
// app's Metro tag first, as the product prints it
const LOG_ROWS: { lines: number[]; from?: string }[] = [
  { lines: [0.74] },
  { lines: [0.98, 0.4], from: 'horsetinder:' },
  { lines: [0.62] },
  { lines: [0.86] },
  { lines: [0.9, 0.52] },
  { lines: [0.56] },
  { lines: [0.8] },
  { lines: [0.68] },
  { lines: [0.96, 0.34], from: 'horsetinder:' },
  { lines: [0.88] },
  { lines: [0.6] },
  { lines: [0.76] },
]
// 9 one-line rows (27px) and 3 two-line rows (45px) fill the list's 378px
// exactly, so no row is cut under the toolbar
// The message column in px: the column less its insets, icon, time and rule
const MSG_COL = 150

function LogRow({ lines, from }: { lines: number[]; from?: string }) {
  return (
    <div className="mds-log">
      <Info size={14} strokeWidth={2} className="mds-log__sev" />
      <span className="mds-log__line">
        <Bar w={46} h={6} style={{ background: '#e6e6e6' }} />
      </span>
      <span className="mds-log__rule" />
      <span className="mds-log__msg">
        {lines.map((f, i) => {
          const tag = i === 0 ? from : undefined
          // A mono character is 0.6em of 12px: the bar takes the line's rest
          const w = Math.round(f * MSG_COL - (tag ? (tag.length + 1) * 7.2 : 0))
          return (
            <span key={i} className="mds-log__line">
              {tag && <span className="mds-log__tag">{tag}</span>}
              <Bar w={Math.max(28, w)} h={6} style={{ background: '#d3e2f3' }} />
            </span>
          )
        })}
      </span>
    </div>
  )
}

function Logs() {
  return (
    <section className="mds-logs" style={{ width: LOGS }}>
      <div className="mds-logs__tools">
        <Field className="mds-filter" value="" placeholder="Filter logs..." leading={<Search size={14} strokeWidth={2} className="mds-filter__icon" />} box={{ 'data-cursor': 'ibeam' }} />
        <span className="mds-icon" data-pressed-look><Layers size={14} strokeWidth={2} /></span>
        <span className="mds-icon"><SlidersHorizontal size={14} strokeWidth={2} /></span>
      </div>
      {/* The list follows new logs: pinned to its foot */}
      <div className="mds-logs__list">
        {LOG_ROWS.map((r, i) => (
          <LogRow key={i} {...r} />
        ))}
      </div>
    </section>
  )
}

// The device toolbars, in the window bar over their panes: the iPhone's is
// always there; the emulator's slides in with its pane, divider leading
function DeviceBar({ both }: { both: boolean }) {
  return (
    <div className="mds-devbar" style={{ left: LOGS }} data-both={both || undefined}>
      <div className="mds-seg mds-seg--ios" style={{ width: DEVICE_PANE.width }}>
        <Toolbar name="iPhone 17 Pro · iOS 26.3" tools="bar" />
      </div>
      <div className="mds-seg mds-seg--android" style={{ left: DEVICE_PANE.width, width: DEVICE_PANE.width }} aria-hidden={!both}>
        <Toolbar name="Medium_Phone_API_36.1" tools="bar" />
      </div>
    </div>
  )
}

export default function MdSimulators() {
  return (
    <Stage<S>
      width={STAGE.width}
      height={STAGE.height}
      // UNIFY.md puts the window whole in the shared 48/40 gutter, so the
      // floating-window check stands down, as in the other md-* previews
      unframed
      compact={{ below: 600, width: 358, height: 336 }}
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: REST }}
      className="mds"
    >
      {(s, _rect, layout) => {
        const wide = layout === 'wide'
        const phone = wide ? DEVICE_PANE.phone : COMPACT.phone
        const k = phone / ANDROID_PT
        const ios = <HorseTinderPhone width={phone} time="17:36" phoneClassName="mds-phone" horse={HORSES.monty} />
        // The emulator's deck: Juniper on top, thrown at release speed; Clover
        // a step back under her, rising as she leaves
        const android = (
          <HorseTinderPhone
            width={phone}
            frame="android"
            time="5:36"
            phoneClassName="mds-phone"
            horse={HORSES.juniper}
            next={HORSES.clover}
            card={{
              'data-target': 'adeck',
              className: 'mds-throw',
              style: {
                transform: `translateX(${s.dx / k}px) rotate(${(s.dx / k) * 0.04}deg)`,
                transition: s.flick ? `transform ${s.flick.ms}ms ${s.flick.ease}, visibility 0s ${s.flick.ms}ms` : 'none',
                visibility: s.swiped ? 'hidden' : 'visible',
              },
            }}
            nextCard={{ className: 'mds-rise', 'data-up': s.swiped || undefined }}
          />
        )
        // The menu hangs from the select's right edge, which never moves (the
        // label grows leftward), so it is placed from the window, not measured
        const pop = wide
          ? { right: STAGE.width - (WINDOW.x + SELECT_END), top: WINDOW.y + 37 }
          : { right: 358 - (COMPACT.win.x + COMPACT.win.w - 14.5), top: COMPACT.win.y + 37 }

        const menu = (
          <Popover show={s.menu} origin="top right" className="mds-menu" style={pop} role="listbox" aria-multiselectable aria-label="Visible platforms">
            <div className="mds-menu__item" role="option" aria-selected data-target="opt-ios">
              <span>iOS</span>
              <Check className="mds-menu__tick" size={14} strokeWidth={2} />
            </div>
            <div className="mds-menu__item" role="option" aria-selected={s.pick} data-target="opt-android">
              <span>Android</span>
              <Check className="mds-menu__tick" data-off={!s.pick || undefined} size={14} strokeWidth={2} />
            </div>
          </Popover>
        )

        if (wide) {
          return (
            <>
              <WindowShell both={s.pick} menu={s.menu} lead={<DeviceBar both={s.android} />}>
                <Logs />
                <div className="mds-devices" style={{ left: LOGS }} data-both={s.android || undefined}>
                  <section className="md-device-pane mds-dpane mds-dpane--ios" data-target="stage-ios">
                    {ios}
                  </section>
                  <section className="md-device-pane mds-dpane mds-dpane--android" data-target="stage-android" style={{ left: DEVICE_PANE.width }} aria-hidden={!s.android}>
                    {android}
                  </section>
                </div>
              </WindowShell>
              {menu}
            </>
          )
        }

        const g = COMPACT
        const half = g.win.w / 2
        return (
          <>
            <div style={{ position: 'absolute', left: g.win.x, top: g.win.y, width: g.win.w, height: g.win.h }} className="mds-frame">
              <div className="mds-win-wrap">
                {/* The window is the hero; the panel is its body */}
                <WindowShell both={s.pick} menu={s.menu}>
                  <div className="mds-panel" style={{ ['--mds-half' as string]: `${half}px`, ['--mds-full' as string]: `${g.win.w}px` }} data-both={s.android || undefined}>
                    <section className="mds-pane mds-pane--ios">
                      <Toolbar name="iPhone 17 Pro" tools="none" />
                      <div className="mds-stage" data-target="stage-ios">
                        {ios}
                      </div>
                    </section>
                    <section className="mds-pane mds-pane--android" aria-hidden={!s.android}>
                      <div className="mds-pane__inner" style={{ width: half }}>
                        <Toolbar name="Medium_Phone…" tools="none" />
                        <div className="mds-stage" data-target="stage-android">
                          {android}
                        </div>
                      </div>
                    </section>
                  </div>
                </WindowShell>
              </div>
            </div>
            {menu}
          </>
        )
      }}
    </Stage>
  )
}

function WindowShell({ both, menu, lead, children }: { both: boolean; menu: boolean; lead?: ReactNode; children: ReactNode }) {
  return (
    <Window
      className="md-window mds-win"
      title="Mobile Dev"
      lead={lead}
      toolbar={
        <span className="mds-platform" data-target="platform" data-cursor="pointer" data-open={menu || undefined}>
          <Roll variant="fade" align="end">{both ? 'Both' : 'iOS'}</Roll>
          <ChevronDown size={14} strokeWidth={1.75} />
        </span>
      }
      body={{ className: 'mds-body' }}
    >
      {children}
    </Window>
  )
}
