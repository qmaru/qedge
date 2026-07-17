import { onMessage, publish } from "@/mqtt/client"
import { env } from "@/mqtt/config"
import { debugLog } from "@/shared/utils"

import { CommandBackend } from "@/mqtt/utils"
import { CommandRunner, APIRunner } from "@/mqtt/runner"

import type { AgentRunner, AgentInput } from "@/mqtt/runner"

type TaskType = "start" | "cancel" | "error"

const isTaskType = (type: string): type is TaskType => type === "start" || type === "cancel"

interface Request {
  request_id: string
  type: TaskType
  input: AgentInput
  options?: {
    source_id?: string
    source_name?: string
  }
}

interface ResponseCallback {
  region: string
  source_id?: string
  source_name?: string
}

interface Response {
  type: TaskType
  request_id: string
  ok: boolean
  result: string
  callback: ResponseCallback
  toJson: () => string
}

const publishTopic = `${env.topic}/oc/result`
const { qos, retain, clientId } = env

let runner: AgentRunner
if (env.agentEndpoint === "") {
  runner = new CommandRunner(new CommandBackend())
  console.log("Using CommandRunner")
} else {
  runner = new APIRunner()
  console.log("Using APIRunner", { endpoint: env.agentEndpoint })
}

const toJson = function (this: Omit<Response, "toJson">) {
  return JSON.stringify(this)
}

const toResponse = (requestId: string, type: TaskType, ok: boolean, result: string): Response => {
  return {
    request_id: requestId,
    type,
    ok,
    result,
    callback: {
      region: clientId,
    },
    toJson,
  }
}

const errAgent = async (requestId: string) => {
  debugLog("Error task received", { requestId })
  return "error task received"
}

const handlers: Record<TaskType, (req: Request) => Promise<string>> = {
  start: ({ request_id, input }) => runner.start(request_id, input),
  cancel: ({ request_id }) => runner.stop(request_id),
  error: ({ request_id }) => errAgent(request_id),
}

export const initMessageHandler = () => {
  onMessage(async (topic, payload) => {
    const raw = payload.toString()

    debugLog("Received", { raw, topic })

    let request: Request

    try {
      request = JSON.parse(raw)
    } catch {
      const response = toResponse("", "error", false, "invalid payload")
      debugLog("Parse failed", { raw })
      await publish(publishTopic, response.toJson(), qos, retain)
      return
    }

    const { request_id, type } = request

    if (!request_id) {
      const response = toResponse("", type, false, "no request id provided")
      debugLog("Missing id", { request })
      await publish(publishTopic, response.toJson(), qos, retain)
      return
    }

    if (!isTaskType(type)) {
      const response = toResponse(request_id, type, false, "unknown task type")
      debugLog("Unknown type", { request_id, type })
      await publish(publishTopic, response.toJson(), qos, retain)
      return
    }

    try {
      const result = await handlers[type](request)
      const response = toResponse(request_id, type, true, result)

      response.callback.source_id = request.options?.source_id || ""
      response.callback.source_name = request.options?.source_name || "unknown"

      debugLog("Processed", { request_id, result })
      debugLog("Processed", { request_id, type, response })

      if (type === "start" && result === "[cancelled]") {
        debugLog("drop cancelled result", { request_id })
        return
      }

      await publish(publishTopic, response.toJson(), qos, retain)
    } catch (e) {
      const err = e as Error

      debugLog("Process crashed", { message: err.message, stack: err.stack })

      const response = toResponse(request_id, type, false, err.message)

      response.callback.source_id = request.options?.source_id || ""
      response.callback.source_name = request.options?.source_name || "unknown"

      await publish(publishTopic, JSON.stringify(response), qos, retain)
    }
  })
}
