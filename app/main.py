# car-sim — unified backend. Serves the section pages; the real-map simulator (/drive)
# is a client-side canvas app that streams baked map tiles served as static JSON.
# MVP: one Prague district (Vinohrady). No DB.

import hashlib
import json
import os
import re
import secrets
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import Response

from . import auth, db

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

# signed-cookie sessions for auth. SECRET_KEY must be stable across restarts (set in compose) or sessions
# drop on every deploy; a random fallback keeps dev working. same_site=lax so the OAuth redirect keeps the
# cookie; Secure flag on unless explicitly disabled for plain-http local runs.
SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
SESSION_HTTPS = os.environ.get("SESSION_HTTPS", "1") != "0"
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, same_site="lax",
                   https_only=SESSION_HTTPS, max_age=60 * 60 * 24 * 30)

templates = Jinja2Templates(directory=str(BASE / "templates"))
templates.env.cache = None  # avoid a Jinja LRUCache key issue under Python 3.14 (prod uses 3.12)
templates.env.globals["asset_base"] = f"/s/{BUILD}"  # versioned static prefix for all templates
auth.templates = templates                            # share the configured templates with the auth router
app.include_router(auth.router)


@app.on_event("startup")
def _startup():
    db.init_db()
    auth.seed_admin()   # out-of-band admin bootstrap from SEED_ADMIN_EMAIL/PASSWORD env (if set)


app.mount(f"/s/{BUILD}", ImmutableStatic(directory=str(STATIC)), name="assets")
app.mount("/static", RevalidatingStatic(directory=str(STATIC)), name="static")  # legacy/direct hits
if CITIES.exists():
    app.mount("/citydata", RevalidatingStatic(directory=str(CITIES)), name="citydata")

# photo quiz — migrated from the standalone "ulice" game (msg 2802), mounted as a sub-app under /quiz/photo
from .quiz.photo import photo_app  # noqa: E402  (after app/mounts so its import side-effects are last)
app.mount("/quiz/photo", photo_app)

DEFAULT_CITY = ("cz", "praha", "vinohrady")
PRAHA = CITIES / "cz" / "praha"
_DISTRICT_RE = re.compile(r"[a-z0-9_-]{1,40}")


def _district_dir(district: str) -> Path | None:
    """Resolve a baked-district directory from a user-supplied name, refusing path traversal.
    Returns the directory only if `district` is a safe slug, resolves inside data/cities/cz/praha,
    and is actually a baked district (has meta.json). Otherwise None."""
    if not _DISTRICT_RE.fullmatch(district):
        return None
    base = PRAHA.resolve()
    d = (base / district).resolve()
    if d.parent != base or not (d / "meta.json").is_file():
        return None
    return d


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


@app.get("/route")
def route(district: str = "prague", fx: float = 0, fy: float = 0, tx: float = 0, ty: float = 0):
    """Shortest drivable path (one-ways honoured) between two map points, as a polyline."""
    from .routing import get_router
    d = _district_dir(district)
    if d is None:
        return JSONResponse({"polyline": [], "length_m": 0, "error": "unknown district"}, status_code=404)
    r = get_router(d / "graph.json")
    if r is None:
        return JSONResponse({"polyline": [], "length_m": 0, "error": "no graph"}, status_code=404)
    res = r.route(fx, fy, tx, ty)
    return JSONResponse(res or {"polyline": [], "length_m": 0})


HTML_HEADERS = {"Cache-Control": "no-cache"}  # never cache the HTML that names the asset build token


@app.get("/", response_class=HTMLResponse)
def intro(request: Request):
    return templates.TemplateResponse(request, "intro.html", {
        "districts": _districts(),
        "user": auth.current_user(request),
    }, headers=HTML_HEADERS)


@app.get("/quiz", response_class=HTMLResponse)
def quiz_hub(request: Request):
    """Quizzes hub — indexes the sub-quizzes (photo quiz live; situations/signs/rules soon)."""
    return templates.TemplateResponse(request, "quiz.html", {
        "user": auth.current_user(request),
    }, headers=HTML_HEADERS)


