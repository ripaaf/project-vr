// Motion: springs and damped follow, so everything in the space moves like it has a little mass
// (fast to start, soft to settle — no linear tweens).

/** A 1D spring. stiffness ~ how fast, damping ~ how much it overshoots (2·√stiffness = none). */
export class Spring {
  constructor(value = 0, { stiffness = 220, damping = 26 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }
  set(v) {
    this.value = this.target = v;
    this.velocity = 0;
  }
  step(dt) {
    // a few sub-steps keep stiff springs stable at 72 Hz
    const n = Math.max(1, Math.ceil(dt / 0.006));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  get resting() {
    return Math.abs(this.target - this.value) < 1e-4 && Math.abs(this.velocity) < 1e-3;
  }
}

/** Frame-rate independent exponential follow (for positions that track a moving target). */
export function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Same for THREE.Vector3 (in place). */
export function dampVec(v, target, lambda, dt) {
  const k = 1 - Math.exp(-lambda * dt);
  v.x += (target.x - v.x) * k;
  v.y += (target.y - v.y) * k;
  v.z += (target.z - v.z) * k;
  return v;
}

export const ease = {
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};
