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
                     "oneway": rd["oneway"], "flow": rd.get("flow", "two"), "bear": bear, "compass": comp})
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
    "tulipan":       dict(city="praha", streets="Tulipánová|Želivecká",   near=(2240, 149),    r=42, name="Tulipánová × Želivecká", district="Praha 10 · Záběhlice"),
    "dvorce":        dict(city="praha", streets="Na Dvorcích|Nová cesta", near=(-2018, -2199), r=42, name="Na Dvorcích × Nová cesta", district="Praha 4 · Podolí"),
    "ohradni":       dict(city="praha", streets="Michelská|Ohradní",      near=(-838, -763),   r=46, name="Michelská × Ohradní", district="Praha 4 · Michle"),
    "navrsni":       dict(city="praha", streets="Návršní|Točitá",          near=(-2145, -2136), r=40, name="Návršní × Točitá", district="Praha 4 · Krč"),
    "tocita":        dict(city="praha", streets="Nová cesta|Točitá",       near=(-2142, -2212), r=40, name="Nová cesta × Točitá", district="Praha 4 · Krč"),
    "hornokrcska":   dict(city="praha", streets="Hornokrčská|Valtínovská", near=(-651, -1982),  r=40, name="Hornokrčská × Valtínovská", district="Praha 4 · Krč"),
    "klapalkova":    dict(city="praha", streets="Klapálkova|Měchnovská",   near=(2557, -1576),  r=42, name="Klapálkova × Měchnovská", district="Praha 11 · Chodov"),
    "prespolni":     dict(city="praha", streets="Přespolní|Záběhlická",    near=(1606, -482),   r=42, name="Přespolní × Záběhlická", district="Praha 10 · Záběhlice"),
    "cervenydvur":   dict(city="praha", streets="K Červenému dvoru|Na Třebešíně", near=(1221, 2570), r=42, name="K Červenému dvoru × Na Třebešíně", district="Praha 10 · Strašnice"),
    # --- batch 3 (msg 3124): curated clean junctions across districts, auto-authored from real signs ---
    "mracska":       dict(city="praha", streets="Mračská|Nebřenická",     near=(2735, -1871),  r=40, name="Mračská × Nebřenická", district="Praha 11 · Háje"),
    "kalmanova":     dict(city="praha", streets="Kálmánova|Lisztova",     near=(707, -4940),   r=40, name="Kálmánova × Lisztova", district="Praha 4 · Krč"),
    "povstani":      dict(city="praha", streets="Pražského povstání|Suppého", near=(560, -4933), r=42, name="Pražského povstání × Suppého", district="Praha 4 · Krč"),
    "navrsich":      dict(city="praha", streets="Na Vrších|U Hranic",     near=(1174, 1081),   r=40, name="Na Vrších × U Hranic", district="Praha 10 · Vršovice"),
    "jihoceska":     dict(city="praha", streets="Jihočeská|K ústavu",     near=(314, -4853),   r=40, name="Jihočeská × K ústavu", district="Praha 4 · Krč"),
    "podtrebesinem": dict(city="praha", streets="Pod Třebešínem|Slunečná", near=(1579, 2616),  r=40, name="Pod Třebešínem × Slunečná", district="Praha 10 · Strašnice"),
    "ruzinovska":    dict(city="praha", streets="Ružinovská|Vídeňská",    near=(-514, -3559),  r=44, name="Ružinovská × Vídeňská", district="Praha 4 · Krč"),
    "jevanska":      dict(city="praha", streets="Jevanská|Uhříněveská",   near=(2959, 742),    r=42, name="Jevanská × Uhříněveská", district="Praha 10 · Strašnice"),
    "kpradelne":     dict(city="praha", streets="K Prádelně|Záběhlická",  near=(1756, -646),   r=42, name="K Prádelně × Záběhlická", district="Praha 10 · Záběhlice"),
    "naslovanech":   dict(city="praha", streets="Na Slovanech|Vyšehradská", near=(-3377, 1515), r=44, name="Na Slovanech × Vyšehradská", district="Praha 2 · Nové Město"),
    # --- batch 4 (msg 3126): topologically complex junctions across all 4 cities ---
    "kubanske":      dict(city="praha", streets="Kubánské náměstí|Vršovická", near=(857, 1297), r=56, name="Kubánské náměstí", district="Praha 10 · Vršovice"),
    "trojicka":      dict(city="praha", streets="Vyšehradská|Trojická",     near=(-3320, 1314), r=50, name="Vyšehradská × Trojická", district="Praha 2 · Nové Město"),
    "stvanice":      dict(city="praha", streets="Sokolovská|Na Poříčí",     near=(-1943, 3535), r=54, name="Na Poříčí × Sokolovská", district="Praha 8 · Karlín"),
    "cacovicka":     dict(city="brno", streets="Cacovická|Valchařská",      near=(4328, 1404), r=52, name="Tomkovo náměstí", district="Brno · Husovice"),
    "cejl":          dict(city="brno", streets="Cejl|Vranovská",            near=(3512, 95),   r=52, name="Cejl × Vranovská", district="Brno · Zábrdovice"),
    "dornych":       dict(city="brno", streets="Dornych|Křenová",           near=(2694, -1088), r=55, name="Dornych × Křenová", district="Brno · Trnitá"),
    "hornopolni":    dict(city="ostrava", streets="Hornopolní|Českobratrská", near=(1104, 2347), r=50, name="Hornopolní × Českobratrská", district="Ostrava · Moravská Ostrava"),
    "pavlovova":     dict(city="ostrava", streets="Pavlovova|Výškovická",   near=(-1937, -2219), r=55, name="Pavlovova × Výškovická", district="Ostrava · Zábřeh"),
    "lidicka":       dict(city="plzen", streets="Lidická|alej Svobody",     near=(-141, 2910), r=54, name="Lidická × alej Svobody", district="Plzeň · Bolevec"),
    "klatovska":     dict(city="plzen", streets="Klatovská třída|17. listopadu", near=(-378, -1113), r=52, name="Klatovská třída × 17. listopadu", district="Plzeň · Jižní Předměstí"),
    "chodske":       dict(city="plzen", streets="Chodské náměstí|Thámova",  near=(-314, -210), r=50, name="Chodské náměstí", district="Plzeň · Jižní Předměstí"),
}

