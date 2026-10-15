import { handleRequest } from "@/mqtt/agent"
import { env } from "@/mqtt/config"

export const startHttp = () => {
  const server = Bun.serve({
    hostname: env.agentHTTPHost,
    port: env.agentHTTPPort,
    async fetch(req) {
      const response = await handleRequest(await req.text())
      return new Response(response.toJson(), {
        headers: { "content-type": "application/json" },
      })
    },
  })

  console.log(`qedge MQTT HTTP endpoint running on http://${server.hostname}:${server.port}`)
  return server
}

if (import.meta.main) {
  startHttp()
}
