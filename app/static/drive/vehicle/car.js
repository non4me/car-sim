// Rotate-in-place + thrust car. DOM-free (headless-testable).
// controls: {throttle:0/1 (↑), brake:0/1 (↓), hard:bool (Space), turn:-1/0/1 (←/→)}
import { PARAMS as P } from "./params.js";

export class Car {
  constructor(x, y, heading) {
    this.x = x; this.y = y; this.h = heading; // 0 = +x (east)
    this.v = 0;             // m/s, signed
    this.blocked = false;
  }

  // longitudinal speed model only (reused by free driving and the rail/overview mode)
  longitudinal(dt, c) {
    if (c.hard) {                                   // sharp brake (Space)
      const s = Math.sign(this.v);
      this.v -= s * P.hardBrake * dt;
      if (Math.sign(this.v) !== s) this.v = 0;
    } else if (c.throttle) {                        // ↑ gentle accelerate
      this.v += P.accel * dt;
    } else if (c.brake) {                           // ↓ smooth brake, then gentle reverse
      if (this.v > 0.15) { this.v -= P.brake * dt; if (this.v < 0) this.v = 0; }
      else { this.v -= P.reverseAccel * dt; }
    }
    // else: maintain speed (no auto-decel) — only ↓ / Space slow the car (msg 2668)
    this.v = Math.max(-P.maxReverse, Math.min(P.maxSpeed, this.v));
  }

  update(dt, c) {
    this.longitudinal(dt, c);
    if (c.turn) this.h += c.turn * P.turnRate * dt;   // rotate in place (independent of speed)
    this.x += this.v * Math.cos(this.h) * dt;          // move along heading
    this.y += this.v * Math.sin(this.h) * dt;
  }

  get speedKmh() { return Math.round(Math.abs(this.v) * 3.6); }
}
