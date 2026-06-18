// Ulice Sim — REAL-junction decision quiz (msg 3093 redesign). No driving: a short animation of a
// real, to-scale Czech junction plays out a tricky situation, freezes at the decision point, and the
// user picks the one correct action from several. The pick is revealed with the rule + § citation.
// Reuses render.js (drawScene/drawAgent), the Agent path-follower, and the shared i18n.
import { makeViewBounds, densify } from "./world.js";
import { buildScene } from "./scene.js";
import { drawScene, drawAgent } from "./render.js";
import { Agent } from "./agents.js";
import { STR, RULES, pickLang } from "./i18n.js";

const B = window.SIM_BASE || "";            // mount prefix (/quiz/situations)
const LANG = pickLang();
const T = STR[LANG];
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);
const loc = (o) => (o ? (o[LANG] || o.cs || o.en || Object.values(o)[0] || "") : "");

// accident-stats vocabulary (cs/en/ru authored; other langs fall back to cs — folded into app.json later)
const STATW = {
  cs: { real: "Reálná nehodová křižovatka", acc: "nehod", inj: "zraněných" },
  en: { real: "Real accident hot-spot", acc: "crashes", inj: "injured" },
  ru: { real: "Реальный аварийный перекрёсток", acc: "ДТП", inj: "ранены" },
};
const SW = STATW[LANG] || STATW.cs;

// show the REAL place (junction name + district) + accident-statistics badge so it's clearly a real case
function setLocationAndStats() {
  const j = scn.junction || {};
  $("hud-loc").textContent = j.name ? "📍 " + j.name + (j.district ? " · " + j.district : "") : "";
  const st = scn.stats, el = $("hud-stats");
  if (st && st.accidents) {
    el.textContent = `⚠ ${SW.real}: ${st.accidents} ${SW.acc}`
      + (st.injured ? ` · ${st.injured} ${SW.inj}` : "")
      + (st.period ? ` (${st.period})` : "");
    el.title = st.source || "";
    el.classList.remove("hidden");
  } else el.classList.add("hidden");
}

let cssW = 0, cssH = 0, view = null;
let scn = null, scene = null, actors = [], ego = null;
let order = [], curIdx = 0, total = 0, correct = 0;
let phase = "idle";                          // idle | play | decide | result
let t = 0, lastTs = 0, raf = 0, answered = false;

// ---------- canvas sizing ----------
function resize() {
  const box = canvas.parentElement.getBoundingClientRect();
  cssW = box.width; cssH = box.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (scene) { view = makeViewBounds(cssW, cssH, scene.bbox); draw(); }
}
window.addEventListener("resize", resize);

// ---------- menu ----------
async function loadMenu() {
  const list = await (await fetch(B + "/scenarios")).json();
  order = list.map((s) => s.id); total = list.length;
  const box = $("scenario-list");
  box.innerHTML = "";
  list.forEach((s, i) => {
    const b = document.createElement("button");
    b.className = "btn text-left rounded-xl border border-line bg-panel p-3 hover:border-accent/60";
    const ti = document.createElement("div"); ti.className = "font-bold text-sm"; ti.textContent = `${i + 1}. ${loc(s.title) || s.id}`;
    const h = document.createElement("div"); h.className = "text-xs text-slate-400 mt-0.5"; h.textContent = loc(s.hint);
    b.append(ti, h);
    b.onclick = () => startScenario(i);
    box.appendChild(b);
  });
}

// ---------- scenario lifecycle ----------
async function startScenario(idx) {
  curIdx = idx;
  scn = await (await fetch(`${B}/scenario/${order[idx]}`)).json();
  scene = buildScene(scn);
  view = makeViewBounds(cssW, cssH, scene.bbox);
  buildActors();
  $("menu").classList.add("hidden");
  $("feedback").classList.add("hidden");
  $("qpanel").classList.add("hidden");
  $("hud-title").textContent = loc(scn.title);
  setLocationAndStats();
  $("hud-hint").textContent = loc(scn.hint);
  $("hud-score").textContent = correct;
  $("hud-prog").textContent = `${idx + 1}/${total}`;
  answered = false; phase = "play"; t = 0; lastTs = 0;
  cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}

function buildActors() {
  actors = []; ego = null;
  for (const a of scn.actors || []) {
    const path = densify(a.path.map((p) => p.slice()), 0.4);
    const color = a.color || (a.kind === "ego" ? "#5b9cff" : a.kind === "tram" ? "#cbd5e1" : "#f59e0b");
    const ag = new Agent(path, { kind: a.kind === "ego" ? "car" : a.kind, color, cruiseV: a.v || 8 });
    ag.kindTag = a.kind; ag.spawnT = a.spawn || 0;
    ag.v = a.v || 8;                          // already in motion when the clip starts
    if (a.kind === "ego") ego = ag;
    actors.push(ag);
  }
}

