import { describe, expect, it } from "vitest"
import { evidenceTagsForText, extractEvidenceFlags } from "./evidence"

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
