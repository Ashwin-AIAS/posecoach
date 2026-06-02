import { useCallback, useRef } from "react"

/** A single rep-completion particle (deliverable #10). */
export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  /** Remaining lifetime in ms (fades linearly to 0). */
  life: number
  readonly maxLife: number
  readonly color: string
  readonly radius: number
}

const PARTICLE_COUNT = 18
const PARTICLE_LIFETIME_MS = 600
const PARTICLE_RADIUS = 3
const GRAVITY_PER_FRAME = 0.2 // px/frame² (frame ≈ 1/60s)
const MIN_SPEED = 4
const MAX_SPEED = 8
const GOOD_COLOR = "#22c55e"
const OK_COLOR = "#f59e0b"
const REFERENCE_FRAME_MS = 1000 / 60 // physics tuned for 60fps frames

export interface ParticleSystem {
  /** Spawn a burst at (x, y); color depends on the form score. */
  readonly spawn: (x: number, y: number, formScore: number | null) => void
  /** Advance the simulation by `dtMs`, drop dead particles, return survivors. */
  readonly update: (dtMs: number) => readonly Particle[]
  /** Remove all particles. */
  readonly reset: () => void
}

/**
 * Minimal particle system held in a ref. Gravity and velocity are expressed in
 * px/frame at 60fps and scaled by the real frame delta so bursts look the same
 * whether the loop runs at 60 or the 30fps cap.
 */
export function useParticles(): ParticleSystem {
  const particlesRef = useRef<Particle[]>([])

  const spawn = useCallback((x: number, y: number, formScore: number | null): void => {
    const color = formScore !== null && formScore >= 80 ? GOOD_COLOR : OK_COLOR
    const burst: Particle[] = []
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED)
      burst.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: PARTICLE_LIFETIME_MS,
        maxLife: PARTICLE_LIFETIME_MS,
        color,
        radius: PARTICLE_RADIUS,
      })
    }
    particlesRef.current.push(...burst)
  }, [])

  const update = useCallback((dtMs: number): readonly Particle[] => {
    const frames = dtMs / REFERENCE_FRAME_MS
    const alive: Particle[] = []
    for (const p of particlesRef.current) {
      p.vy += GRAVITY_PER_FRAME * frames
      p.x += p.vx * frames
      p.y += p.vy * frames
      p.life -= dtMs
      if (p.life > 0) alive.push(p)
    }
    particlesRef.current = alive
    return alive
  }, [])

  const reset = useCallback((): void => {
    particlesRef.current = []
  }, [])

  return { spawn, update, reset }
}
