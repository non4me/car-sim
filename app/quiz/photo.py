# Photo quiz — migrated from the standalone "ulice" game into car-sim as the /quiz/photo subsection
# (msg 2802). A free game that teaches Czech road rules on REAL street photos: per-question timer with a
# speed bonus, XP/rank progression, streak combo, lives, Quick/Exam/Survival modes + survival leaderboard.
#
# Mounted as a FastAPI SUB-APP at /quiz/photo, so its routes/static/photos live under that prefix. Templates
# build URLs from `base` (= the mount's root_path) so the absolute paths keep working under the prefix.
# i18n: UI strings + question content per language (data/quiz/i18n.json + questions.json). No accounts/DB —
# sessions + leaderboard are in memory, keyed by a cookie (one uvicorn worker, MVP).

import json
import os
import random
import secrets
import time
from pathlib import Path

from fastapi import Cookie, FastAPI, Form, Header, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BASE = Path(__file__).resolve().parent                       # app/quiz
QUIZ_DATA = Path(os.environ.get("QUIZ_DATA_DIR", BASE.parents[1] / "data" / "quiz"))
PHOTOS = Path(os.environ.get("QUIZ_PHOTOS_DIR", QUIZ_DATA / "photos"))

QUESTION_SECONDS = 30          # countdown per question (msg 2812: 20 → 30 s)
QUICK_LEN = 10                 # Quick game
EXAM_LEN = 25                  # Exam (real test simulation)
EXAM_PASS_PCT = 86             # Czech theory exam ≈ 43/50 points
SURVIVAL_LIVES = 3             # Survival

photo_app = FastAPI(title="car-sim · photo quiz")
templates = Jinja2Templates(directory=str(BASE / "templates"))
photo_app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")
if PHOTOS.exists():
    photo_app.mount("/photos", StaticFiles(directory=str(PHOTOS)), name="photos")


# ---- content ----
def _load_questions() -> list[dict]:
    f = QUIZ_DATA / "questions.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []


QUESTIONS = _load_questions()
QUESTION_BY_ID = {q["id"]: q for q in QUESTIONS}

TOPIC_TYPES = {
    "all": None,
    "signs": {"sign_identification", "sign_meaning"},
    "priority": {"right_of_way"},
    "situation": {"road_situation", "speed_limit"},
}


def topic_pool(topic: str) -> list[str]:
    types = TOPIC_TYPES.get(topic)
    if not types:
        return [q["id"] for q in QUESTIONS]
    ids = [q["id"] for q in QUESTIONS if q.get("type") in types]
    return ids or [q["id"] for q in QUESTIONS]


def interleave_by_type(ids: list[str]) -> list[str]:
    """Order a pool so consecutive questions are different in essence (msg 2812): bucket by question
    type, shuffle each bucket, then round-robin across buckets. A 10-question game then spans signs /
    priority / situations / speed instead of serving six near-identical pedestrian-crossing questions."""
    buckets: dict[str, list[str]] = {}
    for qid in ids:
        buckets.setdefault(QUESTION_BY_ID[qid].get("type", "?"), []).append(qid)
    bl = list(buckets.values())
    for b in bl:
        random.shuffle(b)
    random.shuffle(bl)                       # vary which type leads each game
    order: list[str] = []
    while bl:
        for b in list(bl):                  # one from every non-empty bucket per pass = round-robin
            order.append(b.pop())
            if not b:
                bl.remove(b)
    return order


# ---- in-memory state ----
SESSIONS: dict[str, dict] = {}
LEADERBOARD: list[dict] = []   # survival: [{name, score, q, ts}], top 20 by score

# ---- i18n ----
LANGS_META = [
    ("en", "English", "gb"),
    ("cs", "Čeština", "cz"),
    ("uk", "Українська", "ua"),
    ("sk", "Slovenčina", "sk"),
    ("ru", "Русский", "ru"),
    ("vi", "Tiếng Việt", "vn"),
    ("de", "Deutsch", "de"),
    ("pl", "Polski", "pl"),
    ("kk", "Қазақша", "kz"),
    ("ro", "Română", "ro"),
]
SUPPORTED = [c for c, _, _ in LANGS_META]
DEFAULT_LANG = "en"
RANK_AT = [0, 120, 300, 600, 1000]


