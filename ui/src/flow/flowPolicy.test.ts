import { describe, expect, it } from "vitest"
import {
  BACKOFF_STEP_MS,
  MAX_BACKOFF_MS,
  computeBackoff,
  shouldStopFlowForStatus,
} from "./flowPolicy"

describe("shouldStopFlowForStatus", () => {
  it("stops for security/payment/replay statuses", () => {
    expect(shouldStopFlowForStatus(401)).toBe(true)
    expect(shouldStopFlowForStatus(402)).toBe(true)
    expect(shouldStopFlowForStatus(409)).toBe(true)
  })

  it("does not stop for healthy status", () => {
    expect(shouldStopFlowForStatus(200)).toBe(false)
  })

  it("does not stop for throttled status", () => {
    expect(shouldStopFlowForStatus(429)).toBe(false)
  })
})

describe("computeBackoff", () => {
  it("increases backoff on 429 up to max", () => {
    const first = computeBackoff(0, 429)
    const second = computeBackoff(first, 429)

    expect(first).toBe(BACKOFF_STEP_MS)
    expect(second).toBe(BACKOFF_STEP_MS * 2)
    expect(computeBackoff(MAX_BACKOFF_MS, 429)).toBe(MAX_BACKOFF_MS)
  })

  it("decays backoff on non-429 statuses", () => {
    expect(computeBackoff(BACKOFF_STEP_MS * 2, 200)).toBe(BACKOFF_STEP_MS)
    expect(computeBackoff(BACKOFF_STEP_MS, 200)).toBe(0)
  })
})
