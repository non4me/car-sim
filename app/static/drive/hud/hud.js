// HUD: speedometer, current speed-limit sign, contextual warnings, street name.
const STR = {
  over: "Překročení rychlosti",
  boundary: "Dál cesta nevede — otočte se",
  offroad: "Mimo vozovku",
};

export function makeHud() {
  const $ = (id) => document.getElementById(id);
  const speedo = $("speedo"), speed = $("speed");
  const limitBox = $("limit"), limitVal = $("limitval");
  const info = $("warn");   // info block: current street name, or a warning
  const big = $("bigspeed"), bigVal = $("bigval");   // centre fading speed readout
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  let lastKmh = null, changedAt = 0;

  return {
    update(r) {
      speed.textContent = r.kmh;
      speedo.classList.toggle("over", r.over);

      // big centre readout: visible while speed changes, then fades over 3 s
      if (big) {
        if (r.kmh !== lastKmh) { lastKmh = r.kmh; changedAt = now(); bigVal.textContent = r.kmh; }
        const fade = Math.max(0, 1 - (now() - changedAt) / 3000);  // 1 → 0 over 3 s after last change
        big.style.opacity = (0.55 * fade).toFixed(3);
      }

      if (r.limit != null) {
        limitBox.classList.remove("none");
        limitVal.textContent = r.limit;
      } else {
        limitBox.classList.add("none");
        limitVal.textContent = "—";
      }

      // info block — priority: boundary > off-road > over-limit > current street name.
      // current street = white, "Mimo vozovku" = yellow, violations/boundary = red.
      let text, cls;
      if (r.boundary) { text = STR.boundary; cls = "bad"; }
      else if (r.offRoad) { text = STR.offroad; cls = "warnY"; }
      else if (r.over) { text = `${STR.over} — ${r.limit} km/h`; cls = "bad"; }
      else { text = r.street || "—"; cls = "street"; }
      info.textContent = text;
      info.classList.remove("bad", "warnY", "street");
      info.classList.add(cls);
    },
  };
}