def _load_i18n():
    f = QUIZ_DATA / "i18n.json"
    raw = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    ui = {l: raw[l].get("ui", {}) for l in raw}
    ranks = {l: raw[l].get("ranks", []) for l in raw}
    return ui, ranks


UI, RANKS = _load_i18n()
EN_UI = UI.get("en", {})
EN_RANKS = RANKS.get("en", ["Rookie", "Apprentice", "Driver", "Expert", "Master"])


def strings(lang: str) -> dict:
    return {**EN_UI, **UI.get(lang, {})}


def rank_names(lang: str) -> list[str]:
    r = RANKS.get(lang)
    return r if r and len(r) == 5 else EN_RANKS


def detect_lang(explicit, cookie, accept_language) -> str:
    for cand in (explicit, cookie):
        if cand in SUPPORTED:
            return cand
    if accept_language:
        for part in accept_language.split(","):
            code = part.split(";")[0].strip().split("-")[0].lower()
            if code in SUPPORTED:
                return code
    return DEFAULT_LANG


def rank_info(xp: int, lang: str) -> dict:
    names = rank_names(lang)
    lvl = 0
    for i, t in enumerate(RANK_AT):
        if xp >= t:
            lvl = i
    floor = RANK_AT[lvl]
    nxt = RANK_AT[lvl + 1] if lvl + 1 < len(RANK_AT) else None
    if nxt:
        prog = round(100 * (xp - floor) / (nxt - floor))
        to_next = nxt - xp
    else:
        prog, to_next = 100, 0
    return {"level": lvl + 1, "name": names[lvl], "progress": prog,
            "to_next": to_next, "is_max": nxt is None}


def _qfield(q: dict, base: str, lang: str):
    return q.get(f"{base}_{lang}") or q.get(f"{base}_en") or q.get(f"{base}_cs")


def localized(q: dict, lang: str) -> dict:
    return {
        "id": q["id"],
        "type": q.get("type", ""),
        "photo": f"/photos/{q['photo_id']}.jpg",
        "question": _qfield(q, "question", lang),
        "options": _qfield(q, "options", lang),
        "correct_index": q["correct_index"],
        "explanation": _qfield(q, "explanation", lang),
        "photographer": q.get("photographer", "Panoramax"),
        "license": q.get("license", "CC-BY-SA 4.0"),
        "difficulty": q.get("difficulty", 1),
        "locality": q.get("locality") or "Praha",   # photo city — new questions are from Plzeň/HK/ČB, not Praha
    }


# ---- session helpers ----
def new_session(lang: str, mode: str, topic: str) -> str:
    if mode not in ("quick", "exam", "survival"):
        mode = "quick"
    if topic not in TOPIC_TYPES:
        topic = "all"
    total = {"quick": QUICK_LEN, "exam": EXAM_LEN, "survival": None}[mode]
    pool = topic_pool(topic)
    sid = secrets.token_urlsafe(12)
    SESSIONS[sid] = {
        "lang": lang, "mode": mode, "topic": topic,
        "pool": pool, "total": total,
        "seq": interleave_by_type(pool), "seq_i": 0,   # type-spread serving order (msg 2812)
        "served": 0, "correct": 0, "score": 0, "xp": 0,
        "streak": 0, "best_streak": 0,
        "lives": SURVIVAL_LIVES if mode == "survival" else None,
        "cur_qid": None, "q_served_at": 0.0,
        "answered": False, "finished": False,
    }
    if len(SESSIONS) > 5000:
        for k in list(SESSIONS)[:1000]:
            SESSIONS.pop(k, None)
    return sid


