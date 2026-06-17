// Street + district search with autocomplete. The index is a separate baked file (search.json)
// because map tiles STREAM — not all street names are resident in memory. On pick, the caller
// teleports the map (streaming the destination tiles, then snapping onto the nearest road).

export async function loadSearchIndex(base) {
  try {
    // ?b dodges a stale CF-cached 404 from before the file existed; no-cache keeps it fresh via ETag
    const idx = await (await fetch(base + "/search.json?b=1")).json();
    const items = [];
    for (const p of idx.places || []) items.push({ name: p.name, x: p.x, y: p.y, kind: "district" });
    for (const s of idx.streets || []) items.push({ name: s.name, x: s.x, y: s.y, kind: "street" });
    for (const it of items) it.q = it.name.toLowerCase();
    // places keep their OSM place-kind (city/town/suburb/quarter/…) for City/Trasa minimap ranking;
    // landmarks = the major city-wide objects (station/castle/…) baked into search.json (msg 2784).
    const places = (idx.places || []).map((p) => ({ name: p.name, x: p.x, y: p.y, kind: p.kind }));
    const landmarks = (idx.landmarks || []).map((l) => ({ name: l.name, x: l.x, y: l.y, kind: l.kind }));
    // admin = the city's official districts with boundary polygons (Praha 1…22, Brno-…) for the City minimap
    // (msg 2964/2970); road_refs = numbered-highway badge points (D0/D1/…) (msg 2971).
    const admin = (idx.admin || []).map((a) => ({ name: a.name, x: a.x, y: a.y, n: a.n, poly: a.poly || null }));
    const roadRefs = (idx.road_refs || []).map((r) => ({ ref: r.ref, x: r.x, y: r.y, m: !!r.m }));
    return { items, places, landmarks, admin, roadRefs };
  } catch {
    return { items: [], places: [], landmarks: [], admin: [], roadRefs: [] };
  }
}

// rank matches: prefix hits first, then substring; districts before streets; shorter names first.
function rank(items, text, limit) {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  const pref = [], sub = [];
  for (const it of items) {
    const i = it.q.indexOf(q);
    if (i === 0) pref.push(it);
    else if (i > 0) sub.push(it);
  }
  const r = (a) => (a.kind === "district" ? 0 : 1);
  const cmp = (a, b) => r(a) - r(b) || a.name.length - b.name.length;
  pref.sort(cmp); sub.sort(cmp);
  return [...pref, ...sub].slice(0, limit);
}

export function makeSearchBox(input, results, items, onPick) {
  let cur = [], hi = -1;
  const close = () => { results.classList.add("hidden"); results.innerHTML = ""; cur = []; hi = -1; };
  const render = () => {
    results.innerHTML = "";
    cur.forEach((it, i) => {
      const el = document.createElement("div");
      el.className = "sr-item" + (i === hi ? " hi" : "");
      const nm = document.createElement("span"); nm.className = "sr-name"; nm.textContent = it.name;
      const kd = document.createElement("span"); kd.className = "sr-kind";
      kd.textContent = it.kind === "district" ? "čtvrť" : "ulice";
      el.append(nm, kd);
      el.addEventListener("mousedown", (e) => { e.preventDefault(); pick(it); });
      results.appendChild(el);
    });
    results.classList.toggle("hidden", cur.length === 0);
  };
  const pick = (it) => { input.value = it.name; close(); input.blur(); onPick(it.x, it.y); };
  const refresh = () => { cur = rank(items, input.value, 8); hi = -1; render(); };

  input.addEventListener("input", refresh);
  input.addEventListener("focus", () => { if (input.value.trim().length >= 2) refresh(); });
  input.addEventListener("blur", () => setTimeout(close, 120));   // delay so a click registers
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && cur.length) { e.preventDefault(); hi = (hi + 1) % cur.length; render(); }
    else if (e.key === "ArrowUp" && cur.length) { e.preventDefault(); hi = (hi - 1 + cur.length) % cur.length; render(); }
    else if (e.key === "Enter" && cur.length) { e.preventDefault(); pick(cur[hi >= 0 ? hi : 0]); }
    else if (e.key === "Escape") { close(); input.blur(); }
  });
}
