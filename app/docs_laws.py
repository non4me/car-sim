# Full-text transport-law portal backend (msg 2820). Parses the legalize-cz markdown laws stored in
# data/docs/laws/ into §-structured sections, and provides diacritics-insensitive full-text search across
# all of them. Loaded once at import; the law texts are static (refresh with tools/fetch_laws.py).
#
# Source format: YAML-ish frontmatter (title, official_code, source e-Sbírka URL, status, amendments,
# last_updated) + a body whose headings are: `#` title, `## ČÁST`, `### HLAVA`, `#### heading`,
# `##### § N`. A section = a `##### § N` marker, the following `#### heading`, and the text until the next §.

import json
import os
import re
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
LAWS_DIR = Path(os.environ.get("LAWS_DIR", ROOT / "data" / "docs" / "laws"))

MODE_LABEL = {
    "road":  {"cs": "Silniční provoz", "en": "Road traffic"},
    "rail":  {"cs": "Železniční doprava", "en": "Rail"},
    "air":   {"cs": "Civilní letectví", "en": "Air"},
    "water": {"cs": "Vnitrozemská plavba", "en": "Water"},
}
MODE_ORDER = ["road", "rail", "air", "water"]


def _fold(s: str) -> str:
    """Length-preserving diacritics+case fold: each char → its lowercase base letter (č→c, ř→r), so
    search and snippet offsets stay aligned with the original text."""
    out = []
    for c in s:
        d = unicodedata.normalize("NFD", c)
        base = "".join(ch for ch in d if unicodedata.category(ch) != "Mn")
        out.append((base or c).lower())
    return "".join(out)


def _anchor(ref: str) -> str:
    m = re.search(r"§\s*([0-9]+[a-z]?)", ref)
    if m:
        return "p" + m.group(1)
    m = re.search(r"příloh\w*\s*(?:č\.?\s*)?([0-9]+)", _fold(ref))
    if m:
        return "priloha-" + m.group(1)
    return "s" + re.sub(r"[^a-z0-9]+", "", _fold(ref))[:16]


# annexes (Přílohy) are plain-text lines, not markdown headings — split them into their own sections so
# a law's last § doesn't swallow the whole appendix (e.g. the 294/2015 sign catalog) and pollute search.
ANNEX_RE = re.compile(r"^\s{0,3}(Příloha|PŘÍLOHA|Příl\.)\b", re.I)


def _parse_frontmatter(text: str):
    meta = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            for line in text[3:end].strip().split("\n"):
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip().strip('"')
            text = text[end + 4:]
    return meta, text


def _parse_law(text: str):
    meta, body = _parse_frontmatter(text)
    sections, cur, buf = [], None, []
    part = chapter = ""
    pending = None

    def flush():
        nonlocal cur, buf
        if cur is not None:
            cur["text"] = "\n".join(buf).strip()
            sections.append(cur)
        cur, buf = None, []

    for ln in body.split("\n"):
        m = re.match(r"^(#{1,6})\s+(.*\S)\s*$", ln)
        if not m:
            if ANNEX_RE.match(ln):                  # start of an appendix → its own section
                flush()
                cur = {"ref": ln.strip()[:70], "heading": "", "part": part,
                       "chapter": chapter or "Přílohy", "anchor": _anchor(ln)}
            elif cur is not None:
                buf.append(ln)
            continue
        lvl, txt = len(m.group(1)), m.group(2).strip()
        if lvl >= 5 and txt.lstrip().startswith("§"):
            flush()
            cur = {"ref": txt, "heading": "", "part": part, "chapter": chapter, "anchor": _anchor(txt)}
            pending = "section"
        elif lvl == 2:
            flush(); part = txt; chapter = ""; pending = "part"
        elif lvl == 3:
            flush(); chapter = txt; pending = "chapter"
        elif lvl == 4:
            if pending == "section" and cur is not None and not cur["heading"]:
                cur["heading"] = txt; pending = None
            elif pending == "part":
                part = txt; pending = None
            elif pending == "chapter":
                chapter = txt; pending = None
            elif cur is not None:
                buf.append(txt)            # a sub-heading inside a section → keep in its text
        elif lvl == 1:
            flush()                         # document title — ignore
    flush()
    return meta, sections


