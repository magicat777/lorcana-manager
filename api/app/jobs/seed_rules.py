"""Seed the Comprehensive Rules index: download the official CR PDF, parse it
into numbered paragraphs + glossary entries, and replace cr_paragraphs/cr_meta
in one transaction.

Run on demand when a CR update ships (the news watcher's rules signal is the
cue):
  kubectl -n lorcana delete job lorcana-rules-seed --ignore-not-found && \
  kubectl apply -f jobs/rules-seed-job.yaml

The PDF URL is versioned (Comprehensive-Rules_<ver>-EN.pdf), so by default the
job discovers the current link from the official resources page; set
LORCANA_CR_URL to pin one. The CR text is copyrighted (Disney/Ravensburger):
it lives ONLY in the database, for personal reference through our own tools —
never commit extracted text to this public repo. The parser is code; the data
is not.

Structure this parser depends on (stable across CR releases so far):
- a cover carrying "Version N.N.N" and "Effective <Month> <D>, <YYYY>"
- a CONTENTS block, then the body starting at a bare "1. CONCEPTS" line
- paragraphs prefixed "N.N." .. "N.N.N.N." with continuations indented deeper
- per-page footer lines (disneylorcana.com / (c)Disney / Pooh credit / page no)
- an unnumbered "Glossary" (term line, then wrapped definition lines) ending
  at "Glossary Updates"
"""
import io
import re
import sys
from datetime import datetime

import httpx
from pypdf import PdfReader

from .. import config, db

_FOOTER = re.compile(
    r'^\s*(disneylorcana\.com|©Disney(/Pixar)?|Based on the .Winnie the Pooh.*|\d{1,3})\s*$')
_SECTION = re.compile(r"^\s*(\d+)\.\s+([A-Z][A-Z0-9 ,.&'’-]+?)\s*$")
_RULE = re.compile(r'^\s*(\d+(?:\.\d+)+)\.\s+(.+)$')
_BODY_START = re.compile(r'^\s*1\.\s+CONCEPTS\s*$')
_LIGATURES = {'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl',
              'ﬃ': 'ffi', 'ﬄ': 'ffl'}


def _clean(s: str) -> str:
    for lig, rep in _LIGATURES.items():
        s = s.replace(lig, rep)
    # layout-mode extraction pads columns with runs of spaces mid-sentence
    return re.sub(r'\s{2,}', ' ', s.strip())


def extract_text(pdf_bytes: bytes) -> str:
    # default extraction mode, NOT 'layout': layout mode pads columns with
    # spaces that land mid-word ("r esolve") and corrupt verbatim text
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return '\n'.join(p.extract_text() for p in reader.pages)


