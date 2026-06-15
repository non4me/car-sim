# car-sim auth — dual provider, guest-friendly. Google OAuth (Vlad's preferred external service) is the
# primary sign-in; email+password is a stdlib-only fallback so accounts work with zero external setup.
# Sessions are signed cookies (Starlette SessionMiddleware). Guests stay fully anonymous — these routes
# only matter once someone chooses to sign in.

import hashlib
import os
import secrets

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from . import db

ADMIN_EMAILS = {e.strip().lower() for e in
                os.environ.get("ADMIN_EMAILS", "vladimir.troyanenko@gmail.com").split(",") if e.strip()}

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
GOOGLE_ENABLED = bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)

_oauth = None
if GOOGLE_ENABLED:                                   # lazy: only import/register when configured
    from authlib.integrations.starlette_client import OAuth
    _oauth = OAuth()
    _oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )

# set by main.py after it builds Jinja2Templates (with the asset_base global) — avoids a circular import
templates = None
router = APIRouter()


# ---- password hashing (stdlib scrypt — no fragile bcrypt/passlib dep) ----------------------------

def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    n, r, p = 16384, 8, 1
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${dk.hex()}"


def verify_password(pw: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    try:
        _, n, r, p, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt_hex),
                            n=int(n), r=int(r), p=int(p), dklen=len(hash_hex) // 2)
        return secrets.compare_digest(dk.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


# ---- session helpers -----------------------------------------------------------------------------

def current_user(request: Request) -> dict | None:
    """The logged-in user, or None for a guest. Drops the session if the user vanished/was disabled."""
    uid = request.session.get("uid")
    if not uid:
        return None
    u = db.get_user(uid)
    if u is None or u.get("disabled"):
        request.session.pop("uid", None)
        return None
    return u


def login_user(request: Request, user: dict) -> None:
    request.session["uid"] = user["id"]
    db.touch_login(user["id"])


def logout_user(request: Request) -> None:
    request.session.pop("uid", None)


def _maybe_elevate(user: dict) -> dict:
    """Elevate an ADMIN_EMAILS user to role=admin. SECURITY: only ever called after the email's ownership
    has been PROVEN (a Google-verified sign-in, or the out-of-band startup seed) — NEVER from self-service
    email/password, which would let anyone squat an admin email and grab admin."""
    if user["email"].lower() in ADMIN_EMAILS and user["role"] != "admin":
        db.set_role(user["id"], "admin")
        user = db.get_user(user["id"])
    return user


def seed_admin() -> None:
    """One-shot, out-of-band admin bootstrap from env (only settable by someone with Castle shell access):
    SEED_ADMIN_EMAIL [+ SEED_ADMIN_PASSWORD]. Creates the account as admin if missing, else elevates it.
    This is the trusted path to a first admin before Google OAuth is configured."""
    email = (os.environ.get("SEED_ADMIN_EMAIL") or "").strip().lower()
    if not email:
        return
    user = db.get_user_by_email(email)
    if user is None:
        pw = os.environ.get("SEED_ADMIN_PASSWORD")
        db.create_user(email, pw_hash=hash_password(pw) if pw else None,
                       display_name=email.split("@")[0], role="admin", provider="password")
    elif user["role"] != "admin":
        db.set_role(user["id"], "admin")


def _safe_next(request: Request, default: str = "/me") -> str:
    nxt = request.query_params.get("next")
    # only allow same-site relative paths (no //host, no scheme) to avoid open-redirect
    if nxt and nxt.startswith("/") and not nxt.startswith("//"):
        return nxt
    return default


# ---- pages / routes ------------------------------------------------------------------------------

def _render_login(request: Request, *, error: str | None = None, mode: str = "login", status: int = 200):
    nxt = request.query_params.get("next", "")
    if nxt and not (nxt.startswith("/") and not nxt.startswith("//")):
        nxt = ""
    return templates.TemplateResponse(request, "login.html", {
        "google_enabled": GOOGLE_ENABLED, "error": error, "mode": mode, "next": nxt,
        "user": current_user(request),
    }, status_code=status, headers={"Cache-Control": "no-cache"})


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    if current_user(request):
        return RedirectResponse(_safe_next(request), status_code=303)
    return _render_login(request, mode=request.query_params.get("mode", "login"))


@router.post("/auth/register")
def register(request: Request, email: str = Form(...), password: str = Form(...),
             display_name: str = Form("")):
    email = email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        return _render_login(request, error="Neplatný e-mail.", mode="register", status=400)
    if len(password) < 8:
        return _render_login(request, error="Heslo musí mít aspoň 8 znaků.", mode="register", status=400)
    if db.get_user_by_email(email):
        return _render_login(request, error="Účet s tímto e-mailem už existuje.", mode="register", status=409)
    # SECURITY: self-service registration is ALWAYS a plain user — never trust the email for a role here
    # (the address isn't proven owned). Admin comes only from Google-verified sign-in or the startup seed.
    user = db.create_user(email, pw_hash=hash_password(password),
                          display_name=display_name.strip() or None,
                          role="user", provider="password")
    login_user(request, user)
    return RedirectResponse(_safe_next(request), status_code=303)


@router.post("/auth/login")
def login_submit(request: Request, email: str = Form(...), password: str = Form(...)):
    email = email.strip().lower()
    user = db.get_user_by_email(email)
    if not user or not verify_password(password, user.get("pw_hash")):
        return _render_login(request, error="Nesprávný e-mail nebo heslo.", mode="login", status=401)
    if user.get("disabled"):
        return _render_login(request, error="Účet je zablokován.", mode="login", status=403)
    # NO elevation here — an email/password session never grants admin (the email isn't verified).
    login_user(request, user)
    return RedirectResponse(_safe_next(request), status_code=303)


@router.post("/auth/logout")
@router.get("/auth/logout")
def logout(request: Request):
    logout_user(request)
    return RedirectResponse("/", status_code=303)


@router.get("/auth/google")
async def google_login(request: Request):
    if not GOOGLE_ENABLED:
        raise HTTPException(status_code=404, detail="Google sign-in not configured")
    request.session["oauth_next"] = _safe_next(request)
    redirect_uri = _google_redirect_uri(request)
    return await _oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/auth/google/callback")
async def google_callback(request: Request):
    if not GOOGLE_ENABLED:
        raise HTTPException(status_code=404)
    try:
        token = await _oauth.google.authorize_access_token(request)
    except Exception:
        return _render_login(request, error="Přihlášení přes Google selhalo.", status=400)
    info = token.get("userinfo") or {}
    email = (info.get("email") or "").strip().lower()
    if not email:
        return _render_login(request, error="Google nevrátil e-mail.", status=400)
    # SECURITY: only trust (and possibly admin-elevate) the email if Google says it's verified — otherwise
    # an unverified-email Google account could hijack a same-email password account or claim an admin email.
    ev = info.get("email_verified")
    if not (ev is True or str(ev).lower() == "true"):
        return _render_login(request, error="Google e-mail není ověřený.", status=400)
    user = db.get_user_by_email(email)
    if user is None:
        user = db.create_user(email, display_name=info.get("name"),
                              role="user", provider="google", locale=info.get("locale"))
    if user.get("disabled"):
        return _render_login(request, error="Účet je zablokován.", status=403)
    user = _maybe_elevate(user)             # safe: email is Google-verified here
    login_user(request, user)
    nxt = request.session.pop("oauth_next", "/me")
    return RedirectResponse(nxt if nxt.startswith("/") and not nxt.startswith("//") else "/me", status_code=303)


def _google_redirect_uri(request: Request) -> str:
    """Prefer BASE_URL (correct public https origin behind Traefik/CF); fall back to request URL."""
    base = os.environ.get("BASE_URL", "").rstrip("/")
    if base:
        return base + "/auth/google/callback"
    return str(request.url_for("google_callback"))
