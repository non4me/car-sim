// Keyboard → control state. ↑ throttle, ↓ brake, ←/→ rotate in place, Space sharp brake.
export function makeInput() {
  const keys = {};
  const map = {
    ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
    KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right", Space: "hand",
  };
  const on = (e, down) => {
    const k = map[e.code];
    if (!k) return;
    keys[k] = down;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  };
  window.addEventListener("keydown", (e) => on(e, true));
  window.addEventListener("keyup", (e) => on(e, false));
  window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

  return {
    controls() {
      return {
        throttle: keys.up ? 1 : 0,
        brake: keys.down ? 1 : 0,
        hard: !!keys.hand,
        // left rotates the car to its left (heading increases)
        turn: (keys.left ? 1 : 0) - (keys.right ? 1 : 0),
      };
    },
  };
}