def serve_next(s: dict) -> dict:
    seq = s["seq"]
    if s["seq_i"] >= len(seq):                         # survival ran past the pool → fresh interleaved pass
        seq = s["seq"] = interleave_by_type(s["pool"])
        s["seq_i"] = 0
    s["cur_qid"] = seq[s["seq_i"]]
    s["seq_i"] += 1
    s["served"] += 1
    s["q_served_at"] = time.time()
    s["answered"] = False
    return localized(QUESTION_BY_ID[s["cur_qid"]], s["lang"])


def is_over(s: dict) -> bool:
    if s["mode"] == "survival":
        return (s["lives"] or 0) <= 0
    return s["served"] >= (s["total"] or 0)


def hud(s: dict) -> dict:
    streak = s["streak"]
    mult = 2.0 if streak >= 5 else 1.5 if streak >= 3 else 1.0
    return {
        "mode": s["mode"], "score": s["score"], "xp": s["xp"],
        "streak": streak, "mult": mult, "lives": s["lives"],
        "qnum": s["served"], "total": s["total"],
        "rank": rank_info(s["xp"], s["lang"]),
        "survival_lives_max": SURVIVAL_LIVES,
    }


def ctx(request: Request, lang: str, **kw):
    lm = next((m for m in LANGS_META if m[0] == lang), LANGS_META[0])
    base = {
        "request": request, "t": strings(lang), "lang": lang,
        "secs": QUESTION_SECONDS, "langs": LANGS_META, "lang_meta": lm,
        "base": request.scope.get("root_path", ""),   # mount prefix (/quiz/photo) for template URLs
    }
    base.update(kw)
    return base


# ---- routes ----
@photo_app.get("/healthz")
def healthz():
    return {"ok": True, "questions": len(QUESTIONS), "langs": SUPPORTED}


@photo_app.get("/", response_class=HTMLResponse)
def home(request: Request, lang: str | None = None, ui_lang: str | None = Cookie(default=None),
         accept_language: str | None = Header(default=None)):
    chosen = detect_lang(lang, ui_lang, accept_language)
    counts = {k: len(topic_pool(k)) for k in TOPIC_TYPES}
    resp = templates.TemplateResponse("index.html", ctx(request, chosen, count=len(QUESTIONS), counts=counts))
    resp.set_cookie("ui_lang", chosen, max_age=60 * 60 * 24 * 365, samesite="lax")
    return resp


@photo_app.post("/start", response_class=HTMLResponse)
def start(request: Request, mode: str = Form("quick"), topic: str = Form("all"),
          ui_lang: str | None = Cookie(default=None), accept_language: str | None = Header(default=None)):
    lang = detect_lang(None, ui_lang, accept_language)
    if not QUESTIONS:
        return templates.TemplateResponse("index.html", ctx(request, lang, count=0, counts={}))
    sid = new_session(lang, mode, topic)
    s = SESSIONS[sid]
    q = serve_next(s)
    resp = templates.TemplateResponse("game.html", ctx(request, lang, q=q, hud=hud(s)))
    resp.set_cookie("sid", sid, max_age=60 * 60 * 6, samesite="lax", httponly=True)
    return resp


