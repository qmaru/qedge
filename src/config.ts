export const env = {
  host: Bun.env.HOST ?? "0.0.0.0",
  port: Number(Bun.env.PORT ?? 3000),
  debug: Bun.env.DEBUG === "1",
}

export const routes = new Map<string, string>()

for (const [k, v] of Object.entries(Bun.env)) {
  if (!k.startsWith("ROUTE_") || !v) continue
  routes.set(k.slice(6), v)
}
