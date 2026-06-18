# Situation simulator — migrated from the standalone "ulice-sim" app into car-sim as the
# /quiz/situations subsection (msg 2802). A 2D top-down driving-rules simulator: drive through a
# junction following Czech priority/right-of-way rules (§ 22/§ 21/§ 54), then freeze-and-explain the
# verdict. All game logic (render, agents, rule engine) is client-side (static/js); the backend serves
# the page, the scenario JSONs, and records attempts in memory.
#
# Mounted as a FastAPI SUB-APP at /quiz/situations, so its routes/static live under that prefix. The
# template injects `base` (= the mount root_path) so the client JS hits the prefixed API/asset URLs.

import hashlib
import json
import os
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BASE = Path(__file__).resolve().parent                       # app/quiz/situations
SC_DIR = Path(os.environ.get("SCENARIOS_DIR", BASE / "scenarios"))

sim_app = FastAPI(title="car-sim · situation simulator")
templates = Jinja2Templates(directory=str(BASE / "templates"))
from ... import auth, ui as _ui                               # shared common header (msg 2837)
templates.env.globals["hdr"] = _ui
sim_app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


def _build_token(root: Path) -> str:
    """Short hash of the static tree's newest mtime — same idea as the main app: a versioned PATH prefix
    (not a query string) so a deploy busts the whole nested ES-module graph (game.js → ./i18n.js) at once,
    rather than CF serving a stale i18n.js while index.html injects fresh strings (msg 3083)."""
    newest = 0.0
    for p in root.rglob("*"):
        if p.is_file():
            newest = max(newest, p.stat().st_mtime)
    return hashlib.sha1(str(newest).encode()).hexdigest()[:10]


SIM_BUILD = _build_token(BASE / "static")
sim_app.mount(f"/s/{SIM_BUILD}", StaticFiles(directory=str(BASE / "static")), name="vstatic")


def load_scenarios() -> dict:
    out = {}
    if SC_DIR.exists():
        for f in sorted(SC_DIR.glob("*.json")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
                out[d["id"]] = d
            except Exception as e:  # a malformed scenario shouldn't kill startup
                print(f"skip {f.name}: {e}")
    return out


SCENARIOS = load_scenarios()
ORDER = [d["id"] for d in sorted(SCENARIOS.values(), key=lambda x: x.get("order", 0))]
ATTEMPTS: list[dict] = []


@sim_app.get("/healthz")
def healthz():
    return {"ok": True, "scenarios": len(SCENARIOS)}


# client i18n bundle (msg 3083): the UI strings + rule explanations for the chosen language, shaped the way
# the game JS reads them (STR[lang] / REASON[lang][k] / RULES[key][lang]). Keys live in data/i18n/app.json.
_SIM_STR = ("go", "retry", "next", "menu", "pass", "fail", "finished", "score", "play")
_SIM_REASON = ("collision", "no_yield", "ran_stop", "ped", "over_cautious", "pass")
_SIM_RULES = ("prednost_zprava", "left_yields", "give_way", "stop", "priority_road",
              "tram_turning", "tram_straight", "tram_straight_yields", "pedestrian")


def _sim_i18n(s: dict) -> dict:
    return {
        "str": {k: s.get("sim_" + k, "") for k in _SIM_STR},
        "reason": {k: s.get("reason_" + k, "") for k in _SIM_REASON},
        "rules": {k: s.get("rule_" + k, "") for k in _SIM_RULES},
    }


@sim_app.get("/", response_class=HTMLResponse)
def home(request: Request):
    lang = _ui.resolve_lang(request)
    s = _ui.app_strings(lang)
    return templates.TemplateResponse("index.html", {
        "request": request,
        "base": request.scope.get("root_path", ""),   # mount prefix (/quiz/situations) for template URLs
        "lang": lang, "t": s, "user": auth.current_user(request),  # shared header (msg 2837)
        "sim_i18n_json": json.dumps(_sim_i18n(s), ensure_ascii=False),
        "build": SIM_BUILD,                            # versioned static prefix → no stale game JS (msg 3083)
    })


@sim_app.get("/scenarios")
def scenarios():
    return [
        {"id": d["id"], "order": d.get("order", 0), "title": d.get("title", {}),
         "rule": d.get("rule"), "hint": d.get("hint", {})}
        for d in (SCENARIOS[i] for i in ORDER)
    ]


@sim_app.get("/scenario/{sid}")
def scenario(sid: str):
    d = SCENARIOS.get(sid)
    if not d:
        return JSONResponse({"error": "not found"}, status_code=404)
    return d


@sim_app.post("/api/attempt")
async def attempt(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    ATTEMPTS.append({**body, "ts": time.time()})
    if len(ATTEMPTS) > 10000:
        del ATTEMPTS[:5000]
    return {"ok": True}