def parse_cr(text: str) -> tuple[dict, list[dict]]:
    """Returns (meta, rows); rows are dicts of kind/key/title/body/sort_ord."""
    m_ver = re.search(r'Version\s+(\d+\.\d+(?:\.\d+)?)', text)
    m_eff = re.search(r'Effective\s+([A-Z][a-z]+ \d{1,2}, \d{4})', text)
    if not m_ver or not m_eff:
        raise RuntimeError('CR cover parse failed: version/effective date not found '
                           '— layout changed, fix the parser before loading')
    meta = {'version': m_ver.group(1),
            'effective_date': datetime.strptime(m_eff.group(1), '%B %d, %Y').date()}

    lines = [ln for ln in text.splitlines() if not _FOOTER.match(ln)]
    starts = [i for i, ln in enumerate(lines) if _BODY_START.match(ln)]
    if not starts:
        raise RuntimeError('CR body start ("1. CONCEPTS") not found')
    body = lines[starts[-1]:]  # last match: earlier ones are the CONTENTS page

    gl_start = next((i for i, ln in enumerate(body) if ln.strip() == 'Glossary'), None)
    if gl_start is None:
        raise RuntimeError('CR glossary not found')
    # the changelog sections trail the glossary; stop at whichever comes first
    _END = {'Update Summary', 'Glossary Updates', 'Previous Update Summaries'}
    gl_end = next((i for i, ln in enumerate(body) if i > gl_start
                   and ln.strip() in _END), len(body))

    rows: list[dict] = []

    def emit(kind, key, title, parts):
        body_txt = ' '.join(parts).strip()
        # keep rulings examples on their own line for readability
        body_txt = body_txt.replace(' Example: ', '\nExample: ')
        rows.append({'kind': kind, 'key': key, 'title': title,
                     'body': body_txt, 'sort_ord': len(rows)})

    cur: tuple[str, str, str | None] | None = None  # (kind, key, title)
    parts: list[str] = []
    for ln in body[:gl_start]:
        if not ln.strip():
            continue
        if m := _SECTION.match(ln):
            if cur:
                emit(*cur, parts)
            cur, parts = ('section', m.group(1), m.group(2).title()), []
        elif m := _RULE.match(ln):
            if cur:
                emit(*cur, parts)
            cur, parts = ('rule', m.group(1), None), [_clean(m.group(2))]
        elif cur:
            parts.append(_clean(ln))
    if cur:
        emit(*cur, parts)

    term: str | None = None
    parts = []
    for ln in body[gl_start + 1:gl_end]:
        s = _clean(ln)
        if not s:
            continue
        # term lines: short, few words, no sentence-final punctuation — a
        # wrapped definition tail like '"[A]. If you do, [B]."' ends in a
        # quote and must not become a term
        if (len(s) <= 60 and len(s.split()) <= 6 and not s[0].isdigit()
                and not s.endswith(('.', '!', '?', ':', ',', '”', '"', '’'))):
            if term:
                emit('glossary', term, term, parts)
            term, parts = s, []
        elif term:
            parts.append(s)
    if term:
        emit('glossary', term, term, parts)

    n_rules = sum(1 for r in rows if r['kind'] == 'rule')
    n_gloss = sum(1 for r in rows if r['kind'] == 'glossary')
    empties = [r['key'] for r in rows if r['kind'] != 'section' and not r['body']]
    if n_rules < 400 or n_gloss < 80 or empties:
        raise RuntimeError(f'CR parse sanity failed: {n_rules} rules, {n_gloss} '
                           f'glossary terms, empty bodies: {empties[:5]} '
                           '— refusing to load a suspect index')
    meta.update(rules=n_rules, glossary=n_gloss)
    return meta, rows


def discover_url(client: httpx.Client) -> str:
    if config.CR_URL:
        return config.CR_URL
    page = client.get(config.CR_RESOURCES_URL).text
    m = re.search(r'https://files\.disneylorcana\.com/Comprehensive-Rules[^"\'\s<>]*\.pdf',
                  page)
    if not m:
        raise RuntimeError('could not discover the CR PDF link on the resources page '
                           '— set LORCANA_CR_URL explicitly')
    return m.group(0)


def main() -> int:
    with httpx.Client(timeout=60, follow_redirects=True,
                      headers={'User-Agent': 'lorcana-manager/1.0 (personal collection tool)'}) as client:
        url = discover_url(client)
        print(f'fetching {url}', flush=True)
        pdf = client.get(url)
        pdf.raise_for_status()
    meta, rows = parse_cr(extract_text(pdf.content))
    print(f"CR {meta['version']} effective {meta['effective_date']}: "
          f"{meta['rules']} rules, {meta['glossary']} glossary terms", flush=True)

    db.pool.open()
    try:
        with db.pool.connection() as conn, conn.cursor() as cur:
            cur.execute('DELETE FROM cr_paragraphs')
            cur.executemany(
                'INSERT INTO cr_paragraphs (kind, key, title, body, sort_ord) '
                'VALUES (%(kind)s, %(key)s, %(title)s, %(body)s, %(sort_ord)s)', rows)
            cur.execute(
                '''INSERT INTO cr_meta (id, version, effective_date, source_url, rules, glossary)
                   VALUES (true, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version,
                     effective_date = EXCLUDED.effective_date,
                     source_url = EXCLUDED.source_url, rules = EXCLUDED.rules,
                     glossary = EXCLUDED.glossary, loaded_at = now()''',
                (meta['version'], meta['effective_date'], url,
                 meta['rules'], meta['glossary']))
            conn.commit()
    finally:
        db.pool.close()
    print('rules index loaded', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
