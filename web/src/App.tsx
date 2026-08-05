import { NavLink, Route, Routes } from 'react-router-dom'
import Collection from './pages/Collection'
import CardDetail from './pages/CardDetail'
import Upload from './pages/Upload'
import Decks from './pages/Decks'
import DeckDetail from './pages/DeckDetail'
import Stats from './pages/Stats'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">◈ Lorcana Collection</span>
        <nav>
          <NavLink to="/" end>Cards</NavLink>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/decks">Decks</NavLink>
          <NavLink to="/upload">Upload</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Collection />} />
          <Route path="/cards/:set/:number" element={<CardDetail />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/decks" element={<Decks />} />
          <Route path="/decks/:id" element={<DeckDetail />} />
          <Route path="/stats" element={<Stats />} />
        </Routes>
      </main>
    </div>
  )
}
