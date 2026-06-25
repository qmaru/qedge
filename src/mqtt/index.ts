import { startClient, stopClient } from "@/mqtt/client"
import { createShutdown } from "@/shared/utils"
import { initMessageHandler } from "@/mqtt/agent"

const shutdown = createShutdown()

const run = async () => {
  await startClient()
  initMessageHandler()
}

run()

shutdown.register(() => stopClient())
shutdown.listen()