CITE = {
    "prednost_zprava": "§ 22 odst. 1 z. 361/2000 Sb.",
    "give_way": "značka P4, § 22 z. 361/2000 Sb.",
    "priority_road": "§ 22 z. 361/2000 Sb.",
    "tram_straight_yields": "§ 21 a § 22 z. 361/2000 Sb.",
    "tram_turning": "§ 21 odst. 7 z. 361/2000 Sb.",
    "pedestrian": "§ 5 odst. 2 h) a § 54 z. 361/2000 Sb.",
    "left_turn": "§ 21 odst. 5 z. 361/2000 Sb.",
    "signal_left": "§ 21 odst. 5 a § 70 z. 361/2000 Sb.",
    "signal_ped": "§ 5 odst. 2 h) a § 70 odst. 2 z. 361/2000 Sb.",
    "roundabout": "značka C 1 + P 4, § 22 odst. 5 z. 361/2000 Sb.",
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
    dict(
        id="r4_tulipan_chodec", order=4, extract="tulipan",
        title={"cs": "Chodec na přechodu", "en": "Pedestrian on the crossing", "ru": "Пешеход на переходе"},
        hint={"cs": "Blížíte se k přechodu pro chodce. Sledujte a rozhodněte.",
              "en": "You approach a pedestrian crossing. Watch and decide.",
              "ru": "Вы приближаетесь к пешеходному переходу. Смотрите и решайте."},
        actors=[
            dict(kind="ego", frm="Tulipánová@SE", to="straight", v=6, spawn=0.0),
            dict(kind="ped", crossing=1, side=1, v=1.3, spawn=0.5),
        ],
        decision=dict(t=2.8),
        question={"cs": "Před vámi je přechod pro chodce a chodec vstupuje do vozovky. Jak budete pokračovat?",
                  "en": "There's a pedestrian crossing ahead and a pedestrian is stepping onto it. How do you proceed?",
                  "ru": "Впереди пешеходный переход, и пешеход выходит на проезжую часть. Как вы поступите?"},
        options=[
            dict(text={"cs": "Projedu, než chodec dojde", "en": "Drive through before they reach me", "ru": "Проеду, пока пешеход не дошёл"}, correct=False, rule="pedestrian"),
            dict(text={"cs": "Dám chodci přednost a počkám", "en": "Give way to the pedestrian and wait", "ru": "Уступлю пешеходу и подожду"}, correct=True, rule="pedestrian"),
            dict(text={"cs": "Zatroubím, ať si pospíší", "en": "Honk so they hurry up", "ru": "Посигналю, чтобы поторопился"}, correct=False, rule="pedestrian"),
        ],
        explain={"cs": "Řidič musí dát přednost chodci, který je na přechodu nebo na něj vstupuje. Nesmíte ho ohrozit ani omezit — zastavte a nechte ho přejít.",
                 "en": "A driver must give way to a pedestrian who is on the crossing or stepping onto it. You must not endanger or obstruct them — stop and let them cross.",
                 "ru": "Водитель обязан уступить пешеходу, который находится на переходе или вступает на него. Нельзя создавать ему помеху или опасность — остановитесь и пропустите."},
        rule="pedestrian",
    ),
    dict(
        id="r5_dvorce_zprava", order=5, extract="dvorce",
        title={"cs": "Kdo jede první?", "en": "Who goes first?", "ru": "Кто едет первым?"},
        hint={"cs": "Neoznačená křižovatka v Podolí. Sledujte a rozhodněte.",
              "en": "An unmarked junction in Podolí. Watch and decide.",
              "ru": "Нерегулируемый перекрёсток в Подоли. Смотрите и решайте."},
        actors=[
            dict(kind="ego", frm="Na Dvorcích@N", to="straight", v=7, spawn=0.0),
            dict(kind="car", frm="Nová cesta@W", to="straight", v=7, spawn=0.0),
        ],
        decision=dict(t=3.0),
        question={"cs": "Křižovatka bez značek. Zprava přijíždí vozidlo. Jak budete pokračovat?",
                  "en": "A junction with no signs. A vehicle comes from the right. How do you proceed?",
                  "ru": "Перекрёсток без знаков. Справа приближается автомобиль. Как вы поступите?"},
        options=[
            dict(text={"cs": "Projedu, jsem na hlavnější ulici", "en": "I go, my street looks more major", "ru": "Проеду — моя улица главнее на вид"}, correct=False, rule="prednost_zprava"),
            dict(text={"cs": "Dám přednost vozidlu zprava", "en": "Give way to the vehicle on the right", "ru": "Уступлю автомобилю справа"}, correct=True, rule="prednost_zprava"),
            dict(text={"cs": "Vjedu, kdo dřív přijede", "en": "First come, first served", "ru": "Кто первый подъехал, тот и едет"}, correct=False, rule="prednost_zprava"),
        ],
        explain={"cs": "Bez dopravních značek nerozhoduje šířka ani „důležitost“ ulice — platí přednost zprava. Vozidlu přijíždějícímu zprava musíte dát přednost.",
                 "en": "With no signs, the width or apparent importance of a street doesn't matter — priority-to-the-right applies. You must give way to the vehicle coming from your right.",
                 "ru": "Без знаков ширина и кажущаяся «важность» улицы не имеют значения — действует «помеха справа». Автомобилю справа нужно уступить."},
        rule="prednost_zprava",
    ),
    dict(
        id="r6_navrsni_odboceni", order=6, extract="navrsni",
        title={"cs": "Odbočujete vlevo", "en": "Turning left", "ru": "Поворот налево"},
        hint={"cs": "Neoznačená křižovatka. Chcete odbočit vlevo, proti vám jede vozidlo.",
              "en": "Unmarked junction. You want to turn left; a vehicle comes towards you.",
              "ru": "Нерегулируемый перекрёсток. Вы поворачиваете налево, навстречу едет автомобиль."},
        actors=[
            dict(kind="ego", frm="Návršní@W", to="left", v=6, spawn=0.0),
            dict(kind="car", frm="Návršní@E", to="straight", v=7, spawn=0.0),
        ],
        decision=dict(t=3.0),
        question={"cs": "Odbočujete vlevo. Proti vám jede protijedoucí vozidlo rovně. Jak budete pokračovat?",
                  "en": "You are turning left. An oncoming vehicle is going straight. How do you proceed?",
                  "ru": "Вы поворачиваете налево. Встречный автомобиль едет прямо. Как вы поступите?"},
        options=[
            dict(text={"cs": "Odbočím první, jsem blíž", "en": "I turn first, I'm closer", "ru": "Поверну первым, я ближе"}, correct=False, rule="left_turn"),
            dict(text={"cs": "Dám přednost protijedoucímu vozidlu", "en": "Give way to the oncoming vehicle", "ru": "Уступлю встречному автомобилю"}, correct=True, rule="left_turn"),
            dict(text={"cs": "Mám přednost zprava, projedu", "en": "I have priority from the right, I go", "ru": "У меня помеха справа, проезжаю"}, correct=False, rule="left_turn"),
        ],
        explain={"cs": "Při odbočování vlevo musíte dát přednost protijedoucím vozidlům jedoucím rovně nebo odbočujícím vpravo. Pravidlo platí i na neoznačené křižovatce.",
                 "en": "When turning left you must give way to oncoming vehicles going straight or turning right. This holds even at an unmarked junction.",
                 "ru": "При повороте налево вы обязаны уступить встречным, едущим прямо или поворачивающим направо. Правило действует и на нерегулируемом перекрёстке."},
        rule="left_turn",
    ),
    dict(
        id="r7_hornokrcska_zprava", order=7, extract="hornokrcska",
        title={"cs": "Hlavní? Spíš ne", "en": "Main road? Not really", "ru": "Главная? Вряд ли"},
        hint={"cs": "Jedete po průběžné ulici bez značek. Zprava vyjíždí vozidlo.",
              "en": "You drive along a through street with no signs. A vehicle pulls in from the right.",
              "ru": "Вы едете по сквозной улице без знаков. Справа выезжает автомобиль."},
        actors=[
            dict(kind="ego", frm="Hornokrčská@S", to="straight", v=7, spawn=0.0),
            dict(kind="car", frm="Valtínovská@E", to="Hornokrčská@N", v=6, spawn=0.0),
        ],
        decision=dict(t=3.0),
        question={"cs": "Vaše ulice vypadá jako hlavní, ale nikde nejsou značky. Zprava přijíždí vozidlo. Jak budete pokračovat?",
                  "en": "Your street looks like a main road, but there are no signs anywhere. A vehicle approaches from the right. How do you proceed?",
                  "ru": "Ваша улица выглядит как главная, но знаков нигде нет. Справа приближается автомобиль. Как вы поступите?"},
        options=[
            dict(text={"cs": "Jsem na hlavní, mám přednost", "en": "I'm on the main road, I have priority", "ru": "Я на главной, у меня приоритет"}, correct=False, rule="prednost_zprava"),
            dict(text={"cs": "Bez značek dám přednost zprava", "en": "No signs — I give way to the right", "ru": "Без знаков уступаю тому, кто справа"}, correct=True, rule="prednost_zprava"),
            dict(text={"cs": "Zrychlím, ať to stihnu", "en": "Speed up to make it", "ru": "Ускорюсь, чтобы успеть"}, correct=False, rule="prednost_zprava"),
        ],
        explain={"cs": "Pokud křižovatka není označena značkami (hlavní/vedlejší), nezáleží na tom, jak „hlavní“ ulice vypadá — platí přednost zprava. Vozidlu zprava dáte přednost.",
                 "en": "If a junction isn't marked with main/side-road signs, it doesn't matter how 'main' a street looks — priority-to-the-right applies. Give way to the vehicle on the right.",
                 "ru": "Если перекрёсток не обозначен знаками главной/второстепенной — неважно, насколько «главной» выглядит улица: действует «помеха справа». Уступите тому, кто справа."},
        rule="prednost_zprava",
    ),
    dict(
        id="r8_tocita_zprava", order=8, extract="tocita",
        title={"cs": "Zprava přijíždí", "en": "Coming from the right", "ru": "Подъезжает справа"},
        hint={"cs": "Neoznačená křižovatka v Krči. Sledujte a rozhodněte.",
              "en": "Unmarked junction in Krč. Watch and decide.",
              "ru": "Нерегулируемый перекрёсток в Крчи. Смотрите и решайте."},
        actors=[
            dict(kind="ego", frm="Nová cesta@W", to="straight", v=7, spawn=0.0),
            dict(kind="car", frm="Točitá@S", to="straight", v=7, spawn=0.1),
        ],
        decision=dict(t=3.0),
        question={"cs": "Křižovatka bez značek, zprava přijíždí vozidlo přibližně stejnou rychlostí. Jak budete pokračovat?",
                  "en": "An unmarked junction; a vehicle approaches from the right at about the same speed. How do you proceed?",
                  "ru": "Перекрёсток без знаков, справа примерно с той же скоростью подъезжает автомобиль. Как вы поступите?"},
        options=[
            dict(text={"cs": "Projedu rovně, mám to po hlavní", "en": "I go straight, I'm on the through road", "ru": "Проеду прямо, я по сквозной"}, correct=False, rule="prednost_zprava"),
            dict(text={"cs": "Dám přednost vozidlu zprava", "en": "Give way to the vehicle on the right", "ru": "Уступлю автомобилю справа"}, correct=True, rule="prednost_zprava"),
            dict(text={"cs": "Pojedu, kdo se bojí, ten couvne", "en": "I go — whoever's scared backs off", "ru": "Поеду — кто боится, тот уступит"}, correct=False, rule="prednost_zprava"),
        ],
        explain={"cs": "Na neoznačené křižovatce platí přednost zprava. Vozidlo přijíždí zprava, takže přednost dáte jemu.",
                 "en": "At an unmarked junction, priority-to-the-right applies. The vehicle is on your right, so you give way to it.",
                 "ru": "На нерегулируемом перекрёстке действует «помеха справа». Автомобиль справа — значит уступаете ему."},
        rule="prednost_zprava",
    ),
    dict(
        id="r9_klapalkova_vyjezd", order=9, extract="klapalkova",
        title={"cs": "Vyjíždíte z vedlejší ulice", "en": "Pulling out of a side street", "ru": "Выезд с второстепенной"},
        hint={"cs": "Vyjíždíte z menší ulice (Měchnovská) na průběžnou. Sledujte a rozhodněte.",
              "en": "You pull out of a smaller street (Měchnovská) onto a through road. Watch and decide.",
              "ru": "Вы выезжаете с небольшой улицы (Měchnovská) на сквозную. Смотрите и решайте."},
        actors=[
            dict(kind="ego", frm="Měchnovská@SW", to="Klapálkova@NW", v=5, spawn=0.0),
            dict(kind="car", frm="Klapálkova@SE", to="straight", v=7, spawn=0.0),
        ],
        decision=dict(t=3.0),
        question={"cs": "Vyjíždíte z menší ulice na průběžnou, zprava po ní přijíždí vozidlo. Jak budete pokračovat?",
                  "en": "You pull out of a smaller street onto a through road; a vehicle comes along it from the right. How do you proceed?",
                  "ru": "Вы выезжаете с небольшой улицы на сквозную, по ней справа едет автомобиль. Как вы поступите?"},
        options=[
            dict(text={"cs": "Rychle se zařadím před něj", "en": "Quickly pull in front of it", "ru": "Быстро встрою перед ним"}, correct=False, rule="prednost_zprava"),
            dict(text={"cs": "Dám přednost vozidlu zprava na průběžné", "en": "Give way to the vehicle on the right on the through road", "ru": "Уступлю автомобилю справа на сквозной"}, correct=True, rule="prednost_zprava"),
            dict(text={"cs": "Mávnu na něj, ať počká", "en": "Wave at them to wait", "ru": "Махну ему, чтобы подождал"}, correct=False, rule="prednost_zprava"),
        ],
        explain={"cs": "I bez značek platí přednost zprava. Vozidlo na průběžné ulici přijíždí zprava — musíte mu dát přednost a zařadit se, až bude volno.",
                 "en": "Even without signs, priority-to-the-right applies. The vehicle on the through road comes from your right — give way and pull out only when it's clear.",
                 "ru": "Даже без знаков действует «помеха справа». Автомобиль на сквозной едет справа — уступите и выезжайте, когда будет свободно."},
        rule="prednost_zprava",
    ),
    dict(
        id="r10_prespolni_vedlejsi", order=10, extract="prespolni",
        title={"cs": "Vedlejší silnice", "en": "Minor road", "ru": "Второстепенная дорога"},
        hint={"cs": "Přijíždíte po vedlejší (Přespolní) — značka „Dej přednost“. Sledujte a rozhodněte.",
              "en": "You arrive on the minor road (Přespolní) — a “give way” sign. Watch and decide.",
              "ru": "Вы подъезжаете по второстепенной (Přespolní) — знак «Уступи дорогу». Смотрите и решайте."},
        actors=[
            dict(kind="ego", frm="Přespolní@S", to="straight", v=6, spawn=0.0),
            dict(kind="car", frm="Záběhlická@W", to="straight", v=8, spawn=0.0),
        ],
        decision=dict(t=3.0),
        question={"cs": "Z vedlejší (Přespolní) chcete přejet přes hlavní (Záběhlická). Po hlavní jede vozidlo. Jak budete pokračovat?",
                  "en": "From the minor road (Přespolní) you want to cross the main road (Záběhlická). A vehicle is coming on the main road. How do you proceed?",
                  "ru": "Со второстепенной (Přespolní) вы хотите пересечь главную (Záběhlická). По главной едет автомобиль. Как вы поступите?"},
        options=[
            dict(text={"cs": "Přejedu rychle, než dojede", "en": "Cross quickly before it arrives", "ru": "Быстро пересеку, пока не доехал"}, correct=False, rule="give_way"),
            dict(text={"cs": "Dám přednost vozidlu na hlavní", "en": "Give way to the vehicle on the main road", "ru": "Уступлю автомобилю на главной"}, correct=True, rule="give_way"),
            dict(text={"cs": "Na hlavní mi dají přednost", "en": "Traffic on the main road will yield to me", "ru": "На главной мне уступят"}, correct=False, rule="give_way"),
        ],
        explain={"cs": "Značka „Dej přednost v jízdě“ (P4) znamená, že vozidlům na hlavní silnici musíte dát přednost. Vjet smíte, až bude hlavní volná — bez ohledu na to, kdo přijíždí zleva či zprava.",
                 "en": "The “give way” sign (P4) means you must yield to traffic on the main road. Proceed only when the main road is clear — regardless of which side the traffic comes from.",
                 "ru": "Знак «Уступи дорогу» (P4) означает, что вы обязаны пропустить транспорт на главной. Двигаться можно, только когда главная свободна — независимо от того, слева или справа едет автомобиль."},
        rule="give_way",
    ),
    dict(
        id="r11_cervenydvur_hlavni", order=11, extract="cervenydvur",
        title={"cs": "Jste na hlavní", "en": "You're on the main road", "ru": "Вы на главной"},
        hint={"cs": "Jedete po hlavní (K Červenému dvoru). Z vedlejší čeká vozidlo. Sledujte a rozhodněte.",
              "en": "You drive on the main road (K Červenému dvoru). A car waits on the side road. Watch and decide.",
              "ru": "Вы едете по главной (K Červenému dvoru). На второстепенной ждёт автомобиль. Смотрите и решайте."},
        actors=[
            dict(kind="ego", frm="K Červenému dvoru@S", to="straight", v=7, spawn=0.0),
            dict(kind="car", frm="Na Třebešíně@W", to="K Červenému dvoru@N", v=2.4, spawn=0.0),
        ],
        decision=dict(t=3.0),
        question={"cs": "Jedete po hlavní silnici. Z vedlejší vlevo čeká vozidlo, které chce vyjet. Jak budete pokračovat?",
                  "en": "You're on the main road. A car on the side road to your left waits to pull out. How do you proceed?",
                  "ru": "Вы едете по главной. Слева на второстепенной ждёт автомобиль, который хочет выехать. Как вы поступите?"},
        options=[
            dict(text={"cs": "Pro jistotu zastavím a pustím ho", "en": "Stop just in case and let it out", "ru": "На всякий случай остановлюсь и пропущу"}, correct=False, rule="priority_road"),
            dict(text={"cs": "Mám přednost, plynule pokračuji", "en": "I have priority, I continue smoothly", "ru": "У меня приоритет, спокойно продолжаю"}, correct=True, rule="priority_road"),
            dict(text={"cs": "Zastavím a zamávám, ať jede", "en": "Stop and wave it through", "ru": "Остановлюсь и махну, чтобы ехал"}, correct=False, rule="priority_road"),
        ],
        explain={"cs": "Jedete po hlavní silnici (značka „Hlavní pozemní komunikace“), takže přednost máte vy. Vozidlo z vedlejší musí dát přednost vám — pokračujte plynule a sledujte ho. Bezdůvodné zastavování na hlavní mate ostatní a může způsobit nehodu.",
                 "en": "You're on the main road (the “priority road” sign), so you have priority. The car on the side road must yield to you — keep moving and watch it. Stopping on the main road for no reason confuses others and can cause a crash.",
                 "ru": "Вы едете по главной дороге (знак «Главная дорога»), приоритет у вас. Автомобиль со второстепенной обязан уступить вам — продолжайте плавно и следите за ним. Беспричинная остановка на главной путает других и может привести к ДТП."},
        rule="priority_road",
    ),
    dict(
        id="r12_michelska_odboceni", order=12, extract="michelska",
        title={"cs": "Na semaforu vlevo", "en": "Turning left at lights", "ru": "Налево на светофоре"},
        hint={"cs": "Křižovatka se semafory. Máte zelenou a chcete odbočit vlevo.",
              "en": "A signalized junction. You have green and want to turn left.",
              "ru": "Перекрёсток со светофором. У вас зелёный, вы хотите повернуть налево."},
        actors=[
            dict(kind="ego", frm="Michelská@SE", to="left", v=6, spawn=0.0),
            dict(kind="car", frm="Michelská@NW", to="straight", v=8, spawn=0.0),
        ],
        decision=dict(t=3.0),
        question={"cs": "Máte zelenou a odbočujete vlevo. Proti vám jede vozidlo rovně, také na zelenou. Jak budete pokračovat?",
                  "en": "You have green and are turning left. An oncoming vehicle goes straight, also on green. How do you proceed?",
                  "ru": "У вас зелёный, вы поворачиваете налево. Навстречу на зелёный едет автомобиль прямо. Как вы поступите?"},
        options=[
            dict(text={"cs": "Zelená je zelená, odbočím", "en": "Green is green, I turn", "ru": "Зелёный есть зелёный, поворачиваю"}, correct=False, rule="signal_left"),
            dict(text={"cs": "Dám přednost protijedoucímu vozidlu", "en": "Give way to the oncoming vehicle", "ru": "Уступлю встречному автомобилю"}, correct=True, rule="signal_left"),
            dict(text={"cs": "Zatroubím a odbočím", "en": "Honk and turn", "ru": "Сигналю и поворачиваю"}, correct=False, rule="signal_left"),
        ],
        explain={"cs": "Zelený signál vás opravňuje vjet do křižovatky, ale při odbočování vlevo musíte dát přednost protijedoucím vozidlům, která mají také zelenou a jedou rovně nebo odbočují vpravo.",
                 "en": "A green light lets you enter the junction, but when turning left you must give way to oncoming vehicles that also have green and go straight or turn right.",
                 "ru": "Зелёный сигнал разрешает въезд на перекрёсток, но при повороте налево вы обязаны уступить встречным, у которых тоже зелёный и которые едут прямо или поворачивают направо."},
        rule="signal_left",
    ),
]


