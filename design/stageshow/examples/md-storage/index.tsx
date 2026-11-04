import { ArrowRightLeft, Braces, ChevronDown, Copy, Database, Hash, Play, RefreshCw, RotateCcw, Search, Smartphone, ToggleLeft } from 'lucide-react'
import { Bar, Collapse, Phone, Popover, Roll, Stage, WALLPAPER, Window, type Act, type Layout } from '../../kit'
import { DEVICE_PANE, STAGE } from '../md-shared/frame'
import { HORSES, HT_WALLPAPER, HorseTinder } from '../md-shared/HorseTinder'
import appIcon from './app-icon.png'
import './storage.css'

// Mobile Dev's App storage, beside the simulator it reads. The window is the
// product's side-by-side workspace on the shared md-* frame: Storage on the
// left, the iPhone pane docked on the right running HorseTinder. Beats:
//   1. The cursor clicks LIKE on the simulator: Monty leaves to the right and
//      Juniper comes up.
//   2. Refresh (Browse reads on request, as the product does): the icon turns
//      once while the controls rest.
//   3. The `likes` row updates in place, [2 items] rolling to [3 items] under
//      one wash, and the Changes count rolls 4 to 5.
//   4. Changes opens: the new entry on top, the old array struck through and
//      the new one beside it. Payoff, held.
//   5. The reset, with its cause on screen: Reset, the product's confirm
//      popover, Reset app data. HorseTinder closes into its icon and the
//      product's status strip offers Launch app; the app opens again on the
//      first card of its deck, this run's change leaves the list, and Browse
//      shows the store as it began. The video repeats from here.
//
// Real strings: Mobile Dev, Storage, the device, HorseTinder, Browse,
// Changes, Filter keys and values..., Reset, the store, three keys and their
// values, the change rows, the reset's confirm and status copy, and Monty /
// Juniper on the phone. The rest of the store and the older changes are lines.
//
// Compact: the product's narrow panel, simulator above and Storage below,
// with the toolbar cut to the app, the tabs, Refresh and Reset as icons.

type Tab = 'browse' | 'changes'
type S = {
  tab: Tab
  // The deck's card on the phone, and the likes storage has read back
  k: number
  m: number
  fling: boolean
  // The next card has come up: it stays up, hidden under the new top card,
  // until the reset puts the deck back
  up: boolean
  spin: boolean
  bwash: boolean
  cwash: boolean
  // The reset: the confirm popover open, the app stopped (home screen and
  // the status strip), a read running after it
  confirm: boolean
  stopped: boolean
  busy: boolean
}

const initial: S = { tab: 'browse', k: 0, m: 0, fling: false, up: false, spin: false, bwash: false, cwash: false, confirm: false, stopped: false, busy: false }
const poster: S = { ...initial, tab: 'changes', k: 1, m: 1, up: true }

// The likes array after m likes: two from before, then each horse liked here
// (Monty 7, Juniper 12, Clover 3, in deck order)
const IDS = [7, 12, 3]
const likes = (m: number) => `[${[21, 34, ...Array.from({ length: m }, (_, i) => IDS[i % IDS.length])].join(',')}]`
const items = (m: number) => `[${2 + m} items]`
// The like lands at 17:42:08; the phone shows the minute
const clock = (m: number) => {
  const t = 17 * 3600 + 42 * 60 + 8 + m * 13
  return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map((n) => String(n).padStart(2, '0')).join(':')
}

// Where the cursor rests: over the list, between the tabs and the phone.
// Compact keeps the product's narrow panel under a satellite simulator.
const REST = { wide: { at: 'views', x: 0.78, y: 0.56 }, compact: { at: 'views', x: 0.74, y: 0.62 } } as const
const COMPACT = { height: 460, win: { x: 16, y: 280, w: 326, h: 220 }, phone: 230, left: 64, top: -167 }
// The confirm popover's width, as the product's (min(300px, 100vw - 24px))
const CONFIRM_W = { wide: 300, compact: 280 }