// ---------- loop ----------
function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05); lastTs = ts;
  if (phase === "play") {
    t += dt;
    for (const a of actors) { a.setTarget(t >= a.spawnT ? a.cruiseV : 0); a.update(dt); }
    if (t >= (scn.decision?.t ?? 3)) { enterDecide(); return; }
    draw();
    raf = requestAnimationFrame(loop);
  }
}

function enterDecide() {
  phase = "decide";
  cancelAnimationFrame(raf);
  draw();
  // build the question panel
  $("q-prompt").textContent = loc(scn.question);
  const box = $("q-options"); box.innerHTML = "";
  (scn.options || []).forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "btn w-full text-left rounded-xl border border-line bg-panel/95 px-4 py-3 text-sm font-semibold hover:border-accent";
    btn.textContent = loc(opt.text);
    btn.dataset.i = i;
    btn.onclick = () => answer(i, btn);
    box.appendChild(btn);
  });
  $("qpanel").classList.remove("hidden");
}

function answer(i, btn) {
  if (answered) return;
  answered = true; phase = "result";
  const opt = scn.options[i];
  const good = !!opt.correct;
  if (good) correct++;
  $("hud-score").textContent = correct;
  // colour the option buttons: chosen + the actually-correct one
  document.querySelectorAll("#q-options button").forEach((b, j) => {
    b.disabled = true;
    const o = scn.options[j];
    if (o.correct) b.className = b.className.replace("border-line bg-panel/95", "border-good bg-good/15 text-good");
    else if (j === i) b.className = b.className.replace("border-line bg-panel/95", "border-bad bg-bad/15 text-bad");
  });
  showFeedback(good, opt);
}

function showFeedback(good, opt) {
  $("fb-verdict").textContent = good ? "✓ " + T.pass : "✕ " + T.fail;
  $("fb-verdict").className = "text-lg font-extrabold " + (good ? "text-good" : "text-bad");
  const ruleTxt = opt.rule && RULES[opt.rule] ? RULES[opt.rule][LANG] || "" : "";
  $("fb-rule").textContent = loc(scn.explain) || ruleTxt;
  $("fb-cite").textContent = scn.citation || (opt.rule && RULES[opt.rule] ? "" : "");
  const last = curIdx >= order.length - 1;
  $("fb-next").classList.toggle("hidden", last);
  $("fb-retry").textContent = T.retry; $("fb-next").textContent = T.next; $("fb-menu").textContent = T.menu;
  // post the attempt (best-effort)
  fetch(B + "/api/attempt", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: scn.id, ok: good, correct }),
  }).catch(() => {});
  $("feedback").classList.remove("hidden");
}

$("fb-retry").onclick = () => startScenario(curIdx);
$("fb-next").onclick = () => { if (curIdx < order.length - 1) startScenario(curIdx + 1); else showMenu(); };
$("fb-menu").onclick = showMenu;
function showMenu() {
  cancelAnimationFrame(raf); phase = "idle";
  $("feedback").classList.add("hidden"); $("qpanel").classList.add("hidden");
  $("menu").classList.remove("hidden");
}

// ---------- render ----------
function draw() {
  if (!view || !scene) return;
  ctx.clearRect(0, 0, cssW, cssH);
  drawScene(ctx, view, scene);
  for (const a of actors) { if (t >= a.spawnT - 0.001) drawAgent(ctx, view, a); }
  if ((phase === "decide" || phase === "result") && ego) drawEgoMarker();
}

// a blue pulsing ring + a downward chevron so the player knows which car is theirs (language-free)
function drawEgoMarker() {
  const x = view.sx(ego.pos[0]), y = view.sy(ego.pos[1]);
  const r = Math.max(16, view.s(4));
  ctx.save();
  ctx.strokeStyle = "#5b9cff"; ctx.lineWidth = 2.5; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#5b9cff";
  ctx.beginPath(); ctx.moveTo(x, y - r + 8); ctx.lineTo(x - 7, y - r - 4); ctx.lineTo(x + 7, y - r - 4); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// localize the static menu/feedback chrome
$("fb-retry").textContent = T.retry;
$("fb-menu").textContent = T.menu;

// ---------- debug hook ----------
window.__sim = {
  start: (i) => startScenario(i),
  answer: (i) => { const b = document.querySelector(`#q-options button[data-i="${i}"]`); if (b) b.click(); },
  get state() { return { phase, t, curIdx, correct, total, ego: ego && ego.pos, decideT: scn && scn.decision?.t }; },
};

// ---------- boot ----------
resize();
loadMenu();