# ---- rule templates + auto-author (msg 3124) ----------------------------------------------------
# The teaching text for a given rule is the same wherever the rule applies; only the junction
# (real geometry, signs, street names, location) changes. So we keep one template per rule and
# stamp it onto many real junctions — the schematic + location badge carry the "this is real" part.
ZPRAVA_T = dict(
    title={"cs": "Přednost zprava", "en": "Priority from the right", "ru": "Помеха справа"},
    hint={"cs": "Neoznačená křižovatka. Zprava přijíždí vozidlo.",
          "en": "Unmarked junction. A vehicle approaches from the right.",
          "ru": "Нерегулируемый перекрёсток. Справа приближается автомобиль."},
    question={"cs": "Křižovatka bez dopravních značek. Zprava přijíždí vozidlo. Jak budete pokračovat?",
              "en": "A junction with no signs. A vehicle is coming from the right. How do you proceed?",
              "ru": "Перекрёсток без знаков. Справа приближается автомобиль. Как вы поступите?"},
    options=[
        dict(text={"cs": "Mám přednost, projedu první", "en": "I have priority, I go first", "ru": "У меня приоритет, проезжаю первым"}, correct=False, rule="prednost_zprava"),
        dict(text={"cs": "Dám přednost vozidlu zprava", "en": "Give way to the vehicle on the right", "ru": "Уступлю автомобилю справа"}, correct=True, rule="prednost_zprava"),
        dict(text={"cs": "Zatroubím a projedu", "en": "I honk and go", "ru": "Сигналю и проезжаю"}, correct=False, rule="prednost_zprava"),
    ],
    explain={"cs": "Na křižovatce bez dopravních značek platí přednost zprava (pravidlo pravé ruky). Vozidlu přijíždějícímu zprava musíte dát přednost v jízdě.",
             "en": "At a junction with no signs, priority-to-the-right applies. You must give way to the vehicle coming from your right.",
             "ru": "На перекрёстке без знаков действует «помеха справа». Автомобилю, приближающемуся справа, нужно уступить."},
    rule="prednost_zprava",
)
VEDLEJSI_T = dict(
    title={"cs": "Vedlejší silnice", "en": "Minor road", "ru": "Второстепенная дорога"},
    hint={"cs": "Přijíždíte po vedlejší silnici (značka „Dej přednost“). Sledujte a rozhodněte.",
          "en": "You arrive on the minor road (a “give way” sign). Watch and decide.",
          "ru": "Вы подъезжаете по второстепенной (знак «Уступи дорогу»). Смотрите и решайте."},
    question={"cs": "Přijíždíte po vedlejší silnici a chcete přejet hlavní. Po hlavní jede vozidlo. Jak budete pokračovat?",
              "en": "You arrive on the minor road and want to cross the main road. A vehicle is coming on it. How do you proceed?",
              "ru": "Вы подъезжаете по второстепенной и хотите пересечь главную. По ней едет автомобиль. Как вы поступите?"},
    options=[
        dict(text={"cs": "Přejedu rychle, než dojede", "en": "Cross quickly before it arrives", "ru": "Быстро пересеку, пока не доехал"}, correct=False, rule="give_way"),
        dict(text={"cs": "Dám přednost vozidlu na hlavní", "en": "Give way to the vehicle on the main road", "ru": "Уступлю автомобилю на главной"}, correct=True, rule="give_way"),
        dict(text={"cs": "Na hlavní mi dají přednost", "en": "Traffic on the main road will yield to me", "ru": "На главной мне уступят"}, correct=False, rule="give_way"),
    ],
    explain={"cs": "Značka „Dej přednost v jízdě“ (P4) znamená, že vozidlům na hlavní silnici musíte dát přednost. Vjet smíte, až bude hlavní volná — bez ohledu na to, kdo přijíždí zleva či zprava.",
             "en": "The “give way” sign (P4) means you must yield to traffic on the main road. Proceed only when it's clear — no matter which side the traffic comes from.",
             "ru": "Знак «Уступи дорогу» (P4) означает, что транспорту на главной нужно уступить. Двигаться можно, только когда главная свободна — независимо от того, слева или справа автомобиль."},
    rule="give_way",
)
VEDLEJSI_TRAM_T = dict(
    title={"cs": "Vedlejší a tramvaj", "en": "Minor road and a tram", "ru": "Второстепенная и трамвай"},
    hint={"cs": "Přijíždíte po vedlejší silnici, po hlavní jezdí tramvaj. Sledujte a rozhodněte.",
          "en": "You arrive on the minor road; a tram runs on the main road. Watch and decide.",
          "ru": "Вы подъезжаете по второстепенной, по главной ходит трамвай. Смотрите и решайте."},
    question={"cs": "Z vedlejší chcete přejet hlavní, po které přijíždí tramvaj. Jak budete pokračovat?",
              "en": "From the minor road you want to cross the main road; a tram is coming on it. How do you proceed?",
              "ru": "Со второстепенной вы хотите пересечь главную, по которой едет трамвай. Как вы поступите?"},
    options=[
        dict(text={"cs": "Stihnu to před tramvají", "en": "I'll make it before the tram", "ru": "Успею перед трамваем"}, correct=False, rule="give_way"),
        dict(text={"cs": "Dám přednost tramvaji i provozu na hlavní", "en": "Give way to the tram and main-road traffic", "ru": "Уступлю трамваю и движению по главной"}, correct=True, rule="give_way"),
        dict(text={"cs": "Tramvaj počká, jsem blíž", "en": "The tram will wait, I'm closer", "ru": "Трамвай подождёт, я ближе"}, correct=False, rule="give_way"),
    ],
    explain={"cs": "Přijíždíte po vedlejší (značka „Dej přednost“), proto musíte dát přednost veškerému provozu na hlavní — včetně tramvaje. Tramvaj má navíc na hlavní přednost. Vjet smíte, až bude volno.",
             "en": "You're on the minor road (a “give way” sign), so you must yield to all traffic on the main road — including the tram, which also has priority. Pull out only when it's clear.",
             "ru": "Вы по второстепенной (знак «Уступи дорогу»), поэтому уступаете всему движению по главной — включая трамвай, у которого ещё и приоритет. Выезжайте, только когда свободно."},
    rule="give_way",
)