async function script(a: Act<S>) {
  const wide = a.layout === 'wide'
  await a.wait(500)

  // 1. LIKE on the simulator
  a.mark('like')
  await a.click({ at: 'like', x: 0.64, y: 0.68 })
  a.put({ fling: true, up: true })
  await a.wait(460)
  // The card is off the screen: the deck moves on under it
  await a.snap((s) => ({ k: s.k + 1, fling: false }), 'app')

  // 2. Refresh reads the app's storage again
  a.mark('refresh')
  await a.click({ at: 'refresh', x: 0.5, y: 0.5 })
  a.put({ spin: true })
  await a.wait(820)

  // 3. The key updates in place, the Changes count with it
  a.mark('update')
  a.put((s) => ({ spin: false, bwash: true, m: s.m + 1 }))
  await a.wait(1300)
  a.put({ bwash: false })
  await a.move({ at: 'tab-changes', x: 0.5, y: 1.8 }, { duration: 700 })
  await a.wait(400)

  // 4. Changes: the entry, old next to new
  a.mark('changes')
  await a.click({ at: 'tab-changes', x: 0.9, y: 0.72 })
  a.put({ tab: 'changes', cwash: true })
  await a.wait(300)
  await a.move(REST[a.layout], { duration: wide ? 800 : 700 })
  a.mark('payoff')
  await a.wait(1200)
  a.put({ cwash: false })
  await a.wait(800)

  // 5. Reset app data, confirmed in the product's popover
  a.mark('reset')
  await a.click({ at: 'reset', x: 0.22, y: 0.78 })
  a.put({ confirm: true })
  await a.wait(650)
  await a.click({ at: 'reset-confirm', x: 0.5, y: 0.6 })
  // The app stops: it closes into its icon, and the status strip says so
  a.put({ confirm: false, busy: true, stopped: true })
  await a.wait(500)
  // Under the home screen the app is gone: its deck starts over
  await a.snap({ k: 0, up: false }, 'app')
  a.put({ busy: false })
  await a.wait(400)
  // Launch app: HorseTinder opens again on Monty, and the next read finds the
  // store as it began, so this run's change leaves the list
  await a.click({ at: 'launch-app', x: 0.5, y: 0.6 })
  a.put({ stopped: false })
  await a.wait(380)
  a.put({ m: 0 })
  await a.wait(700)
  await a.click({ at: 'tab-browse', x: 0.5, y: 0.7 })
  a.put({ tab: 'browse' })
  await a.move(REST[a.layout], { duration: 650 })
}

/* ---------------------------------------------------------------- phone */

// HorseTinder is the shared md-* app (md-shared). LIKE throws the top card
// off to the right and the one under it comes up; the deck wraps
const DECK = [HORSES.monty, HORSES.juniper, HORSES.clover]
const horse = (k: number) => DECK[k % DECK.length]!

function App({ s }: { s: S }) {
  return (
    <HorseTinder
      horse={horse(s.k)}
      // Once the card that came up is on top, the risen card under it keeps
      // that profile: hidden, it never changes or moves until the reset
      next={horse(s.up && !s.fling ? s.k : s.k + 1)}
      card={{ className: 'mst-top', 'data-fling': s.fling || undefined }}
      nextCard={{ className: 'mst-under', 'data-up': s.up || undefined }}
      buttons={{ like: { 'data-target': 'like' } }}
    />
  )
}

// The home screen the app closes to when Reset stops it: quiet icon tiles,
// HorseTinder's own icon in the slot it opens from (row 4, column 2, low
// enough to stay in view under compact's crop)
const HOME_SLOT = 13
function Home() {
  return (
    <div className="mst-home" aria-hidden style={{ background: WALLPAPER }}>
      <div className="mst-home__grid">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className="mst-home__app">
            {i === HOME_SLOT ? <img className="mst-home__icon" src={appIcon} alt="" /> : <span className="mst-home__icon" data-tint={i % 4} />}
            {i === HOME_SLOT ? <span className="mst-home__label">HorseTinder</span> : <span className="mst-home__bar" style={{ width: 30 + ((i * 7) % 4) * 6 }} />}
          </span>
        ))}
      </div>
      <div className="mst-home__dock">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="mst-home__icon" data-tint={(i + 1) % 4} />
        ))}
      </div>
    </div>
  )
}

// The running app over the home screen: it closes into its icon and opens
// out of it again, as iOS draws an app stopping and launching
function Screen({ s }: { s: S }) {
  return (
    <>
      <Home />
      <div className="mst-launch" data-target="app" data-closed={s.stopped || undefined} style={{ background: HT_WALLPAPER }}>
        <App s={s} />
      </div>
    </>
  )
}

