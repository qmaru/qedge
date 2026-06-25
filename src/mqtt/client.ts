import mqtt from "mqtt"
import { env } from "@/mqtt/config"
import { log } from "@/shared/utils"

let client = null as mqtt.MqttClient | null
let readyPromise: Promise<mqtt.MqttClient> | null = null

type MessageHandler = (topic: string, payload: Buffer) => void
const messageHandlers: MessageHandler[] = []

export const onMessage = (handler: MessageHandler) => {
  messageHandlers.push(handler)
}

const getClient = async () => {
  if (!readyPromise) throw new Error("MQTT not started")
  return readyPromise
}

export const publish = async (topic: string, data: any, qos: 0 | 1 | 2 = 0, retain: boolean = false) => {
  const c = await getClient()
  const payload = typeof data === "string" ? data : JSON.stringify(data)

  c.publish(topic, payload, { qos, retain }, (err) => {
    if (err) log(`publish error: ${err.message}`)
  })
}

export const startClient = () => {
  if (readyPromise) return readyPromise

  const mqtt_server = `mqtt://${env.server_host}:${env.server_port}`

  log(`qedge MQTT connected to ${mqtt_server}`)

  const clientId = env.client_id

  client = mqtt.connect(mqtt_server, {
    username: env.username,
    password: env.password,
    clientId: clientId,
    clean: env.clean_start,
    ...(env.with_tls && { protocol: "mqtts" }),
  })

  client.on("message", (topic, payload) => {
    for (const handler of messageHandlers) {
      try {
        handler(topic, payload)
      } catch (e) {
        log(`message handler error: ${(e as Error).message}`)
      }
    }
  })

  readyPromise = new Promise((resolve, reject) => {
    client!.once("connect", () => {
      const t = `${env.topic}/oc/${clientId}`
      client!.subscribe(t, { qos: env.qos })
      log(`Subscribed to topic: ${t} with QoS: ${env.qos} `)
      resolve(client!)
    })

    client!.once("error", (err) => {
      reject(err)
    })
  })

  return readyPromise
}

export const stopClient = () => {
  client?.end()
  client = null
  readyPromise = null
  log("qedge MQTT client stopped")
}
