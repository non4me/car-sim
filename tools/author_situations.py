#!/usr/bin/env python3
"""Author real-junction situation scenarios at scale (msg 3104).

Pulls faithful geometry from the OSM bake (via extract_junction) and turns a compact, high-level spec
(ego/other actors described as "enter from <street>@<compass>, go straight/left/right") into explicit
lane-following actor paths through the real junction — so many faithful scenarios can be authored quickly,
each with real street names on the schematic, the real location, and accident statistics where known.

  python3 tools/author_situations.py --inspect ip_pavlova     # print a junction's detected arms
  python3 tools/author_situations.py --build                  # (re)write all scenarios to scenarios/
"""
import argparse, json, math, sys, unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_junction import locate, build_geom, load_city          # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "app/quiz/situations/scenarios"
COMPASS = {"N": (0, -1), "NE": (.7071, -.7071), "E": (1, 0), "SE": (.7071, .7071),
           "S": (0, 1), "SW": (-.7071, .7071), "W": (-1, 0), "NW": (-.7071, -.7071)}


def fold(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c)).lower()


def _len(cl):
    return sum(math.dist(cl[i - 1], cl[i]) for i in range(1, len(cl)))


def _norm(v):
    L = math.hypot(*v) or 1
    return [v[0] / L, v[1] / L]


def _hyp(p):
    return math.hypot(p[0], p[1])


def _orient_core_outer(cl):
    return cl if _hyp(cl[0]) <= _hyp(cl[-1]) else cl[::-1]


def _point_at(cl, dist):                       # walk `dist` m along cl from its start
    acc = 0
    for i in range(1, len(cl)):
        seg = math.dist(cl[i - 1], cl[i])
        if acc + seg >= dist:
            t = (dist - acc) / seg if seg else 0
            return [cl[i - 1][0] + (cl[i][0] - cl[i - 1][0]) * t, cl[i - 1][1] + (cl[i][1] - cl[i - 1][1]) * t]
        acc += seg
    return cl[-1]


def build_arms(geom, core_max=15.0):
    """Each road touching the junction core, oriented core→outer, with its outward compass bearing."""
    arms = []
    for rd in geom["roads"]:
        cl = _orient_core_outer([p[:] for p in rd["centerline"]])
        if _hyp(cl[0]) > core_max:
            continue
        bear = _norm(_point_at(cl, min(16, _len(cl))))
        comp = max(COMPASS, key=lambda k: bear[0] * COMPASS[k][0] + bear[1] * COMPASS[k][1])
        arms.append({"name": rd["name"], "cl": cl, "halfW": rd["halfW"],
                     "oneway": rd["oneway"], "bear": bear, "compass": comp})
    return arms


def resolve_arm(arms, ref):
    """ref = 'Street@DIR' | '@DIR' | 'DIR' → the best-matching arm."""
    name, _, dirc = ref.rpartition("@") if "@" in ref else ("", "", ref)
    pool = [a for a in arms if not name or fold(name) in fold(a["name"])]
    if not pool:
        sys.exit(f"no arm matches '{ref}' (arms: {[a['name']+'@'+a['compass'] for a in arms]})")
    d = COMPASS.get(dirc.upper())
    if not d:
        sys.exit(f"bad compass in '{ref}'")
    return max(pool, key=lambda a: a["bear"][0] * d[0] + a["bear"][1] * d[1])


def _offset_rht(path, d):                       # offset each point d metres to the right of travel
    out = []
    for i, p in enumerate(path):
        j = min(i, len(path) - 2)
        t = _norm([path[j + 1][0] - path[j][0], path[j + 1][1] - path[j][1]])
        out.append([p[0] - t[1] * d, p[1] + t[0] * d])     # V.right(t) = [-t_y, t_x]
    return out


