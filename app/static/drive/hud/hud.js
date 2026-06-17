// HUD: speedometer, current speed-limit sign, contextual warnings, street name.
const STR = {
  over: "Překročení rychlosti",
  boundary: "Dál cesta nevede — otočte se",
  offroad: "Mimo vozovku",
  oncoming: "V protisměru!",
};

// CZ road-number badge colour (mirrors render/draw.js refStyle): red dálnice (D), blue I. třída
// (trunk/primary), yellow II/III, green E-routes. Shown in the HUD next to the street name (msg 3030).
function refClass(ref, cls) {
  if (/^E\s?\d/i.test(ref)) return { bg: "#2f8f43", fg: "#fff", bd: "rgba(255,255,255,.92)" };
  if (/^D\d/.test(ref) || cls === "motorway" || cls === "motorway_link") return { bg: "#c1272d", fg: "#fff", bd: "rgba(255,255,255,.92)" };
  if (cls === "trunk" || cls === "primary" || cls === "trunk_link" || cls === "primary_link") return { bg: "#1f6fd6", fg: "#fff", bd: "rgba(255,255,255,.92)" };
  return { bg: "#f2b21a", fg: "#241803", bd: "rgba(90,66,6,.95)" };
}

export function makeHud() {
  const $ = (id) => document.getElementById(id);
  const speedo = $("speedo"), speed = $("speed");
  const limitBox = $("limit"), limitVal = $("limitval");
  const warn = $("warn");     // warnings/violations block (top) — shown only when active
  const streetEl = $("street"); // current-street block (below) — always visible, translucent
  const big = $("bigspeed"), bigVal = $("bigval");   // centre fading speed readout
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let lastKmh = null, changedAt = 0, lastStreetKey = null;

  return {
    update(r, hideWarn) {
      speed.textContent = r.kmh;
      speedo.classList.toggle("over", r.over);

      // big centre readout: visible while speed changes, then fades over 1 s
      if (big) {
        if (r.kmh !== lastKmh) { lastKmh = r.kmh; changedAt = now(); bigVal.textContent = r.kmh; }
        const fade = Math.max(0, 1 - (now() - changedAt) / 1000);  // 1 → 0 over 1 s after last change
        big.style.opacity = (0.30 * fade).toFixed(3);              // peak 30% opacity
      }

      if (r.limit != null) {
        limitBox.classList.remove("none");
        limitVal.textContent = r.limit;
      } else {
        limitBox.classList.add("none");
        limitVal.textContent = "—";
      }

      // current street + its road number(s) — an always-on translucent block (never hidden by warnings).
      // The number rides next to the name in CZ colours (msg 3030). Rebuilt only when it actually changes,
      // and via DOM nodes (not innerHTML) so an OSM street name can never inject markup.
      const ie = r.iref ? r.iref.replace(/\s+/g, "") : "";
      const skey = `${r.street || ""}|${r.ref || ""}|${ie}|${r.cls || ""}`;
      if (skey !== lastStreetKey) {
        lastStreetKey = skey;
        streetEl.textContent = "";
        streetEl.appendChild(document.createTextNode(r.street || "—"));
        const badges = [];
        if (r.ref) badges.push({ t: r.ref, st: refClass(r.ref, r.cls) });
        if (ie && ie !== (r.ref || "")) badges.push({ t: ie, st: refClass("E", r.cls) });
        for (const b of badges) {
          const span = document.createElement("span");
          span.className = "refbadge"; span.textContent = b.t;
          span.style.background = b.st.bg; span.style.color = b.st.fg; span.style.borderColor = b.st.bd;
          streetEl.appendChild(span);
        }
      }

      // warnings/violations block (above the street) — shown only when something is active, so
      // it never covers the street name. Priority: boundary > off-road > oncoming > over-limit.
      // Hidden entirely in bird's-eye/overview (hideWarn) — violations only matter when you can
      // actually see the car as a vehicle (msg 2768).
      let wtext = null, wcls = "bad";
      if (hideWarn) wtext = null;
      else if (r.boundary) wtext = STR.boundary;
      else if (r.offRoad) { wtext = STR.offroad; wcls = "warnY"; }
      else if (r.oncoming) wtext = STR.oncoming;
      else if (r.over) wtext = `${STR.over} — ${r.limit} km/h`;
      warn.classList.toggle("hidden", !wtext);
      if (wtext) {
        warn.textContent = wtext;
        warn.classList.remove("bad", "warnY");
        warn.classList.add(wcls);
      }
    },
  };
}
