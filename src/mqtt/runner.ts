import { debugLog } from "@/shared/utils"
import { env } from "@/mqtt/config"

import { Opencode } from "@/shared/opencode"
import { CommandBackend } from "@/mqtt/utils"

const taskPrefix = "agent-task-"

const taskId = (requestId: string): string => {
  return taskPrefix + requestId
}

interface ParsedEvent {
  text: string
  modelID?: string
  providerID?: string
}

export interface AgentRunner {
  start(requestId: string, prompt: string, model?: string): Promise<string>
  stop(requestId: string): Promise<string>
}

export class CommandRunner implements AgentRunner {
  constructor(private readonly backend: CommandBackend) {}

  private readonly cancelled = new Set<string>()
  private readonly startArgs = CommandRunner.parseArgs(env.agentStartArgs)
  private readonly stopArgs = CommandRunner.parseArgs(env.agentStopArgs)

  private static parseArgs(args: string): string[] {
    const trimmed = args.trim()
    return trimmed ? trimmed.split(/\s+/) : []
  }

  async start(requestId: string, prompt: string, model: string = ""): Promise<string> {
    if (!requestId || !prompt) {
      debugLog("Start invalid request", { requestId, prompt, model })
      return "invalid request"
    }

    debugLog("Running", {
      requestId,
      prompt,
      model,
      startCmd: env.agentStartCmd,
      startArgs: this.startArgs,
    })

    try {
      const res = await this.backend.run(env.agentStartCmd, [
        ...this.startArgs,
        taskId(requestId),
        prompt,
        model,
      ])

      if (this.cancelled.has(requestId)) {
        debugLog("drop cancelled start result", { requestId, res })
        return "[cancelled]"
      }

      return res.toText()
    } finally {
      this.cancelled.delete(requestId)
    }
  }

  async stop(requestId: string): Promise<string> {
    if (!requestId) return "no request id provided"

    debugLog("Stopping", { requestId, stopCmd: env.agentStopCmd, stopArgs: this.stopArgs })
    this.cancelled.add(requestId)

    const res = await this.backend.run(env.agentStopCmd, [...this.stopArgs, taskId(requestId)])

    if (!res.ok) {
      const msg = `stop failed: ${res.toText()}`
      debugLog("Stop failed", { requestId, msg, res })
      return msg
    }

    return `${env.clientId} has been stopped successfully. (Request ID: ${requestId})`
  }
}

export class APIRunner implements AgentRunner {
  private sessionCache = new Map<string, string>()
  private readonly cancelled = new Set<string>()
  private readonly controllers = new Map<string, AbortController>()

  private oc = new Opencode(env.agentEndpoint, {
    username: env.agentUsername,
    password: env.agentPassword,
  })

  private timeout = env.agentTimeout * 1000

  private eventParser = (resp: any): ParsedEvent => {
    if (!resp || !Array.isArray(resp.parts)) {
      debugLog("Invalid response format", { resp })
      return { text: "invalid response format" }
    }

    return {
      text: resp.parts
        .filter(
          (part: any): part is { type: "text"; text: string } =>
            part.type === "text" && typeof part.text === "string",
        )
        .map((part: any) => part.text)
        .join("\n"),
      modelID: resp.info?.modelID,
      providerID: resp.info?.providerID,
    }
  }

  async start(requestId: string, prompt: string, model: string): Promise<string> {
    const tid = taskId(requestId)
    let sessionId: string | undefined
    let aborted = false

    this.cancelled.delete(tid)

    const controller = new AbortController()
    this.controllers.set(tid, controller)

    try {
      debugLog("Create a session", { requestId })

      const createResp = await this.oc.createSession(tid, { signal: controller.signal })
      if (this.cancelled.has(tid)) {
        aborted = true
        return "[cancelled]"
      }

      if (!createResp.ok) {
        debugLog("Create session failed", { createResp })
        return `create session failed: ${createResp.status} ${createResp.statusText}`
      }

      const createData = (await createResp.json()) as { id: string }
      sessionId = createData.id
      this.sessionCache.set(tid, sessionId)

      debugLog("Send a sync message", { requestId, prompt, model })

      const messageResp = await this.oc.sendMessage(sessionId, [{ type: "text", text: prompt }], {
        signal: controller.signal,
        timeout: this.timeout,
        model: model,
      })
      if (this.cancelled.has(tid)) {
        aborted = true
        return "[cancelled]"
      }

      if (!messageResp.ok) {
        debugLog("Send message failed", { messageResp })
        return `send message failed: ${messageResp.status} ${messageResp.statusText}`
      }

      const resp = await messageResp.json()
      const { text, modelID, providerID } = this.eventParser(resp)
      return modelID && providerID ? `${text}\n\n[\`${providerID}/${modelID}\`]` : text
    } catch (error) {
      const err = error as Error
      if (this.cancelled.has(tid) || err.name === "AbortError") {
        aborted = true
        return "[cancelled]"
      }

      if (sessionId) {
        await this.oc.deleteSession(sessionId).catch(() => undefined)
      }
      debugLog("Error occurred", { requestId, error })
      return `error: ${error}`
    } finally {
      this.controllers.delete(tid)
      this.sessionCache.delete(tid)

      if (sessionId && !aborted) {
        await this.oc.deleteSession(sessionId).catch(() => undefined)
      }
    }
  }

  async stop(requestId: string): Promise<string> {
    if (!requestId) return "no request id provided"

    const tid = taskId(requestId)
    debugLog("Stopping", { requestId })

    this.cancelled.add(tid)

    const controller = this.controllers.get(tid)
    controller?.abort()

    const sid = this.sessionCache.get(tid)
    if (!sid) {
      debugLog("No session found for request", { requestId })
      return `${env.clientId} has been stopped successfully. (Request ID: ${requestId})`
    }

    this.sessionCache.delete(tid)

    const resp = await this.oc.deleteSession(sid).catch(() => null)
    if (!resp?.ok) {
      const body = (await resp?.json().catch(() => null)) as { data?: { message?: string } } | null
      debugLog("Stop failed", { requestId, body })
      return body?.data?.message ?? "stop failed"
    }

    return `${env.clientId} has been stopped successfully. (Request ID: ${requestId})`
  }
}
