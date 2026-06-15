# Curate a diverse, de-duplicated subset of the CS-only photo_verified_cz.json question bank for the
# photo-quiz expansion (msg 2812). Groups the 71 distinct rule_tags into coarse topics, drops the
# pedestrian-crossing topics (already abundant in the live 42), and keeps the highest-confidence
# representative per coarse topic. Writes the source records to /tmp/curated_src.json for translation.
import json
from collections import defaultdict

d = json.load(open("data/quiz/photo_verified_cz.json"))
allq = [{**q, "city": c} for c, lst in d.items() for q in lst]

RULES = [
    ("no_entry", ["zakaz_vjezdu", "zakaz-vjezdu", "no_entry", "no-entry"]),
    ("no_motor_vehicles", ["no_motor", "motorovych", "motor_vehicles"]),
    ("no_stopping", ["no_stopping", "zastaveni"]),
    ("no_standing_parking", ["zakaz_stani", "no_parking", "zakaz-stani"]),
    ("no_turn", ["odbocovani"]),
    ("weight_limit", ["hmotnost", "weight"]),
    ("paid_parking", ["placene", "meter", "hodin"]),
    ("reserved_parking", ["vyhrazene"]),
    ("blue_zone", ["modra_zona", "modra-zona", "modrymi"]),
    ("parking_P", ["parkoviste", "parking", "ip11a"]),
    ("give_way_sign", ["give_way", "prednost_v_jizde"]),
    ("priority_main_road", ["priority_main", "prednost"]),
    ("roundabout_giveway", ["roundabout_give"]),
    ("roundabout_sign", ["kruhovy_objezd", "roundabout"]),
    ("mandatory_arrow", ["prikazove", "prikaz", "mandatory"]),
    ("shared_path", ["shared_path", "c9a"]),
    ("dead_end", ["dead_end"]),
    ("zone30_end", ["zona_30_konec", "konec_zony_30", "zona-30-konec"]),
    ("zone30_start", ["zona_30_zacatek", "zona_30", "zone_30"]),
    ("zone_end", ["konec-zony", "konec_zony"]),
    ("directional_sign", ["smerova_znacka", "smerove_znac"]),
    ("lane_direction_sign", ["radici_pruhy"]),
    ("red_light", ["cervena", "traffic_light", "svetelny"]),
    ("broken_line", ["prerusovana", "broken_lane", "podelna-cara", "podelna_cara"]),
    ("lane_arrows", ["direction_arrows", "smerove_sipky"]),
    ("cyclist", ["cyklist", "cycle"]),
    ("oblique_area", ["sikme"]),
    ("temp_yellow", ["docasne", "zlute"]),
    ("signal_overrides", ["signal_overrides"]),
    ("speed_roadworks", ["speed_limit"]),
    ("sign_category", ["kategorie"]),
]


def coarse(tag):
    t = (tag or "").lower()
    if "prechod" in t or "pedestrian" in t:
        return None
    for name, keys in RULES:
        if any(k in t for k in keys):
            return name
    return None


groups = defaultdict(list)
for q in allq:
    c = coarse(q.get("rule_tag", ""))
    if c:
        groups[c].append(q)

picked = []
for name, lst in groups.items():
    lst.sort(key=lambda x: -(x.get("confidence") or 0))
    picked.append((name, lst[0]))
picked.sort(key=lambda x: x[0])

print("curated coarse topics:", len(picked))
for n, q in picked:
    print("  %-22s conf=%-4s %s :: %s" % (n, q.get("confidence"), q["photo_id"][:8], (q["question_cs"] or "")[:44]))

src = [{
    "topic": n, "photo_id": q["photo_id"], "type": q.get("type"), "rule_tag": q.get("rule_tag"),
    "difficulty": 2, "citation": q.get("citation", ""), "city": q.get("city"),
    "question_cs": q["question_cs"], "options_cs": q["options_cs"],
    "correct_index": q["correct_index"], "explanation_cs": q.get("explanation_cs", ""),
} for n, q in picked]
json.dump(src, open("/tmp/curated_src.json", "w"), ensure_ascii=False, indent=1)
print("\nsaved %d source records -> /tmp/curated_src.json" % len(src))
