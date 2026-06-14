// Headless sanity for the DOM-free vehicle core.
import { Car } from "../app/static/drive/vehicle/car.js";
const H = 1/60;
function run(label, controls, steps, car) {
  for (let i=0;i<steps;i++) car.update(H, controls);
  console.log(`${label}: v=${car.v.toFixed(2)}m/s (${car.speedKmh}km/h) pos=(${car.x.toFixed(1)},${car.y.toFixed(1)}) h=${(car.h*180/Math.PI).toFixed(1)}°`);
  return car;
}
let ok = true;
// accelerate east 2s
let c = new Car(0,0,0);
run("accel 2s", {throttle:1,steer:0,brake:false}, 120, c);
if (!(c.v > 10 && c.x > 10 && Math.abs(c.y) < 0.5)) { console.log("  FAIL accel"); ok=false; }
// hard brake to stop
run("brake", {throttle:0,steer:0,brake:true}, 120, c);
if (Math.abs(c.v) > 0.1) { console.log("  FAIL brake"); ok=false; }
// steer left while moving → heading increases (turn toward +y / north)
let c2 = new Car(0,0,0); c2.v = 8;
run("steer-left 1.5s", {throttle:1,steer:-1,brake:false}, 90, c2);
if (!(c2.h !== 0)) { console.log("  FAIL steer"); ok=false; }
// reverse from stop
let c3 = new Car(0,0,0);
run("reverse 1.5s", {throttle:-1,steer:0,brake:false}, 90, c3);
if (!(c3.v < 0 && c3.x < 0)) { console.log("  FAIL reverse"); ok=false; }
console.log(ok ? "\n✅ vehicle core OK" : "\n❌ vehicle core issues");
process.exit(ok?0:1);
