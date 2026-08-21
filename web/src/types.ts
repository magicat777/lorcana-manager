export interface Card {
  id: string
  set_id: string
  set_code: string
  set_name: string
  core_legal: boolean
  collector_number: string
  name: string
  version: string | null
  full_name: string
  ink: string | null
  inks: string[] | null
  cost: number | null
  inkwell: boolean | null
  type: string[] | null
  classifications: string[] | null
  keywords: string[] | null
  body_text: string | null
  flavor_text: string | null
  strength: number | null
  willpower: number | null
  lore: number | null
  move_cost: number | null
  rarity: string | null
  image_small: string | null
  image_normal: string | null
  image_large: string | null
  price_usd: string | number | null
  price_usd_foil: string | number | null
  qty_normal: number
  qty_foil: number
  qty_in_use: number
  qty_free?: number
  decks?: { id: number; name: string; in_use: boolean; qty: number }[]
  illustrators?: string[]
  released_at?: string
  price_history?: { captured_at: string; usd: string | number | null; usd_foil: string | number | null }[]
  qty_slabbed?: number
  graded?: {
    id: number; foil: boolean; status: 'raw' | 'submitted' | 'graded'
    grader: string | null; cert_id: string | null; grade: string | null
    declared_value: string | number | null; notes: string | null
  }[]
}

export interface SetInfo {
  id: string
  code: string
  set_num: number | null
  name: string
  released_at: string | null
  card_count: number
}

export interface SearchResult {
  total: number
  page: number
  page_size: number
  results: Card[]
}

export interface UnmatchedRow {
  row: number
  name: string
  set: string
  number: string
  reason: string
}

export interface ReplaceLoss {
  card_id: string
  full_name: string
  set_code: string
  collector_number: string
  have_normal: number
  have_foil: number
  file_normal: number
  file_foil: number
}

export interface DiffCard {
  card_id: string
  full_name: string
  set_code: string
  collector_number: string
  before_normal: number
  before_foil: number
  after_normal: number
  after_foil: number
  delta: number
}

export interface ImportDiff {
  summary: {
    cards_changed: number
    new_cards: number
    removed_cards: number
    copies_added: number
    copies_removed: number
  }
  cards: DiffCard[]
  truncated: number
}

export interface ImportReport {
  import_id: number
  filename: string
  mode: string
  dry_run: boolean
  rows: number
  matched: number
  unique_cards: number
  unmatched: UnmatchedRow[]
  replace_losses: ReplaceLoss[]
  summary: {
    added: number
    updated: number
    zeroed: number
    qty_before: number
    qty_after: number
    qty_in_file: number
    lost_cards: number
  }
  diff?: ImportDiff
}

export interface ImportHistoryRow {
  id: number
  filename: string
  uploaded_at: string
  mode: string
  dry_run: boolean
  row_count: number
  matched_rows: number
  unmatched_count: number
  summary: ImportReport['summary'] | null
  note: string | null
  diff_summary: ImportDiff['summary'] | null
}

export interface SnapshotBucket {
  c: number // copies
  u: number // unique cards
  v: number // value USD
}

export interface SnapshotRow {
  id: number
  captured_at: string
  source: 'daily' | 'import' | 'manual'
  import_id: number | null
  total_cards: number
  // Backfilled pre-feature rows (reconstructed from the imports audit trail)
  // only know total copies — value/unique/breakdown are null there.
  unique_cards: number | null
  value_usd: string | number | null
  breakdown: Record<'rarity' | 'ink' | 'set' | 'type' | 'cost', Record<string, SnapshotBucket>> | null
  import_note: string | null
  import_filename: string | null
}

export interface DeckCardRow {
  card_id: string
  qty: number
  full_name: string
  ink: string | null
  inks: string[] | null
  cost: number | null
  inkwell?: boolean | null
  lore?: number | null
  rarity: string | null
  type: string[] | null
  set_code: string
  core_legal: boolean
  collector_number: string
  image_small: string | null
  // null on sealed decks: they build from their own pool, not the collection
  owned: number | null
  allocated_elsewhere: number | null
  free: number | null
  in_pool?: number
}

export interface PoolRow {
  card_id: string
  qty: number
  full_name: string
  ink: string | null
  inks: string[] | null
  cost: number | null
  rarity: string | null
  type: string[] | null
  set_code: string
  collector_number: string
}

