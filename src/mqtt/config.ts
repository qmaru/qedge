export type Qos = 0 | 1 | 2

export const env = {
  serverHost: Bun.env.MQTT_HOST ?? "127.0.0.1",
  serverPort: Number(Bun.env.MQTT_PORT ?? 1883),
  username: Bun.env.MQTT_USERNAME ?? "qmaru",
  password: Bun.env.MQTT_PASSWORD ?? "123456",
  withTls: (Bun.env.MQTT_WITH_TLS ?? "false") === "true",
  clientId: Bun.env.MQTT_CLIENT_ID ?? "qedge",
  cleanStart: (Bun.env.MQTT_CLEANSTART ?? "false") === "true",
  retain: (Bun.env.MQTT_RETAIN ?? "false") === "true",
  topic: Bun.env.MQTT_TOPIC ?? "ai/agent",
  qos: Number(Bun.env.MQTT_QOS ?? 2) as Qos,
  agentStartCmd: Bun.env.MQTT_AGENT_START_CMD ?? "",
  agentStartArgs: Bun.env.MQTT_AGENT_START_ARGS ?? "",
  agentStopCmd: Bun.env.MQTT_AGENT_STOP_CMD ?? "",
  agentStopArgs: Bun.env.MQTT_AGENT_STOP_ARGS ?? "",
  agentEndpoint: Bun.env.MQTT_AGENT_ENDPOINT ?? "",
  agentUsername: Bun.env.MQTT_AGENT_USERNAME ?? "",
  agentPassword: Bun.env.MQTT_AGENT_PASSWORD ?? "",
}
