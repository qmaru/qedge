import { startClient, stopClient } from "@/mqtt/client"
import { createShutdown } from "@/shared/utils"
import { initMessageHandler } from "@/mqtt/agent"

const shutdown = createShutdown()

await startClient()
initMessageHandler()

shutdown.register(() => stopClient())
shutdown.listen()