/* -------------------------------------------------------------- storage */

// The store's icon chip, as the product tints it: AsyncStorage is violet
function KindChip({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className="mst-kind" data-size={size} aria-hidden>
      <Braces size={size === 'lg' ? 16 : 12} strokeWidth={2} />
    </span>
  )
}

function Toolbar({ s, wide }: { s: S; wide: boolean }) {
  return (
    <div className="mst-tools">
      <span className="mst-select mst-app-pick">
        <img className="mst-app-icon" src={appIcon} alt="" />
        <span className="mst-select__label">HorseTinder</span>
        <ChevronDown className="mst-chev" size={14} strokeWidth={1.75} />
      </span>
      <span className="mst-tabs" role="tablist">
        <span className="mst-tab" role="tab" data-on={s.tab === 'browse' || undefined} data-target="tab-browse" data-cursor="pointer">
          Browse
        </span>
        <span className="mst-tab" role="tab" data-on={s.tab === 'changes' || undefined} data-target="tab-changes" data-cursor="pointer">
          Changes
          <span className="mst-tab__count">
            <Roll>{String(HISTORY.length + s.m)}</Roll>
          </span>
        </span>
      </span>
      {wide && (
        <span className="mst-filter">
          <Search size={14} strokeWidth={1.75} />
          {/* The placeholder follows the tab, as the product's does */}
          <span className="mst-filter__stack">
            <span className="mst-filter__text" data-on={s.tab === 'browse' || undefined}>
              Filter keys and values…
            </span>
            <span className="mst-filter__text" data-on={s.tab === 'changes' || undefined}>
              Filter changes…
            </span>
          </span>
        </span>
      )}
      <span className="mst-group" data-busy={s.spin || s.busy || undefined}>
        <span className="mst-btn mst-btn--icon" data-target="refresh">
          <RefreshCw className="mst-refresh" data-spin={s.spin || undefined} size={14} strokeWidth={1.75} />
        </span>
        {/* Compact keeps Reset as its icon */}
        <span className={`mst-btn${wide ? '' : ' mst-btn--icon'}`} data-target="reset" data-on={s.confirm || undefined}>
          <RotateCcw size={14} strokeWidth={1.75} />
          {wide && 'Reset'}
        </span>
      </span>
    </div>
  )
}

// The product's confirm, under Reset and aligned to its end
// Compact has no room under the toolbar, so it opens upward over the phone
function Confirm({ s, at, width, up }: { s: S; at: { x: number; y: number; width: number; height: number }; width: number; up?: number }) {
  const place = up === undefined ? { top: at.y + at.height + 6 } : { bottom: up - at.y + 6 }
  return (
    <Popover show={s.confirm} origin={up === undefined ? 'top right' : 'bottom right'} className="mst-confirm" style={{ left: at.x + at.width - width, ...place, width }}>
      <p className="mst-confirm__title">Reset app data?</p>
      <p className="mst-confirm__text">Stops the app and deletes everything in its data container, including UserDefaults. The app stays installed.</p>
      <div className="mst-confirm__actions">
        <span className="mst-btn mst-btn--xs mst-btn--ghost">Cancel</span>
        <span className="mst-btn mst-btn--xs mst-btn--destructive" data-target="reset-confirm">
          Reset app data
        </span>
      </div>
    </Popover>
  )
}

// The product's status strip after a reset, with its Launch app button
function Status({ s, wide }: { s: S; wide: boolean }) {
  return (
    <Collapse open={s.stopped} className="mst-status-wrap">
      <div className="mst-status" role="status">
        <span className="mst-status__text">{wide ? 'Cleared all app data. The app was stopped.' : 'Cleared all app data.'}</span>
        <span className="mst-btn mst-btn--xs" data-target="launch-app">
          <Play size={12} strokeWidth={1.75} />
          Launch app
        </span>
      </div>
    </Collapse>
  )
}

const FILL_ROWS = [
  [96, 132],
  [74, 168],
  [112, 96],
  [86, 150],
  [64, 118],
  [104, 140],
]

