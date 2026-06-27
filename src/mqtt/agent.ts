import { onMessage, publish } from "@/mqtt/client"
import { debugLog } from "@/shared/utils"
import { env } from "@/mqtt/config"

type TaskType = "start" | "cancel" | "error"

interface Request {
  request_id: string
  type: TaskType
  prompt: string
  model?: string
  source_id?: string
  source_name?: string
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

type ProcessResult = {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
}

const taskPrefix = "agent-task-"
const publishTopic = `${env.topic}/oc/result`
const { qos, retain, clientId } = env

const isTaskType = (type: string): type is TaskType => type === "start" || type === "cancel"

const toJson = function (this: Omit<Response, "toJson">) {
  return JSON.stringify(this)
}

const cancelled = new Set<string>()

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

const runProcess = async (cmd: string, args: string[]): Promise<ProcessResult> => {
  const fullCmd = [cmd, ...args].join(" ")
  debugLog("Running process", { fullCmd })
  const proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" })

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { stdout, stderr, code, ok: code === 0 }
}

const stopAgent = async (requestId: string) => {
  if (!requestId) return Promise.resolve("no request id provided")

  debugLog("Stopping", { requestId, stopCmd: env.stopCmd, stopArgs: env.stopArgs })
  cancelled.add(requestId)

  const res = await runProcess(env.stopCmd, [...env.stopArgs.split(" "), taskPrefix + requestId])

  if (!res.ok) {
    const msg = `stop failed: ${res.stderr || res.stdout || `code=${res.code}`}`
    debugLog("Stop failed", { requestId, msg, res })
    return msg
  }

  return `${env.clientId} has been stopped successfully. (${requestId})`
}

const startAgent = async (requestId: string, prompt: string, model: string) => {
  if (!requestId || !prompt) {
    debugLog("Start invalid request", { requestId, prompt, model })
    return "invalid request"
  }

  debugLog("Running", {
    requestId,
    prompt,
    model,
    startCmd: env.startCmd,
    startArgs: env.startArgs,
  })

  const res = await runProcess(env.startCmd, [
    ...env.startArgs.split(" "),
    taskPrefix + requestId,
    prompt,
    model,
  ])

  if (cancelled.has(requestId)) {
    debugLog("drop cancelled start result", { requestId, res })
    return "[cancelled]"
  }

  if (!res.ok) {
    const msg = `start failed: ${res.stderr || res.stdout || `code=${res.code}`}`
    debugLog("Start failed", { requestId, msg, res })
    return msg
  }

  return res.stdout || "ok"
}

const errAgent = async (requestId: string) => {
  debugLog("Error task received", { requestId })
  return "error task received"
}

const handlers: Record<TaskType, (req: Request) => Promise<string>> = {
  start: (req) => startAgent(req.request_id, req.prompt, req.model ?? ""),
  cancel: (req) => stopAgent(req.request_id),
  error: (req) => errAgent(req.request_id),
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

      response.callback.source_id = request.source_id
      response.callback.source_name = request.source_name

      debugLog("Processed", { request_id, result })
      debugLog("Processed", { request_id, type, response })

      if (type === "start" && cancelled.has(request_id) && result === "[cancelled]") {
        debugLog("drop cancelled result", { request_id })
        return
      }

      await publish(publishTopic, response.toJson(), qos, retain)
    } catch (e) {
      const err = e as Error

      debugLog("Process crashed", { message: err.message, stack: err.stack })

      const res = toResponse(request_id, type, false, err.message)
      await publish(publishTopic, JSON.stringify(res), qos, retain)
    }
  })
}
