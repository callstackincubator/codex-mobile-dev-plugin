// HorseTinder, the demo app on every md-* phone: one look everywhere (the
// md-logs version). Render <HorseTinderPhone> for the usual device, or
// <HorseTinder> inside your own <Phone> when you need its props. Screen
// points throughout (the kit scales the screen), so it is the same at every
// phone width and on either frame.
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { BadgeCheck, Carrot, Heart, X } from 'lucide-react'
import { Bar, Phone } from '../../kit'
import './horsetinder.css'

export type Horse = { name: string; line: string; photo: 'bay' | 'palomino' | 'grey' }

/** The real app's first three profiles, in deck order (horse-tinder/App.tsx). */
export const HORSES = {
  monty: { name: 'Monty, 9', line: 'A curious friend for every trail', photo: 'bay' },
  juniper: { name: 'Juniper, 5', line: 'Ready for a little adventure', photo: 'palomino' },
  clover: { name: 'Clover, 7', line: 'Freeride kind of girl', photo: 'grey' },
} as const satisfies Record<string, Horse>

export const HT_WALLPAPER = 'linear-gradient(180deg, #ffe3ea 0%, #fbc3d2 100%)'

type Div = HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: unknown }
type Button = 'pass' | 'carrot' | 'like'

export type HorseTinderProps = {
  /** The profile on top of the deck. */
  horse?: Horse
  /** The profile waiting under it, shown as the top card moves away. */
  next?: Horse
  /** Props for the top card: data-target, a drag/throw style, a class. */
  card?: Div
  /** Props for the next card, for its own rise as the top one leaves. */
  nextCard?: Div
  /** Props per action button (data-target, data-pressed, ...). */
  buttons?: Partial<Record<Button, Div>>
  /** Drawn over the app, in screen points: pins, highlights, a toast. */
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

function Card({ horse, props, under }: { horse: Horse; props?: Div; under?: boolean }) {
  const { className, ...rest } = props ?? {}
  return (
    <div {...rest} className={`ht-card${under ? ' ht-card--next' : ''}${className ? ` ${className}` : ''}`} data-photo={horse.photo}>
      <div className="ht-photo" />
      <div className="ht-info">
        <div className="ht-name">
          {horse.name}
          <BadgeCheck size={26} strokeWidth={2} className="ht-check" />
        </div>
        <div className="ht-sub">{horse.line}</div>
        <div className="ht-tags">
          {[64, 78, 60].map((w, i) => (
            <span key={i} className="ht-tag">
              <Bar w={w} h={8} r={4} style={{ background: 'rgba(255, 255, 255, 0.62)' }} />
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Action({ kind, props, children }: { kind: Button; props?: Div; children: ReactNode }) {
  const { className, ...rest } = props ?? {}
  return <span {...rest} className={`ht-btn ht-${kind}${className ? ` ${className}` : ''}`}>{children}</span>
}

export function HorseTinder({ horse = HORSES.monty, next, card, nextCard, buttons, children, className, style }: HorseTinderProps) {
  return (
    <div className={`ht${className ? ` ${className}` : ''}`} style={style}>
      <div className="ht-logo">
        HorseTinder
        <Heart size={20} strokeWidth={0} fill="currentColor" className="ht-logo-heart" />
      </div>
      <div className="ht-deck">
        {next && <Card horse={next} props={nextCard} under />}
        <Card key={horse.name} horse={horse} props={card} />
      </div>
      <div className="ht-actions">
        <Action kind="pass" props={buttons?.pass}><X size={40} strokeWidth={3.5} /></Action>
        <Action kind="carrot" props={buttons?.carrot}><Carrot size={44} strokeWidth={2} fill="currentColor" /></Action>
        <Action kind="like" props={buttons?.like}><Heart size={40} strokeWidth={0} fill="currentColor" /></Action>
      </div>
      {children}
    </div>
  )
}

export type HorseTinderPhoneProps = HorseTinderProps & {
  width: number
  /** 'pro' for the iPhone, 'android' for the emulator. */
  frame?: 'pro' | 'android'
  time?: string
  phoneClassName?: string
  phoneProps?: Div
}

/** The standard device: a kit Phone with the app's wallpaper and the app. */
export function HorseTinderPhone({ width, frame = 'pro', time, phoneClassName, phoneProps, ...app }: HorseTinderPhoneProps) {
  return (
    <Phone {...phoneProps} width={width} frame={frame} time={time ?? (frame === 'android' ? '5:36' : '17:42')}
      className={`ht-phone${phoneClassName ? ` ${phoneClassName}` : ''}`} wallpaper={HT_WALLPAPER}>
      <HorseTinder {...app} />
    </Phone>
  )
}
