# car-sim — unified backend. Serves the section pages; the real-map simulator (/drive)
# is a client-side canvas app that streams baked map tiles served as static JSON.
# MVP: one Prague district (Vinohrady). No DB.

import hashlib
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
STATIC = BASE / "static"


def _build_token(root: Path) -> str:
    """Short hash of the static tree's newest mtime. Changes only when an asset
    changes, so the versioned path /s/<token>/ stays stable across no-op restarts
    and rolls forward on a real deploy."""
    newest = 0.0
    for p in root.rglob("*"):
        if p.is_file():
            newest = max(newest, p.stat().st_mtime)
    return hashlib.sha1(str(newest).encode()).hexdigest()[:10]


BUILD = _build_token(STATIC)


class ImmutableStatic(StaticFiles):
    """Versioned assets are content-addressed by the /s/<BUILD>/ path prefix, so they
    can be cached forever — a new deploy serves new URLs for the whole nested
    ES-module graph (a query string can't reach nested imports; a path prefix does)."""

    def file_response(self, *args, **kwargs) -> Response:
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


class RevalidatingStatic(StaticFiles):
    """`Cache-Control: no-cache` → browser/CDN revalidate via ETag (cheap 304 when
    unchanged). Used for data tiles, which aren't path-versioned."""

    def file_response(self, *args, **kwargs) -> Response:
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


app = FastAPI(title="car-sim")
templates = Jinja2Templates(directory=str(BASE / "templates"))
templates.env.cache = None  # avoid a Jinja LRUCache key issue under Python 3.14 (prod uses 3.12)
templates.env.globals["asset_base"] = f"/s/{BUILD}"  # versioned static prefix for all templates
app.mount(f"/s/{BUILD}", ImmutableStatic(directory=str(STATIC)), name="assets")
app.mount("/static", RevalidatingStatic(directory=str(STATIC)), name="static")  # legacy/direct hits
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


HTML_HEADERS = {"Cache-Control": "no-cache"}  # never cache the HTML that names the asset build token


@app.get("/", response_class=HTMLResponse)
def intro(request: Request):
    return templates.TemplateResponse(request, "intro.html", {
        "districts": _districts(),
    }, headers=HTML_HEADERS)


@app.get("/drive", response_class=HTMLResponse)
def drive(request: Request, district: str = "prague"):
    cc, city, _ = DEFAULT_CITY
    meta_path = CITIES / cc / city / district / "meta.json"
    if not meta_path.is_file():
        district = "vinohrady"
        meta_path = CITIES / cc / city / district / "meta.json"
    snapshot = None
    if meta_path.is_file():
        try:
            snapshot = json.loads(meta_path.read_text(encoding="utf-8")).get("snapshot")
        except (ValueError, OSError):
            pass
    return templates.TemplateResponse(request, "drive.html", {
        "country": cc, "city": city, "district": district,
        "data_base": f"/citydata/{cc}/{city}/{district}",
        "snapshot": snapshot,
        "districts": _districts(),
    }, headers=HTML_HEADERS)
