"""Shared app chrome (msg 2837): one header across every section — home logo, the quiz-style flag
language selector, and login/registration (or the signed-in user menu).

Rendered in Python rather than a Jinja include because the sections live in different template
environments (the main app, the /quiz/photo and /quiz/situations sub-apps) and different CSS stacks
(plain CSS vs Tailwind vs the /drive canvas HUD). One function = one source of truth everywhere.

Expose the module as the Jinja global `hdr` (not `ui` — the docs templates already use `ui` for their
localized-strings dict). Pages put `{{ hdr.header(lang, user) }}` at the top of <body>; /drive pulls the
pieces (`hdr.assets()`, `hdr.logo()`, `hdr.lang_dropdown(lang)`, `hdr.user_menu(lang, user)`) into its HUD.
"""
from markupsafe import Markup, escape

# (code, endonym, flag-cc) — same language set as the photo quiz; cs first (the home country).
LANGS = [
    ("cs", "Čeština", "cz"), ("en", "English", "gb"), ("ru", "Русский", "ru"), ("uk", "Українська", "ua"),
    ("sk", "Slovenčina", "sk"), ("vi", "Tiếng Việt", "vn"), ("de", "Deutsch", "de"), ("pl", "Polski", "pl"),
    ("kk", "Қазақша", "kz"), ("ro", "Română", "ro"),
]
SUPPORTED = [c for c, _, _ in LANGS]
_CC = {c: cc for c, _, cc in LANGS}
_NAME = {c: n for c, n, _ in LANGS}

# header strings per language: sign-in / register / profile / sign-out / admin
HSTR = {
    "cs": ("Přihlásit se", "Registrace", "Profil", "Odhlásit", "Admin"),
    "en": ("Sign in", "Sign up", "Profile", "Sign out", "Admin"),
    "ru": ("Войти", "Регистрация", "Профиль", "Выйти", "Админ"),
    "uk": ("Увійти", "Реєстрація", "Профіль", "Вийти", "Адмін"),
    "sk": ("Prihlásiť sa", "Registrácia", "Profil", "Odhlásiť", "Admin"),
    "vi": ("Đăng nhập", "Đăng ký", "Hồ sơ", "Đăng xuất", "Quản trị"),
    "de": ("Anmelden", "Registrieren", "Profil", "Abmelden", "Admin"),
    "pl": ("Zaloguj się", "Rejestracja", "Profil", "Wyloguj", "Admin"),
    "kk": ("Кіру", "Тіркелу", "Профиль", "Шығу", "Әкімші"),
    "ro": ("Autentificare", "Înregistrare", "Profil", "Deconectare", "Admin"),
}


def resolve_lang(request, default: str = "cs") -> str:
    """Effective UI language: explicit ?lang= wins, else the carsim_lang cookie, else the default."""
    q = request.query_params.get("lang")
    if q in SUPPORTED:
        return q
    c = request.cookies.get("carsim_lang")
    return c if c in SUPPORTED else default


# Brand mark: the literal 🚗 emoji — the same car shown next to the "Drive"/"Jízda" card — with NO
# background badge (Vlad msg 2938/2939). The favicon (static/favicon.svg) renders the same emoji as text.
LOGO_SVG = '<span class="ah-mark" aria-hidden="true">🚗</span>'

_FLAG = '<img class="ah-flag" src="/static/flags/{cc}.svg" alt="" width="20" height="14">'

_CSS = """
<style>
.ah-bar{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:14px;
  padding:9px 18px;background:rgba(11,14,20,.86);backdrop-filter:blur(8px);
  border-bottom:1px solid #1c2330;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.ah-logo{display:flex;align-items:center;gap:9px;text-decoration:none;color:#e6e9f0;font-weight:800;
  font-size:17px;letter-spacing:-.02em;white-space:nowrap}
.ah-mark{flex:none;font-size:21px;line-height:1}
.ah-logo .ac{color:#5b9cff}
.ah-spacer{flex:1}
.ah-right{display:flex;align-items:center;gap:10px}
.ah-lang{position:relative}
.ah-langbtn{display:flex;align-items:center;gap:7px;background:#141925;border:1px solid #222a3a;border-radius:9px;
  padding:6px 9px;color:#cfd6e2;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
.ah-langbtn:hover{border-color:#5b9cff}
.ah-flag{border-radius:2px;object-fit:cover;box-shadow:0 0 0 1px rgba(0,0,0,.3)}
.ah-caret{color:#6b7385;font-size:10px}
.ah-menu{position:absolute;right:0;top:calc(100% + 5px);min-width:184px;max-height:60vh;overflow:auto;
  background:#141925;border:1px solid #222a3a;border-radius:11px;box-shadow:0 14px 34px rgba(0,0,0,.5);
  padding:5px;z-index:70}
.ah-menu.ah-hidden{display:none}
.ah-opt{display:flex;align-items:center;gap:9px;width:100%;box-sizing:border-box;padding:7px 9px;border-radius:7px;
  background:none;border:0;color:#dbe1ec;font-size:13.5px;cursor:pointer;text-align:left;font-family:inherit}
.ah-opt:hover{background:#1c2536}
.ah-opt.ah-on{color:#5b9cff;font-weight:700}
.ah-link{color:#9aa4b8;text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap}
.ah-link:hover{color:#e6e9f0}
.ah-cta{color:#06203f;background:#5b9cff;border-radius:8px;padding:6px 13px}
.ah-cta:hover{filter:brightness(1.07);color:#06203f}
@media(max-width:560px){.ah-langbtn .ah-name,.ah-link.ah-hide-sm{display:none}}
</style>
"""

