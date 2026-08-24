import { NavLink, Route, Routes } from 'react-router-dom'
import Collection from './pages/Collection'
import CardDetail from './pages/CardDetail'
import Upload from './pages/Upload'
import Decks from './pages/Decks'
import DeckDetail from './pages/DeckDetail'
import DeckExport from './pages/DeckExport'
import Events from './pages/Events'
import EventDetail from './pages/EventDetail'
import Brief from './pages/Brief'
import Stats from './pages/Stats'
import MatchStats from './pages/MatchStats'
import Wantlist from './pages/Wantlist'
import Sim from './pages/Sim'
import SimRun from './pages/SimRun'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <img src="/brand/lorcana-logo.png" alt="Disney Lorcana Trading Card Game" />
          <span className="brand-sub">Collection</span>
        </span>
        <nav>
          <NavLink to="/" end>Cards</NavLink>
          <NavLink to="/stats">Stats</NavLink>
          <NavLink to="/decks">Decks</NavLink>
          <NavLink to="/matches">Matches</NavLink>
          <NavLink to="/sim">Sim</NavLink>
          <NavLink to="/brief">Brief</NavLink>
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
          <Route path="/decks/:id/export" element={<DeckExport />} />
          <Route path="/wantlist" element={<Wantlist />} />
          <Route path="/matches" element={<Events />} />
          <Route path="/matches/stats" element={<MatchStats />} />
          <Route path="/matches/:id" element={<EventDetail />} />
          <Route path="/sim" element={<Sim />} />
          <Route path="/sim/:id" element={<SimRun />} />
          <Route path="/brief" element={<Brief />} />
          <Route path="/stats" element={<Stats />} />
        </Routes>
      </main>
      <footer className="sitefooter no-print">
        This website uses trademarks and/or copyrights associated with Disney Lorcana TCG, used
        under Ravensburger&rsquo;s{' '}
        <a href="https://cdn.ravensburger.com/lorcana/community-code-en" target="_blank" rel="noreferrer">
          Community Code Policy
        </a>. We are expressly prohibited from charging you to use or access this content. This
        website is not published, endorsed, or specifically approved by Disney or Ravensburger.
        For more information about Disney Lorcana TCG, visit{' '}
        <a href="https://www.disneylorcana.com/en-US/" target="_blank" rel="noreferrer">disneylorcana.com</a>.
      </footer>
    </div>
  )
}
