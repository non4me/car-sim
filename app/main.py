# car-sim — unified backend. Serves the section pages; the real-map simulator (/drive)
# is a client-side canvas app that streams baked map tiles served as static JSON.
# MVP: one Prague district (Vinohrady). No DB.

import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.responses import Response

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
CITIES = Path(os.environ.get("CITIES_DIR", ROOT / "data" / "cities"))


class RevalidatingStatic(StaticFiles):
    """Serve assets with `Cache-Control: no-cache` so the browser/CDN must revalidate
    via ETag on every request. Unchanged files return a cheap 304; a deploy of the
    nested ES-module graph (which a query-string cache-bust can't reach) is live at
    once instead of stale for the default max-age window."""

    def file_response(self, *args, **kwargs) -> Response:
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


app = FastAPI(title="car-sim")
templates = Jinja2Templates(directory=str(BASE / "templates"))
templates.env.cache = None  # avoid a Jinja LRUCache key issue under Python 3.14 (prod uses 3.12)
app.mount("/static", RevalidatingStatic(directory=str(BASE / "static")), name="static")
if CITIES.exists():
    app.mount("/citydata", RevalidatingStatic(directory=str(CITIES)), name="citydata")

DEFAULT_CITY = ("cz", "praha", "vinohrady")


def _districts() -> list[dict]:
    """Available baked districts (have a meta.json)."""
    out = []
    base = CITIES / "cz" / "praha"
    if base.exists():
        for d in sorted(base.iterdir()):
            meta = d / "meta.json"
            if meta.is_file():
                m = json.loads(meta.read_text(encoding="utf-8"))
                out.append({"district": d.name, "n_edges": m.get("n_edges", 0)})
    return out


@app.get("/healthz")
def healthz():
    return {"ok": True, "districts": _districts()}


@app.get("/", response_class=HTMLResponse)
def intro(request: Request):
    return templates.TemplateResponse(request, "intro.html", {
        "districts": _districts(),
    })


@app.get("/drive", response_class=HTMLResponse)
def drive(request: Request, district: str = "vinohrady"):
    cc, city, _ = DEFAULT_CITY
    meta_path = CITIES / cc / city / district / "meta.json"
    if not meta_path.is_file():
        district = "vinohrady"
        meta_path = CITIES / cc / city / district / "meta.json"
    return templates.TemplateResponse(request, "drive.html", {
        "country": cc, "city": city, "district": district,
        "data_base": f"/citydata/{cc}/{city}/{district}",
        "districts": _districts(),
    })
