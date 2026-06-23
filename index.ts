const DEBUG = Bun.env.DEBUG === "1"

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log(new Date().toISOString(), ...args)
  }
}

function mask(key: string) {
  if (key.length <= 8) return key
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

function routeKey(key: string) {
  return Buffer.from(key).toString("base64url")
}

const routes = new Map<string, string>()

for (const [k, v] of Object.entries(Bun.env)) {
  if (!k.startsWith("ROUTE_") || !v) continue
  routes.set(k.slice(6), v)
}

log(
  "routes",
  [...routes.entries()].map(([k, v]) => ({
    key: k,
    upstream: v,
  })),
)

const server = Bun.serve({
  hostname: Bun.env.HOST ?? "0.0.0.0",
  port: Number(Bun.env.PORT ?? 3000),

  async fetch(req) {
    const auth = req.headers.get("authorization")

    if (!auth?.startsWith("Bearer ")) {
      log(req.method, req.url, "missing bearer token")

      return new Response("missing bearer token", {
        status: 401,
      })
    }

    const key = auth.slice(7)
    const keyId = routeKey(key)
    const upstream = routes.get(keyId)

    log(
      req.method,
      req.url,
      "key=",
      mask(key),
      "keyId=",
      keyId,
      "upstream=",
      upstream ?? "<not-found>",
    )

    if (!upstream) {
      return new Response("unknown api key", {
        status: 404,
      })
    }

    const url = new URL(req.url)
    const target = new URL(url.pathname + url.search, upstream)

    log("proxy", {
      from: req.url,
      to: target.href,
    })

    const headers = new Headers(req.headers)
    headers.delete("host")

    try {
      const resp = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
        duplex: "half",
        redirect: "manual",
      })

      log("response", target.href, resp.status, resp.statusText)

      return resp
    } catch (err) {
      console.error(new Date().toISOString(), "upstream error", target.href, err)

      return new Response("bad gateway", {
        status: 502,
      })
    }
  },
})

console.log(`qEdge listening on http://${server.hostname}:${server.port}`)

let closing = false

async function shutdown(signal: string) {
  if (closing) return
  closing = true

  console.log(new Date().toISOString(), `received ${signal}, shutting down...`)

  try {
    server.stop(true)
    await Bun.sleep(3000)
  } finally {
    console.log(new Date().toISOString(), "shutdown complete")
    process.exit(0)
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT")
})

process.on("SIGTERM", () => {
  void shutdown("SIGTERM")
})
