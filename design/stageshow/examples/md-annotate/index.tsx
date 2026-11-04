import { ArrowUp, Camera, ChevronDown, Copy, House, Mic, MousePointer2, Plus, Smartphone } from 'lucide-react'
import { Bar, Collapse, Fly, Follow, Stage, Window, contains, type Act, type Point, type Rect } from '../../kit'
import { DEVICE_PANE, STAGE } from '../md-shared/frame'
import { HorseTinderPhone } from '../md-shared/HorseTinder'
import './annotate.css'

// Mobile Dev's Annotate: in the live device view the pointer tool turns on,
// the cursor picks the Mega Carrot button on the running app, a note is typed
// in the inline field and sent, a numbered pin marks the button, and the note
// lands in the agent's composer as a "Context · 1" chip.
//
// Real strings: the device picker, HorseTinder (the shared md-* app), the
// note, the chip and the composer's placeholder. The chat history and the
// window title are filler.

type Hover = 'card' | 'carrot' | null

type S = {
  selecting: boolean
  hover: Hover
  draft: boolean
  typed: string
  pin: boolean
  /** The composer's attachment row is open */
  room: boolean
  /** The chip is in the air: mounted, budding at the field, then flying */
  flyer: boolean
  fly: boolean
  /** Landed: the flyer fades off the identical chip under it */
  done: boolean
  /** Where the chip will sit once the composer has made room, measured before it opens */
  dest: Rect | null
  chip: boolean
}

const initial: S = { selecting: false, hover: null, draft: false, typed: '', pin: false, room: false, flyer: false, fly: false, done: false, chip: false, dest: null }
const POSTER: S = { ...initial, selecting: true, pin: true, room: true, chip: true }
// The composer's attachment row: the chip and the gap under it
const ROOM = 32

const NOTE = 'Make this an apple'
// Wide: in the device pane, left of the phone, clear of everything the cursor visits
const REST = { wide: { x: 640, y: 196 }, compact: { x: 322, y: 250 } }
// The inline field: real is 360 wide and 44 tall; this is the width the note
// needs. The phone is small in its pane, so the field takes the room between
// the Mega Carrot button and the panel's edge: it starts just right of the
// button and ends just inside the panel (wide, the window's edge)
const FIELD = { wide: { w: 119, h: 28, gap: 4, edge: 4 }, compact: { w: 128, h: 30, gap: 5, edge: 5 } }

/** The part of a rect inside another: what of the app the device view shows */
const clip = (r: Rect, to: Rect): Rect => {
  const x = Math.max(r.x, to.x)
  const y = Math.max(r.y, to.y)
  return { x, y, width: Math.max(0, Math.min(r.x + r.width, to.x + to.width) - x), height: Math.max(0, Math.min(r.y + r.height, to.y + to.height) - y) }
}

function fieldBox(rect: (n: string) => Rect, layout: 'wide' | 'compact'): Rect {
  const b = rect('carrot')
  const panel = rect('panel')
  const { w, h, gap, edge } = FIELD[layout]
  // As the product places it: beside the element, centered on it, kept inside
  // the panel (which, wide, ends at the window's edge)
  const x = Math.min(b.x + b.width + gap, panel.x + panel.width - edge - w)
  const width = Math.min(w, panel.x + panel.width - edge - x)
  const y = b.y + (b.height - h) / 2
  return { x, y, width, height: h }
}

function hoverAt(a: Act<S>, at: Point): Hover | undefined {
  if (contains(a.rect('carrot'), { x: at.x, y: at.y, width: 0, height: 0 })) return 'carrot'
  if (contains(clip(a.rect('card'), a.rect('panel')), { x: at.x, y: at.y, width: 0, height: 0 })) return 'card'
  return undefined
}