@app.get("/drive", response_class=HTMLResponse)
def drive(request: Request, district: str = "prague"):
    cc, city, _ = DEFAULT_CITY
    d = _district_dir(district)
    if d is None:                       # unknown/invalid slug → fall back to the always-present district
        district = "vinohrady"
        d = _district_dir(district)
    snapshot = None
    if d is not None:
        try:
            snapshot = json.loads((d / "meta.json").read_text(encoding="utf-8")).get("snapshot")
        except (ValueError, OSError):
            pass
    return templates.TemplateResponse(request, "drive.html", {
        "country": cc, "city": city, "district": district,
        "data_base": f"/citydata/{cc}/{city}/{district}",
        "snapshot": snapshot,
        "districts": _districts(),
        "user": auth.current_user(request),
    }, headers=HTML_HEADERS)


# ---- accounts: /me (user) + /admin (role=admin) — guests are redirected to /login ----------------

def _require_login(request: Request):
    u = auth.current_user(request)
    if u is None:
        return None, RedirectResponse(f"/login?next={request.url.path}", status_code=303)
    return u, None


@app.get("/me", response_class=HTMLResponse)
def me(request: Request):
    u, redirect = _require_login(request)
    if redirect:
        return redirect
    return templates.TemplateResponse(request, "me.html", {
        "user": u, "trips": db.list_trips(u["id"], limit=50),
    }, headers=HTML_HEADERS)


@app.get("/me/export")
def me_export(request: Request):
    u, redirect = _require_login(request)
    if redirect:
        return redirect
    data = db.export_user(u["id"])
    return JSONResponse(data, headers={
        "Content-Disposition": 'attachment; filename="car-sim-my-data.json"',
        "Cache-Control": "no-store",
    })


@app.post("/me/delete")
def me_delete(request: Request):
    u, redirect = _require_login(request)
    if redirect:
        return redirect
    db.delete_user(u["id"])              # cascades trips/events
    auth.logout_user(request)
    return RedirectResponse("/", status_code=303)


def _require_admin(request: Request):
    u = auth.current_user(request)
    if u is None:
        return None, RedirectResponse(f"/login?next={request.url.path}", status_code=303)
    if u.get("role") != "admin":
        return None, JSONResponse({"error": "forbidden"}, status_code=403)
    return u, None


@app.get("/admin", response_class=HTMLResponse)
def admin(request: Request):
    u, redirect = _require_admin(request)
    if redirect:
        return redirect
    q = request.query_params.get("q") or None
    users = db.list_users(q=q)
    return templates.TemplateResponse(request, "admin.html", {
        "user": u, "users": users, "q": q or "",
        "total": db.count_users(), "admin_emails": sorted(auth.ADMIN_EMAILS),
    }, headers=HTML_HEADERS)


@app.post("/admin/users/{uid}/role")
def admin_set_role(request: Request, uid: int, role: str = Form(...)):
    u, redirect = _require_admin(request)
    if redirect:
        return redirect
    if role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="bad role")
    target = db.get_user(uid)
    if target and target["email"].lower() in auth.ADMIN_EMAILS and role != "admin":
        raise HTTPException(status_code=400, detail="cannot demote a configured admin email")
    db.set_role(uid, role)
    return RedirectResponse("/admin", status_code=303)


@app.post("/admin/users/{uid}/disable")
def admin_disable(request: Request, uid: int, disabled: str = Form("1")):
    u, redirect = _require_admin(request)
    if redirect:
        return redirect
    db.set_disabled(uid, disabled == "1")
    return RedirectResponse("/admin", status_code=303)


@app.post("/admin/users/{uid}/delete")
def admin_delete(request: Request, uid: int):
    u, redirect = _require_admin(request)
    if redirect:
        return redirect
    if uid == u["id"]:
        raise HTTPException(status_code=400, detail="refusing to delete yourself")
    db.delete_user(uid)
    return RedirectResponse("/admin", status_code=303)
