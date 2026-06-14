// Tuned for an automatic-transmission, arcade-comfortable feel. Metres / seconds / radians.
export const PARAMS = {
  length: 4.4,          // wheelbase-ish (also draw length)
  width: 1.9,
  maxSpeed: 36,         // ~130 km/h cap (the car CAN exceed limits → warnings)
  maxReverse: 6,        // ~22 km/h
  accel: 7.5,           // forward acceleration m/s²
  brake: 12,            // foot-brake deceleration
  hardBrake: 22,        // spacebar
  drag: 3.2,            // engine/rolling brake when no throttle
  maxSteer: 0.62,       // rad at low speed (~35°)
  steerSpeedFalloff: 26, // higher → steering tightens less at speed
  steerReturn: 5.0,     // rad/s the wheel recenters when no steer input
};
