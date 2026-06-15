// Waypoint-snap kinematic agents: lane-locked, move along an arc-length-parameterised
// path. No physics — speed integrates toward a target set by the controller each tick.
import { V } from "./world.js";

export class Agent {
  constructor(path, { kind = "car", color = "#f59e0b", cruiseV = 8, maxA = 5, maxD = 9 } = {}) {
    this.path = path; this.kind = kind; this.color = color;
    this.cruiseV = cruiseV; this.maxA = maxA; this.maxD = maxD;
    this.cum = [0];
    for (let i = 1; i < path.length; i++) this.cum.push(this.cum[i - 1] + V.dist(path[i - 1], path[i]));
    this.total = this.cum[this.cum.length - 1];
    this.s = 0; this.v = 0; this.target = 0; this.done = false; this.active = true;
    const a = this.at(0); this.pos = a.pos; this.angle = a.angle;
  }

  at(s) {
    s = Math.max(0, Math.min(this.total, s));
    let i = 1; while (i < this.cum.length && this.cum[i] < s) i++;
    const i0 = i - 1, segLen = (this.cum[i] - this.cum[i0]) || 1, t = (s - this.cum[i0]) / segLen;
    const p = V.lerp(this.path[i0], this.path[Math.min(i, this.path.length - 1)], t);
    const dir = V.norm(V.sub(this.path[Math.min(i, this.path.length - 1)], this.path[i0]));
    return { pos: p, angle: Math.atan2(dir[1], dir[0]) };
  }

  setTarget(v) { this.target = v; }

  update(dt) {
    if (!this.active) return;
    if (this.v < this.target) this.v = Math.min(this.target, this.v + this.maxA * dt);
    else this.v = Math.max(this.target, this.v - this.maxD * dt);
    this.s += this.v * dt;
    if (this.s >= this.total) { this.s = this.total; this.done = true; }
    const a = this.at(this.s); this.pos = a.pos; this.angle = a.angle;
  }

  // arc length at which this path passes closest to a world point
  closestS(P) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.path.length; i++) {
      const d = V.dist(this.path[i], P);
      if (d < bd) { bd = d; best = this.cum[i]; }
    }
    return best;
  }

  get speedKmh() { return Math.round(this.v * 3.6); }
}
