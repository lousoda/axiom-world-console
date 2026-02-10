type StateMassColor = {
  background: string
  border: string
}

export type StateMassConfig = {
  id: string
  value: number
  color: StateMassColor
}

export type StateMassRenderParams = {
  ctx: CanvasRenderingContext2D
  id: string | number
  x: number
  y: number
  state: {
    selected: boolean
    hover: boolean
  }
}

export type StateMassRenderResult = {
  drawNode: () => void
  nodeDimensions: {
    width: number
    height: number
  }
}

export type StateMassCtxRenderer = (
  params: StateMassRenderParams,
) => StateMassRenderResult

type Particle = {
  angle: number
  radial: number
  size: number
  alpha: number
  offsetX: number
  offsetY: number
  driftPhase: number
  driftSpeed: number
  driftAmplitude: number
}

const TWO_PI = Math.PI * 2

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function buildParticles(input: {
  radius: number
  count: number
  prng: () => number
}): Particle[] {
  const particles: Particle[] = []

  for (let i = 0; i < input.count; i += 1) {
    const radial = Math.pow(input.prng(), 1.78) * input.radius
    const radialNorm = radial / input.radius
    const angle = input.prng() * TWO_PI

    particles.push({
      angle,
      radial,
      size: 0.55 + input.prng() * 1.9,
      alpha: clamp(0.16 + (1 - radialNorm) * 0.72 + input.prng() * 0.08, 0.12, 0.92),
      offsetX: (input.prng() - 0.5) * input.radius * 0.16 * radialNorm,
      offsetY: (input.prng() - 0.5) * input.radius * 0.16 * radialNorm,
      driftPhase: input.prng() * TWO_PI,
      driftSpeed: 0.34 + input.prng() * 0.78,
      driftAmplitude: 0.16 + input.prng() * 0.56,
    })
  }

  return particles
}

function drawMassHalo(ctx: CanvasRenderingContext2D, radius: number, color: StateMassColor) {
  const gradient = ctx.createRadialGradient(
    -radius * 0.22,
    -radius * 0.18,
    radius * 0.1,
    0,
    0,
    radius * 1.08,
  )
  gradient.addColorStop(0, color.border)
  gradient.addColorStop(0.42, color.background)
  gradient.addColorStop(1, "rgba(7, 20, 36, 0)")

  ctx.save()
  ctx.globalAlpha = 0.32
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.ellipse(
    0,
    0,
    radius * 0.98,
    radius * 0.82,
    radius * 0.04,
    0,
    TWO_PI,
  )
  ctx.fill()
  ctx.restore()
}

function drawMassShell(
  ctx: CanvasRenderingContext2D,
  radius: number,
  seedPhase: number,
  color: StateMassColor,
) {
  ctx.save()
  ctx.globalAlpha = 0.26
  ctx.fillStyle = color.background
  ctx.beginPath()
  ctx.ellipse(
    radius * 0.04,
    -radius * 0.02,
    radius * (0.9 + Math.sin(seedPhase) * 0.06),
    radius * (0.75 + Math.cos(seedPhase) * 0.08),
    seedPhase * 0.22,
    0,
    TWO_PI,
  )
  ctx.fill()

  ctx.globalAlpha = 0.18
  ctx.beginPath()
  ctx.ellipse(
    -radius * 0.16,
    radius * 0.14,
    radius * 0.74,
    radius * 0.63,
    seedPhase * 0.17 + 0.58,
    0,
    TWO_PI,
  )
  ctx.fill()
  ctx.restore()
}

function drawMassBoundary(
  ctx: CanvasRenderingContext2D,
  radius: number,
  seedPhase: number,
  color: StateMassColor,
  selected: boolean,
  hover: boolean,
) {
  ctx.save()
  ctx.strokeStyle = color.border
  ctx.globalAlpha = selected ? 0.78 : hover ? 0.58 : 0.42
  ctx.lineWidth = selected ? 1.6 : 1
  ctx.beginPath()
  ctx.ellipse(
    radius * 0.03,
    -radius * 0.01,
    radius * (0.98 + Math.sin(seedPhase) * 0.05),
    radius * (0.81 + Math.cos(seedPhase) * 0.05),
    seedPhase * 0.2,
    0,
    TWO_PI,
  )
  ctx.stroke()
  ctx.restore()
}

export function createStateMassRenderer(config: StateMassConfig): StateMassCtxRenderer {
  const seed = hashString(config.id)
  const prng = createPrng(seed)
  const seedPhase = prng() * TWO_PI

  const baseRadius = clamp(16 + config.value * 0.66, 18, 68)
  const width = baseRadius * 2.55
  const height = baseRadius * 2.22
  const stretchX = 0.88 + prng() * 0.3
  const stretchY = 0.84 + prng() * 0.3
  const skewX = (prng() - 0.5) * baseRadius * 0.2
  const skewY = (prng() - 0.5) * baseRadius * 0.2

  const particleCount = clamp(Math.round(baseRadius * 3.4 + config.value * 2.8), 72, 220)
  const particles = buildParticles({
    radius: baseRadius,
    count: particleCount,
    prng,
  })

  return ({ ctx, x, y, state }) => ({
    nodeDimensions: {
      width,
      height,
    },
    drawNode: () => {
      const now = performance.now() * 0.001
      const radiusScale = state.selected ? 1.09 : state.hover ? 1.05 : 1
      const radius = baseRadius * radiusScale

      ctx.save()
      ctx.translate(x + skewX, y + skewY)

      drawMassHalo(ctx, radius, config.color)
      drawMassShell(ctx, radius, seedPhase, config.color)

      ctx.save()
      ctx.globalCompositeOperation = "lighter"
      ctx.fillStyle = config.color.border

      for (let i = 0; i < particles.length; i += 1) {
        const particle = particles[i]
        const driftWave = now * particle.driftSpeed + particle.driftPhase
        const driftX = Math.sin(driftWave) * particle.driftAmplitude
        const driftY = Math.cos(driftWave * 0.87 + seedPhase) * particle.driftAmplitude

        const px =
          Math.cos(particle.angle) * particle.radial * stretchX +
          particle.offsetX +
          driftX
        const py =
          Math.sin(particle.angle) * particle.radial * stretchY +
          particle.offsetY +
          driftY

        ctx.globalAlpha = particle.alpha
        ctx.fillRect(px, py, particle.size, particle.size)
      }
      ctx.restore()

      drawMassBoundary(
        ctx,
        radius,
        seedPhase,
        config.color,
        state.selected,
        state.hover,
      )
      ctx.restore()
    },
  })
}