def _bezier(a, c, b, n=8):
    return [[(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
             (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]
            for t in (i / n for i in range(n + 1))]


def actor_path(arms, frm, to, lane=0.5, core_r=6.0):
    fa = resolve_arm(arms, frm)
    tin = [-fa["bear"][0], -fa["bear"][1]]                  # inward travel direction
    if to in ("straight", "left", "right"):
        tgt = tin if to == "straight" else ([-tin[1], tin[0]] if to == "right" else [tin[1], -tin[0]])
        ta = max((a for a in arms if a is not fa),
                 key=lambda a: a["bear"][0] * tgt[0] + a["bear"][1] * tgt[1])
    else:
        ta = resolve_arm(arms, to)
    entry = _offset_rht(fa["cl"][::-1], fa["halfW"] * lane)        # outer→core, drive inward
    entry = [p for p in entry if _hyp(p) >= core_r] or [entry[-1]]
    ex = _offset_rht(ta["cl"], ta["halfW"] * lane)                 # core→outer, drive outward
    ex = [p for p in ex if _hyp(p) >= core_r] or [ex[0]]
    path = entry + _bezier(entry[-1], [0, 0], ex[0])[1:-1] + ex
    return [[round(p[0], 1), round(p[1], 1)] for p in path]


# ---- junction extracts (city, street pair, --near seed in projected m, radius) ----
EXTRACTS = {
    "ip_pavlova":    dict(city="praha", streets="Sokolská|Ječná",        near=(-2573, 1824),  r=60, name="I. P. Pavlova", district="Praha 2"),
    "klarov":        dict(city="praha", streets="Klárov|Valdštejnská",   near=(-4100, 3580),  r=52, name="Klárov × Valdštejnská", district="Praha 1 · Malá Strana"),
    "vitezne":       dict(city="praha", streets="Vítězné náměstí|Jugoslávských partyzánů", near=(-5096, 4648), r=70, name="Vítězné náměstí", district="Praha 6 · Dejvice"),
    "strossmayer":   dict(city="praha", streets="Strossmayerovo náměstí|Dukelských hrdinů", near=(-2128, 4412), r=58, name="Strossmayerovo náměstí", district="Praha 7 · Holešovice"),
    "korunni":       dict(city="praha", streets="Korunní|Bělehradská",   near=(-1700, 1500),  r=50, name="Korunní × Bělehradská", district="Praha 2 · Vinohrady"),
    "michelska":     dict(city="praha", streets="Michelská|Ohradní",     near=(-838, -763),   r=42, name="Michelská × Ohradní", district="Praha 4 · Michle"),
    "cernokostel":   dict(city="praha", streets="Černokostelecká|Saratovská", near=(1916, 1957), r=46, name="Černokostelecká × Saratovská", district="Praha 10 · Strašnice"),
    "nalanech":      dict(city="praha", streets="Na Líše|Na Lánech",     near=(-98, -1199),   r=40, name="Na Líše × Na Lánech", district="Praha 4 · Michle"),
    "bulovka":       dict(city="praha", streets="Povltavská|Bulovka",    near=(-117, 6000),   r=55, name="Povltavská × Bulovka", district="Praha 8 · Libeň"),
    "strboholy":     dict(city="praha", streets="Průmyslová|Černokostelecká", near=(4300, -200), r=60, name="Průmyslová × Černokostelecká", district="Praha 10 · Štěrboholy"),
}

CITE = {
    "prednost_zprava": "§ 22 odst. 1 z. 361/2000 Sb.",
    "give_way": "značka P4, § 22 z. 361/2000 Sb.",
    "priority_road": "§ 22 z. 361/2000 Sb.",
    "tram_straight_yields": "§ 21 a § 22 z. 361/2000 Sb.",
    "tram_turning": "§ 21 odst. 7 z. 361/2000 Sb.",
}

# Each spec: an EXTRACTS key + the teaching layer + high-level actors (resolved to real lane paths).
SPECS = [
    dict(
        id="r1_prednost_zprava", order=1, extract="nalanech",
        title={"cs": "Přednost zprava", "en": "Priority from the right", "ru": "Помеха справа"},
        hint={"cs": "Neoznačená křižovatka. Sledujte situaci a rozhodněte.",
              "en": "Unmarked junction. Watch and decide.",
              "ru": "Нерегулируемый перекрёсток. Смотрите и решайте."},
        actors=[
            dict(kind="ego", frm="Na Lánech@SW", to="straight", v=7, spawn=0.0),
            dict(kind="car", frm="Na Líše@SE", to="straight", v=7, spawn=0.0),
        ],
        decision=dict(t=3.2),
        question={"cs": "Křižovatka bez dopravních značek. Zprava přijíždí vozidlo. Jak budete pokračovat?",
                  "en": "A junction with no signs. A vehicle is coming from the right. How do you proceed?",
                  "ru": "Перекрёсток без знаков. Справа приближается автомобиль. Как вы поступите?"},
        options=[
            dict(text={"cs": "Mám přednost, projedu první", "en": "I have priority, I go first", "ru": "У меня приоритет, проезжаю первым"}, correct=False, rule="prednost_zprava"),
            dict(text={"cs": "Dám přednost vozidlu zprava", "en": "I give way to the vehicle on the right", "ru": "Уступлю автомобилю справа"}, correct=True, rule="prednost_zprava"),
            dict(text={"cs": "Zatroubím a projedu", "en": "I honk and go", "ru": "Сигналю и проезжаю"}, correct=False, rule="prednost_zprava"),
        ],
        explain={"cs": "Na křižovatce bez dopravních značek platí přednost zprava (pravidlo pravé ruky). Vozidlo přijíždějící zprava má přednost — musíte mu dát přednost v jízdě.",
                 "en": "At a junction with no signs, priority-to-the-right applies. The vehicle coming from your right has priority — you must give way.",
                 "ru": "На перекрёстке без знаков действует «помеха справа». Автомобиль, приближающийся справа, имеет приоритет — вы должны уступить."},
        rule="prednost_zprava",
    ),
    dict(
        id="r2_prednost_zleva", order=2, extract="nalanech",
        title={"cs": "Máte přednost?", "en": "Do you have priority?", "ru": "У вас приоритет?"},
        hint={"cs": "Neoznačená křižovatka. Zleva přijíždí vozidlo.",
              "en": "Unmarked junction. A vehicle comes from the left.",
              "ru": "Нерегулируемый перекрёсток. Слева приближается автомобиль."},
        actors=[
            dict(kind="ego", frm="Na Líše@SE", to="straight", v=7, spawn=0.0),
            dict(kind="car", frm="Na Lánech@SW", to="straight", v=7, spawn=0.2),
        ],
        decision=dict(t=3.2),
        question={"cs": "Křižovatka bez značek, zleva přijíždí vozidlo. Jak budete pokračovat?",
                  "en": "No signs; a vehicle comes from the left. How do you proceed?",
                  "ru": "Перекрёсток без знаков, слева приближается автомобиль. Как вы поступите?"},
        options=[
            dict(text={"cs": "Dám přednost vozidlu zleva", "en": "Give way to the vehicle on the left", "ru": "Уступлю автомобилю слева"}, correct=False, rule="prednost_zprava"),
            dict(text={"cs": "Mám přednost, opatrně pokračuji", "en": "I have priority, I proceed carefully", "ru": "У меня приоритет, осторожно проезжаю"}, correct=True, rule="prednost_zprava"),
            dict(text={"cs": "Zastavím a počkám na všechny", "en": "Stop and wait for everyone", "ru": "Остановлюсь и подожду всех"}, correct=False, rule="prednost_zprava"),
        ],
        explain={"cs": "Na neoznačené křižovatce platí přednost zprava. Vozidlo přijíždí zleva, takže přednost máte VY — můžete pokračovat (samozřejmě s ohledem na situaci).",
                 "en": "At an unmarked junction, priority-to-the-right applies. The vehicle comes from your left, so YOU have priority and may proceed (with due care).",
                 "ru": "На нерегулируемом перекрёстке действует «помеха справа». Автомобиль приближается слева, значит приоритет у ВАС — можно продолжать движение (с учётом обстановки)."},
        rule="prednost_zprava",
    ),
    dict(
        id="r3_bulovka_vedlejsi", order=3, extract="bulovka",
        stats=dict(accidents=84, injured=10, source="Regionální dopravní konference Praha (denik.cz, TOP-10 rizikových míst)"),
        title={"cs": "Vedlejší silnice a tramvaj", "en": "Minor road and a tram", "ru": "Второстепенная и трамвай"},
        hint={"cs": "Přijíždíte po vedlejší silnici (Bulovka). Sledujte a rozhodněte.",
              "en": "You arrive on the minor road (Bulovka). Watch and decide.",
              "ru": "Вы подъезжаете по второстепенной (Bulovka). Смотрите и решайте."},
        actors=[
            dict(kind="ego", frm="Bulovka@NE", to="left", v=6, spawn=0.0),
            dict(kind="tram", frm="Povltavská@NW", to="straight", lane=0.0, v=8, spawn=0.0),
        ],
        decision=dict(t=3.0),
        question={"cs": "Z vedlejší (Bulovka) odbočujete na hlavní (Povltavská). Po hlavní přijíždí tramvaj. Jak budete pokračovat?",
                  "en": "From the minor road (Bulovka) you turn onto the main road (Povltavská). A tram is coming on the main road. How do you proceed?",
                  "ru": "Со второстепенной (Bulovka) вы поворачиваете на главную (Povltavská). По главной приближается трамвай. Как вы поступите?"},
        options=[
            dict(text={"cs": "Stihnu to a vjedu před tramvaj", "en": "I'll make it and pull out before the tram", "ru": "Успею и выеду перед трамваем"}, correct=False, rule="give_way"),
            dict(text={"cs": "Dám přednost tramvaji i provozu na hlavní", "en": "Give way to the tram and the main-road traffic", "ru": "Уступлю трамваю и движению по главной"}, correct=True, rule="give_way"),
            dict(text={"cs": "Tramvaj mi dá přednost, jsem blíž", "en": "The tram will yield, I'm closer", "ru": "Трамвай уступит, я ближе"}, correct=False, rule="give_way"),
        ],
        explain={"cs": "Přijíždíte po vedlejší silnici (značka „Dej přednost v jízdě“), proto musíte dát přednost veškerému provozu na hlavní — včetně tramvaje. Vjet smíte, až bude hlavní volná.",
                 "en": "You are on the minor road (a “give way” sign), so you must yield to all traffic on the main road — including the tram. Pull out only when the main road is clear.",
                 "ru": "Вы едете по второстепенной дороге (знак «Уступи дорогу»), поэтому обязаны уступить всему движению по главной — включая трамвай. Выезжать можно только когда главная свободна."},
        rule="give_way",
    ),
]


def build_one(spec):
    ex = EXTRACTS[spec["extract"]]
    tdir, meta = load_city(ex["city"])
    cx, cy = locate(tdir, ex["streets"], ex.get("near"), 1100)
    geom, info = build_geom(tdir, cx, cy, ex["r"], meta)
    arms = build_arms(geom)
    core_r = spec.get("core_r", geom["core"]["r"])
    actors = []
    for a in spec["actors"]:
        path = a["path"] if "path" in a else actor_path(arms, a["frm"], a["to"], a.get("lane", 0.5), core_r)
        act = {"kind": a["kind"], "path": path, "v": a.get("v", 8), "spawn": a.get("spawn", 0)}
        if "color" in a:
            act["color"] = a["color"]
        actors.append(act)
    span = ex["r"] + 8
    scn = {
        "id": spec["id"], "order": spec["order"], "city": ex["city"],
        "junction": {"name": ex["name"], "district": ex.get("district", ""),
                     "lat": info["lat"], "lon": info["lon"], "source": "OSM bake (car-sim) © OpenStreetMap"},
        "title": spec["title"], "hint": spec["hint"],
        "view": {"minx": -span, "miny": -span, "maxx": span, "maxy": span},
        "geom": geom, "actors": actors, "decision": spec["decision"],
        "question": spec["question"], "options": spec["options"], "explain": spec["explain"],
        "citation": spec.get("citation") or CITE.get(spec.get("rule", ""), ""),
    }
    if "stats" in spec:
        scn["stats"] = spec["stats"]
    (OUT / f"{spec['id']}.json").write_text(json.dumps(scn, ensure_ascii=False, indent=2))
    return spec["id"], len(geom["roads"]), [len(a["path"]) for a in actors]


def build_all(specs):
    for spec in specs:
        sid, nroads, paths = build_one(spec)
        print(f"  wrote {sid}.json  roads={nroads} actor_path_pts={paths}")


def do_inspect(key):
    ex = EXTRACTS[key]
    tdir, meta = load_city(ex["city"])
    cx, cy = locate(tdir, ex["streets"], ex.get("near"), 1100)
    geom, info = build_geom(tdir, cx, cy, ex["r"], meta)
    arms = build_arms(geom)
    print(f"# {key}: {ex['name']}  ({info['lat']},{info['lon']})  streets={info['streets']}")
    print(f"# signs={[s['code'] for s in geom['signs']]} rails={len(geom['rails'])} crossings={len(geom['crossings'])}")
    for a in sorted(arms, key=lambda a: a["compass"]):
        print(f"  {a['compass']:>2}  {a['name'] or '(unnamed)':28} halfW={a['halfW']:.1f} oneway={a['oneway']}")


def do_scan(city, ctrl_want, n_arms, central):
    """Scan the bake for clean candidate junctions: deg==n_arms, given control, exactly two named two-way
    streets crossing. Prints name pair + projected-metre centre, ready to drop into EXTRACTS."""
    import glob
    tdir, _ = load_city(city)
    files = glob.glob(str(tdir / "tiles" / "*.json"))
    if central:
        files = [f for f in files if abs(int(Path(f).stem.split("_")[0])) <= central
                 and abs(int(Path(f).stem.split("_")[1])) <= central]
    found = []
    for f in files:
        t = json.loads(Path(f).read_text())
        edges = t.get("edges", [])
        for j in t.get("junctions", []):
            if j.get("deg") != n_arms or j.get("ctrl") not in ctrl_want:
                continue
            inc = [e for e in edges if min(math.dist(j_xy := (j["x"], j["y"]), e["geom"][0]),
                                           math.dist(j_xy, e["geom"][-1])) < 3.0]
            named = {e["name"] for e in inc if e.get("name")}
            tw = [e for e in inc if not e.get("oneway") and 5 <= e.get("width", 0) <= 9]
            if len(named) == 2 and len(tw) >= 3:
                found.append((sorted(named), round(j["x"]), round(j["y"]), j["ctrl"]))
    seen = set()
    for names, x, y, c in found:
        key = tuple(names)
        if key in seen:
            continue
        seen.add(key)
        print(f'  near=({x}, {y})  ctrl={c:9} streets="{names[0]}|{names[1]}"')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", action="store_true", help="find clean candidate junctions in the bake")
    ap.add_argument("--ctrl", default="priority,give_way")
    ap.add_argument("--arms", type=int, default=4)
    ap.add_argument("--central", type=int, default=7, help="limit scan to |tile index|<=N (0=whole city)")
    ap.add_argument("--inspect", help="print detected arms for an EXTRACTS key")
    ap.add_argument("--build", action="store_true", help="write all SPECS scenarios")
    args = ap.parse_args()
    if args.scan:
        do_scan("praha", set(args.ctrl.split(",")), args.arms, args.central)
    elif args.inspect:
        do_inspect(args.inspect)
    elif args.build:
        build_all(SPECS)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
