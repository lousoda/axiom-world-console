export type EvidenceTag = "DENIAL" | "COOLDOWN" | "ADAPTATION"

export type ProofEvidenceCounters = {
  capacityDenial: number
  cooldownPenalty: number
  adaptationWanderOnce: number
}

export type BreathingEvidenceCounters = {
  idleCycles: number
  activeCycles: number
  capacityHeadroom: number
}

export type AutonomyEvidenceCounters = ProofEvidenceCounters &
  BreathingEvidenceCounters

export function zeroAutonomyEvidence(): AutonomyEvidenceCounters {
  return {
    capacityDenial: 0,
    cooldownPenalty: 0,
    adaptationWanderOnce: 0,
    idleCycles: 0,
    activeCycles: 0,
    capacityHeadroom: 0,
  }
}

function extractAppliedActions(line: string): number | null {
  const match = line.toLowerCase().match(/applied_actions=(\d+)/)
  if (!match || !match[1]) {
    return null
  }
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : null
}

function extractCapacityLeft(line: string): number | null {
  const match = line.toLowerCase().match(/capacity_left=(\d+)/)
  if (!match || !match[1]) {
    return null
  }
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : null
}

export function extractProofEvidenceFlags(line: string): ProofEvidenceCounters {
  const lowered = line.toLowerCase()
  return {
    capacityDenial:
      lowered.includes("earn denied") ||
      lowered.includes("earn_denied_capacity") ||
      lowered.includes("capacity denial streak")
        ? 1
        : 0,
    cooldownPenalty:
      lowered.includes("cooldown_penalty") ||
      lowered.includes("cooldown penalty")
        ? 1
        : 0,
    adaptationWanderOnce:
      lowered.includes("wander once") ||
      lowered.includes("recent capacity denial") ||
      lowered.includes("adaptive goal override") ||
      lowered.includes("adaptive goal restore")
        ? 1
        : 0,
  }
}

export function extractBreathingEvidenceFlags(
  line: string,
): BreathingEvidenceCounters {
  const lowered = line.toLowerCase()
  const appliedActions = extractAppliedActions(line)
  const capacityLeft = extractCapacityLeft(line)

  return {
    idleCycles:
      lowered.includes("world_idle") || appliedActions === 0
        ? 1
        : 0,
    activeCycles: appliedActions !== null && appliedActions > 0 ? 1 : 0,
    capacityHeadroom:
      capacityLeft !== null && capacityLeft >= 1
        ? 1
        : 0,
  }
}

export function extractEvidenceFlags(line: string): ProofEvidenceCounters {
  return extractProofEvidenceFlags(line)
}

export function evidenceTagsForText(line: string): EvidenceTag[] {
  const lowered = line.toLowerCase()
  const tags: EvidenceTag[] = []
  if (
    lowered.includes("earn denied") ||
    lowered.includes("earn_denied_capacity") ||
    lowered.includes("capacity denial streak")
  ) {
    tags.push("DENIAL")
  }
  if (
    lowered.includes("cooldown_penalty") ||
    lowered.includes("cooldown penalty")
  ) {
    tags.push("COOLDOWN")
  }
  if (
    lowered.includes("wander once") ||
    lowered.includes("recent capacity denial") ||
    lowered.includes("adaptive goal override") ||
    lowered.includes("adaptive goal restore")
  ) {
    tags.push("ADAPTATION")
  }
  return tags
}
