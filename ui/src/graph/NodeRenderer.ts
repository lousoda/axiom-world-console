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
  baseX: number
  baseY: number
  size: number
  alpha: number
  phase: number
  driftSpeed: number
  driftX: number
  driftY: number
}

type Lobe = {
  x: number
  y: number
  spreadX: number
  spreadY: number
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

function gaussian(prng: () => number): number {
  // Box-Muller transform for clustered mass distributions.
  let u = 0
  let v = 0
  while (u === 0) {
    u = prng()
  }
  while (v === 0) {
    v = prng()
  }
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v)
}

function buildLobes(input: {
  prng: () => number
  baseRadius: number
  lobeCount: number
}): Lobe[] {
  const lobes: Lobe[] = []

  for (let i = 0; i < input.lobeCount; i += 1) {
    const angle = (i / input.lobeCount) * TWO_PI + (input.prng() - 0.5) * 0.95
    const distance = input.baseRadius * (0.08 + input.prng() * 0.4)

    lobes.push({
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      spreadX: input.baseRadius * (0.15 + input.prng() * 0.34),
      spreadY: input.baseRadius * (0.13 + input.prng() * 0.3),
    })
  }

  return lobes
}

function buildDustParticles(input: {
  prng: () => number
  count: number
  baseRadius: number
  stretchX: number
  stretchY: number
  lobes: Lobe[]
}): Particle[] {
  const particles: Particle[] = []

  for (let i = 0; i < input.count; i += 1) {
    const lobe = input.lobes[Math.floor(input.prng() * input.lobes.length)]
    const baseX = lobe.x + gaussian(input.prng) * lobe.spreadX
    const baseY = lobe.y + gaussian(input.prng) * lobe.spreadY
    const radialNorm = clamp(
      Math.hypot(baseX / input.stretchX, baseY / input.stretchY) /
        (input.baseRadius * 1.18),
      0,
      1,
    )

    particles.push({
      baseX,
      baseY,
      size: clamp(0.24 + (1 - radialNorm) * 0.96 + input.prng() * 0.72, 0.18, 2.2),
      alpha: clamp(0.1 + (1 - radialNorm) * 0.56 + input.prng() * 0.08, 0.05, 0.88),
      phase: input.prng() * TWO_PI,
      driftSpeed: 0.03 + input.prng() * 0.14,
      driftX: 0.03 + input.prng() * 0.16,
      driftY: 0.03 + input.prng() * 0.16,
    })
  }

  return particles
}

function buildKernelParticles(input: {
  prng: () => number
  count: number
  baseRadius: number
}): Particle[] {
  const particles: Particle[] = []

  for (let i = 0; i < input.count; i += 1) {
    const baseX = gaussian(input.prng) * input.baseRadius * 0.18
    const baseY = gaussian(input.prng) * input.baseRadius * 0.18

    particles.push({
      baseX,
      baseY,
      size: clamp(0.34 + input.prng() * 1.05, 0.24, 1.8),
      alpha: clamp(0.34 + input.prng() * 0.5, 0.2, 0.96),
      phase: input.prng() * TWO_PI,
      driftSpeed: 0.04 + input.prng() * 0.12,
      driftX: 0.02 + input.prng() * 0.1,
      driftY: 0.02 + input.prng() * 0.1,
    })
  }

  return particles
}

function drawParticles(input: {
  ctx: CanvasRenderingContext2D
  particles: Particle[]
  now: number
  seedPhase: number
  stretchX: number
  stretchY: number
  alphaScale: number
  sizeScale: number
}) {
  for (let i = 0; i < input.particles.length; i += 1) {
    const particle = input.particles[i]
    const wave = input.now * particle.driftSpeed + particle.phase
    const x = particle.baseX * input.stretchX + Math.sin(wave) * particle.driftX
    const y =
      particle.baseY * input.stretchY +
      Math.cos(wave * 0.82 + input.seedPhase) * particle.driftY

    input.ctx.globalAlpha = clamp(particle.alpha * input.alphaScale, 0.05, 0.95)
    input.ctx.beginPath()
    input.ctx.arc(x, y, Math.max(0.14, particle.size * input.sizeScale), 0, TWO_PI)
    input.ctx.fill()
  }
}

export function createStateMassRenderer(config: StateMassConfig): StateMassCtxRenderer {
  const seed = hashString(config.id)
  const prng = createPrng(seed)
  const seedPhase = prng() * TWO_PI

  const baseRadius = clamp(50 + config.value * 1.66, 62, 186)
  const width = baseRadius * 4.2
  const height = baseRadius * 4.2
  const stretchX = 0.9 + prng() * 0.2
  const stretchY = 0.88 + prng() * 0.23
  const lobeCount = 3 + (seed % 3)

  const lobes = buildLobes({
    prng,
    baseRadius,
    lobeCount,
  })

  const dustParticles = buildDustParticles({
    prng,
    count: clamp(Math.round(baseRadius * 11 + config.value * 9), 700, 3200),
    baseRadius,
    stretchX,
    stretchY,
    lobes,
  })

  const kernelParticles = buildKernelParticles({
    prng,
    count: clamp(Math.round(baseRadius * 3.8 + config.value * 4.6), 190, 980),
    baseRadius,
  })

  return ({ ctx, x, y, state }) => ({
    nodeDimensions: {
      width,
      height,
    },
    drawNode: () => {
      const now = performance.now() * 0.001
      const breath = 1 + Math.sin(now * 0.14 + seedPhase) * 0.01
      const scale = state.selected ? 1.06 : state.hover ? 1.03 : 1
      const renderStretchX = stretchX * scale * breath
      const renderStretchY = stretchY * scale * breath

      ctx.save()
      ctx.translate(x, y)

      const fogRadius = baseRadius * (1.24 + (state.selected ? 0.08 : 0))
      const fog = ctx.createRadialGradient(0, 0, 0, 0, 0, fogRadius)
      fog.addColorStop(0, config.color.background)
      fog.addColorStop(1, "rgba(0,0,0,0)")
      ctx.fillStyle = fog
      ctx.globalAlpha = state.selected ? 0.24 : 0.18
      ctx.beginPath()
      ctx.arc(0, 0, fogRadius, 0, TWO_PI)
      ctx.fill()

      ctx.save()
      ctx.globalCompositeOperation = "screen"
      ctx.fillStyle = config.color.border
      drawParticles({
        ctx,
        particles: dustParticles,
        now,
        seedPhase,
        stretchX: renderStretchX,
        stretchY: renderStretchY,
        alphaScale: state.selected ? 0.96 : 0.84,
        sizeScale: state.selected ? 1.08 : 1,
      })
      ctx.restore()

      ctx.save()
      ctx.globalCompositeOperation = "lighter"
      ctx.fillStyle = "rgba(236, 246, 255, 1)"
      drawParticles({
        ctx,
        particles: kernelParticles,
        now,
        seedPhase,
        stretchX: renderStretchX * 0.92,
        stretchY: renderStretchY * 0.9,
        alphaScale: state.selected ? 0.9 : 0.74,
        sizeScale: state.selected ? 1.08 : 1,
      })
      ctx.restore()

      ctx.restore()
    },
  })
}
