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
    "road":  {"cs": "Silniční provoz", "en": "Road traffic", "ru": "Дорожное движение",
              "uk": "Дорожній рух", "sk": "Cestná premávka", "vi": "Giao thông đường bộ",
              "de": "Straßenverkehr", "pl": "Ruch drogowy", "kk": "Жол қозғалысы", "ro": "Trafic rutier"},
    "rail":  {"cs": "Železniční doprava", "en": "Rail", "ru": "Железнодорожный транспорт",
              "uk": "Залізничний транспорт", "sk": "Železničná doprava", "vi": "Đường sắt",
              "de": "Schienenverkehr", "pl": "Transport kolejowy", "kk": "Теміржол көлігі",
              "ro": "Transport feroviar"},
    "air":   {"cs": "Civilní letectví", "en": "Air", "ru": "Гражданская авиация",
              "uk": "Цивільна авіація", "sk": "Civilné letectvo", "vi": "Hàng không",
              "de": "Luftfahrt", "pl": "Lotnictwo cywilne", "kk": "Азаматтық авиация",
              "ro": "Aviație civilă"},
    "water": {"cs": "Vnitrozemská plavba", "en": "Water", "ru": "Внутреннее судоходство",
              "uk": "Внутрішнє судноплавство", "sk": "Vnútrozemská plavba", "vi": "Đường thủy nội địa",
              "de": "Binnenschifffahrt", "pl": "Żegluga śródlądowa", "kk": "Ішкі су көлігі",
              "ro": "Navigație interioară"},
}
MODE_ORDER = ["road", "rail", "air", "water"]

# Languages offered on /docs. cs is the binding original (always shown, never carries a disclaimer);
# the rest appear only once a machine translation exists (msg 2828). Names are each language's own endonym.
DOC_LANGS = [
    ("cs", "Čeština"), ("en", "English"), ("ru", "Русский"), ("uk", "Українська"),
    ("sk", "Slovenčina"), ("vi", "Tiếng Việt"), ("de", "Deutsch"), ("pl", "Polski"),
    ("kk", "Қазақша"), ("ro", "Română"),
]
I18N_DIR = Path(os.environ.get("LAWS_I18N_DIR", ROOT / "data" / "docs" / "laws_i18n"))


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


# ---- machine translations (msg 2828) -------------------------------------------------------------
# Per-(lang, law) caches live in data/docs/laws_i18n/<lang>/<law_id>.json (built by tools/translate_laws.py).
# Czech is the binding original and has no cache. A language only becomes selectable for a law once its
# cache exists, so the site degrades gracefully before/while translations are generated.

