import { Link } from 'react-router-dom'
import RarityIcon from './RarityIcon'
import type { Card } from '../types'

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
  return (
    <div className="cardgrid">
      {cards.map((c) => {
        const owned = c.qty_normal + c.qty_foil > 0
        return (
          <Link
            key={c.id}
            to={`/cards/${c.set_code}/${c.collector_number}`}
            className={`cardtile ${owned ? '' : 'unowned'}`}
            title={c.full_name}
          >
            {c.image_normal ? (
              <img src={c.image_normal} alt={c.full_name} loading="lazy" />
            ) : (
              <div style={{ aspectRatio: '5/7', display: 'grid', placeItems: 'center' }}>
                {c.full_name}
              </div>
            )}
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
