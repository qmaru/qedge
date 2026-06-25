type Qos = 0 | 1 | 2

export const env = {
  server_host: Bun.env.MQTT_HOST ?? "127.0.0.1",
  server_port: Number(Bun.env.MQTT_PORT ?? 1883),
  username: Bun.env.MQTT_USERNAME ?? "qmaru",
  password: Bun.env.MQTT_PASSWORD ?? "123456",
  with_tls: (Bun.env.MQTT_WITH_TLS ?? "false") === "true",
  client_id: Bun.env.MQTT_CLIENT_ID ?? "qedge",
  clean_start: (Bun.env.MQTT_CLEANSTART ?? "false") === "true",
  retain: (Bun.env.MQTT_RETAIN ?? "false") === "true",
  topic: Bun.env.MQTT_TOPIC ?? "ai/agent",
  qos: Number(Bun.env.MQTT_QOS ?? 2) as Qos,
}
