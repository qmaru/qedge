import { onMessage, publish } from "@/mqtt/client"
import { debugLog } from "@/shared/utils"
import { env } from "@/mqtt/config"

type taskType = "start" | "cancel"

interface Request {
  id: string
  type: taskType
  prompt: string
  timestamp?: number
}

interface Response {
  id: string
  client_id: string
  result: string
  timestamp?: number
}

const runAgent = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log("your prompt:", prompt)
      console.log("Agent finished")
      resolve(`[echo] ${prompt}`)
    }, 5000)
  })
}

const publishTopic = `${env.topic}/oc/result`
const retain = env.retain
const qos = env.qos

export function initMessageHandler() {
  onMessage(async (topic, payload) => {
    const rawMessage = payload.toString()

    debugLog("Received", "raw message", rawMessage)
    debugLog("Received", "topic:", topic)

    try {
      const request: Request = JSON.parse(rawMessage)

      if (request.type !== "start") {
        debugLog("Received", "type", "cancel a task")
        return
      }

      const result = await runAgent(request.prompt)
      const response: Response = {
        id: request.id,
        client_id: env.client_id,
        result: result,
        timestamp: Date.now(),
      }

      debugLog("Processed", "response:", response)
      const text = JSON.stringify(response)
      await publish(publishTopic, text, qos, retain)
    } catch (error) {
      console.error("message handler error:", error)
    }
  })
}
