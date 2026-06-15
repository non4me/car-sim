// Ulice Sim — DOM/render/input wrapper around the headless Sim core (sim.js).
import { makeView, V } from "./world.js";
import { drawStatic, drawAgent } from "./render.js";
import { Sim } from "./sim.js";
import { STR, REASON, RULES, pickLang } from "./i18n.js";

const B = window.SIM_BASE || "";   // mount prefix (/quiz/situations); set by the page before this module loads
const LANG = pickLang();
const T = STR[LANG];
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);

let cssW = 0, cssH = 0, view = null;
let sim = null, scn = null, order = [], curIdx = 0;
let running = false, lastTs = 0, acc = 0, shownResult = false;

// ---------- canvas sizing ----------
function resize() {
  const box = canvas.parentElement.getBoundingClientRect();
  cssW = box.width; cssH = box.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (sim) { view = makeView(cssW, cssH, scn.world.w, scn.world.h); draw(); }
}
window.addEventListener("resize", resize);

// ---------- menu ----------
async function loadMenu() {
  const list = await (await fetch(B + "/scenarios")).json();
  order = list.map((s) => s.id);
  const box = $("scenario-list");
  box.innerHTML = "";
  list.forEach((s, i) => {
    const title = (s.title && (s.title[LANG] || s.title.cs)) || s.id;
    const hint = (s.hint && (s.hint[LANG] || s.hint.cs)) || "";
    const b = document.createElement("button");
    b.className = "btn text-left rounded-xl border border-line bg-panel p-3 hover:border-accent/60";
    const t = document.createElement("div"); t.className = "font-bold text-sm"; t.textContent = `${i + 1}. ${title}`;
    const h = document.createElement("div"); h.className = "text-xs text-slate-400 mt-0.5"; h.textContent = hint;
    b.append(t, h);
    b.onclick = () => startScenario(i);
    box.appendChild(b);
  });
}

// ---------- scenario ----------
async function startScenario(idx) {
  curIdx = idx;
  scn = await (await fetch(`${B}/scenario/${order[idx]}`)).json();
  sim = new Sim(scn);
  view = makeView(cssW, cssH, scn.world.w, scn.world.h);
  $("menu").classList.add("hidden");
  $("feedback").classList.add("hidden");
  $("hud-title").textContent = (scn.title && (scn.title[LANG] || scn.title.cs)) || "";
  $("hud-hint").textContent = (scn.hint && (scn.hint[LANG] || scn.hint.cs)) || "";
  highlightTurn();
  shownResult = false; running = true; lastTs = 0; acc = 0;
  requestAnimationFrame(loop);
}

// ---------- input ----------
function highlightTurn() {
  document.querySelectorAll("#turnbtns .ctrl").forEach((b) => {
    const on = sim && b.dataset.turn === sim.turn;
    b.classList.toggle("border-accent", on);
    b.classList.toggle("text-accent", on);
    b.classList.toggle("bg-accent/10", on);
  });
}
function setTurn(tn) { if (!sim) return; sim.setTurn(tn); highlightTurn(); draw(); }
document.querySelectorAll("#turnbtns .ctrl").forEach((b) =>
  b.addEventListener("click", () => setTurn(b.dataset.turn)));

const gas = $("gas");
gas.addEventListener("pointerdown", (e) => { e.preventDefault(); sim && sim.setGas(true); });
window.addEventListener("pointerup", () => { sim && sim.setGas(false); });
gas.addEventListener("touchstart", (e) => { e.preventDefault(); sim && sim.setGas(true); }, { passive: false });
window.addEventListener("keydown", (e) => {
  if (!sim) return;
  if (e.key === " " || e.key === "ArrowUp") { sim.setGas(true); e.preventDefault(); }
  else if (e.key === "ArrowLeft") setTurn("left");
  else if (e.key === "ArrowRight") setTurn("right");
  else if (e.key === "ArrowDown") setTurn("straight");
});
window.addEventListener("keyup", (e) => { if (sim && (e.key === " " || e.key === "ArrowUp")) sim.setGas(false); });

// ---------- render ----------
function draw() {
  if (!view || !sim) return;
  ctx.clearRect(0, 0, cssW, cssH);
  drawStatic(ctx, view, sim.jun);
  // route preview
  ctx.save();
  ctx.strokeStyle = "rgba(91,156,255,.35)"; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
  ctx.beginPath();
  sim.player.path.forEach((p, i) => i
    ? ctx.lineTo(view.sx(p[0]), view.sy(p[1])) : ctx.moveTo(view.sx(p[0]), view.sy(p[1])));
  ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  for (const a of sim.agents) drawAgent(ctx, view, a);
  for (const p of sim.peds) drawAgent(ctx, view, p);
  drawAgent(ctx, view, sim.player);
  $("hud-score").textContent = sim.score;
  $("hud-speed").textContent = sim.player.speedKmh + " km/h";
}

function loop(ts) {
  if (!lastTs) lastTs = ts;
  let frame = Math.min((ts - lastTs) / 1000, 0.05); lastTs = ts;
  if (running) {
    acc += frame;
    while (acc >= 1 / 60) { sim.step(1 / 60); acc -= 1 / 60; }
    if (sim.result && !shownResult) { running = false; shownResult = true; finish(); }
  }
  draw();
  if (running) requestAnimationFrame(loop);
}

// ---------- feedback ----------
async function finish() {
  try {
    await fetch(B + "/api/attempt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario: scn.id, ok: sim.result.ok, reason: sim.result.reason, score: sim.score }),
    });
  } catch {}
  const r = sim.result, good = r.ok;
  $("fb-verdict").textContent = good ? "✓ " + T.pass : "✕ " + T.fail;
  $("fb-verdict").className = "text-lg font-extrabold " + (good ? "text-good" : "text-bad");
  const why = REASON[LANG][r.reason] || "";
  const rk = r.agentRule && RULES[r.agentRule.ruleKey];
  $("fb-rule").textContent = (good ? "" : why + " ") + (rk ? rk[LANG] : "");
  $("fb-cite").textContent = (r.agentRule && r.agentRule.citation) || scn.citation || "";
  $("fb-next").classList.toggle("hidden", !good || curIdx >= order.length - 1);
  $("fb-retry").textContent = T.retry;
  $("fb-next").textContent = T.next;
  $("feedback").classList.remove("hidden");
}
$("fb-retry").onclick = () => startScenario(curIdx);
$("fb-next").onclick = () => { if (curIdx < order.length - 1) startScenario(curIdx + 1); else showMenu(); };
$("fb-menu").onclick = showMenu;
function showMenu() { $("feedback").classList.add("hidden"); $("menu").classList.remove("hidden"); running = false; }

// localize static labels
$("gas").textContent = T.go;
$("fb-retry").textContent = T.retry;
$("fb-menu").textContent = T.menu;

// ---------- debug hook ----------
window.__sim = {
  gas: (v) => sim && sim.setGas(v),
  turn: (tn) => setTurn(tn),
  start: (i) => startScenario(i),
  get state() { return sim ? { t: sim.t, score: sim.score, result: sim.result, ps: sim.player.s, pv: sim.player.v } : null; },
};

// ---------- boot ----------
resize();
loadMenu();
