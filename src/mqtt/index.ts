import { Command } from "commander"

const program = new Command("qedge-mqtt")
  .option(
    "--with-http",
    "also start the local HTTP test endpoint (MQTT_AGENT_HTTP_HOST / MQTT_AGENT_HTTP_PORT)",
  )
  .parse()

const { withHttp } = program.opts<{ withHttp?: boolean }>()

const main = async () => {
  const { createShutdown } = await import("@/shared/utils")
  const shutdown = createShutdown()

  if (withHttp) {
    const { startHttp } = await import("@/mqtt/http")
    const server = startHttp()
    shutdown.register(() => server.stop(true))
  }

  const { startClient, stopClient } = await import("@/mqtt/client")
  const { initMessageHandler } = await import("@/mqtt/agent")

  shutdown.register(() => {
    stopClient()
  })
  shutdown.listen()

  await startClient()
  initMessageHandler()
}

void main()