export interface Deck {
  id: number
  name: string
  notes: string | null
  in_use: boolean
  wanted?: boolean
  sim_only?: boolean
  strategy?: string | null
  inks?: string[] | null
  format: 'constructed' | 'sealed'
  updated_at: string
  card_total: number
  created_source?: string
  updated_source?: string | null
  validation?: string[]
  cards?: DeckCardRow[]
  pool?: PoolRow[]
  pool_total?: number
  unmatched?: { qty: number | null; name: string; reason: string }[]
  events?: { at: string; action: string; detail: string | null }[]
  pulled_from?: string[]
}

export interface AllocationConflict {
  card_id: string
  full_name: string
  set_code: string
  collector_number: string
  owned: number
  claimed: number
  decks: string[]
}

export interface Venue {
  id: number
  slug: string
  name: string
  city: string
  state: string
  display_name: string
  active: boolean
  event_night: string | null
  event_time: string | null
}

export interface ObservationRow {
  id: number
  kind: string
  value: string
  card_set_code: string | null
  card_number: string | null
}

export interface GameRow {
  id: number
  game_no: number
  on_play: boolean | null
  won: boolean | null
  loss_mode: string | null
  cards_altered: number | null
}

export interface MatchRow {
  id: number
  round: number
  opponent_handle: string | null
  result: string
  opp_ink_1: string | null
  opp_ink_2: string | null
  opp_shape: string | null
  one_liner: string | null
  games: GameRow[]
  observations: ObservationRow[]
}

export interface EventRow {
  id: number
  date: string
  store: string
  format: string
  rounds: number | null
  player_count: number | null
  deck_name: string | null
  deck_version: string | null
  final_record: string | null
  packs_won: number | null
  promo: boolean | null
  record: string
  match_count: number
}

export interface EventDetailData extends EventRow {
  deck_id: number | null
  entry_fee: string | number | null
  biggest_problem: string | null
  one_change: string | null
  notes: string | null
  matches: MatchRow[]
  observations: ObservationRow[]
}

export interface SetStats {
  code: string
  name: string
  released_at: string | null
  cards_in_set: number
  unique_owned: number
  base_in_set: number
  base_owned: number
  playsets: number
  total_qty: number
  value: string | number
}

export interface Totals {
  unique_owned: number
  total_normal: number
  total_foil: number
  value_normal: string | number
  value_foil: string | number
  value_total: number
  catalog_cards: number
}

export interface SimRun {
  id: number
  deck_id: number
  deck_name?: string
  opponent: string
  opponent_label: string | null
  games: number
  policy: string
  opponent_policy?: string | null
  require_build?: string | null
  outcomes?: string | null
  seed_base: number | null
  status: 'queued' | 'running' | 'complete' | 'unsupported' | 'error'
  requested_by: string | null
  requested_at: string
  finished_at: string | null
  engine_build: string | null
  wins: number | null
  losses: number | null
  win_rate: string | number | null
  avg_turns: string | number | null
  wins_as_p0: number | null
  wins_as_p1: number | null
  elapsed_s: string | number | null
  error: string | null
  unsupported_cards: { full_name: string; qty?: number; reason: string }[] | null
  analyze_requested: boolean
  seed_base_shared?: boolean
  analysis: SimAnalysis | null
}

export interface SimTurningPoint {
  turn: number
  decision: number
  played: string
  search_prefers: string
  played_winrate: number
  search_winrate: number
  winrate_gap: number
  options: number
}

export interface SimTapeTurn {
  turn: number
  player: 'you' | 'opponent'
  actions: string[]
  banished: string[]
  lore: { you: number; opponent: number }
  board: { you: string[]; opponent: string[] }
}

export interface SimTape {
  seed: number
  seat: number
  won: boolean
  turns: number
  final_lore: { you: number; opponent: number }
  tape: SimTapeTurn[]
  error?: string
}

export interface SimAggregates {
  sample: number
  lore_curve: {
    wins: { turn: number; you: number; opponent: number; n?: number }[]
    losses: { turn: number; you: number; opponent: number; n?: number }[]
  }
  most_played: { name: string; pct_of_games: number }[]
  never_played: string[]
  error?: string
}

export interface SimAnalysis {
  shape: {
    avg_turns_in_losses: number | null
    avg_turns_in_wins: number | null
    losses_on_the_play: number
    losses_on_the_draw: number
  }
  note?: string
  error?: string
  game?: {
    seed: number
    seat: number
    won: boolean
    turns: number
    final_lore: { you: number; opponent: number }
    decisions_scanned: number
    turning_points: SimTurningPoint[]
    lore_trace: { turn: number; you: number; opponent: number }[]
    opponent_label?: string
  }
  tapes?: { loss?: SimTape; win?: SimTape }
  aggregates?: SimAggregates
}
