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

  return {
    update(r) {
      speed.textContent = r.kmh;
      speedo.classList.toggle("over", r.over);

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