def _inward(arm):
    return [-arm["bear"][0], -arm["bear"][1]]


def _right(v):                                  # right of a heading in the y-DOWN frame
    return [-v[1], v[0]]


def _ref(arm):
    return f"{arm['name']}@{arm['compass']}" if arm["name"] else f"@{arm['compass']}"


def _named(arms):
    return [a for a in arms if a["name"]] or arms


SIGNAL_LEFT_T = dict(
    title={"cs": "Na semaforu vlevo", "en": "Turning left at lights", "ru": "Налево на светофоре"},
    hint={"cs": "Křižovatka se semafory. Máte zelenou a odbočujete vlevo.",
          "en": "A signalized junction. You have green and are turning left.",
          "ru": "Перекрёсток со светофором. У вас зелёный, вы поворачиваете налево."},
    question={"cs": "Máte zelenou a odbočujete vlevo. Proti vám jede vozidlo rovně, také na zelenou. Jak budete pokračovat?",
              "en": "You have green and are turning left. An oncoming vehicle goes straight, also on green. How do you proceed?",
              "ru": "У вас зелёный, вы поворачиваете налево. Навстречу на зелёный едет автомобиль прямо. Как вы поступите?"},
    options=[
        dict(text={"cs": "Zelená je zelená, odbočím", "en": "Green is green, I turn", "ru": "Зелёный есть зелёный, поворачиваю"}, correct=False, rule="signal_left"),
        dict(text={"cs": "Dám přednost protijedoucímu vozidlu", "en": "Give way to the oncoming vehicle", "ru": "Уступлю встречному автомобилю"}, correct=True, rule="signal_left"),
        dict(text={"cs": "Zatroubím a odbočím", "en": "Honk and turn", "ru": "Сигналю и поворачиваю"}, correct=False, rule="signal_left"),
    ],
    explain={"cs": "Zelený signál vás opravňuje vjet do křižovatky, ale při odbočování vlevo musíte dát přednost protijedoucím vozidlům, která mají také zelenou a jedou rovně nebo odbočují vpravo.",
             "en": "A green light lets you enter the junction, but when turning left you must give way to oncoming vehicles that also have green and go straight or turn right.",
             "ru": "Зелёный сигнал разрешает въезд на перекрёсток, но при повороте налево вы обязаны уступить встречным, у которых тоже зелёный и которые едут прямо или поворачивают направо."},
    rule="signal_left",
)


