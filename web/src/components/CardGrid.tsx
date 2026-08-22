import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import RarityIcon from './RarityIcon'
import type { Card } from '../types'

// Tile-size zoom bounds for Ctrl+wheel / trackpad pinch (px min column width)
const TILE_MIN = 120
const TILE_MAX = 420
const TILE_DEFAULT = 180

// Official Disney Lorcana ink colors + emblems (media guide swatchbook;
// assets in public/brand/ — see that folder's ATTRIBUTION.md).
export const INK_COLORS: Record<string, string> = {
  Amber: '#F6AC05',
  Amethyst: '#641ECB',
  Emerald: '#2EC000',
  Ruby: '#E10037',
  Sapphire: '#00CBE5',
  Steel: '#90B4BE',
}

export const inkIcon = (ink: string) => `/brand/ink-${ink.toLowerCase()}.png`

// Pointer-driven tile tilt (same idea as FoilCard, gentler): CSS vars on the
// hovered tile drive rotateX/rotateY and the foil sheen position.
function tiltMove(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  const r = el.getBoundingClientRect()
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  el.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`)
  el.style.setProperty('--ry', `${((x - 0.5) * 10).toFixed(2)}deg`)
  el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
  el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
}
function tiltLeave(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  el.style.setProperty('--rx', '0deg')
  el.style.setProperty('--ry', '0deg')
}

export function InkDots({ ink, inks }: { ink: string | null; inks?: string[] | null }) {
  const list = inks?.length ? inks : ink ? [ink] : []
  return (
    <>
      {list.map((i) =>
        INK_COLORS[i] ? (
          <img key={i} className="inkicon" src={inkIcon(i)} alt={i} title={i} />
        ) : (
          <span key={i} className="inkdot" style={{ background: 'transparent' }} />
        )
      )}
    </>
  )
}

export default function CardGrid({ cards }: { cards: Card[] }) {
  // Ctrl+wheel (and trackpad pinch, which browsers deliver as ctrlKey wheel
  // events) over the grid resizes the tiles instead of zooming the page.
  const [tileMin, setTileMin] = useState<number>(() => {
    const v = Number(localStorage.getItem('cards.tilemin'))
    return v >= TILE_MIN && v <= TILE_MAX ? v : TILE_DEFAULT
  })
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    localStorage.setItem('cards.tilemin', String(tileMin))
  }, [tileMin])
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
      setTileMin((v) => Math.min(TILE_MAX, Math.max(TILE_MIN, Math.round(v * factor))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div className="cardgrid" ref={gridRef} title="Ctrl+scroll (or pinch) to resize cards"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileMin}px, 1fr))` }}>
      {cards.map((c) => {
        const owned = c.qty_normal + c.qty_foil > 0
        return (
          <Link
            key={c.id}
            to={`/cards/${c.set_code}/${c.collector_number}`}
            className={`cardtile ${owned ? '' : 'unowned'}`}
            title={c.full_name}
            onPointerMove={tiltMove}
            onPointerLeave={tiltLeave}
          >
            {c.image_normal ? (
              <img src={c.image_normal} alt={c.full_name} loading="lazy" />
            ) : (
              <div style={{ aspectRatio: '5/7', display: 'grid', placeItems: 'center' }}>
                {c.full_name}
              </div>
            )}
            {c.qty_foil > 0 && <span className="tile-sheen" />}
            <span className="qty">
              {c.qty_normal > 0 && <span className="badge">{c.qty_normal}</span>}
              {c.qty_foil > 0 && <span className="badge foil">✦{c.qty_foil}</span>}
              {c.qty_in_use > 0 && (
                <span className="badge" title={`${c.qty_in_use} allocated to built decks`}>◈{c.qty_in_use}</span>
              )}
            </span>
            <div className="label">
              <span>
                <InkDots ink={c.ink} inks={c.inks} />
                {c.set_code}·{c.collector_number}
              </span>
              <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {!c.core_legal && <span title="Not Core Constructed legal (set rotated)">⟳</span>}
                {c.rarity && <RarityIcon rarity={c.rarity} size={12} />}
                {c.rarity?.replace('_', ' ')}
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
