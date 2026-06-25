export const env = {
  host: Bun.env.GATEWAY_HOST ?? "0.0.0.0",
  port: Number(Bun.env.GATEWAY_PORT ?? 3000),
}

export const routes = new Map<string, string>()

for (const [k, v] of Object.entries(Bun.env)) {
  if (!k.startsWith("GATEWAY_ROUTE_") || !v) continue
  routes.set(k.slice(14), v)
}
