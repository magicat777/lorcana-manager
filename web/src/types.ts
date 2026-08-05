export interface Card {
  id: string
  set_id: string
  set_code: string
  set_name: string
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
  illustrators?: string[]
  released_at?: string
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
}

export interface DeckCardRow {
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
  image_small: string | null
  owned: number
}

export interface Deck {
  id: number
  name: string
  notes: string | null
  updated_at: string
  card_total: number
  cards?: DeckCardRow[]
  unmatched?: { qty: number | null; name: string; reason: string }[]
}

export interface SetStats {
  code: string
  name: string
  released_at: string | null
  cards_in_set: number
  unique_owned: number
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