async function script(a: Act<S>) {
  const track = (at: Point) => {
    const h = hoverAt(a, at)
    if (h) a.put((s) => (s.hover === h ? {} : { hover: h }))
  }

  await a.wait(500)

  // 1. The pointer tool turns on
  a.mark('tool')
  await a.click({ at: 'pointer', x: 0.6, y: 0.62 })
  await a.set({ selecting: true })
  await a.wait(450)

  // 2. Over the running app, elements highlight under the cursor
  a.mark('hover')
  // Over the photo: the part of the card the device view shows (compact
  // crops the phone's top under the toolbar)
  const card = clip(a.rect('card'), a.rect('panel'))
  await a.move({ x: card.x + card.width * 0.72, y: card.y + card.height * 0.42 }, { onMove: track })
  await a.wait(700)
  // To a point on the Mega Carrot button, not the button as a target: the
  // selection overlay takes the click, so the app's button never presses
  // (and the highlight, field and pin placed from it hold still)
  const carrot = a.rect('carrot')
  await a.move({ x: carrot.x + carrot.width * 0.68, y: carrot.y + carrot.height * 0.72 }, { onMove: track })
  await a.wait(260)

  // 3. Click picks it; the note field opens beside it
  a.mark('pick')
  await a.click()
  await a.set({ draft: true })
  await a.wait(520)
  a.mark('type')
  await a.type('typed', NOTE, { interval: 62 })
  a.mark('typed')
  await a.wait(320)

  // 4. Send: the room opens in the composer, then the note travels there
  a.mark('send')
  await a.click({ at: 'send', x: 0.5, y: 0.5 })
  // The field closes and the pin takes its place; the note buds into a
  // chip where it was typed and flies, the composer making room on its clock
  const slot = a.rect('ctx-chip', { layout: true })
  await a.set({ draft: false, hover: null, pin: true, dest: { ...slot, y: slot.y - ROOM } })
  await a.wait(110)
  await a.set({ flyer: true })
  await a.wait(170)
  await a.set({ fly: true, room: true })
  await a.wait(780)
  await a.set({ chip: true })
  await a.wait(130)
  await a.set({ done: true })
  await a.wait(130)
  await a.set({ flyer: false })
  await a.snap({ fly: false, done: false })
  a.mark('landed')
  await a.wait(150)
  await a.move('rest')
  await a.wait(2100)

  // The tool turns off, and what this loop added leaves with it
  a.mark('reset')
  await a.click({ at: 'pointer', x: 0.6, y: 0.62 })
  await a.set({ selecting: false, pin: false })
  await a.wait(90)
  await a.set({ room: false })
  await a.move('rest')
  // Closed and faded by now: the chip and the note go unseen
  await a.snap({ chip: false, typed: '', dest: null })
  await a.wait(150)
}

function ChatChip({ target }: { target?: string }) {
  return (
    <span className="ma-chip" data-target={target}>
      <Smartphone size={12} strokeWidth={2} />
      <span>Context · 1</span>
    </span>
  )
}

function Composer({ s }: { s: S }) {
  return (
    <div className="ma-composer" data-target="composer">
      <Collapse open={s.room} reveal="drop">
        <div className="ma-composer__room">
          <span className="ma-chip-slot" data-show={s.chip || undefined}>
            <ChatChip target="ctx-chip" />
          </span>
        </div>
      </Collapse>
      <span className="ma-composer__placeholder">Do anything</span>
      <div className="ma-composer__row">
        <Plus size={16} strokeWidth={1.75} className="ma-ico" />
        <Bar w={58} h={6} r={3} tone={3} />
        <span className="ma-spacer" />
        <Mic size={14} strokeWidth={1.8} className="ma-ico" />
        <span className="ma-composer__send">
          <ArrowUp size={14} strokeWidth={2.2} />
        </span>
      </div>
    </div>
  )
}

function Chat({ s }: { s: S }) {
  return (
    <div className="ma-chat">
      <div className="ma-history">
        <div className="ma-bubble">
          <Bar w={148} h={6} r={3} style={{ background: 'rgba(255, 255, 255, 0.55)' }} />
        </div>
        <div className="ma-answer">
          <Bar w={84} h={6} r={3} tone={2} />
          <div className="ma-answer__lines">
            <Bar w="96%" h={6} r={3} tone={3} />
            <Bar w="90%" h={6} r={3} tone={3} />
            <Bar w="54%" h={6} r={3} tone={3} />
          </div>
        </div>
        <div className="ma-files">
          <div className="ma-files__head">
            <span className="ma-files__icon" />
            <Bar w={92} h={6} r={3} tone={4} />
          </div>
          {[132, 104].map((w) => (
            <div key={w} className="ma-files__row">
              <Bar w={w} h={6} r={3} tone={3} />
              <span className="ma-files__counts">
                <Bar w={20} h={6} r={3} style={{ background: 'rgba(22, 163, 74, 0.45)' }} />
                <Bar w={16} h={6} r={3} style={{ background: 'rgba(220, 38, 38, 0.4)' }} />
              </span>
            </div>
          ))}
        </div>
      </div>
      <Composer s={s} />
    </div>
  )
}