@photo_app.post("/answer", response_class=HTMLResponse)
def answer(request: Request, choice: int = Form(...), sid: str | None = Cookie(default=None)):
    s = SESSIONS.get(sid or "")
    if not s or s["cur_qid"] is None:
        return RedirectResponse(request.scope.get("root_path", "") + "/", status_code=303)
    lang = s["lang"]
    q = localized(QUESTION_BY_ID[s["cur_qid"]], lang)
    if s["answered"]:  # ignore double submits
        return templates.TemplateResponse(
            "_feedback.html",
            ctx(request, lang, q=q, hud=hud(s), chosen=choice,
                is_correct=(choice == q["correct_index"]), timed_out=False,
                points=0, time_bonus=0, mult=1.0, level_up=False, over=is_over(s)))

    elapsed = min(QUESTION_SECONDS, max(0.0, time.time() - s["q_served_at"]))
    timed_out = (choice < 0)
    is_correct = (not timed_out) and (choice == q["correct_index"])
    prev_level = rank_info(s["xp"], lang)["level"]

    points = time_bonus = 0
    mult = 1.0
    s["answered"] = True
    if is_correct:
        streak_now = s["streak"] + 1
        mult = 2.0 if streak_now >= 5 else 1.5 if streak_now >= 3 else 1.0
        time_bonus = round(10 * (QUESTION_SECONDS - elapsed) / QUESTION_SECONDS)
        points = round((10 + time_bonus) * mult)
        s["score"] += points
        s["xp"] += points
        s["streak"] = streak_now
        s["best_streak"] = max(s["best_streak"], streak_now)
        s["correct"] += 1
    else:
        s["streak"] = 0
        if s["mode"] == "survival" and s["lives"] is not None:
            s["lives"] = max(0, s["lives"] - 1)

    level_up = rank_info(s["xp"], lang)["level"] > prev_level
    return templates.TemplateResponse(
        "_feedback.html",
        ctx(request, lang, q=q, hud=hud(s), chosen=choice, is_correct=is_correct,
            timed_out=timed_out, points=points, time_bonus=time_bonus, mult=mult,
            level_up=level_up, over=is_over(s)))


@photo_app.post("/next", response_class=HTMLResponse)
def next_q(request: Request, sid: str | None = Cookie(default=None)):
    s = SESSIONS.get(sid or "")
    if not s:
        return RedirectResponse(request.scope.get("root_path", "") + "/", status_code=303)
    if is_over(s):
        return _render_result(request, s)
    q = serve_next(s)
    return templates.TemplateResponse("_question.html", ctx(request, s["lang"], q=q, hud=hud(s)))


def _render_result(request: Request, s: dict):
    lang = s["lang"]
    s["finished"] = True
    total_q = s["served"]
    pct = round(100 * s["correct"] / total_q) if total_q else 0
    rank = rank_info(s["xp"], lang)
    data = {
        "mode": s["mode"], "topic": s["topic"], "score": s["score"], "xp": s["xp"],
        "correct": s["correct"], "total": total_q, "pct": pct,
        "best_streak": s["best_streak"], "rank": rank,
        "exam_pass": pct >= EXAM_PASS_PCT,
        "qualifies": _qualifies(s["score"]) if s["mode"] == "survival" else False,
        "board": _board_view(),
    }
    if s["mode"] != "survival":
        T = strings(lang)
        data["msg"] = (T["result_great"] if pct >= 80
                       else T["result_good"] if pct >= 50 else T["result_meh"])
    return templates.TemplateResponse("_result.html", ctx(request, lang, r=data))


# ---- survival leaderboard ----
def _qualifies(score: int) -> bool:
    if score <= 0:
        return False
    if len(LEADERBOARD) < 20:
        return True
    return score > min(e["score"] for e in LEADERBOARD)


def _board_view(highlight_ts: float | None = None) -> list[dict]:
    rows = sorted(LEADERBOARD, key=lambda e: -e["score"])[:20]
    return [{**e, "rank": i + 1, "me": (e["ts"] == highlight_ts)} for i, e in enumerate(rows)]


@photo_app.post("/leaderboard", response_class=HTMLResponse)
def submit_score(request: Request, name: str = Form(""), sid: str | None = Cookie(default=None)):
    s = SESSIONS.get(sid or "")
    if not s or s["mode"] != "survival":
        return RedirectResponse(request.scope.get("root_path", "") + "/", status_code=303)
    lang = s["lang"]
    ts = time.time()
    if not s.get("submitted") and _qualifies(s["score"]):
        clean = (name or "Anon").strip()[:14] or "Anon"
        LEADERBOARD.append({"name": clean, "score": s["score"], "q": s["served"], "ts": ts})
        LEADERBOARD.sort(key=lambda e: -e["score"])
        del LEADERBOARD[20:]
        s["submitted"] = True
        my_ts = ts
    else:
        my_ts = None
    return templates.TemplateResponse("_leaderboard.html", ctx(request, lang, board=_board_view(my_ts), submitted=True))
