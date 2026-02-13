export type EvidenceTag = "DENIAL" | "COOLDOWN" | "ADAPTATION"

export type AutonomyEvidenceCounters = {
  capacityDenial: number
  cooldownPenalty: number
  adaptationWanderOnce: number
}

export function extractEvidenceFlags(line: string): AutonomyEvidenceCounters {
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
