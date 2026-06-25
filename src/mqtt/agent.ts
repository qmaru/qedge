import { onMessage, publish } from "@/mqtt/client"
import { debugLog, spawn } from "@/shared/utils"
import { env } from "@/mqtt/config"

type TaskType = "start" | "cancel"

interface Request {
  id: string
  type: TaskType
  prompt: string
  timestamp?: number
}

interface Response {
  id: string
  clientId: string
  result: string
  timestamp?: number
}

const publishTopic = `${env.topic}/oc/result`
const retain = env.retain
const qos = env.qos

const isTaskType = (type: string): type is TaskType => {
  return type === "start" || type === "cancel"
}

const stopAgent = async (requestId: string): Promise<string> => {
  if (!requestId) return "no request id provided"

  const args = env.stopArgs.split(" ")
  args.push(requestId)

  debugLog("Stopping", { requestId, stopCmd: env.stopCmd })
  debugLog("Stopping", { requestId, stopArgs: env.stopArgs })

  const proc = spawn(env.stopCmd, args)
  const output = await new Response(proc.stdout).text()
  await proc.exited

  return output
}

const startAgent = async (requestId: string, prompt: string): Promise<string> => {
  if (!requestId || !prompt) return "no prompt provided"
  const args = env.startArgs.split(" ")
  args.push(requestId, prompt)

  debugLog("Running", { requestId, startCmd: env.startCmd })
  debugLog("Running", { requestId, startArgs: env.startArgs })

  const proc = spawn(env.startCmd, args)
  const output = await new Response(proc.stdout).text()
  await proc.exited

  return output
}

export const initMessageHandler = () => {
  onMessage(async (topic, payload) => {
    const rawMessage = payload.toString()

    debugLog("Received", { rawMessage, topic })

    try {
      const request: Request = JSON.parse(rawMessage)
      const requestId = request.id

      debugLog("Received", { requestId, type: request.type })

      if (!requestId) {
        debugLog("Received", { requestId, error: "no request id provided" })
        return
      }

      if (!isTaskType(request.type)) {
        debugLog("Received", { requestId, error: "unknown task type" })
        return
      }

      if (request.type === "cancel") {
        await stopAgent(requestId)
        return
      }

      const result = await startAgent(requestId, request.prompt)
      const response: Response = {
        id: requestId,
        clientId: env.clientId,
        result: result,
        timestamp: Date.now(),
      }

      debugLog("Processed", { requestId, response })
      const text = JSON.stringify(response)
      await publish(publishTopic, text, qos, retain)
    } catch (e) {
      console.error("message handler error:", (e as Error).message)
    }
  })
}
