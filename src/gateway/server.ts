import { env } from "@/gateway/config"
import { resolve } from "@/gateway/router"
import { log } from "@/shared/utils"

let server: ReturnType<typeof Bun.serve>

export const startServer = () => {
  log(`qedge gateway running on http://${env.host}:${env.port}`)

  server = Bun.serve({
    hostname: env.host,
    port: env.port,

    async fetch(req) {
      const res = resolve(req)

      if ("error" in res) {
        return new Response(res.error, { status: res.status })
      }

      const url = new URL(req.url)
      const target = new URL(url.pathname + url.search, res.upstream)

      try {
        const resp = await fetch(target, {
          method: req.method,
          headers: req.headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
          duplex: "half",
        })

        log("proxy", { url: req.url, target: target.href, status: resp.status })
        return resp
      } catch (e) {
        log("error", { url: req.url, error: e })
        return new Response("bad gateway", { status: 502 })
      }
    },
  })

  return server
}

export const stopServer = () => {
  server?.stop(true)
  log("qedge gateway server stopped")
}
