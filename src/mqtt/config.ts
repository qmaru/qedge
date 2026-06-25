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
  startCmd: Bun.env.MQTT_START_CMD ?? "",
  startArgs: Bun.env.MQTT_START_ARGS ?? "",
  stopCmd: Bun.env.MQTT_STOP_CMD ?? "",
  stopArgs: Bun.env.MQTT_STOP_ARGS ?? "",
}