SIGNAL_PED_T = dict(
    title={"cs": "Zelená a chodci", "en": "Green and pedestrians", "ru": "Зелёный и пешеходы"},
    hint={"cs": "Křižovatka se semafory. Máte zelenou a odbočujete vpravo.",
          "en": "A signalized junction. You have green and are turning right.",
          "ru": "Перекрёсток со светофором. У вас зелёный, вы поворачиваете направо."},
    question={"cs": "Máte zelenou a odbočujete vpravo. Do ulice, kam odbočujete, vstupují na přechod chodci. Jak budete pokračovat?",
              "en": "You have green and are turning right. Pedestrians are stepping onto the crossing of the street you turn into. How do you proceed?",
              "ru": "У вас зелёный, вы поворачиваете направо. На переход улицы, куда вы поворачиваете, выходят пешеходы. Как вы поступите?"},
    options=[
        dict(text={"cs": "Mám zelenou, projedu", "en": "I have green, I go", "ru": "У меня зелёный, проезжаю"}, correct=False, rule="signal_ped"),
        dict(text={"cs": "Dám přednost chodcům na přechodu", "en": "Give way to the pedestrians on the crossing", "ru": "Уступлю пешеходам на переходе"}, correct=True, rule="signal_ped"),
        dict(text={"cs": "Zatroubím, ať uhnou", "en": "Honk so they move", "ru": "Сигналю, чтобы ушли"}, correct=False, rule="signal_ped"),
    ],
    explain={"cs": "I na zelenou musíte při odbočování dát přednost chodcům přecházejícím vozovku, do níž odbočujete — mají zpravidla zelenou současně s vámi. Nesmíte je ohrozit ani omezit.",
             "en": "Even on green, when turning you must give way to pedestrians crossing the road you turn into — they usually have green at the same time as you. You must not endanger or obstruct them.",
             "ru": "Даже на зелёный при повороте вы обязаны уступить пешеходам, переходящим дорогу, куда вы поворачиваете — у них обычно зелёный одновременно с вами. Нельзя создавать им помеху или опасность."},
    rule="signal_ped",
)


