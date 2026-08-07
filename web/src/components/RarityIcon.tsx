// Original SVG glyphs echoing the official rarity-symbol shapes (sides grow
// with rarity): circle, book, triangle, diamond, pentagon, hexagon, rainbow
// fan (Epic), lore star (Iconic), star (Promo). Drawn here rather than
// vendoring Ravensburger's artwork into a public repo.
const RAINBOW = ['#e35d8a', '#e8a33d', '#58b85c', '#3f8ed0', '#8f5cc9']

function Rainbow({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
        {RAINBOW.map((c, i) => (
          <stop key={c} offset={`${(100 * i) / (RAINBOW.length - 1)}%`} stopColor={c} />
        ))}
      </linearGradient>
    </defs>
  )
}

export default function RarityIcon({ rarity, size = 14 }: { rarity: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 20 20', style: { flexShrink: 0 } }
  switch (rarity) {
    case 'Common':
      return <svg {...common}><circle cx="10" cy="10" r="7" fill="#8a92a5" /></svg>
    case 'Uncommon':
      return (
        <svg {...common}>
          <path d="M9.3 4 L2.5 5.6 L2.5 16 L9.3 14.4 Z" fill="#e8edf5" />
          <path d="M10.7 4 L17.5 5.6 L17.5 16 L10.7 14.4 Z" fill="#c8d2e0" />
        </svg>
      )
    case 'Rare':
      return <svg {...common}><polygon points="10,3 18,17 2,17" fill="#b5722f" /></svg>
    case 'Super_rare':
      return <svg {...common}><polygon points="10,2 17.5,10 10,18 2.5,10" fill="#c9d3de" /></svg>
    case 'Legendary':
      return <svg {...common}><polygon points="10,2.2 17.4,7.6 14.6,16.6 5.4,16.6 2.6,7.6" fill="#d9a73e" /></svg>
    case 'Enchanted':
      return (
        <svg {...common}>
          <Rainbow id="rar-hex" />
          <polygon points="10,1.8 17,5.9 17,14.1 10,18.2 3,14.1 3,5.9" fill="url(#rar-hex)" />
        </svg>
      )
    case 'Epic':
      return (
        <svg {...common}>
          <Rainbow id="rar-fan" />
          <g fill="url(#rar-fan)">
            <path d="M10 18 L4.4 4.6 A2.2 2.2 0 0 1 8.6 3.4 Z" transform="rotate(-30 10 18)" />
            <path d="M10 18 L7.9 3.8 A2.2 2.2 0 0 1 12.1 3.8 Z" />
            <path d="M10 18 L11.4 3.4 A2.2 2.2 0 0 1 15.6 4.6 Z" transform="rotate(30 10 18)" />
          </g>
        </svg>
      )
    case 'Iconic':
      return (
        <svg {...common}>
          <Rainbow id="rar-star4" />
          <polygon
            points="10,1 12.4,7.6 19,10 12.4,12.4 10,19 7.6,12.4 1,10 7.6,7.6"
            fill="url(#rar-star4)"
          />
        </svg>
      )
    case 'Promo':
      return (
        <svg {...common}>
          <polygon
            points="10,1.5 12.4,7 18.5,7.6 13.9,11.6 15.3,17.7 10,14.4 4.7,17.7 6.1,11.6 1.5,7.6 7.6,7"
            fill="#dfe5ee"
          />
        </svg>
      )
    default:
      return null
  }
}
