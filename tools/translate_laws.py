#!/usr/bin/env python3
"""Machine-translate the /docs law corpus into every UI language (msg 2828).

Czech is the binding original and is never translated. For every other language we translate each law's
title + the distinct part/chapter headings + every section's heading and body, and cache the result under
data/docs/laws_i18n/<lang>/<law_id>.json. The job is resumable: a law already fully cached for a language
is skipped, so it can be re-run any number of times to top up gaps.

Engine: Google Gemini Flash (the GEMINI_API_KEY already provisioned on the server). Gemini covers all ten
languages — including Vietnamese and Kazakh, which DeepL does not — at a fraction of DeepL's per-character
price. Translations are explicitly UNOFFICIAL; every non-Czech document carries an in-app disclaimer.

Usage:
  GEMINI_API_KEY=... python3 tools/translate_laws.py --ui                 # translate the UI strings
  GEMINI_API_KEY=... python3 tools/translate_laws.py --lang ru --law SB-1994-111   # one combo (test)
  GEMINI_API_KEY=... python3 tools/translate_laws.py                      # full run: all langs, all laws
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import docs_laws as dl  # noqa: E402  reuse the exact same parser the site renders from

ROOT = Path(__file__).resolve().parent.parent
I18N_DIR = ROOT / "data" / "docs" / "laws_i18n"

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
API = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

# Czech ('cs') is the binding original — never a translation target.
TARGET_LANGS = ["ru", "en", "uk", "sk", "vi", "de", "pl", "kk", "ro"]
LANG_NAME = {
    "ru": "Russian", "en": "English", "uk": "Ukrainian", "sk": "Slovak", "vi": "Vietnamese",
    "de": "German", "pl": "Polish", "kk": "Kazakh", "ro": "Romanian",
}

# English baseline for the /docs UI chrome. cs is kept inline in the templates; every other language is
# machine-translated from this baseline into laws_i18n/_ui.json. 'disclaimer' is the msg-2828 banner.
UI_BASE = {
    "disclaimer": "Unofficial machine translation. The binding and authoritative text is the Czech "
                  "original; we accept no responsibility for the accuracy of this translation.",
    "all_laws": "all laws",
    "in_force": "in force",
    "as_of": "current as of",
    "amendments": "amendments",
    "binding_link": "binding text — e-Sbírka ↗",
    "filter_ph": "Filter within this law…",
    "contents": "Contents",
    "no_match": "No section matches.",
    "footer_law": "Text: legalize-cz (MIT). Binding & current version: e-Sbírka (link above).",
    "docs_title_a": "Official",
    "docs_title_b": "documents",
    "docs_sub": "Full texts of the Czech transport laws — road, rail, air and water — with full-text "
                "search across every section.",
    "search_ph": "Search all laws (e.g. roundabout, level crossing, speed)…",
    "search_btn": "Search",
    "results_for": "result(s) for",
    "nothing_for": "Nothing found for",
    "list_laws": "all laws",
    "tip": "Tip: search ignores accents — \"prejezd\" finds \"přejezd\".",
    "updated": "updated",
    "footer_docs": "Source: github.com/legalize-dev/legalize-cz (MIT) · binding text: e-Sbírka, linked "
                   "on each law.",
}

PROMPT = (
    "You are a professional legal translator. Translate each Czech legal-text segment in the input JSON "
    "array into {language}. Use formal, precise legal/administrative register. Preserve EXACTLY and do "
    "NOT translate: the section symbol §, paragraph numbers like (1) (2), list markers like \"- a)\" "
    "\"- b)\", footnote markers like ^1) ^12a), numbers, dates, units, monetary amounts, statute "
    "references (e.g. č. 361/2000 Sb.), and the layout/line breaks. Keep defined terms that appear in "
    "quotes „…\" translated but still quoted. Do not add notes, comments or explanations. "
    "Return ONLY a JSON array of strings: the same length and order as the input, each element the "
    "translation of the corresponding input element."
)


def _post(body: dict, key: str, tries: int = 5) -> dict:
    data = json.dumps(body).encode("utf-8")
    url = f"{API}?key={key}"
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}"
            if e.code in (429, 500, 503):           # rate-limit / transient → back off and retry
                time.sleep(min(2 ** i * 2, 45))
                continue
            break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = str(e)
            time.sleep(min(2 ** i * 2, 45))
    raise RuntimeError(f"gemini call failed after {tries} tries: {last}")


_SAFETY = [{"category": c, "threshold": "BLOCK_NONE"} for c in (
    "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT")]


def _call(strings: list[str], lang: str, key: str):
    """One Gemini call. Returns a list[str] of the same length, or None if the model blocked
    (e.g. RECITATION on verbatim legal text) or the response didn't round-trip as a JSON array."""
    body = {
        "systemInstruction": {"parts": [{"text": PROMPT.format(language=LANG_NAME[lang])}]},
        "contents": [{"role": "user", "parts": [{"text": json.dumps(strings, ensure_ascii=False)}]}],
        "safetySettings": _SAFETY,
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json",
                             "maxOutputTokens": 65536,
                             # translation needs no chain-of-thought — disabling it cuts latency ~3-4x
                             "thinkingConfig": {"thinkingBudget": 0}},
    }
    resp = _post(body, key)
    cand = (resp.get("candidates") or [{}])[0]
    try:
        out = json.loads(cand["content"]["parts"][0]["text"])
    except (KeyError, IndexError, ValueError):
        return None
    if isinstance(out, list) and len(out) == len(strings):
        return [str(x) for x in out]
    return None