def _arm_sign(arm, geom):
    """the give-way/priority sign code sitting along this arm (P2 priority / P4 give-way), if any."""
    best, bd = None, 1e9
    for s in geom["signs"]:
        sd = _norm([s["x"], s["y"]])
        if arm["bear"][0] * sd[0] + arm["bear"][1] * sd[1] > 0.6:
            d = _hyp([s["x"], s["y"]])
            if d < bd:
                bd, best = d, s["code"]
    return best


def _enter(a):                                  # traffic on this arm can drive toward the junction
    return a.get("flow", "two") in ("in", "two")


def _exit(a):                                   # traffic can leave the junction along this arm
    return a.get("flow", "two") in ("out", "two")


def _opposite(arm, arms, thr=0.55):
    pool = [a for a in arms if a is not arm]
    if not pool:
        return None
    o = max(pool, key=lambda a: -(a["bear"][0] * arm["bear"][0] + a["bear"][1] * arm["bear"][1]))
    return o if -(o["bear"][0] * arm["bear"][0] + o["bear"][1] * arm["bear"][1]) > thr else None


def gen_zprava(arms, _geom):
    """ego from the south-most enterable arm going straight across; conflicting car from ego's right."""
    pool = [a for a in _named(arms) if _enter(a)]
    if not pool:
        return None
    ego = max(pool, key=lambda a: a["bear"][1])
    opp = _opposite(ego, arms)
    ego_to = _ref(opp) if (opp and _exit(opp)) else "straight"
    r = _right(_inward(ego))
    cars = [a for a in arms if a is not ego and _enter(a)]
    if not cars:
        return None
    car = max(cars, key=lambda a: a["bear"][0] * r[0] + a["bear"][1] * r[1])
    if car["bear"][0] * r[0] + car["bear"][1] * r[1] < 0.4:   # nothing clearly on the right
        return None
    cexit = _opposite(car, arms)
    car_to = _ref(cexit) if (cexit and _exit(cexit)) else "straight"
    return ZPRAVA_T, [dict(kind="ego", frm=_ref(ego), to=ego_to, v=7, spawn=0.0),
                      dict(kind="car", frm=_ref(car), to=car_to, v=7, spawn=0.1)]


