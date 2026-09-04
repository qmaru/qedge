import { initMessageHandler } from "@/mqtt/agent"
import { startClient, stopClient } from "@/mqtt/client"
import { createShutdown } from "@/shared/utils"

const shutdown = createShutdown()

const run = async () => {
  await startClient()
  initMessageHandler()
}

void run()

shutdown.register(() => {
  stopClient()
})
shutdown.listen()
