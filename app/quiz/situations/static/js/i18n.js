// Simulator UI strings + rule explanations. The page now follows the language chosen in the header (msg 3083):
// index.html injects window.SIM_LANG and window.SIM_I18N = { str, reason, rules } for that language. We keep a
// Czech/English fallback inline so the sim still reads if the payload is missing (old cache / a new key), and
// expose STR/REASON/RULES in the exact shape game.js already consumes — STR[lang], REASON[lang][k],
// RULES[key][lang] — so no game logic changes.
const W = typeof window !== "undefined" ? window : {};
const LANG = W.SIM_LANG || (((W.navigator && W.navigator.language) || "cs").toLowerCase().startsWith("en") ? "en" : "cs");
const P = W.SIM_I18N || {};                       // server payload for LANG (may be empty)

const FB_STR = {
  cs: { go: "JEĎ ▶", retry: "Zkusit znovu", next: "Další ▶", menu: "← Menu",
        pass: "Správně!", fail: "Chyba", finished: "Hotovo — všechny situace!", score: "Body", play: "Hrát" },
  en: { go: "GO ▶", retry: "Try again", next: "Next ▶", menu: "← Menu",
        pass: "Correct!", fail: "Mistake", finished: "Done — all situations!", score: "Score", play: "Play" },
};
const FB_REASON = {
  cs: { collision: "Došlo ke kolizi.", no_yield: "Nedal jsi přednost.",
        ran_stop: "Nezastavil jsi úplně před značkou STOP.", ped: "Nedal jsi přednost chodci na přechodu.",
        over_cautious: "Měl jsi přednost — mohl jsi pokračovat v jízdě.", pass: "Projel jsi správně podle pravidel." },
  en: { collision: "There was a collision.", no_yield: "You failed to give way.",
        ran_stop: "You didn't come to a full stop at the STOP sign.", ped: "You didn't give way to the pedestrian on the crossing.",
        over_cautious: "You had right of way — you could have proceeded.", pass: "You drove through correctly, by the rules." },
};
const FB_RULES = {
  prednost_zprava: { cs: "Na křižovatce bez dopravních značek platí přednost zprava — dáváš přednost vozidlům přijíždějícím zprava.",
                     en: "At a junction with no signs, priority-to-the-right applies — you give way to vehicles coming from your right." },
  left_yields: { cs: "Vozidlo přijíždějící zleva ti dává přednost — na neoznačené křižovatce máš přednost ty.",
                 en: "A vehicle coming from your left must yield — at an unmarked junction you have priority." },
  give_way: { cs: "Značka „Dej přednost v jízdě“ (P4) — musíš dát přednost vozidlům na hlavní.",
              en: "“Give way” sign (P4) — you must yield to traffic on the main road." },
  stop: { cs: "Značka „Stůj, dej přednost v jízdě“ (P6) — musíš úplně zastavit a pak dát přednost.",
          en: "“Stop, give way” sign (P6) — you must come to a full stop, then give way." },
  priority_road: { cs: "Jsi na hlavní silnici — máš přednost před vozidly z vedlejších ulic.",
                   en: "You are on the priority road — you have right of way over side-road traffic." },
  tram_turning: { cs: "Odbočující tramvaj má přednost (§ 21/7) — i když jinak bys přednost měl ty.",
                  en: "A turning tram has priority (§ 21/7) — even when you would otherwise have right of way." },
  tram_straight: { cs: "Tramvaj jedoucí přímo má na neoznačené křižovatce přednost před vozidly.",
                   en: "A tram going straight has priority over vehicles at an unmarked junction." },
  tram_straight_yields: { cs: "Jsi na hlavní silnici a tramvaj jede přímo — přednost máš TY, tramvaj nemá vždy přednost (častý chyták).",
                          en: "You're on the priority road and the tram goes straight — YOU have right of way; a tram is not always priority (a common trap)." },
  pedestrian: { cs: "Chodci na přechodu (i který na něj vstupuje) musíš dát přednost — § 5/§ 54.",
                en: "You must give way to a pedestrian on (or stepping onto) the crossing — § 5/§ 54." },
};

const fbl = FB_STR[LANG] ? LANG : "en";           // built-in fallback language for any missing piece

export function pickLang() { return LANG; }

export const STR = { [LANG]: { ...FB_STR[fbl], ...(P.str || {}) } };
export const REASON = { [LANG]: { ...FB_REASON[fbl], ...(P.reason || {}) } };
export const RULES = {};
for (const k of Object.keys(FB_RULES)) {
  RULES[k] = { [LANG]: (P.rules && P.rules[k]) || FB_RULES[k][fbl] };
}