function Toolbar({ s, layout }: { s: S; layout: 'wide' | 'compact' }) {
  return (
    <div className="ma-toolbar">
      <span className="ma-picker">
        <span className="ma-picker__device">
          <Smartphone size={14} strokeWidth={1.8} />
          <span className="ma-picker__dot" />
        </span>
        <span className="ma-picker__label">iPhone 17 Pro</span>
        <ChevronDown size={13} strokeWidth={2} className="ma-ico" />
      </span>
      <span className="ma-spacer" />
      <span className="ma-tool">
        <House size={16} strokeWidth={1.75} />
      </span>
      {layout === 'wide' && (
        <span className="ma-tool">
          <Copy size={16} strokeWidth={1.75} />
        </span>
      )}
      <span className="ma-tool">
        <Camera size={16} strokeWidth={1.75} />
      </span>
      <span className="ma-tool ma-tool--select" data-target="pointer" data-on={s.selecting || undefined}>
        <MousePointer2 size={16} strokeWidth={1.75} />
      </span>
    </div>
  )
}

function Panel({ s, layout }: { s: S; layout: 'wide' | 'compact' }) {
  return (
    <section className="ma-panel md-device-pane" data-target="panel" data-crop>
      {/* HorseTinder, the shared app (md-shared): the card and the Mega Carrot
          button are the targets; the whole device takes the crosshair while
          the pointer tool is on */}
      <HorseTinderPhone
        width={layout === 'wide' ? DEVICE_PANE.phone : 270}
        time="17:44"
        phoneClassName="ma-phone"
        phoneProps={{ 'data-cursor': s.selecting ? 'crosshair' : undefined }}
        card={{ 'data-target': 'card' }}
        buttons={{ carrot: { 'data-target': 'carrot' } }}
      />
    </section>
  )
}

export default function MdAnnotate() {
  return (
    <Stage<S>
      width={STAGE.width}
      height={STAGE.height}
      // The shared md-* frame asks for the window whole with an even margin
      unframed
      compact={{ below: 600, width: 358, height: 516 }}
      initial={initial}
      poster={POSTER}
      script={script}
      cursor={{ at: REST }}
      className="ma"
    >
      {(s, rect, layout) => {
        const field = fieldBox(rect, layout)
        const carrot = rect('carrot')
        const dest = s.dest ?? rect('ctx-chip')
        const from: Rect = { x: field.x + 6, y: field.y + (field.height - dest.height) / 2, width: dest.width, height: dest.height }
        const hovered = s.selecting && (s.draft ? 'carrot' : s.hover)
        // The overlay is the device view's: clipped to it, as the product's is
        const lit = hovered ? clip(rect(hovered), rect('panel')) : null
        // Half the pin's size: it sits on the button's lower right corner
        const pin = layout === 'wide' ? 9 : 10
        return (
          <>
            {layout === 'wide' ? (
              <Window className="md-window ma-window" body={{ 'data-crop': true }} lead={<div className="ma-lead"><Bar w={136} h={7} r={3} tone={4} /></div>} toolbar={<Toolbar s={s} layout={layout} />}>
                <div className="ma-body">
                  <Chat s={s} />
                  <Panel s={s} layout={layout} />
                </div>
              </Window>
            ) : (
              // At phone width: the device view alone, as the host shows it in a
              // side pane (a chromeless window: no lights, so portrait is its
              // shape), with the composer in front of its foot
              <div className="ss-window ma-pane">
                <Toolbar s={s} layout={layout} />
                <Panel s={s} layout={layout} />
              </div>
            )}

            {/* The overlay the product draws over the device, from measured targets */}
            <Follow className="ma-highlight" to={lit} stiffness={0.18} />
            <span className="ma-pin" data-show={s.pin || undefined} style={{ left: carrot.x + carrot.width - pin, top: carrot.y + carrot.height - pin }}>
              <span>1</span>
            </span>
            <form className="ma-field" data-show={s.draft || undefined} style={{ left: field.x, top: field.y, width: field.width, height: field.height }} onSubmit={(e) => e.preventDefault()}>
              <span className="ma-field__text" data-typing={s.typed ? true : undefined}>
                {s.typed ? s.typed : <span className="ma-field__placeholder" data-snap>Add a note...</span>}
                <span className="ma-caret" />
              </span>
              <span className="ma-field__send" data-target="send" data-ready={s.typed.length > 0 || undefined}>
                <ArrowUp size={14} strokeWidth={2.4} />
              </span>
            </form>

            {layout === 'compact' && (
              <div className="ma-composer-wrap">
                <Composer s={s} />
              </div>
            )}

            {s.flyer && (
              <Fly from={from} to={dest} go={s.fly} held duration={760} className={`ma-flyer${s.done ? ' ma-flyer--done' : ''}`}>
                <ChatChip />
              </Fly>
            )}

            <span data-target="rest" className="ma-rest" style={{ left: REST[layout].x, top: REST[layout].y }} />
          </>
        )
      }}
    </Stage>
  )
}
