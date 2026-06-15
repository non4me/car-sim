// Headless simulation core: agents + Czech rule evaluation, no DOM. Shared by the
// browser game (game.js) and the Node golden-path test harness.
import { V, densify } from "./world.js";
import { buildJunction, targetArm, turnOf, DIR } from "./junction.js";
import { Agent } from "./agents.js";
import { agentPriority, mustStop } from "./rules.js";

export class Sim {
  constructor(scn) {
    this.scn = scn;
    this.jun = buildJunction(scn);
    this.turn = scn.player.turn || (scn.player.to ? turnOf(scn.player.from, scn.player.to) : "straight");
    this.t = 0; this.score = 100; this.result = null; this.gas = false;
    this.waitTime = 0; this.deducted = false; this.stoppedAtLine = false;
    this.buildAgents();
  }

  buildPlayerPath() {
    const scn = this.scn, jun = this.jun;
    const to = scn.player.to || targetArm(scn.player.from, this.turn);
    const p = new Agent(jun.pathFor(scn.player.from, to), { kind: "car", color: "#5b9cff", cruiseV: 9, maxA: 6 });
    p.from = scn.player.from;
    p.confS = p.closestS(jun.C);
    p.mouthS = p.closestS(jun.mouth(scn.player.from));
    this.player = p;
  }

  buildAgents() {
    this.buildPlayerPath();
    const scn = this.scn, jun = this.jun;
    this.agents = []; this.peds = [];
    for (const sp of scn.agents || []) {
      const to = sp.to || targetArm(sp.from, sp.turn);
      const col = sp.kind === "tram" ? "#cbd5e1" : "#f59e0b";
      const a = new Agent(jun.pathFor(sp.from, to), {
        kind: sp.kind, color: col, cruiseV: sp.cruise_v || (sp.kind === "tram" ? 9 : 7),
      });
      a.from = sp.from; a.turn = sp.turn || turnOf(sp.from, to);
      a.spawnT = sp.spawn_t || 0;
      a.confS = a.closestS(jun.C);
      a.prio = agentPriority(scn, { kind: sp.kind, from: sp.from, turn: a.turn });
      this.agents.push(a);
    }
    for (const p of scn.pedestrians || []) {
      const arm = p.arm, d = DIR[arm], perp = V.right(d);
      const center = V.add(jun.C, V.mul(d, jun.R + 1.6));
      const s0 = (p.side === "L" ? -1 : 1);
      const path = densify([
        V.add(center, V.mul(perp, (jun.roadHalf + 1.2) * s0)),
        V.add(center, V.mul(perp, -(jun.roadHalf + 1.2) * s0)),
      ], 0.4);
      const ped = new Agent(path, { kind: "ped", color: "#fbbf24", cruiseV: p.v || 1.3, maxA: 3, maxD: 3 });
      ped.spawnT = p.spawn_t || 0;
      ped.prio = { priority: true, ruleKey: "pedestrian", citation: "§ 5 / § 54 z. 361/2000 Sb." };
      this.peds.push(ped);
    }
  }

  setGas(v) { this.gas = v; }
  setTurn(tn) { if (this.player.s > 1.0) return; this.turn = tn; this.buildPlayerPath(); }

  hasPriorityAgent() { return this.agents.some((a) => a.prio.priority) || this.peds.length > 0; }
  inZone(a, extra = 3) { return V.dist(a.pos, this.jun.C) < this.jun.R + extra; }
  committed() { return this.player.s > this.player.confS - 7; }
  cleared() { return this.player.s > this.player.confS + 5; }

  fail(reason, agentRule) { if (!this.result) this.result = { ok: false, reason, agentRule }; }

  step(dt) {
    if (this.result) return;
    const { player, agents, peds, jun, scn } = this;
    this.t += dt;
    player.setTarget(this.gas ? player.cruiseV : 0);
    player.update(dt);

    if (player.s > player.mouthS - 4 && player.s < player.mouthS + 0.3 && player.v < 0.6) this.stoppedAtLine = true;

    for (const a of agents) {
      if (this.t < a.spawnT) { a.setTarget(0); a.update(dt); continue; }
      if (a.prio.priority) a.setTarget(a.cruiseV);
      else {
        const d = a.confS - a.s;
        if (this.committed() && !this.cleared() && d < 12 && d > -2) a.setTarget(0);
        else a.setTarget(a.cruiseV);
      }
      a.update(dt);
    }
    for (const p of peds) { p.setTarget(this.t >= p.spawnT ? p.cruiseV : 0); p.update(dt); }

    this.evaluate(dt);
  }

  evaluate(dt) {
    if (this.result) return;
    const { player, agents, peds, jun, scn } = this;

    if (!this.deducted && this.committed() && player.v > 8.4) { this.score = Math.max(0, this.score - 10); this.deducted = true; }

    for (const a of [...agents, ...peds]) {
      if (this.t < a.spawnT) continue;
      const r = a.kind === "tram" ? 4.5 : a.kind === "ped" ? 2.6 : 3.4;
      if (V.dist(player.pos, a.pos) < r) return this.fail(a.kind === "ped" ? "ped" : "collision", a.prio);
    }
    if (this.inZone(player, 2)) {
      for (const a of agents) {
        if (this.t < a.spawnT) continue;
        if (a.prio.priority && this.inZone(a, 2)) return this.fail("no_yield", a.prio);
      }
    }
    if (mustStop(scn) && player.s > player.mouthS + 0.3 && !this.stoppedAtLine)
      return this.fail("ran_stop", { ruleKey: "stop", citation: "značka P6, § 22 z. 361/2000 Sb." });

    const nearLine = player.s > player.mouthS - 9 && player.s < player.mouthS + 1;
    if (!this.hasPriorityAgent() && nearLine && player.v < 0.3) {
      this.waitTime += dt;
      if (this.waitTime > 5) {
        const a0 = agents[0];
        return this.fail("over_cautious", a0 ? a0.prio : { ruleKey: "priority_road", citation: "§ 22 z. 361/2000 Sb." });
      }
    } else if (player.v > 0.5) this.waitTime = 0;

    if (player.done) this.result = { ok: true, reason: "pass", agentRule: this.keyRule() };
  }

  keyRule() {
    const a = this.agents.find((x) => x.prio.priority);
    if (a) return a.prio;
    if (this.peds[0]) return this.peds[0].prio;
    if (this.agents[0]) return this.agents[0].prio;
    return { ruleKey: this.scn.rule, citation: this.scn.citation || "" };
  }
}
