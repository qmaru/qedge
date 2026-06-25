import { onMessage, publish } from "@/mqtt/client"
import { debugLog, spawn } from "@/shared/utils"
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

const runAgent = async (rid: string, prompt: string): Promise<string> => {
  if (!rid || !prompt) return "no prompt provided"
  debugLog("running", "request_id", rid, "prompt:", prompt)
  const args = env.start_args.split(" ")
  args.push(rid, prompt)
  debugLog("running", "start_cmd", env.start_cmd)
  debugLog("running", "start_args", env.start_args)
  const proc = spawn(env.start_cmd, args)
  const output = await new Response(proc.stdout).text()
  await proc.exited

  return output
}

const publishTopic = `${env.topic}/oc/result`
const retain = env.retain
const qos = env.qos

export const initMessageHandler = () => {
  onMessage(async (topic, payload) => {
    const rawMessage = payload.toString()

    debugLog("Received", "raw message", rawMessage)
    debugLog("Received", "topic:", topic)

    try {
      const request: Request = JSON.parse(rawMessage)
      const requestId = request.id

      if (request.type !== "start") {
        debugLog("Received", "type", "cancel a task")
        return
      }

      const result = await runAgent(requestId, request.prompt)
      debugLog("Processed", "result:", result)
      const response: Response = {
        id: requestId,
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
