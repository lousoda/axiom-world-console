import react from "@vitejs/plugin-react"
import { execSync } from "node:child_process"
import type { IncomingMessage, ServerResponse } from "node:http"
import { defineConfig, type ViteDevServer } from "vite"

type ProxyRequestPayload = {
  target: string
  path: string
  method: "GET" | "POST"
  body: unknown
  gateKey: string
}

function normalizeTarget(rawTarget: string): string | null {
  const trimmed = rawTarget.trim().replace(/\/+$/, "")
  if (trimmed.length === 0) {
    return null
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null
    }
    return parsed.toString().replace(/\/+$/, "")
  } catch {
    return null
  }
}

function normalizePath(rawPath: string): string | null {
  const trimmed = rawPath.trim()
  if (!trimmed.startsWith("/")) {
    return null
  }
  return trimmed
}

function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (chunk) => {
      data += chunk
    })
    req.on("end", () => resolve(data))
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, code: number, payload: unknown) {
  res.statusCode = code
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

function detectBuildSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    }).trim()
  } catch {
    return "unknown"
  }
}

function installApiProxy(server: ViteDevServer) {
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/__proxy/request")) {
      next()
      return
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { detail: "Method not allowed" })
      return
    }

    let payload: ProxyRequestPayload
    try {
      const rawBody = await readRawBody(req)
      payload = JSON.parse(rawBody) as ProxyRequestPayload
    } catch {
      sendJson(res, 400, { detail: "Invalid JSON body" })
      return
    }

    const target = normalizeTarget(payload.target ?? "")
    const path = normalizePath(payload.path ?? "")
    const method = payload.method

    if (!target || !path) {
      sendJson(res, 400, { detail: "Invalid proxy target/path" })
      return
    }
    if (method !== "GET" && method !== "POST") {
      sendJson(res, 400, { detail: "Invalid proxy method" })
      return
    }

    const headers: Record<string, string> = {}
    const gateKey = (payload.gateKey ?? "").trim()
    if (gateKey.length > 0) {
      headers["X-World-Gate"] = gateKey
    }

    let body: string | undefined
    if (method === "POST" && payload.body != null) {
      body = JSON.stringify(payload.body)
      headers["Content-Type"] = "application/json"
    }

    try {
      const upstream = await fetch(`${target}${path}`, {
        method,
        headers,
        body,
      })

      const upstreamBody = await upstream.text()
      res.statusCode = upstream.status
      res.setHeader(
        "Content-Type",
        upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      )
      res.end(upstreamBody)
    } catch (error) {
      sendJson(res, 502, {
        detail: "Proxy upstream error",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }
  })
}

const BUILD_SHA = detectBuildSha()
const BUILD_TIME = new Date().toISOString()

export default defineConfig({
  define: {
    __APP_BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __APP_BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    {
      name: "api-dev-proxy",
      configureServer(server) {
        installApiProxy(server)
      },
    },
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/vis-network")) {
            return "graph-vendor"
          }
          if (id.includes("node_modules/react")) {
            return "react-vendor"
          }
          if (id.includes("node_modules")) {
            return "vendor"
          }
          return undefined
        },
      },
    },
  },
})
