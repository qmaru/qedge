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
  usage?: {
    cost: number
    tokens: {
      total: number
      input: number
      output: number
      reasoning: number
      cache: {
        write: number
        read: number
      }
    }
  }
}

export interface AgentMediaInput {
  image?: string
  audio?: string
  video?: string
  file?: string
}

export interface AgentInput {
  prompt: string
  model?: string
  agent?: string
  media?: AgentMediaInput
}

export interface AgentRunner {
  start(requestId: string, input: AgentInput): Promise<string>
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

  async start(requestId: string, input: AgentInput): Promise<string> {
    const { prompt, model, agent, media } = input

    if (!requestId || !prompt.trim()) {
      debugLog("Start invalid request", { requestId, prompt, model, agent })
      return "invalid request"
    }

    if (media?.image || media?.audio || media?.video || media?.file) {
      return "media input is not supported in CommandRunner"
    }

    debugLog("Running", {
      requestId,
      prompt,
      model,
      agent,
      startCmd: env.agentStartCmd,
      startArgs: this.startArgs,
    })

    try {
      const res = await this.backend.run(env.agentStartCmd, [
        ...this.startArgs,
        taskId(requestId),
        prompt,
        model || "",
        agent || "",
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

  private formatTokens(n: number) {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  private formatUsage(usage: ParsedEvent["usage"]): string {
    return [
      `💰 ${this.formatTokens(usage?.tokens.total || 0)} tokens / $${usage?.cost.toFixed(6)}`,
      `in ${this.formatTokens(usage?.tokens.input || 0)} / out ${this.formatTokens(usage?.tokens.output || 0)} / reasoning ${this.formatTokens(usage?.tokens.reasoning || 0)}`,
      `cache read ${this.formatTokens(usage?.tokens.cache.read || 0)} / write ${this.formatTokens(usage?.tokens.cache.write || 0)}`,
    ].join("\n")
  }

  private eventParser = (resp: any): ParsedEvent => {
    if (!resp || !Array.isArray(resp.parts)) {
      debugLog("Invalid response format", { resp })
      return { text: "invalid response format" }
    }

    const text = resp.parts
      .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
      .map((part: any) => part.text)
      .join("\n")

    if (text) {
      return {
        text,
        modelID: resp.info?.modelID,
        providerID: resp.info?.providerID,
        usage: resp.info ?? {
          cost: resp.info?.cost,
          tokens: resp.info?.tokens ?? {},
        },
      }
    }

    const errorText = resp.info?.error?.message || resp.info?.error?.data?.message
    if (errorText) {
      return {
        text: errorText,
        modelID: resp.info?.modelID,
        providerID: resp.info?.providerID,
      }
    }

    debugLog("Invalid response format", { resp })
    return { text: "invalid response format" }
  }

  private getMediaInfo(media?: AgentMediaInput): { mime: string; url: string } | undefined {
    const url = media?.image || media?.audio || media?.video || media?.file
    if (!url) {
      return undefined
    }

    const match = /^data:([^;,]+)[;,]/.exec(url)
    if (!match?.[1]) {
      throw new Error("Invalid media data URL")
    }

    return { url, mime: match[1] }
  }

  async start(requestId: string, input: AgentInput): Promise<string> {
    const { prompt, model, agent, media } = input

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

      debugLog("Send a sync message", {
        requestId,
        prompt,
        model,
        agent,
        media:
          media?.image?.slice(0, 30) ||
          media?.audio?.slice(0, 30) ||
          media?.video?.slice(0, 30) ||
          media?.file?.slice(0, 30) ||
          "",
      })

      const messages = this.oc.buildMessageParts(prompt, this.getMediaInfo(media))

      const messageResp = await this.oc.sendMessage(sessionId, messages, {
        signal: controller.signal,
        timeout: this.timeout,
        model: model || "",
        agent: agent || "",
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
      debugLog("Send message succeeded", { resp })

      const { text, modelID, providerID, usage } = this.eventParser(resp)

      const usageInfo = this.formatUsage(usage)

      return modelID && providerID
        ? `${text}\n${usageInfo}\n\n[\`${providerID}/${modelID}\`]`
        : `${text}\n${usageInfo}`
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
