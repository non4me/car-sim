# Situation simulator — migrated from the standalone "ulice-sim" app into car-sim as the
# /quiz/situations subsection (msg 2802). A 2D top-down driving-rules simulator: drive through a
# junction following Czech priority/right-of-way rules (§ 22/§ 21/§ 54), then freeze-and-explain the
# verdict. All game logic (render, agents, rule engine) is client-side (static/js); the backend serves
# the page, the scenario JSONs, and records attempts in memory.
#
# Mounted as a FastAPI SUB-APP at /quiz/situations, so its routes/static live under that prefix. The
# template injects `base` (= the mount root_path) so the client JS hits the prefixed API/asset URLs.

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


@sim_app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "base": request.scope.get("root_path", ""),   # mount prefix (/quiz/situations) for template URLs
        "lang": _ui.resolve_lang(request), "user": auth.current_user(request),  # shared header (msg 2837)
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