function Browse({ s, wide }: { s: S; wide: boolean }) {
  return (
    <div className="mst-view" data-on={s.tab === 'browse' || undefined} data-pane>
      {wide && <div className="mst-head">
        <KindChip size="lg" />
        <div className="mst-head__text">
          <span className="mst-head__title">default</span>
          <span className="mst-head__sub">AsyncStorage · 12 keys · 3.1 KB</span>
        </div>
        {wide && (
          <span className="mst-head__end">
            <span className="mst-btn mst-btn--xs">
              <Copy size={12} strokeWidth={1.75} />
              Copy as JSON
            </span>
            <span className="mst-btn mst-btn--xs mst-btn--danger">Clear</span>
          </span>
        )}
      </div>}
      <div className="mst-entries">
        <div className="mst-entry" data-wash={s.bwash || undefined}>
          <Braces className="mst-type" size={16} strokeWidth={1.75} />
          <span className="mst-key">likes</span>
          <span className="mst-val mst-val--muted">
            <Roll>{items(s.m)}</Roll>
          </span>
        </div>
        <div className="mst-entry">
          <Hash className="mst-type" size={16} strokeWidth={1.75} />
          <span className="mst-key">megaCarrots</span>
          <span className="mst-val mst-val--num">3</span>
        </div>
        <div className="mst-entry">
          <ToggleLeft className="mst-type" size={16} strokeWidth={1.75} />
          <span className="mst-key">onboarding.done</span>
          <span className="mst-val">
            <span className="mst-bool">
              <span className="mst-bool__dot" />
              true
            </span>
          </span>
        </div>
        <div className="mst-entry">
          <Braces className="mst-type" size={16} strokeWidth={1.75} />
          <span className="mst-key">profile</span>
          <span className="mst-val mst-val--muted">
            <span className="mst-key">{'{ name: "Ada", city: "Vienna", … }'}</span>
          </span>
        </div>
        <div className="mst-entry">
          <Hash className="mst-type" size={16} strokeWidth={1.75} />
          <span className="mst-key">search.radiusKm</span>
          <span className="mst-val mst-val--num">25</span>
        </div>
        {FILL_ROWS.map(([k, v], i) => (
          <div key={i} className="mst-entry">
            <Bar w={14} h={14} r={4} tone={1} />
            <Bar w={k} h={6} tone={2} />
            <Bar w={wide ? v : v * 0.6} h={6} tone={1} />
          </div>
        ))}
      </div>
    </div>
  )
}

// What the app wrote before this run's likes, newest first. A JSON object
// shows only the field that changed, as the product does
const HISTORY: { time: string; key: string; short?: string; field?: string; before: string; after: string }[] = [
  { time: '17:41:30', key: 'megaCarrots', before: '4', after: '3' },
  { time: '17:41:12', key: 'onboarding.done', short: 'onboarding…', before: 'false', after: 'true' },
  { time: '17:40:47', key: 'search.radiusKm', before: '10', after: '25' },
  { time: '17:40:31', key: 'profile', field: 'city', before: '"Graz"', after: '"Vienna"' },
]

function Old({ children }: { children: string }) {
  return <span className="mst-old">{children}</span>
}
function New({ children }: { children: string }) {
  return <span className="mst-new">{children}</span>
}
const Arrow = () => <span className="mst-arrow">→</span>

