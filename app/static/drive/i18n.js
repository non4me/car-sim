// UI-string lookup for the canvas engine. The server injects window.CARSIM.i18n = {key: text} for the
// language chosen in the header (msg 3080). T(key, fallback) returns the localized string, falling back to
// the supplied default if the key is missing (e.g. an older cached page meeting a newly added string).
const DICT = (typeof window !== "undefined" && window.CARSIM && window.CARSIM.i18n) || {};

export function T(key, fallback) {
  const v = DICT[key];
  return v === undefined || v === null ? (fallback === undefined ? key : fallback) : v;
}
