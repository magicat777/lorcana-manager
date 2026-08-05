-- Hand-maintained set aliases for Dreamborn "Set" values that don't match a
-- Lorcast set code, set number, or set name (the seed job auto-creates those
-- three alias forms for every set). Add rows here as import unmatched-reports
-- reveal gaps. Guarded so this is safe to run before the catalog is seeded.

INSERT INTO set_aliases (alias, set_id)
SELECT v.alias, s.id
FROM (VALUES
  ('promo',   'P1'),          -- example: dreamborn generic promo bucket
  ('promo 2', 'P2')
) AS v(alias, code)
JOIN sets s ON s.code = v.code
ON CONFLICT (alias) DO NOTHING;