def _atom(s: str, lang: str, key: str) -> str:
    """Translate a single string that a batch couldn't. Gemini sometimes RECITATION-blocks long verbatim
    legal spans, so we split into ever-smaller pieces; an indivisible piece that still blocks keeps its
    Czech original (acceptable — every non-Czech document carries the unofficial-translation disclaimer)."""
    got = _call([s], lang, key)
    if got is not None:
        return got[0]
    for sep in ("\n\n", "\n", "; "):
        if sep in s.strip():
            parts = s.split(sep)
            if len(parts) > 1:
                return sep.join(_atom(p, lang, key) if p.strip() else p for p in parts)
    return s  # indivisible and still blocked → keep original


def translate_strings(strings: list[str], lang: str, key: str) -> list[str]:
    """Translate a list of strings, preserving order/length. Bisects batches that don't round-trip;
    falls back to per-atom splitting (and ultimately the original) for a single blocked string."""
    if not strings:
        return []
    got = _call(strings, lang, key)
    if got is not None:
        return got
    if len(strings) > 1:
        mid = len(strings) // 2
        return translate_strings(strings[:mid], lang, key) + translate_strings(strings[mid:], lang, key)
    return [_atom(strings[0], lang, key)]


def batched(units: list[str], max_chars: int = 6000, max_items: int = 40):
    batch, size = [], 0
    for u in units:
        if batch and (size + len(u) > max_chars or len(batch) >= max_items):
            yield batch
            batch, size = [], 0
        batch.append(u)
        size += len(u) + 8
    if batch:
        yield batch


def translate_law(law: dict, lang: str, key: str) -> dict:
    """Build the per-(lang, law) translation document."""
    parts = sorted({s["part"] for s in law["sections"] if s["part"]})
    chapters = sorted({s["chapter"] for s in law["sections"] if s["chapter"]})

    # one flat ordered list of every translatable unit, with an index map back to where it belongs
    units, slots = [], []
    units.append(law["title"]); slots.append(("title", None))
    for p in parts:
        units.append(p); slots.append(("part", p))
    for c in chapters:
        units.append(c); slots.append(("chapter", c))
    for s in law["sections"]:
        if s["heading"]:
            units.append(s["heading"]); slots.append(("heading", s["anchor"]))
        if s["text"]:
            units.append(s["text"]); slots.append(("text", s["anchor"]))

    translated = []
    for batch in batched(units):
        translated.extend(translate_strings(batch, lang, key))
    assert len(translated) == len(units)

    out = {"lang": lang, "law_id": law["id"], "title": law["title"],
           "parts": {}, "chapters": {}, "sections": {}}
    for (kind, ref), val in zip(slots, translated):
        if kind == "title":
            out["title"] = val
        elif kind == "part":
            out["parts"][ref] = val
        elif kind == "chapter":
            out["chapters"][ref] = val
        else:
            out["sections"].setdefault(ref, {})[kind] = val
    return out


def is_complete(law: dict, lang: str) -> bool:
    f = I18N_DIR / lang / f"{law['id']}.json"
    if not f.exists():
        return False
    try:
        cached = json.loads(f.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return False
    secs = cached.get("sections", {})
    for s in law["sections"]:
        c = secs.get(s["anchor"], {})
        if s["heading"] and not c.get("heading"):
            return False
        if s["text"] and not c.get("text"):
            return False
    return True


def run_ui(key: str):
    I18N_DIR.mkdir(parents=True, exist_ok=True)
    keys = list(UI_BASE.keys())
    vals = [UI_BASE[k] for k in keys]
    out = {}
    for lang in TARGET_LANGS:
        if lang == "en":
            out["en"] = dict(UI_BASE)
            continue
        tr = translate_strings(vals, lang, key)
        out[lang] = dict(zip(keys, tr))
        print(f"  ui[{lang}] done")
    (I18N_DIR / "_ui.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {I18N_DIR / '_ui.json'}")


def _one(law: dict, lang: str, key: str) -> str:
    if is_complete(law, lang):
        return f"  skip {lang}/{law['id']} (cached)"
    t0 = time.time()
    try:
        doc = translate_law(law, lang, key)
    except Exception as e:                       # one combo failing must not abort the whole run
        return f"  FAIL {lang}/{law['id']}: {e}"
    (I18N_DIR / lang / f"{law['id']}.json").write_text(
        json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    return f"  {lang}/{law['id']}: {law['n_sections']} § in {time.time()-t0:.0f}s"


def run_laws(key: str, only_lang: str | None, only_law: str | None, workers: int):
    langs = [only_lang] if only_lang else TARGET_LANGS
    for lang in langs:
        (I18N_DIR / lang).mkdir(parents=True, exist_ok=True)
    jobs = [(law, lang) for lang in langs for law in dl.LAWS if not (only_law and law["id"] != only_law)]
    print(f"  {len(jobs)} (law,lang) jobs, {workers} workers")
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_one, law, lang, key): (law["id"], lang) for law, lang in jobs}
        for f in as_completed(futs):
            print(f.result(), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ui", action="store_true", help="translate the UI strings into _ui.json")
    ap.add_argument("--lang", help="restrict to one language")
    ap.add_argument("--law", help="restrict to one law id")
    ap.add_argument("--workers", type=int, default=12, help="parallel (law,lang) jobs")
    args = ap.parse_args()
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY not set")
    print(f"model={MODEL} laws={len(dl.LAWS)} langs={TARGET_LANGS}")
    if args.ui:
        run_ui(key)
    else:
        run_laws(key, args.lang, args.law, args.workers)
    print("done")


if __name__ == "__main__":
    main()
