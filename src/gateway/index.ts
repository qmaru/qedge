import { startServer, stopServer } from "@/gateway/server"
import { createShutdown } from "@/shared/utils"

const shutdown = createShutdown()

startServer()

shutdown.register(() => stopServer())
shutdown.listen()
