import { env } from "@/gateway/config"
import { startServer, stopServer } from "@/gateway/server"
import { createShutdown } from "@/shared/utils"

const shutdown = createShutdown()

console.log(`qedge running on ${env.host}:${env.port}`)

startServer()

shutdown.register(() => stopServer())
shutdown.listen()
