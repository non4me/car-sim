// Fixed-timestep loop: physics at 60 Hz, render once per animation frame.
export function runLoop(update, render) {
  const H = 1 / 60;
  let last = 0, acc = 0;
  function frame(ts) {
    if (!last) last = ts;
    acc += Math.min(0.05, (ts - last) / 1000);
    last = ts;
    while (acc >= H) { update(H); acc -= H; }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
