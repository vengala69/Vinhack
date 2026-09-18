"""Generate a print-ready schema reference from the live database.

Reads the real structure via PRAGMA rather than transcribing the .sql files,
so the document cannot drift from what is actually in the database.

Writes an HTML file; render it to PDF with headless Chrome or Edge:

    py docs/gen_schema_pdf.py docs/schema.html
    chrome --headless --no-pdf-header-footer \
           --print-to-pdf=docs/VinHack-schema.pdf file:///<abs path>/docs/schema.html

Re-run both after any schema change.
"""
import html
import re
import sqlite3
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from vinhack.db import connect  # noqa: E402

TABLE_ORDER = ["students", "sleep_logs", "screen_time", "academic_tasks",
               "calendar_events", "mood_energy", "study_sessions", "assessments",
               "daily_metrics"]

GRAIN = {
    "students":        "One row per student.",
    "sleep_logs":      "One row per student per night.",
    "screen_time":     "One row per student per day.",
    "academic_tasks":  "One row per piece of coursework.",
    "calendar_events": "One row per calendar event.",
    "mood_energy":     "One row per student per day.",
    "study_sessions":  "One row per study session.",
    "assessments":     "One row per graded item that came back with a mark on it.",
    "daily_metrics":   "One row per student per day. Derived - rebuilt by rollup.sql, never written by hand.",
}

NOTES = {
    "screen_time.total_screen_minutes": "Generated column: the sum of the five category columns. Never inserted.",
    "sleep_logs.duration_minutes":      "Derived by trigger from bedtime and wake_time when not supplied.",
    "study_sessions.duration_minutes":  "Derived by trigger from start_time and end_time when not supplied.",
    "academic_tasks.completed_at":      "Managed by trigger: set when status becomes 'completed', cleared otherwise.",
    "study_sessions.task_id":           "ON DELETE SET NULL, so logged effort survives the task being deleted.",
    "assessments.task_id":              "ON DELETE SET NULL, so a grade survives the task it came from being deleted.",
    "assessments.weight_percent":       "Share of the final subject grade. Items without one are averaged evenly.",
}

conn = connect(ROOT / "db" / "vinhack.db")


def ddl(name: str) -> str:
    row = conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (name,)).fetchone()
    return row[0] if row and row[0] else ""


def checks_for(table: str) -> dict[str, list[str]]:
    """Pull column-level CHECK expressions out of the CREATE TABLE statement."""
    out: dict[str, list[str]] = {}
    for line in ddl(table).splitlines():
        s = line.strip().rstrip(",")
        m = re.match(r"^(\w+)\s+\w+.*?\bCHECK\s*\((.+)\)\s*$", s, re.I)
        if m and m.group(1).upper() not in ("CHECK", "CONSTRAINT", "UNIQUE"):
            out.setdefault(m.group(1), []).append(m.group(2).strip())
    return out


def table_checks(table: str) -> list[str]:
    """Table-level CHECK constraints (those on their own line)."""
    out = []
    for line in ddl(table).splitlines():
        s = line.strip().rstrip(",")
        if re.match(r"^CHECK\s*\(", s, re.I):
            out.append(s[s.index("(") + 1:s.rindex(")")].strip())
    return out


def esc(x) -> str:
    return html.escape(str(x))


rowcounts = {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLE_ORDER}
total_cols = 0
parts = []