def _load():
    laws, sections = [], []
    manifest_f = LAWS_DIR.parent / "laws.json"
    try:
        manifest = json.loads(manifest_f.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return [], []
    for item in manifest:
        f = LAWS_DIR / item["file"]
        try:
            meta, secs = _parse_law(f.read_text(encoding="utf-8"))
        except OSError:
            continue
        law = {
            "id": item["id"], "mode": item["mode"], "label": item["label"],
            "code": meta.get("official_code", item["id"]),
            "title": meta.get("title", item["label"]),
            "source": meta.get("source", ""),
            "status": meta.get("status", ""),
            "updated": meta.get("last_updated", ""),
            "amendments": meta.get("amendments", ""),
            "n_sections": len(secs), "sections": secs,
        }
        laws.append(law)
        for s in secs:
            sections.append({
                "law": law["id"], "code": law["code"], "mode": law["mode"],
                "ref": s["ref"], "heading": s["heading"], "anchor": s["anchor"],
                "chapter": s["chapter"], "text": s["text"],
                "_fold": _fold(s["ref"] + " " + s["heading"] + " " + s["text"]),
            })
    return laws, sections


LAWS, SECTIONS = _load()
LAW_BY_ID = {law["id"]: law for law in LAWS}


def laws_by_mode():
    """Laws grouped for the hub, in transport-mode order."""
    out = []
    for mode in MODE_ORDER:
        group = [law for law in LAWS if law["mode"] == mode]
        if group:
            out.append({"mode": mode, "labels": MODE_LABEL[mode], "laws": group})
    return out


def _snippet(text: str, terms, width: int = 150) -> str:
    ft = _fold(text)
    pos = min((ft.find(t) for t in terms if t and ft.find(t) >= 0), default=-1)
    if pos < 0:
        s = text[: width + 40].strip()
        return s + ("…" if len(text) > width + 40 else "")
    a = max(0, pos - 60)
    b = min(len(text), pos + width)
    return ("…" if a > 0 else "") + text[a:b].strip() + ("…" if b < len(text) else "")


# very common Czech (+ a few EN) words carry no search signal — ignored when other terms are present
_STOP = {"a", "i", "o", "u", "k", "s", "v", "z", "se", "si", "na", "do", "od", "po", "za", "ze", "ve",
         "je", "to", "že", "co", "pro", "při", "the", "of", "in", "on", "at"}


def search(q: str, limit: int = 80):
    """Diacritics-insensitive relevance search across every § (and appendix) of every law. Ranks by how
    many distinct query words a section matches first, then heading hits, then a capped term frequency
    (so a huge appendix can't win on bulk), with a small boost for a real § over an appendix."""
    raw = [t for t in _fold(q).split() if len(t) > 1]
    if not raw:
        return []
    terms = [t for t in raw if t not in _STOP] or raw     # keep stopwords only if that's all there is
    scored = []
    for s in SECTIONS:
        hay = s["_fold"]
        hit = [t for t in terms if t in hay]
        if not hit:
            continue
        head = _fold(s["heading"])
        head_hits = sum(1 for t in terms if t in head)
        freq = min(sum(hay.count(t) for t in hit), 25)
        is_section = 30 if s["ref"].lstrip().startswith("§") else 0
        score = len(hit) * 1000 + head_hits * 200 + freq + is_section
        scored.append((score, s))
    scored.sort(key=lambda x: -x[0])
    return [{
        "law": s["law"], "code": s["code"], "mode": s["mode"], "ref": s["ref"],
        "heading": s["heading"], "anchor": s["anchor"], "chapter": s["chapter"],
        "snippet": _snippet(s["text"], terms),
    } for _, s in scored[:limit]]