_JS = """
<script>
(function(){
  if(window.__ahInit) return; window.__ahInit=true;
  document.addEventListener('click',function(e){
    var t=e.target.closest('[data-ah-toggle]');
    document.querySelectorAll('.ah-menu').forEach(function(m){
      if(t && m===t.parentNode.querySelector('.ah-menu')){ m.classList.toggle('ah-hidden'); }
      else { m.classList.add('ah-hidden'); }
    });
    var o=e.target.closest('[data-ah-lang]');
    if(o){ var code=o.getAttribute('data-ah-lang');
      document.cookie='carsim_lang='+code+';path=/;max-age=31536000;samesite=lax';
      var u=new URL(window.location.href); u.searchParams.set('lang',code); window.location.href=u.toString(); }
  });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')
    document.querySelectorAll('.ah-menu').forEach(function(m){m.classList.add('ah-hidden');}); });
})();
</script>
"""


ASSET_VER = ""  # set by main.py to the static BUILD token; ?v=<token> busts the favicon cache the
                # moment the icon file changes (the route sends a long max-age), so no stale icon.


def _favicon_link() -> str:
    v = f"?v={ASSET_VER}" if ASSET_VER else ""
    return f'<link rel="icon" type="image/svg+xml" href="/favicon.svg{v}">'


def assets() -> Markup:
    """The header's favicon link + CSS + JS. Include once per page (idempotent JS guard)."""
    return Markup(_favicon_link() + _CSS + _JS)


def logo(home: str = "/") -> Markup:
    return Markup(f'<a class="ah-logo" href="{home}" title="car-sim">{LOGO_SVG}'
                  f'<span><span class="ac">car</span>-sim</span></a>')


def lang_dropdown(lang: str) -> Markup:
    lang = lang if lang in SUPPORTED else "cs"
    opts = "".join(
        f'<button class="ah-opt {"ah-on" if c == lang else ""}" data-ah-lang="{c}">'
        f'{_FLAG.format(cc=cc)}<span>{n}</span></button>'
        for c, n, cc in LANGS)
    return Markup(
        '<div class="ah-lang">'
        f'<button class="ah-langbtn" data-ah-toggle aria-haspopup="true">'
        f'{_FLAG.format(cc=_CC[lang])}<span class="ah-name">{_NAME[lang]}</span><span class="ah-caret">▾</span></button>'
        f'<div class="ah-menu ah-hidden" role="listbox">{opts}</div></div>')


def user_menu(lang: str, user) -> Markup:
    s = HSTR.get(lang, HSTR["en"])
    if user:
        # display_name/email are user-controlled (set at registration) and this string is wrapped in
        # Markup() below, which bypasses Jinja auto-escaping — escape it to prevent stored XSS.
        name = escape((user.get("display_name") or user.get("email") or "").split("@")[0])
        out = f'<a class="ah-link" href="/me">👤 {name}</a>'
        if user.get("role") == "admin":
            out += f'<a class="ah-link ah-hide-sm" href="/admin">🛠️ {s[4]}</a>'
        out += f'<a class="ah-link" href="/auth/logout">{s[3]}</a>'
        return Markup(out)
    return Markup(f'<a class="ah-link ah-hide-sm" href="/login">{s[0]}</a>'
                  f'<a class="ah-link ah-cta" href="/login?mode=register">{s[1]}</a>')


def header(lang: str, user=None, home: str = "/") -> Markup:
    """Full top bar for page sections: logo · spacer · language selector · login/user menu."""
    return Markup(
        f'{assets()}<header class="ah-bar">{logo(home)}<div class="ah-spacer"></div>'
        f'<div class="ah-right">{lang_dropdown(lang)}{user_menu(lang, user)}</div></header>')
