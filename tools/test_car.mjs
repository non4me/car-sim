// Headless sanity for the rotate-in-place vehicle core.
import { Car } from "../app/static/drive/vehicle/car.js";
import { PARAMS as P } from "../app/static/drive/vehicle/params.js";
const H = 1 / 60;
const C = (o = {}) => ({ throttle: 0, brake: 0, hard: 0, turn: 0, ...o });
function run(label, controls, steps, car) {
  for (let i = 0; i < steps; i++) car.update(H, controls);
  console.log(`${label}: v=${car.v.toFixed(2)}m/s (${car.speedKmh}km/h) pos=(${car.x.toFixed(1)},${car.y.toFixed(1)}) h=${(car.h * 180 / Math.PI).toFixed(0)}°`);
  return car;
}
let ok = true;
const expect = (c, m) => { if (!c) { console.log("  FAIL " + m); ok = false; } };

// gentle accel: after 2s of throttle, ~ accel*2 = 5.6 m/s (~20 km/h), NOT punchy
let c = new Car(0, 0, 0);
run("accel 2s", C({ throttle: 1 }), 120, c);
expect(c.v > 4 && c.v < 8 && c.x > 4, "gentle forward accel");

// sharp brake stops fast (minimal distance)
const xBrake0 = c.x;
run("hard brake", C({ hard: true }), 60, c);
expect(Math.abs(c.v) < 0.1, "sharp brake stops");
expect(c.x - xBrake0 < 6, "minimal stopping distance");

// rotate in place from standstill (turn changes heading, position barely moves)
let c2 = new Car(0, 0, 0);
run("rotate in place 1s", C({ turn: 1 }), 60, c2);
expect(Math.abs(c2.h) > 1.0 && Math.hypot(c2.x, c2.y) < 0.2, "rotates in place, stays put");

// smooth braking via down then gentle reverse
let c3 = new Car(0, 0, 0); c3.v = 8;
run("down brake 2s", C({ brake: 1 }), 120, c3);
expect(c3.v <= 0, "down brakes then reverses gently");

console.log(ok ? "\n✅ vehicle core OK" : "\n❌ vehicle core issues");
process.exit(ok ? 0 : 1);
