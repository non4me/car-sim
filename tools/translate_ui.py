#!/usr/bin/env python3
"""Machine-translate the app's UI chrome — the /quiz hub and the /drive HUD — into every UI language
(msg 3080/3081/3083). Mirrors translate_laws.run_ui: an English base + an authored Czech original →
data/i18n/app.json keyed by language. Czech is the binding home language (authored inline, never
machine-translated); English is the source the other eight languages are translated from.

Usage:
  GEMINI_API_KEY=... python3 tools/translate_ui.py            # (re)generate data/i18n/app.json
The job overwrites app.json wholesale; run it whenever EN/CS below change.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.translate_laws import translate_strings  # reuse the Gemini client + batching

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "i18n" / "app.json"

# en → these eight (cs is authored below; en is the source).
TARGET = ["ru", "uk", "sk", "vi", "de", "pl", "kk", "ro"]

# English source strings. Keys are shared by /quiz (q_*) and /drive (d_*, w_*, k_*, sign_*, poi_*, cls_*, …).
EN = {
    # ---- /quiz hub ----
    "q_title": "Quizzes",
    "q_sub": "Learn Czech road rules on real street photos — free, no login.",
    "q_photo_t": "Photo quiz",
    "q_photo_d": "Real street photos, 10 languages. Lives game — 3 ❤, XP & ranks, leaderboard.",
    "q_sit_t": "Situation simulator",
    "q_sit_d": "Top-down intersection scenarios — who goes first, when to stop. 8 junctions, freeze-and-explain.",
    "q_sign_t": "Sign trainer",
    "q_sign_d": "Flashcards for every Czech road sign, spaced repetition.",
    "q_rules_t": "Rules flashcards",
    "q_rules_d": "Key sections of Act 361/2000 Coll., bite-sized and searchable.",
    "tag_live": "live",
    "tag_soon": "soon",
    "q_footer": "Photo: Panoramax (CC-BY-SA) · Map data © OpenStreetMap contributors (ODbL). Educational project.",
    # ---- /drive: tools bar + search ----
    "d_search_ph": "Search street / district…",
    "d_route_btn": "Route",
    "d_route_btn_title": "Route between streets",
    "k_district": "district",
    "k_street": "street",
    # ---- /drive: route panel ----
    "d_from_ph": "From (street)…",
    "d_to_ph": "To (street)…",
    "d_find": "Find route",
    "d_pick2": "pick two streets",
    "d_pickdest": "pick destination",
    "d_pickstart": "pick start",
    "d_ready": "ready",
    "d_searching": "finding route…",
    "d_route": "route",
    "d_notfound": "route not found",
    "d_connerr": "connection error",
    "d_arrived": "destination ✓",
    "d_clear_title": "Clear route",
    "d_follow": "Automatic route following",
    "d_follow_title": "Auto-drive the route: steering automatic, throttle/brake are yours",
    "d_route_hint": "Show the whole route with the “Route” button on the minimap →",
    # ---- /drive: help + pause overlays ----
    "d_help_title": "Controls",
    "d_help_throttle": "throttle (holds speed)",
    "d_help_brake": "brake / reverse",
    "d_help_steer": "rotate in place / steer",
    "d_help_hardbrake": "hard brake",
    "d_help_pause": "pause",
    "d_help_mouse": "mouse wheel = zoom · drag left = pan map · right = rotate · double-click = move car",
    "d_help_go": "Drive →",
    "d_pause": "Paused",
    "d_pause_sub": "resume",
    # ---- /drive: minimap ----
    "d_mini_opacity": "Transparency",
    "d_mini_collapse": "Collapse map",
    "d_mini_restore": "Show map",
    "d_mini_zoomout": "Zoom out",
    "d_mini_zoomin": "Zoom in",
    "d_mini_city": "City",
    "d_mini_city_title": "Whole city: main districts and objects",
    "d_mini_route": "Route",
    "d_mini_route_title": "Whole route on the minimap",
    "d_mini_route_tag": "ROUTE",
    # ---- /drive: HUD warnings ----
    "w_over": "Speeding",
    "w_boundary": "End of the road — turn around",
    "w_offroad": "Off the road",
    "w_oncoming": "Wrong way!",
    # ---- /drive: hover tooltips (msg 3074) ----
    "sign_signal": "Traffic lights",
    "sign_stop": "Stop, give way",
    "sign_giveway": "Give way",
    "sign_priority": "Priority road",
    "hov_crossing": "Pedestrian crossing",
    "hov_house": "house no.",
    "hov_num": "no.",
    "hov_oneway": "one-way",
    "hov_bridge": "bridge",
    "hov_tunnel": "tunnel",
    "area_green": "Greenery",
    "area_water": "Water",
    "poi_food": "fast food",
    "poi_cafe": "café",
    "poi_fuel": "petrol station",
    "poi_atm": "ATM",
    "poi_bank": "bank",
    "poi_pharmacy": "pharmacy",
    "poi_post": "post office",
    "poi_shop": "shop",
    "poi_police": "police",
    "poi_fire": "fire station",
    "poi_hospital": "hospital",
    "poi_school": "school",
    "poi_station": "station",
    "poi_parking": "parking",
    "cls_motorway": "motorway",
    "cls_trunk": "trunk road",
    "cls_primary": "primary road",
    "cls_secondary": "secondary road",
    "cls_tertiary": "tertiary road",
    "cls_residential": "local street",
    "cls_service": "service road",
    "cls_other": "road",
}

# Authored Czech original (the binding home language). Mirrors what the templates/JS say today.
CS = {
    "q_title": "Kvízy",
    "q_sub": "Nauč se česká pravidla silničního provozu na skutečných fotkách ulic — zdarma, bez přihlášení.",
    "q_photo_t": "Fotokvíz",
    "q_photo_d": "Skutečné fotky ulic, 10 jazyků. Hra na životy — 3 ❤, XP a hodnosti, žebříček.",
    "q_sit_t": "Simulátor situací",
    "q_sit_d": "Křižovatky z ptačí perspektivy — kdo jede první, kdy zastavit. 8 křižovatek, zastav a vysvětli.",
    "q_sign_t": "Trenažér značek",
    "q_sign_d": "Kartičky pro každou českou dopravní značku, opakování s odstupem.",
    "q_rules_t": "Kartičky pravidel",
    "q_rules_d": "Klíčové §§ zákona 361/2000 Sb., přehledně a s vyhledáváním.",
    "tag_live": "živě",
    "tag_soon": "brzy",
    "q_footer": "Foto: Panoramax (CC-BY-SA) · Mapová data © přispěvatelé OpenStreetMap (ODbL). Vzdělávací projekt.",
    "d_search_ph": "Hledat ulici / čtvrť…",
    "d_route_btn": "Trasa",
    "d_route_btn_title": "Trasa mezi ulicemi",
    "k_district": "čtvrť",
    "k_street": "ulice",
    "d_from_ph": "Odkud (ulice)…",
    "d_to_ph": "Kam (ulice)…",
    "d_find": "Najít trasu",
    "d_pick2": "vyber dvě ulice",
    "d_pickdest": "vyber cíl",
    "d_pickstart": "vyber start",
    "d_ready": "připraveno",
    "d_searching": "hledám trasu…",
    "d_route": "trasa",
    "d_notfound": "trasa nenalezena",
    "d_connerr": "chyba spojení",
    "d_arrived": "cíl ✓",
    "d_clear_title": "Zrušit trasu",
    "d_follow": "Automatické sledování trasy",
    "d_follow_title": "Auto-jízda po trase: řízení automatické, plyn/brzda na tobě",
    "d_route_hint": "Celou trasu zobrazíš tlačítkem „Trasa“ na minimapě →",
    "d_help_title": "Ovládání",
    "d_help_throttle": "plyn (rychlost drží)",
    "d_help_brake": "brzda / zpátečka",
    "d_help_steer": "otáčení na místě / řízení",
    "d_help_hardbrake": "prudké brzdění",
    "d_help_pause": "pauza",
    "d_help_mouse": "kolečko myši = přiblížení · táhni levým = posun mapy · pravým = otáčení · dvojklik = přesun auta",
    "d_help_go": "Jet →",
    "d_pause": "Pauza",
    "d_pause_sub": "pokračovat",
    "d_mini_opacity": "Průhlednost",
    "d_mini_collapse": "Sbalit mapu",
    "d_mini_restore": "Zobrazit mapu",
    "d_mini_zoomout": "Oddálit",
    "d_mini_zoomin": "Přiblížit",
    "d_mini_city": "Město",
    "d_mini_city_title": "Celé město: hlavní čtvrti a objekty",
    "d_mini_route": "Trasa",
    "d_mini_route_title": "Celá trasa na minimapě",
    "d_mini_route_tag": "TRASA",
    "w_over": "Překročení rychlosti",
    "w_boundary": "Dál cesta nevede — otočte se",
    "w_offroad": "Mimo vozovku",
    "w_oncoming": "V protisměru!",
    "sign_signal": "Semafor",
    "sign_stop": "Stůj, dej přednost v jízdě",
    "sign_giveway": "Dej přednost v jízdě",
    "sign_priority": "Hlavní pozemní komunikace",
    "hov_crossing": "Přechod pro chodce",
    "hov_house": "č. p.",
    "hov_num": "č.",
    "hov_oneway": "jednosměrka",
    "hov_bridge": "most",
    "hov_tunnel": "tunel",
    "area_green": "Zeleň",
    "area_water": "Voda",
    "poi_food": "občerstvení",
    "poi_cafe": "kavárna",
    "poi_fuel": "čerpací stanice",
    "poi_atm": "bankomat",
    "poi_bank": "banka",
    "poi_pharmacy": "lékárna",
    "poi_post": "pošta",
    "poi_shop": "obchod",
    "poi_police": "policie",
    "poi_fire": "hasiči",
    "poi_hospital": "nemocnice",
    "poi_school": "škola",
    "poi_station": "stanice",
    "poi_parking": "parkoviště",
    "cls_motorway": "dálnice",
    "cls_trunk": "silnice I. třídy",
    "cls_primary": "silnice I. třídy",
    "cls_secondary": "silnice II. třídy",
    "cls_tertiary": "silnice III. třídy",
    "cls_residential": "místní ulice",
    "cls_service": "účelová komunikace",
    "cls_other": "silnice",
}


def main():
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY not set")
    assert set(EN) == set(CS), f"EN/CS key mismatch: {set(EN) ^ set(CS)}"
    keys = list(EN.keys())
    vals = [EN[k] for k in keys]
    out = {"en": dict(EN), "cs": dict(CS)}
    for lang in TARGET:
        tr = translate_strings(vals, lang, key)
        assert len(tr) == len(keys)
        out[lang] = dict(zip(keys, tr))
        print(f"  app[{lang}] done ({len(keys)} strings)", flush=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT} ({len(out)} languages)")


if __name__ == "__main__":
    main()
