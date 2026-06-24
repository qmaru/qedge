import { env } from "@/config"
import { startServer, stopServer } from "@/server"

startServer()

console.log(`qedge running on ${env.host}:${env.port}`)

function shutdown(signal: string) {
  stopServer()
  console.log("shutdown", signal)
  process.exit(0)
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
