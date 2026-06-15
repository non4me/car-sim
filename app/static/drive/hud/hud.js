// HUD: speedometer, current speed-limit sign, contextual warnings, street name.
const STR = {
  over: "Překročení rychlosti",
  boundary: "Dál cesta nevede — otočte se",
  offroad: "Mimo vozovku",
  oncoming: "V protisměru!",
};

export function makeHud() {
  const $ = (id) => document.getElementById(id);
  const speedo = $("speedo"), speed = $("speed");
  const limitBox = $("limit"), limitVal = $("limitval");
  const warn = $("warn");     // warnings/violations block (top) — shown only when active
  const streetEl = $("street"); // current-street block (below) — always visible, translucent
  const big = $("bigspeed"), bigVal = $("bigval");   // centre fading speed readout
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let lastKmh = null, changedAt = 0;

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

      // current street — its own always-on translucent block (never hidden by warnings)
      streetEl.textContent = r.street || "—";

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
