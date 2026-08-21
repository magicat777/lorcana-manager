import { useRef } from 'react'

// Dreamborn-style foil presentation: pointer-driven 3D tilt with a prismatic
// sheen + glare overlay. The flat digital renders can't capture the physical
// foil treatment (Enchanteds especially read washed-out), so we simulate it.
// `active: false` renders the plain <img> unchanged — as a direct child, it
// still matches the `.detail > img` card-art rule.
export default function FoilCard({ src, alt, active }: {
  src: string
  alt: string
  active: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  if (!active) return <img src={src} alt={alt} />

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    el.style.setProperty('--rx', `${((0.5 - y) * 14).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${((x - 0.5) * 14).toFixed(2)}deg`)
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
    el.classList.add('tilting')
  }
  const onLeave = () => {
    const el = ref.current
    if (!el) return
    el.classList.remove('tilting')
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

  return (
    <div className="foilwrap">
      <div ref={ref} className="foilcard" onPointerMove={onMove}
        onPointerLeave={onLeave} onPointerCancel={onLeave}>
        <img src={src} alt={alt} />
        <div className="foil-sheen" />
        <div className="foil-glare" />
      </div>
      <p className="muted foil-hint">✦ foil — move your pointer over the card</p>
    </div>
  )
}
