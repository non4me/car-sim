# Fetch the full texts of the transport-related Czech laws from the legalize-cz repo (msg 2820) into
# data/docs/laws/, and write a manifest grouping them by transport mode. The runtime (app/docs_laws.py)
# parses the stored markdown into searchable §-sections — so re-running this just refreshes the texts.
#
#   python3 tools/fetch_laws.py
#
# Source: github.com/legalize-dev/legalize-cz (Czech legislation in Markdown, MIT). Each act is one file
# cz/SB-<year>-<number>.md with YAML frontmatter (title, official_code, source e-Sbírka URL, status,
# amendments, last_updated) and a §-structured body.

import json
import urllib.request
from pathlib import Path

RAW = "https://raw.githubusercontent.com/legalize-dev/legalize-cz/main/cz/{}.md"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "docs" / "laws"

# Czech transport legislation, grouped by mode. (id = SB code; label = short human name.)
LAWS = [
    # --- silniční provoz / road traffic ---
    ("SB-2000-361", "road", "Zákon o silničním provozu"),
    ("SB-2015-294", "road", "Vyhláška o dopravních značkách a zařízeních"),
    ("SB-1997-13",  "road", "Zákon o pozemních komunikacích"),
    ("SB-1997-104", "road", "Vyhláška k zákonu o pozemních komunikacích"),
    ("SB-2001-56",  "road", "Zákon o podmínkách provozu vozidel na pozemních komunikacích"),
    ("SB-2014-341", "road", "Vyhláška o schvalování technické způsobilosti vozidel"),
    ("SB-2000-247", "road", "Zákon o získávání a zdokonalování odborné způsobilosti k řízení (autoškoly)"),
    ("SB-1994-111", "road", "Zákon o silniční dopravě"),
    ("SB-1999-168", "road", "Zákon o pojištění odpovědnosti z provozu vozidla"),
    # --- železniční / rail ---
    ("SB-1994-266", "rail", "Zákon o dráhách"),
    # --- letecká / air ---
    ("SB-1997-49",  "air",  "Zákon o civilním letectví"),
    # --- vodní / water ---
    ("SB-1995-114", "water", "Zákon o vnitrozemské plavbě"),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    for sb, mode, label in LAWS:
        url = RAW.format(sb)
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
        except Exception as e:  # noqa: BLE001
            print(f"FAIL {sb}: {e}")
            continue
        (OUT / f"{sb}.md").write_bytes(data)
        manifest.append({"id": sb, "mode": mode, "label": label, "file": f"{sb}.md"})
        print(f"OK {sb}  {len(data) / 1024:6.1f} KB  {label}")
    (ROOT / "data" / "docs" / "laws.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {len(manifest)} laws + manifest")


if __name__ == "__main__":
    main()
