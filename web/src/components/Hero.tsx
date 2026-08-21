import type { ReactNode } from 'react'

// Page banner from the official media-guide art (public/brand/hero-*.jpg,
// sources in ATTRIBUTION.md). `right` renders bottom-right on the scrim —
// used for the header-row action links the banner replaces.
export default function Hero({ img, title, right, pos }: {
  img: string
  title: ReactNode
  right?: ReactNode
  pos?: string
}) {
  return (
    <div className="hero">
      <img src={`/brand/${img}`} alt="" style={pos ? { objectPosition: pos } : undefined} />
      <div className="scrim" />
      <h1>{title}</h1>
      {right && <span className="hero-right">{right}</span>}
    </div>
  )
}