for t in TABLE_ORDER:
    # table_xinfo, not table_info: the latter omits generated columns entirely.
    cols = [r for r in conn.execute(f"PRAGMA table_xinfo({t})").fetchall() if r["hidden"] != 1]
    xinfo = {r["name"]: r for r in cols}
    fks = {f["from"]: f for f in conn.execute(f"PRAGMA foreign_key_list({t})").fetchall()}
    col_checks = checks_for(t)
    total_cols += len(cols)

    # Single-column unique indexes only. A column inside a composite unique is
    # not itself unique, and flagging it as such would be a lie.
    uniques, composite_uniques = [], []
    for idx in conn.execute(f"PRAGMA index_list({t})").fetchall():
        icols = [r["name"] for r in conn.execute(f"PRAGMA index_info({idx['name']})").fetchall()]
        if idx["unique"]:
            (uniques if len(icols) == 1 else composite_uniques).append(", ".join(icols))
    idx_names = [i["name"] for i in conn.execute(f"PRAGMA index_list({t})").fetchall()
                 if not i["name"].startswith("sqlite_autoindex")]

    rows = []
    for c in cols:
        name, typ, notnull, dflt, pk = c["name"], c["type"], c["notnull"], c["dflt_value"], c["pk"]
        flags = []
        if pk:
            flags.append('<span class="f f-pk">PK</span>')
        if name in fks:
            f = fks[name]
            flags.append(f'<span class="f f-fk">FK &rarr; {esc(f["table"])}.{esc(f["to"])}</span>')
        if xinfo.get(name) and xinfo[name]["hidden"] == 3:
            flags.append('<span class="f f-gen">GENERATED</span>')
        if notnull and not pk:
            flags.append('<span class="f f-nn">NOT NULL</span>')
        if name in uniques and not pk:
            flags.append('<span class="f f-uq">UNIQUE</span>')

        rules = []
        if dflt:
            rules.append(f"default <code>{esc(dflt)}</code>")
        for ck in col_checks.get(name, []):
            rules.append(f"<code>{esc(ck)}</code>")
        key = f"{t}.{name}"
        note = f'<div class="note">{esc(NOTES[key])}</div>' if key in NOTES else ""

        rows.append(
            f'<tr><td class="c-name">{esc(name)}</td>'
            f'<td class="c-type">{esc(typ)}</td>'
            f'<td class="c-flags">{" ".join(flags)}</td>'
            f'<td class="c-rules">{"<br>".join(rules)}{note}</td></tr>'
        )

    extras = []
    for u in composite_uniques:
        extras.append(f'UNIQUE (<code>{esc(u)}</code>)')
    for ck in table_checks(t):
        extras.append(f'CHECK <code>{esc(ck)}</code>')
    for i in idx_names:
        icols = [r["name"] for r in conn.execute(f"PRAGMA index_info({i})").fetchall()]
        extras.append(f'INDEX <code>{esc(i)}</code> on ({esc(", ".join(icols))})')

    extra_html = ""
    if extras:
        extra_html = ('<div class="extras"><span class="extras-label">Table constraints &amp; indexes</span><ul>'
                      + "".join(f"<li>{e}</li>" for e in extras) + "</ul></div>")

    parts.append(f"""
<section class="tbl">
  <div class="tbl-head">
    <h2>{esc(t)}</h2>
    <span class="grain">{esc(GRAIN[t])}</span>
    <span class="count">{len(cols)} cols &middot; {rowcounts[t]} rows</span>
  </div>
  <table>
    <thead><tr><th>Column</th><th>Type</th><th>Keys &amp; flags</th><th>Defaults &amp; constraints</th></tr></thead>
    <tbody>{"".join(rows)}</tbody>
  </table>
  {extra_html}
</section>""")

# views
view_rows = []
for v in conn.execute("SELECT name FROM sqlite_master WHERE type='view' ORDER BY name").fetchall():
    vcols = [r["name"] for r in conn.execute(f"PRAGMA table_info({v['name']})").fetchall()]
    view_rows.append(f'<tr><td class="c-name">{esc(v["name"])}</td>'
                     f'<td class="c-rules">{esc(", ".join(vcols))}</td></tr>')

trig_rows = []
for tr in conn.execute("SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' ORDER BY tbl_name, name").fetchall():
    trig_rows.append(f'<tr><td class="c-name">{esc(tr["name"])}</td><td class="c-type">{esc(tr["tbl_name"])}</td></tr>')

doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>VinHack Schema Reference</title>
<style>
@page {{ size: A4; margin: 14mm 13mm 16mm; }}
* {{ box-sizing: border-box; }}
body {{
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 8.6pt; line-height: 1.42; color: #11242A; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}}
code {{ font-family: "Cascadia Mono", Consolas, monospace; font-size: 0.93em;
        background: #EDF2F1; padding: 0.5pt 2.5pt; border-radius: 2px; }}

header.doc {{ border-bottom: 1.6pt solid #0F2A2E; padding-bottom: 7pt; margin-bottom: 13pt; }}
.eyebrow {{ font-family: "Cascadia Mono", Consolas, monospace; font-size: 6.6pt;
            letter-spacing: 0.15em; text-transform: uppercase; color: #0E6E6A; margin: 0 0 4pt; }}
header.doc h1 {{ font-size: 19pt; margin: 0 0 4pt; letter-spacing: -0.4pt; font-weight: 700; }}
.sub {{ color: #4A6663; margin: 0 0 6pt; max-width: 135mm; font-size: 8.8pt; }}
.meta {{ font-family: "Cascadia Mono", Consolas, monospace; font-size: 6.9pt;
         color: #64807D; display: flex; gap: 14pt; flex-wrap: wrap; }}

section.tbl {{ break-inside: avoid; margin-bottom: 11pt; }}
.tbl-head {{ display: flex; align-items: baseline; gap: 7pt;
             border-bottom: 0.9pt solid #0F2A2E; padding-bottom: 2.5pt; margin-bottom: 4pt; }}
.tbl-head h2 {{ font-family: "Cascadia Mono", Consolas, monospace; font-size: 10.2pt;
                margin: 0; font-weight: 600; color: #0E6E6A; letter-spacing: -0.2pt; }}
.grain {{ font-size: 7.6pt; color: #4A6663; font-style: italic; }}
.count {{ margin-left: auto; font-family: "Cascadia Mono", Consolas, monospace;
          font-size: 6.8pt; color: #7C9А96; color: #7C9996; white-space: nowrap; }}

table {{ width: 100%; border-collapse: collapse; }}
thead th {{ font-family: "Cascadia Mono", Consolas, monospace; font-size: 6.4pt;
            letter-spacing: 0.1em; text-transform: uppercase; color: #6E8A87;
            text-align: left; padding: 0 5pt 2pt 0; border-bottom: 0.5pt solid #BFD2CF; }}
tbody td {{ padding: 2.6pt 5pt 2.6pt 0; border-bottom: 0.4pt solid #E0E9E7; vertical-align: top; }}
tbody tr:last-child td {{ border-bottom: none; }}
.c-name {{ font-family: "Cascadia Mono", Consolas, monospace; font-weight: 600; width: 27%; }}
.c-type {{ font-family: "Cascadia Mono", Consolas, monospace; color: #4A6663; width: 13%; white-space: nowrap; }}
.c-flags {{ width: 25%; }}
.c-rules {{ width: 35%; color: #35504D; }}
.note {{ color: #8A6212; font-style: italic; margin-top: 1.5pt; }}

.f {{ display: inline-block; font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 6.2pt; font-weight: 600; letter-spacing: 0.05em;
      padding: 0.6pt 3pt; border-radius: 2px; margin: 0 2pt 1.5pt 0; white-space: nowrap; }}
.f-pk {{ background: #0E6E6A; color: #fff; }}
.f-fk {{ background: #D6E8E5; color: #0B5450; }}
.f-gen {{ background: #F0E6CC; color: #7A560F; }}
.f-nn {{ background: #E8EEEC; color: #4A6663; }}
.f-uq {{ background: #DCEDE3; color: #276B4E; }}

.extras {{ margin-top: 4pt; padding: 4pt 6pt; background: #F4F7F6; border-left: 1.6pt solid #A9BFBB; }}
.extras-label {{ font-family: "Cascadia Mono", Consolas, monospace; font-size: 6.2pt;
                 letter-spacing: 0.1em; text-transform: uppercase; color: #6E8A87; }}
.extras ul {{ margin: 2.5pt 0 0; padding-left: 11pt; }}
.extras li {{ margin-bottom: 1.2pt; color: #35504D; }}

.pair {{ display: flex; gap: 9mm; break-inside: avoid; }}
.pair > div {{ flex: 1; }}
footer.doc {{ margin-top: 12pt; padding-top: 6pt; border-top: 0.5pt solid #BFD2CF;
              font-size: 7.2pt; color: #64807D; }}
footer.doc p {{ margin: 0 0 3pt; max-width: 150mm; }}
</style></head><body>

<header class="doc">
  <p class="eyebrow">VinHack &middot; Database Reference</p>
  <h1>Schema Reference</h1>
  <p class="sub">Every table and column in the VinHack database, generated directly from the live
  schema. Derived columns are marked &mdash; those are filled by the database itself and must not
  be written by a client.</p>
  <div class="meta">
    <span>SQLite {sqlite3.sqlite_version}</span>
    <span>{len(TABLE_ORDER)} tables &middot; {total_cols} columns</span>
    <span>{len(view_rows)} views &middot; {len(trig_rows)} triggers</span>
    <span>Generated {date.today():%d %b %Y}</span>
  </div>
</header>

{"".join(parts)}

<div class="pair">
  <div>
    <section class="tbl">
      <div class="tbl-head"><h2>views</h2><span class="count">{len(view_rows)}</span></div>
      <table><thead><tr><th>View</th><th>Columns</th></tr></thead><tbody>{"".join(view_rows)}</tbody></table>
    </section>
  </div>
  <div>
    <section class="tbl">
      <div class="tbl-head"><h2>triggers</h2><span class="count">{len(trig_rows)}</span></div>
      <table><thead><tr><th>Trigger</th><th>On table</th></tr></thead><tbody>{"".join(trig_rows)}</tbody></table>
    </section>
  </div>
</div>

<footer class="doc">
  <p><b>Conventions.</b> Dates are ISO-8601 text <code>YYYY-MM-DD</code>; timestamps are
  <code>YYYY-MM-DD HH:MM:SS</code> in UTC. Enumerated values are TEXT with a CHECK constraint.
  Booleans are INTEGER 0/1. Foreign keys are off by default in SQLite and the pragma is
  per-connection, so all access goes through <code>vinhack.db.connect()</code>.</p>
  <p><b>Row counts</b> reflect the development seed, not production data.</p>
</footer>

</body></html>"""

out = Path(sys.argv[1] if len(sys.argv) > 1 else "schema.html")
out.write_text(doc, encoding="utf-8")
print(f"{out}  ({len(TABLE_ORDER)} tables, {total_cols} columns, "
      f"{len(view_rows)} views, {len(trig_rows)} triggers)")
