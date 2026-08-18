-- Online-play venue so duels.ink matches log against a registry slug instead
-- of drifting free-text store names — keeps per-venue match stats clean and
-- lets you filter online vs paper. Idempotent.
INSERT INTO venues (slug, name, city, state, display_name, notes) VALUES
  ('duels-ink', 'duels.ink', 'Online', '—', 'duels.ink (online)',
   'Online play — matches imported from duels.ink game logs via MCP')
ON CONFLICT (slug) DO NOTHING;
