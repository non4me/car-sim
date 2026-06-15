// Czech right-of-way resolver. For each agent, decide whether it has priority OVER
// the player, with the rule key + statute citation. Override order per SPEC §6.
import { rightArm } from "./junction.js";

export function agentPriority(scn, ag) {
  const control = scn.control || "uncontrolled";
  const pf = scn.player.from;

  if (ag.kind === "ped")
    return { priority: true, ruleKey: "pedestrian", citation: "§ 5 odst. 2 / § 54 z. 361/2000 Sb." };

  if (ag.kind === "tram") {
    const turning = ag.turn && ag.turn !== "straight";
    if (turning) return { priority: true, ruleKey: "tram_turning", citation: "§ 21 odst. 7 z. 361/2000 Sb." };
    if (control === "priority")
      return { priority: false, ruleKey: "tram_straight_yields", citation: "§ 21 z. 361/2000 Sb." };
    return { priority: true, ruleKey: "tram_straight", citation: "§ 21 odst. 5 z. 361/2000 Sb." };
  }

  // car
  if (control === "priority") return { priority: false, ruleKey: "priority_road", citation: "§ 22 z. 361/2000 Sb." };
  if (control === "give_way") return { priority: true, ruleKey: "give_way", citation: "značka P4, § 22 z. 361/2000 Sb." };
  if (control === "stop") return { priority: true, ruleKey: "stop", citation: "značka P6, § 22 z. 361/2000 Sb." };
  // uncontrolled — přednost zprava
  if (ag.from === rightArm(pf))
    return { priority: true, ruleKey: "prednost_zprava", citation: "§ 22 odst. 1 z. 361/2000 Sb." };
  return { priority: false, ruleKey: "left_yields", citation: "§ 22 odst. 1 z. 361/2000 Sb." };
}

export function mustStop(scn) {
  return scn.control === "stop" || (scn.signs || []).some((s) => s.code === "P6");
}
