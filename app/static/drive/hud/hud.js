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
  const warn = $("warn"), street = $("street");
  let warnUntil = 0;

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

      street.textContent = r.street || "—";

      let msg = "", bad = false;
      if (r.boundary) { msg = STR.boundary; bad = true; }
      else if (r.over) { msg = `${STR.over} — ${r.limit} km/h`; bad = true; }
      else if (r.offRoad) { msg = STR.offroad; bad = false; }
      if (msg) {
        warn.textContent = msg;
        warn.classList.toggle("bad", bad);
        warn.classList.add("show");
      } else {
        warn.classList.remove("show");
      }
    },
  };
}