def gen_vedlejsi(arms, geom):
    """ego crosses the main road from a give-way (P4) arm; conflicting vehicle (tram if tracks) on the
    priority (P2) road. Requires ego to actually CROSS (opposite arm) and the main to be perpendicular."""
    side = [a for a in _named(arms) if _enter(a) and _arm_sign(a, geom) == "P4"]
    main = [a for a in arms if _arm_sign(a, geom) == "P2"]
    if not side or not main:
        return None
    ego = max(side, key=lambda a: a["bear"][1])
    opp = _opposite(ego, arms)
    if not opp or not _exit(opp):                            # must be able to go straight across
        return None
    r = _right(_inward(ego))
    mains = [a for a in main if _enter(a)]
    if not mains:
        return None
    car = max(mains, key=lambda a: abs(a["bear"][0] * r[0] + a["bear"][1] * r[1]))
    if abs(car["bear"][0] * r[0] + car["bear"][1] * r[1]) < 0.45:   # main not actually crossing ego
        return None
    tram = len(geom["rails"]) > 6
    cexit = _opposite(car, arms)
    car_to = _ref(cexit) if (cexit and _exit(cexit)) else "straight"
    tpl = VEDLEJSI_TRAM_T if tram else VEDLEJSI_T
    return tpl, [dict(kind="ego", frm=_ref(ego), to=_ref(opp), v=6, spawn=0.0),
                 dict(kind=("tram" if tram else "car"), frm=_ref(car), to=car_to,
                      lane=(0.0 if tram else 0.5), v=8, spawn=0.0)]


def gen_signal(arms, _geom):
    """ego turns left on green from the south-most enterable arm; oncoming goes straight toward ego."""
    pool = [a for a in _named(arms) if _enter(a)]
    if not pool:
        return None
    ego = max(pool, key=lambda a: a["bear"][1])
    opp = _opposite(ego, arms)
    if not opp or not _enter(opp):                           # need an oncoming arm
        return None
    left = [-x for x in _right(_inward(ego))]
    exits = [a for a in arms if a is not ego and a is not opp and _exit(a)]
    if not exits:
        return None
    lex = max(exits, key=lambda a: a["bear"][0] * left[0] + a["bear"][1] * left[1])
    if lex["bear"][0] * left[0] + lex["bear"][1] * left[1] < 0.3:   # no clear left exit
        return None
    return SIGNAL_LEFT_T, [dict(kind="ego", frm=_ref(ego), to=_ref(lex), v=6, spawn=0.0),
                           dict(kind="car", frm=_ref(opp), to="straight", v=8, spawn=0.0)]


def gen_signal_ped(arms, geom):
    """ego turns right on green; pedestrians cross the street ego turns into (they have green too)."""
    if not geom["crossings"]:
        return None
    pool = [a for a in _named(arms) if _enter(a)]
    if not pool:
        return None
    ego = max(pool, key=lambda a: a["bear"][1])
    r = _right(_inward(ego))
    exits = [a for a in arms if a is not ego and _exit(a)]
    if not exits:
        return None
    rex = max(exits, key=lambda a: a["bear"][0] * r[0] + a["bear"][1] * r[1])
    if rex["bear"][0] * r[0] + rex["bear"][1] * r[1] < 0.3:    # no clear right-turn exit
        return None
    rdir = rex["bear"]
    best, bs = None, 0.55                                       # crossing lying along the right-exit arm
    for ci, c in enumerate(geom["crossings"]):
        ctr = c["center"]
        d = _hyp(ctr)
        if d < 4:
            continue
        dot = (ctr[0] * rdir[0] + ctr[1] * rdir[1]) / d
        if dot > bs:
            bs, best = dot, ci
    if best is None:
        return None
    return SIGNAL_PED_T, [dict(kind="ego", frm=_ref(ego), to=_ref(rex), v=5, spawn=0.0),
                          dict(kind="ped", crossing=best, side=1, v=1.3, spawn=0.6)]


GENERATORS = {"zprava": gen_zprava, "vedlejsi": gen_vedlejsi,
              "signal": gen_signal, "signal_ped": gen_signal_ped}


KIND_RULE = {"zprava": "prednost_zprava", "vedlejsi": "give_way",
             "signal": "signal_left", "signal_ped": "signal_ped"}


def _autokinds(geom):
    """Which rule templates are FAITHFUL at this junction (so the text never lies about the signs)."""
    sg = [s["code"] for s in geom["signs"]]
    out = []
    if sg.count("signal") >= 2:                                # genuinely signalized
        out.append("signal")
        if geom["crossings"]:
            out.append("signal_ped")
    if "P2" in sg and "P4" in sg:
        out.append("vedlejsi")                                 # genuinely main/side signed
    if not sg:
        out.append("zprava")                                   # genuinely uncontrolled
    return out


def _register(params):
    k = params.get("_key") or f"cx_{params['city']}_{round(params['near'][0])}_{round(params['near'][1])}"
    EXTRACTS.setdefault(k, params)
    return k


def auto_spec(key, order, kind, counts=None, cap=None):
    if isinstance(key, dict):
        key = _register(key)
    ex = EXTRACTS[key]
    tdir, meta = load_city(ex["city"])
    try:
        cx, cy = locate(tdir, ex["streets"], ex.get("near"), 1300)
        geom, _ = build_geom(tdir, cx, cy, ex["r"], meta)
    except SystemExit:
        return None
    arms = build_arms(geom)
    kinds = _autokinds(geom) if kind == "auto" else [kind]
    if counts is not None:                                      # try the scarcest type first → balanced set
        kinds = sorted(kinds, key=lambda k: counts.get(KIND_RULE.get(k, k), 0))
    for kd in kinds:
        if cap is not None and counts is not None and counts.get(KIND_RULE.get(kd, kd), 0) >= cap:
            continue
        res = GENERATORS[kd](arms, geom)
        if res is None:
            continue
        tpl, actors = res
        for a in actors:
            a.setdefault("v", 7)
            a.setdefault("spawn", 0.0)
        return dict(id=f"r{order}_{key}", order=order, extract=key, **tpl, actors=actors, decision=dict(t=3.0))
    return None


# Curated topologically complex, multi-city junctions (msg 3126) — the schematic's many arms/rails/signs
# carry the "tangled" feel; ego + conflict are picked flow-aware so paths never go the wrong way one-way.
AUTOGEN = [
    ("kubanske", "vedlejsi"), ("trojicka", "signal"), ("stvanice", "vedlejsi"),
    ("dornych", "vedlejsi"), ("cacovicka", "signal"),
    ("hornopolni", "signal"), ("pavlovova", "vedlejsi"),
    ("lidicka", "signal"), ("chodske", "vedlejsi"), ("klatovska", "vedlejsi"),
]