def _load_i18n():
    translations = {}      # {lang: {law_id: doc}}
    for code, _name in DOC_LANGS:
        if code == "cs":
            continue
        d = I18N_DIR / code
        if not d.is_dir():
            continue
        for law in LAWS:
            f = d / f"{law['id']}.json"
            try:
                translations.setdefault(code, {})[law["id"]] = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
    ui = {}
    try:
        ui = json.loads((I18N_DIR / "_ui.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        ui = {}
    return translations, ui


TRANSLATIONS, _UI = _load_i18n()

# English fallbacks for the UI chrome, used when _ui.json is missing a language (mirrors translate_laws.py).
_UI_EN = {
    "disclaimer": "Unofficial machine translation. The binding and authoritative text is the Czech "
                  "original; we accept no responsibility for the accuracy of this translation.",
    "all_laws": "all laws", "in_force": "in force", "as_of": "current as of", "amendments": "amendments",
    "binding_link": "binding text — e-Sbírka ↗", "filter_ph": "Filter within this law…",
    "contents": "Contents", "no_match": "No section matches.",
    "footer_law": "Text: legalize-cz (MIT). Binding & current version: e-Sbírka (link above).",
    "docs_title_a": "Official", "docs_title_b": "documents",
    "docs_sub": "Full texts of the Czech transport laws — road, rail, air and water — with full-text "
                "search across every section.",
    "search_ph": "Search all laws (e.g. roundabout, level crossing, speed)…", "search_btn": "Search",
    "results_for": "result(s) for", "nothing_for": "Nothing found for", "list_laws": "all laws",
    "tip": "Tip: search ignores accents — \"prejezd\" finds \"přejezd\".", "updated": "updated",
    "footer_docs": "Source: github.com/legalize-dev/legalize-cz (MIT) · binding text: e-Sbírka, linked "
                   "on each law.",
}
# Czech UI chrome (so the non-cs path can render the page entirely in one language).
_UI_CS = {
    "disclaimer": "", "all_laws": "všechny zákony", "in_force": "účinný", "as_of": "znění k",
    "amendments": "novely", "binding_link": "závazné znění — e-Sbírka ↗", "filter_ph": "Filtrovat v tomto zákoně…",
    "contents": "Obsah", "no_match": "Žádný paragraf neodpovídá.",
    "footer_law": "Text: legalize-cz (MIT). Závazné a aktuální znění: e-Sbírka (odkaz výše).",
    "docs_title_a": "Oficiální", "docs_title_b": "dokumenty",
    "docs_sub": "Úplná znění českých dopravních zákonů — silniční, železniční, letecká i vodní doprava — "
                "s fulltextovým hledáním napříč všemi paragrafy.",
    "search_ph": "Hledat ve všech zákonech (např. kruhový objezd, přejezd, rychlost)…", "search_btn": "Hledat",
    "results_for": "výsledků pro", "nothing_for": "Nic nenalezeno pro", "list_laws": "seznam zákonů",
    "tip": "Tip: hledání nezohledňuje diakritiku — „prejezd“ najde „přejezd“.", "updated": "aktuální k",
    "footer_docs": "Zdroj: github.com/legalize-dev/legalize-cz (MIT) · závazné znění: e-Sbírka, odkaz u každého zákona.",
}


def ui(lang: str) -> dict:
    if lang == "cs":
        return _UI_CS
    base = dict(_UI_EN)
    base.update(_UI.get(lang, {}))
    return base


def law_langs(law_id: str):
    """[(code, name, is_current_lang-unused)] languages available for one law: cs + any with a cache."""
    avail = ["cs"] + [c for c, _ in DOC_LANGS if c != "cs" and law_id in TRANSLATIONS.get(c, {})]
    return [(c, n) for c, n in DOC_LANGS if c in avail]


def hub_langs():
    """Languages selectable on the /docs hub: cs + any language that has at least one translated law."""
    avail = {"cs"} | {c for c in TRANSLATIONS if TRANSLATIONS.get(c)}
    return [(c, n) for c, n in DOC_LANGS if c in avail]


def localize_law(law: dict, lang: str) -> dict:
    """Return the law with title/parts/chapters/section headings+bodies swapped to `lang` where a
    translation exists (Czech fallback per field). Adds 'translated' so the view can show the disclaimer."""
    tr = TRANSLATIONS.get(lang, {}).get(law["id"]) if lang != "cs" else None
    if not tr:
        return {**law, "translated": False}
    secs = []
    for s in law["sections"]:
        t = tr.get("sections", {}).get(s["anchor"], {})
        secs.append({**s,
                     "heading": t.get("heading") or s["heading"],
                     "text": t.get("text") or s["text"],
                     "chapter": tr.get("chapters", {}).get(s["chapter"], s["chapter"]),
                     "part": tr.get("parts", {}).get(s["part"], s["part"])})
    return {**law, "title": tr.get("title") or law["title"], "sections": secs, "translated": True}


def laws_by_mode(lang: str = "cs"):
    """Laws grouped for the hub, in transport-mode order, with each law's title localized to `lang`."""
    out = []
    for mode in MODE_ORDER:
        group = []
        for law in LAWS:
            if law["mode"] != mode:
                continue
            tr = TRANSLATIONS.get(lang, {}).get(law["id"]) if lang != "cs" else None
            group.append({**law, "title": (tr or {}).get("title") or law["title"]})
        if group:
            mode_label = MODE_LABEL[mode].get(lang) or MODE_LABEL[mode]["en"]
            out.append({"mode": mode, "label": mode_label, "labels": MODE_LABEL[mode], "laws": group})
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
