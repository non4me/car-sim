// Kinematic bicycle-model car. DOM-free so it can be unit-tested headlessly.
import { PARAMS as P } from "./params.js";

export class Car {
  constructor(x, y, heading) {
    this.x = x; this.y = y; this.h = heading; // heading: 0 = +x (east)
    this.v = 0;            // m/s, signed (negative = reverse)
    this.steer = 0;        // current front-wheel angle (rad)
    this.blocked = false;  // soft-blocked by off-surface this frame
  }

  // controls: {throttle: -1..1, steer: -1..1, brake: bool}
  update(dt, c) {
    // --- longitudinal ---
    let a = 0;
    if (c.brake) {
      a = -Math.sign(this.v) * P.hardBrake;
      if (Math.abs(this.v) < P.hardBrake * dt) { this.v = 0; a = 0; }
    } else if (c.throttle > 0) {
      a = P.accel * c.throttle;
    } else if (c.throttle < 0) {
      if (this.v > 0.3) a = -P.brake;             // braking from forward
      else a = -P.accel * 0.5;                    // then reverse (gentler)
    } else {
      a = -Math.sign(this.v) * P.drag;            // coast
      if (Math.abs(this.v) < P.drag * dt) { this.v = 0; a = 0; }
    }
    this.v += a * dt;
    this.v = Math.max(-P.maxReverse, Math.min(P.maxSpeed, this.v));

    // --- steering (tighter limit as speed rises; recenters when released) ---
    const speedFrac = Math.min(1, Math.abs(this.v) / P.steerSpeedFalloff);
    const maxAtSpeed = P.maxSteer * (1 - 0.6 * speedFrac);
    if (c.steer) {
      this.steer += c.steer * 2.6 * dt;
      this.steer = Math.max(-maxAtSpeed, Math.min(maxAtSpeed, this.steer));
    } else {
      const s = Math.sign(this.steer);
      this.steer -= s * P.steerReturn * dt;
      if (Math.sign(this.steer) !== s) this.steer = 0;
    }

    // --- pose ---
    if (Math.abs(this.v) > 0.05) this.h += (this.v / P.length) * Math.tan(this.steer) * dt;
    this.x += this.v * Math.cos(this.h) * dt;
    this.y += this.v * Math.sin(this.h) * dt;
  }

  get speedKmh() { return Math.round(Math.abs(this.v) * 3.6); }
  // soft block: undo this frame's translation and bleed speed
  softBlock(px, py) { this.x = px; this.y = py; this.v *= 0.3; this.blocked = true; }
}