CITY_DISPLAY = {"praha": "Praha", "brno": "Brno", "ostrava": "Ostrava", "plzen": "Plzeň"}


def scan_complex(city, want=16, used=()):
    """Rank the bake's most topologically complex junctions (high degree, many streets, signals, trams,
    crossings) and return them as ready-to-author param dicts — so we can fill the set with tangled,
    real junctions from every city (msg 3126)."""
    import glob
    tdir, _ = load_city(city)
    cand = []
    for f in glob.glob(str(tdir / "tiles" / "*.json")):
        t = json.loads(Path(f).read_text())
        edges = t.get("edges", [])
        signs = [(s["x"], s["y"], s.get("kind")) for s in t.get("signs", [])]
        railpts = [g for r in t.get("rails", []) for g in (r.get("geom") or [])]
        cross = t.get("crossings", [])
        for jc in t.get("junctions", []):
            jx, jy, deg = jc["x"], jc["y"], jc.get("deg", 0)
            if deg < 5:
                continue
            inc = [e for e in edges if min(math.dist((jx, jy), e["geom"][0]), math.dist((jx, jy), e["geom"][-1])) < 6]
            named = sorted({e["name"] for e in inc if e.get("name")})
            if len(named) < 2:
                continue
            nsig = sum(1 for s in signs if s[2] == "signal" and math.dist((jx, jy), (s[0], s[1])) < 30)
            nrail = sum(1 for p in railpts if math.dist((jx, jy), (p[0], p[1])) < 30)
            ncross = sum(1 for c in cross if math.dist((jx, jy), (c["x"], c["y"])) < 28)
            score = deg * 2 + len(named) * 2 + nsig * 3 + min(nrail, 12) + ncross
            cand.append((score, jx, jy, tuple(named[:2])))
    cand.sort(reverse=True)
    out, seen = [], set()
    for score, jx, jy, names in cand:
        if names in seen or len(names) < 2:
            continue
        if any(c == city and math.dist((jx, jy), (ux, uy)) < 80 for c, ux, uy in used):
            continue
        seen.add(names)
        out.append(dict(city=city, streets=f"{names[0]}|{names[1]}", near=(round(jx), round(jy)),
                        r=52, name=f"{names[0]} × {names[1]}", district=CITY_DISPLAY[city]))
        if len(out) >= want:
            break
    return out


def _used_coords(specs):
    """(city, x, y) seeds already consumed, so the scan filler doesn't duplicate a junction."""
    out = []
    for s in specs:
        ex = EXTRACTS.get(s.get("extract"))
        if ex and ex.get("near"):
            out.append((ex["city"], ex["near"][0], ex["near"][1]))
    return out


def build_one(spec):
    ex = EXTRACTS[spec["extract"]]
    tdir, meta = load_city(ex["city"])
    cx, cy = locate(tdir, ex["streets"], ex.get("near"), 1100)
    geom, info = build_geom(tdir, cx, cy, ex["r"], meta)
    arms = build_arms(geom)
    core_r = spec.get("core_r", geom["core"]["r"])
    actors = []
    for a in spec["actors"]:
        if "path" in a:
            path = a["path"]
        elif a["kind"] == "ped" and "crossing" in a:          # pedestrian across a real zebra
            c = geom["crossings"][a["crossing"]]
            ctr, d, hw, s = c["center"], c["dir"], c["halfW"] + 1.0, a.get("side", 1)
            perp = [-d[1], d[0]]
            path = [[round(ctr[0] + perp[0] * hw * s, 1), round(ctr[1] + perp[1] * hw * s, 1)],
                    [round(ctr[0] - perp[0] * hw * s, 1), round(ctr[1] - perp[1] * hw * s, 1)]]
        else:
            path = actor_path(arms, a["frm"], a["to"], a.get("lane", 0.5), core_r)
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
        "rule": spec.get("rule", ""),                          # used to interleave types in the play order
        "citation": spec.get("citation") or CITE.get(spec.get("rule", ""), ""),
    }
    if "stats" in spec:
        scn["stats"] = spec["stats"]
    (OUT / f"{spec['id']}.json").write_text(json.dumps(scn, ensure_ascii=False, indent=2))
    return spec["id"], len(geom["roads"]), [len(a["path"]) for a in actors]


# keep only the substantial hand-authored scenarios; the simple residential přednost-zprava ones are
# dropped in favour of the topologically complex multi-city set (msg 3126 — focus on tangled junctions).
KEEP_HAND = {"r1_prednost_zprava", "r3_bulovka_vedlejsi", "r4_tulipan_chodec", "r6_navrsni_odboceni",
             "r10_prespolni_vedlejsi", "r11_cervenydvur_hlavni", "r12_michelska_odboceni"}


TARGET = 30


def build_all(specs):
    specs = [s for s in specs if s["id"] in KEEP_HAND]
    all_specs = list(specs)
    order = max((s["order"] for s in specs), default=0)
    # 1) curated complex junctions
    for key, kind in AUTOGEN:
        order += 1
        spec = auto_spec(key, order, kind)
        if spec is None:
            print(f"  SKIP {key} ({kind}) — could not resolve clean arms")
            order -= 1
            continue
        all_specs.append(spec)
    # 2) fill to TARGET from scanned complex junctions, interleaving cities for geographic spread and
    #    capping each rule type so the set stays varied (msg 3126: vary types before repeating).
    from collections import Counter
    pools = {c: scan_complex(c, 30, _used_coords(all_specs)) for c in CITY_DISPLAY}
    cities = list(CITY_DISPLAY)
    flat, depth = [], max((len(p) for p in pools.values()), default=0)
    for i in range(depth):
        for c in cities:
            if i < len(pools[c]):
                flat.append(pools[c][i])
    counts = Counter(s.get("rule", "") for s in all_specs)
    usedset = set()

    def fill(cap):
        nonlocal order
        for cand in flat:
            if len(all_specs) >= TARGET:
                break
            ckey = (cand["city"], tuple(cand["near"]))
            if ckey in usedset:
                continue
            spec = auto_spec(cand, order + 1, "auto", counts, cap)
            if spec is None:
                continue
            order += 1
            all_specs.append(spec)
            counts[spec.get("rule", "")] += 1
            usedset.add(ckey)

    fill(cap=6)        # first pass: keep types balanced
    fill(cap=None)     # second pass: relax the cap if still short of TARGET
    for spec in all_specs:
        sid, nroads, paths = build_one(spec)
        print(f"  wrote {sid}.json  roads={nroads} actor_path_pts={paths} [{spec.get('rule','')}]")
    print(f"  -> {len(all_specs)} scenarios")


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
