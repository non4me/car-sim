// Ulice Sim — REAL-junction decision quiz (msg 3093 redesign; flow per msg 3112). No driving and no menu:
// the page lands straight on the first situation, plays a short animation of a real Czech junction, freezes
// at the decision point, the user picks the one correct action, sees the rule + § citation, then advances to
// the next situation — straight through the series. A progress line of coloured dots (green=correct,
// red=wrong) + a numeric tally rides along the top.
import { makeViewBounds, densify } from "./world.js";
import { buildScene } from "./scene.js";
import { drawScene, drawAgent } from "./render.js";
import { Agent } from "./agents.js";
import { STR, RULES, pickLang } from "./i18n.js";

const B = window.SIM_BASE || "";            // mount prefix (/quiz/situations)
const LANG = pickLang();
const T = STR[LANG];
const FIN = ({ cs: "Dokončit", en: "Finish", ru: "Завершить" })[LANG] || "Dokončit";
const VIEW_RESERVE = 0.2;                    // keep the lower fifth clear for the decision panel
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

let cssW = 0, cssH = 0, view = null;
let scn = null, scene = null, actors = [], ego = null;
let order = [], curIdx = 0, total = 0, results = [];
let phase = "idle";                          // idle | play | decide | result | done
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
  if (scene) { view = makeViewBounds(cssW, cssH, scene.bbox, 0.08, VIEW_RESERVE); draw(); }
}
window.addEventListener("resize", resize);

// ---------- progress line (msg 3112) ----------
function renderProgress() {
  $("dots").innerHTML = order.map((_, i) => {
    let c = "inline-block w-3 h-3 rounded-full ";
    if (results[i] === "correct") c += "bg-good";
    else if (results[i] === "wrong") c += "bg-bad";
    else if (i === curIdx && phase !== "done") c += "bg-accent ring-2 ring-accent/30";
    else c += "bg-line";
    return `<span class="${c}" title="${i + 1}"></span>`;
  }).join("");
  const ok = results.filter((r) => r === "correct").length;
  const bad = results.filter((r) => r === "wrong").length;
  $("tally").innerHTML = `<span class="text-good">✓ ${ok}</span>&nbsp;&nbsp;<span class="text-bad">✗ ${bad}</span>`;
}

// ---------- scenario lifecycle ----------
async function startScenario(idx) {
  curIdx = idx;
  scn = await (await fetch(`${B}/scenario/${order[idx]}`)).json();
  scene = buildScene(scn);
  view = makeViewBounds(cssW, cssH, scene.bbox, 0.08, VIEW_RESERVE);
  buildActors();
  $("feedback").classList.add("hidden");
  $("qpanel").classList.add("hidden");
  $("summary").classList.add("hidden");
  $("hud-title").textContent = loc(scn.title);
  setLocationAndStats();
  $("hud-hint").textContent = loc(scn.hint);
  answered = false; phase = "play"; t = 0; lastTs = 0;
  renderProgress();
  cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}

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

function buildActors() {
  actors = []; ego = null;
  for (const a of scn.actors || []) {
    const path = densify(a.path.map((p) => p.slice()), 0.4);
    const color = a.color || (a.kind === "ego" ? "#5b9cff" : a.kind === "tram" ? "#cbd5e1" : a.kind === "ped" ? "#fbbf24" : "#f59e0b");
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
  $("q-prompt").textContent = loc(scn.question);
  const box = $("q-options"); box.innerHTML = "";
  (scn.options || []).forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "btn w-full text-left rounded-xl border border-line bg-panel/95 px-4 py-3 text-sm font-semibold hover:border-accent";
    btn.textContent = loc(opt.text);
    btn.dataset.i = i;
    btn.onclick = () => answer(i);
    box.appendChild(btn);
  });
  $("qpanel").classList.remove("hidden");
}

function answer(i) {
  if (answered) return;
  answered = true; phase = "result";
  const opt = scn.options[i];
  const good = !!opt.correct;
  results[curIdx] = good ? "correct" : "wrong";
  renderProgress();
  document.querySelectorAll("#q-options button").forEach((b, j) => {
    b.disabled = true;
    const o = scn.options[j];
    if (o.correct) b.className = b.className.replace("border-line bg-panel/95", "border-good bg-good/15 text-good");
    else if (j === i) b.className = b.className.replace("border-line bg-panel/95", "border-bad bg-bad/15 text-bad");
  });
  fetch(B + "/api/attempt", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario: scn.id, ok: good }),
  }).catch(() => {});
  showFeedback(good, opt);
}

function showFeedback(good, opt) {
  $("fb-verdict").textContent = good ? "✓ " + T.pass : "✕ " + T.fail;
  $("fb-verdict").className = "text-lg font-extrabold " + (good ? "text-good" : "text-bad");
  const ruleTxt = opt.rule && RULES[opt.rule] ? RULES[opt.rule][LANG] || "" : "";
  $("fb-rule").textContent = loc(scn.explain) || ruleTxt;
  $("fb-cite").textContent = scn.citation || "";
  $("fb-next").textContent = curIdx >= total - 1 ? FIN : T.next;
  $("feedback").classList.remove("hidden");
}

$("fb-next").onclick = () => {
  $("feedback").classList.add("hidden");
  if (curIdx < total - 1) startScenario(curIdx + 1);
  else showSummary();
};

function showSummary() {
  cancelAnimationFrame(raf); phase = "done";
  renderProgress();
  const ok = results.filter((r) => r === "correct").length;
  $("sum-title").textContent = T.finished;
  $("sum-score").textContent = `${ok} / ${total}`;
  $("sum-sub").textContent = T.score;
  $("sum-restart").textContent = "↻ " + T.retry;
  $("summary").classList.remove("hidden");
}
$("sum-restart").onclick = () => { results = new Array(total).fill(null); startScenario(0); };

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

// ---------- debug hook ----------
window.__sim = {
  start: (i) => startScenario(i),
  answer: (i) => { const b = document.querySelector(`#q-options button[data-i="${i}"]`); if (b) b.click(); },
  next: () => $("fb-next").click(),
  get state() { return { phase, t, curIdx, total, results: results.slice(), ego: ego && ego.pos }; },
};

// ---------- boot: straight into the first situation (msg 3112), no menu ----------
async function boot() {
  const list = await (await fetch(B + "/scenarios")).json();
  order = list.map((s) => s.id); total = list.length;
  results = new Array(total).fill(null);
  resize();
  renderProgress();
  if (total) startScenario(0);
}
boot();
