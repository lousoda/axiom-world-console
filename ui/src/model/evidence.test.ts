import { describe, expect, it } from "vitest"
import {
  evidenceTagsForText,
  extractBreathingEvidenceFlags,
  extractEvidenceFlags,
  zeroAutonomyEvidence,
} from "./evidence"

describe("extractEvidenceFlags", () => {
  it("detects denial and cooldown from explain lines", () => {
    const denial = extractEvidenceFlags(
      "tick 3: earn denied for agent 2 (reason=capacity, left=0)",
    )
    const cooldown = extractEvidenceFlags(
      "tick 3: cooldown_penalty {'agent_id': 2, 'until': 5}",
    )

    expect(denial.capacityDenial).toBe(1)
    expect(denial.cooldownPenalty).toBe(0)
    expect(cooldown.cooldownPenalty).toBe(1)
  })

  it("detects adaptation from override/restore markers", () => {
    const override = extractEvidenceFlags(
      "tick 20: adaptive goal override for agent 2 earn -> wander",
    )
    const restore = extractEvidenceFlags(
      "tick 22: adaptive goal restore for agent 2 -> earn",
    )

    expect(override.adaptationWanderOnce).toBe(1)
    expect(restore.adaptationWanderOnce).toBe(1)
  })
})

describe("evidenceTagsForText", () => {
  it("returns all matching tags for mixed forensic line", () => {
    const line =
      "tick 1: earn denied + cooldown_penalty + adaptive goal override"
    const tags = evidenceTagsForText(line)

    expect(tags).toContain("DENIAL")
    expect(tags).toContain("COOLDOWN")
    expect(tags).toContain("ADAPTATION")
  })
})

describe("extractBreathingEvidenceFlags", () => {
  it("counts idle cycle signals from world_idle and applied_actions=0", () => {
    const idleEvent = extractBreathingEvidenceFlags(
      "tick 22: world_idle {'tick': 22}",
    )
    const zeroActions = extractBreathingEvidenceFlags(
      "tick 22: tick step applied_actions=0",
    )

    expect(idleEvent.idleCycles).toBe(1)
    expect(zeroActions.idleCycles).toBe(1)
    expect(zeroActions.activeCycles).toBe(0)
  })

  it("counts active cycles and headroom from explain lines", () => {
    const active = extractBreathingEvidenceFlags(
      "tick 4: tick step applied_actions=3",
    )
    const headroom = extractBreathingEvidenceFlags(
      "tick 7: agent 1 earned 1 (balance=15, capacity_left=1)",
    )

    expect(active.activeCycles).toBe(1)
    expect(active.idleCycles).toBe(0)
    expect(headroom.capacityHeadroom).toBe(1)
  })
})

describe("zeroAutonomyEvidence", () => {
  it("returns zero values for all counters", () => {
    expect(zeroAutonomyEvidence()).toEqual({
      capacityDenial: 0,
      cooldownPenalty: 0,
      adaptationWanderOnce: 0,
      idleCycles: 0,
      activeCycles: 0,
      capacityHeadroom: 0,
    })
  })
})
