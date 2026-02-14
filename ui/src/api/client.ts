import type {
  ApiCallResult,
  AutoTickResponse,
  ExplainRecentSnapshot,
  MetricsSnapshot,
  WorldSnapshot,
} from "../types"

const MAX_BODY_PREVIEW = 500

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "")
}

function sanitizeGateKey(rawKey: string): string {
  return rawKey
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
}

function isLocalUiRuntime(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  )
}

function shouldUseDevProxy(error: unknown): boolean {
  if (!isLocalUiRuntime()) {
    return false
  }
  const text = error instanceof Error ? error.message : ""
  return (
    text.includes("Failed to fetch") ||
    text.includes("Load failed") ||
    text.includes("NetworkError")
  )
}

function shouldProxyByOrigin(baseUrl: string): boolean {
  if (!isLocalUiRuntime()) {
    return false
  }
  try {
    const targetOrigin = new URL(baseUrl).origin
    return targetOrigin !== window.location.origin
  } catch {
    return false
  }
}

function buildHeaders(gateKey: string, body?: string): HeadersInit {
  const headers: Record<string, string> = {}
  const trimmedKey = sanitizeGateKey(gateKey)
  if (trimmedKey.length > 0) {
    headers["X-World-Gate"] = trimmedKey
  }
  if (typeof body === "string") {
    headers["Content-Type"] = "application/json"
  }
  return headers
}

async function parseResponse<T>(response: Response): Promise<ApiCallResult<T>> {
  const rawText = (await response.text()).trim()
  let data: T | null = null
  if (rawText.length > 0) {
    try {
      data = JSON.parse(rawText) as T
    } catch {
      data = null
    }
  }
  return {
    status: response.status,
    data,
    rawText: rawText.slice(0, MAX_BODY_PREVIEW),
  }
}

async function directRequest<T>(
  baseUrl: string,
  gateKey: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<ApiCallResult<T>> {
  const jsonBody = body === undefined ? undefined : JSON.stringify(body)
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method,
    headers: buildHeaders(gateKey, jsonBody),
    body: jsonBody,
  })
  return parseResponse<T>(response)
}

type ProxyPayload = {
  target: string
  path: string
  method: "GET" | "POST"
  body: unknown
  gateKey: string
}

async function proxyRequest<T>(payload: ProxyPayload): Promise<ApiCallResult<T>> {
  const response = await fetch("/__proxy/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  return parseResponse<T>(response)
}

export async function requestApi<T>(
  baseUrl: string,
  gateKey: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<ApiCallResult<T>> {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  // In local UI dev, always proxy cross-origin API calls to avoid CORS/preflight failures.
  if (shouldProxyByOrigin(normalizedBaseUrl)) {
    return proxyRequest<T>({
      target: normalizedBaseUrl,
      path,
      method,
      body: body ?? null,
      gateKey,
    })
  }

  try {
    return await directRequest<T>(
      normalizedBaseUrl,
      gateKey,
      path,
      method,
      body,
    )
  } catch (error) {
    if (!shouldUseDevProxy(error)) {
      throw error
    }
    return proxyRequest<T>({
      target: normalizedBaseUrl,
      path,
      method,
      body: body ?? null,
      gateKey,
    })
  }
}

export async function probeMetrics(baseUrl: string, gateKey: string) {
  return requestApi<MetricsSnapshot>(baseUrl, gateKey, "/metrics", "GET")
}

export async function loadScenarioBasicAuto(baseUrl: string, gateKey: string) {
  return requestApi<{ ok: boolean; scenario: string }>(
    baseUrl,
    gateKey,
    "/scenario/basic_auto",
    "POST",
  )
}

export type ScenarioKey =
  | "basic_auto"
  | "autonomy_proof"
  | "autonomy_breathing"

export async function loadScenario(
  baseUrl: string,
  gateKey: string,
  scenario: ScenarioKey,
) {
  return requestApi<{ ok: boolean; scenario: string }>(
    baseUrl,
    gateKey,
    `/scenario/${scenario}`,
    "POST",
  )
}

export async function autoPulse(baseUrl: string, gateKey: string, limitAgents = 50) {
  return requestApi<AutoTickResponse>(
    baseUrl,
    gateKey,
    `/auto/tick?limit_agents=${limitAgents}`,
    "POST",
  )
}

export async function fetchWorld(baseUrl: string, gateKey: string) {
  return requestApi<WorldSnapshot>(baseUrl, gateKey, "/world", "GET")
}

export async function fetchMetrics(baseUrl: string, gateKey: string) {
  return requestApi<MetricsSnapshot>(baseUrl, gateKey, "/metrics", "GET")
}

export async function fetchLogs(baseUrl: string, gateKey: string, limit = 40) {
  return requestApi<unknown[]>(baseUrl, gateKey, `/logs?limit=${limit}`, "GET")
}

export async function fetchExplainRecent(
  baseUrl: string,
  gateKey: string,
  limit = 40,
) {
  return requestApi<ExplainRecentSnapshot>(
    baseUrl,
    gateKey,
    `/explain/recent?limit=${limit}`,
    "GET",
  )
}
