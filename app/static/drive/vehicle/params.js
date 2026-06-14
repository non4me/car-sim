// Arcade "rotate-in-place + thrust" feel per Vlad's feedback (msg 2663/2666):
// ←/→ rotate the car on the spot; ↑ accelerates SMOOTHLY and gently; ↓ brakes
// smoothly; Space brakes sharply (minimal stopping distance). Metres / seconds / rad.
export const PARAMS = {
  length: 4.3,         // average passenger car (≈ VW Golf / Škoda Octavia class)
  width: 1.8,
  maxSpeed: 33,        // ~120 km/h ceiling (you can still speed → warnings)
  maxReverse: 5,
  accel: 2.8,          // ↑ gentle, smooth ramp (NOT punchy)
  brake: 5.5,          // ↓ smooth deceleration
  hardBrake: 30,       // Space — sharp, minimal braking distance
  drag: 1.5,           // coast when nothing pressed
  reverseAccel: 1.5,   // gentle reverse once stopped with ↓ held
  turnRate: 1.85,      // rad/s — rotate in place (works stopped or moving)
};