function Changes({ s, wide }: { s: S; wide: boolean }) {
  return (
    <div className="mst-view mst-view--changes" data-on={s.tab === 'changes' || undefined} data-pane>
      {/* A list that scrolls: its foot is the crop */}
      <div className="mst-changes" data-crop>
        {/* This run's like: it opens while Browse shows, and leaves the list
            in one motion when the reset puts the store back */}
        <Collapse open={s.m > 0}>
          <div className="mst-change" data-wash={s.cwash || undefined}>
            <ArrowRightLeft className="mst-change__icon" size={16} strokeWidth={1.75} aria-label="Changed" />
            <span className="mst-time">{clock(0)}</span>
            <span className="mst-change__key">
              <KindChip />
              <span className="mst-key mst-key--strong">likes</span>
            </span>
            <span className="mst-diff">
              <Old>{likes(0)}</Old>
              <Arrow />
              <New>{likes(1)}</New>
            </span>
          </div>
        </Collapse>
        {HISTORY.map((h) => (
          <div key={h.time} className="mst-change">
            <ArrowRightLeft className="mst-change__icon" size={16} strokeWidth={1.75} aria-label="Changed" />
            <span className="mst-time">{h.time}</span>
            <span className="mst-change__key">
              <KindChip />
              <span className="mst-key mst-key--strong">{wide || !h.short ? h.key : h.short}</span>
            </span>
            <span className="mst-diff">
              {h.field && <span className="mst-field">{h.field}</span>}
              <Old>{h.before}</Old>
              <Arrow />
              <New>{h.after}</New>
            </span>
          </div>
        ))}
        {FILL_ROWS.map(([k, v], i) => (
          <div key={i} className="mst-change">
            <Bar w={14} h={14} r={4} tone={1} />
            <Bar className="mst-time" w={52} h={6} tone={1} />
            <Bar w={k * 0.8} h={6} tone={2} />
            <Bar w={wide ? v * 0.8 : v * 0.4} h={6} tone={1} />
          </div>
        ))}
      </div>
      {/* The product's footer: the count since watching began, SDK changes, Clear */}
      <footer className="mst-foot">
        <span className="mst-foot__count">
          <Roll>{String(HISTORY.length + s.m)}</Roll>
          <span>{wide ? 'changes since 17:40:12' : 'changes'}</span>
        </span>
        <span className="mst-foot__sdk">
          SDK changes
          <span className="mst-switch" />
        </span>
        <span className="mst-btn mst-btn--xs mst-btn--ghost">Clear</span>
      </footer>
    </div>
  )
}

/* --------------------------------------------------------------- window */

export default function MdStorage() {
  return (
    <Stage<S>
      width={STAGE.width}
      height={STAGE.height}
      compact={{ below: 600, width: 358, height: COMPACT.height }}
      initial={initial}
      poster={poster}
      script={script}
      cursor={{ at: REST }}
      // UNIFY.md puts the window whole in an even gutter on every md-* video,
      // which film's floating-window check would otherwise flag
      unframed
      className="mst"
    >
      {(s, rect, layout) => {
        const wide = layout === 'wide'
        const phone = (
          <Phone width={wide ? DEVICE_PANE.phone : COMPACT.phone} time={clock(s.m).slice(0, 5)} status={wide} className="mst-phone" wallpaper={HT_WALLPAPER}>
            <Screen s={s} />
          </Phone>
        )
        const window = (
          <Window
            className={wide ? 'md-window mst-win' : 'mst-win'}
            title="Mobile Dev"
            lead={
              wide && (
                <span className="mst-select mst-tool">
                  <Database size={14} strokeWidth={1.75} />
                  Storage
                  <ChevronDown className="mst-chev" size={14} strokeWidth={1.75} />
                </span>
              )
            }
            toolbar={
              wide ? (
                <span className="mst-select mst-device">
                  <span className="mst-device__icon">
                    <Smartphone size={14} strokeWidth={1.75} />
                    <span className="mst-device__dot" />
                  </span>
                  iPhone 17 Pro · iOS 26.3
                  <ChevronDown className="mst-chev" size={14} strokeWidth={1.75} />
                </span>
              ) : undefined
            }
            body={{ className: 'mst-body' }}
          >
            {wide && <section className="mst-sim md-device-pane">{phone}</section>}
            <section className="mst-storage">
              <Toolbar s={s} wide={wide} />
              <Status s={s} wide={wide} />
              <div className="mst-views" data-target="views">
                <Browse s={s} wide={wide} />
                <Changes s={s} wide={wide} />
              </div>
            </section>
          </Window>
        )
        return (
          <>
            {wide ? (
              window
            ) : (
              <div className="mst-frame" style={{ left: COMPACT.win.x, top: COMPACT.win.y, width: COMPACT.win.w, height: COMPACT.win.h }}>
                {window}
              </div>
            )}
            {!wide && (
              <div className="mst-satellite" style={{ left: COMPACT.left, top: COMPACT.top }}>
                {phone}
              </div>
            )}
            <Confirm s={s} at={rect('reset')} width={CONFIRM_W[layout]} up={wide ? undefined : COMPACT.height} />
          </>
        )
      }}
    </Stage>
  )
}
