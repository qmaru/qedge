import { baseEnv } from "@/config"
import { env } from "@/mqtt/config"
import { CommandBackend } from "@/mqtt/utils"
import { Opencode } from "@/shared/opencode"
import { debugLog } from "@/shared/utils"

import type { PromptBody } from "@/shared/opencode"

const taskPrefix = "agent-task-"

const taskId = (requestId: string): string => {
  return taskPrefix + requestId
}

type ParsedUsage = {
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

interface ParsedEvent {
  text: string
  modelID?: string
  providerID?: string
  usage?: ParsedUsage
}

interface EventResponse {
  id?: string
  type?: string
  model?: {
    id?: string
    providerID?: string
  }
  content?: Array<{
    type?: string
    text?: string
  }>
  cost?: number
  tokens?: {
    input?: number
    output?: number
    reasoning?: number
    cache?: {
      read?: number
      write?: number
    }
  }
}

interface CommandExport {
  info?: {
    cost?: number
    tokens?: {
      input?: number
      output?: number
      reasoning?: number
      cache?: {
        read?: number
        write?: number
      }
    }
  }
  messages?: Array<{
    type?: string
    model?: {
      id?: string
      providerID?: string
    }
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n))

const formatUsage = (usage?: ParsedUsage) =>
  [
    `💰 **$${Number(usage?.cost || 0).toFixed(6)}** · **${formatTokens(usage?.tokens?.total || 0)} tokens**`,
    `**Input** ${formatTokens(usage?.tokens?.input || 0)} **Output** ${formatTokens(usage?.tokens?.output || 0)} **Reasoning** ${formatTokens(usage?.tokens?.reasoning || 0)}`,
    `**Cache RW** ${formatTokens(usage?.tokens?.cache?.read || 0)} · ${formatTokens(usage?.tokens?.cache?.write || 0)}`,
  ].join("\n\n")

const formatResult = (event: ParsedEvent) =>
  [
    event.text,
    "---",
    formatUsage(event.usage),
    event.modelID && event.providerID ? `[\`${event.providerID}/${event.modelID}\`]` : null,
  ]
    .filter(Boolean)
    .join("\n\n")

const makeUsage = (
  cost: number,
  input: number,
  output: number,
  reasoning: number,
  cacheRead: number,
  cacheWrite: number,
): ParsedUsage => ({
  cost,
  tokens: {
    total: input + output + reasoning,
    input,
    output,
    reasoning,
    cache: { read: cacheRead, write: cacheWrite },
  },
})

const parseOpencodeResult = (raw: string): ParsedEvent => {
  let data: CommandExport
  try {
    data = JSON.parse(raw) as CommandExport
  } catch {
    return { text: raw.trim() || "invalid response format" }
  }

  const assistant = data.messages?.filter((message) => message.type === "assistant").at(-1)
  const text = (assistant?.content ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n")

  const tokens = data.info?.tokens
  const usage =
    tokens &&
    makeUsage(
      data.info?.cost ?? 0,
      tokens.input ?? 0,
      tokens.output ?? 0,
      tokens.reasoning ?? 0,
      tokens.cache?.read ?? 0,
      tokens.cache?.write ?? 0,
    )

  return {
    text: text || "invalid response format",
    modelID: assistant?.model?.id,
    providerID: assistant?.model?.providerID,
    usage,
  }
}

interface PiMessage {
  role?: string
  content?: Array<{
    type?: string
    text?: string
  }>
  provider?: string
  model?: string
  usage?: {
    input?: number
    output?: number
    reasoning?: number
    cacheRead?: number
    cacheWrite?: number
    cost?: {
      total?: number
    }
  }
}

// pi --mode json prints JSONL events; the final messages are in agent_end
const parsePiResult = (raw: string): ParsedEvent => {
  const events = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type?: string; messages?: PiMessage[] })

  const message = events
    .filter((event) => event.type === "agent_end")
    .at(-1)
    ?.messages?.filter((item) => item.role === "assistant")
    .at(-1)

  const text = (message?.content ?? [])
    .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
    .join("\n")

  const usage = message?.usage
  return {
    text: text || "invalid response format",
    modelID: message?.model,
    providerID: message?.provider,
    usage:
      usage &&
      makeUsage(
        usage.cost?.total ?? 0,
        usage.input ?? 0,
        usage.output ?? 0,
        usage.reasoning ?? 0,
        usage.cacheRead ?? 0,
        usage.cacheWrite ?? 0,
      ),
  }
}

export const parseCommandResult = (raw: string): ParsedEvent =>
  env.agentEngine === "pi" ? parsePiResult(raw) : parseOpencodeResult(raw)

export interface AgentFileInput {
  // base64 data URL, e.g. data:image/png;base64,...
  data_url?: string
}

export interface AgentInput {
  prompt: string
  model?: string
  file?: AgentFileInput
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

  private async saveFile(requestId: string, file?: string): Promise<string | undefined> {
    if (!file) return undefined

    const match = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(file)
    if (!match) throw new Error("Invalid file data URL")

    const [, mime, encoding, data] = match
    const extension = mime?.split(/[/;]/)[1]?.replace(/[^a-z0-9]+/gi, "") || "bin"
    const safeRequestId = requestId.replace(/[^a-z0-9_.-]+/gi, "_")
    const outputDir = env.agentOutput.replace(/[\\/]+$/, "")
    const outputPath = `${outputDir}/${taskId(safeRequestId)}.${extension}`

    const content = encoding
      ? Uint8Array.from(atob(data ?? ""), (character) => character.charCodeAt(0))
      : decodeURIComponent(data ?? "")
    await Bun.write(outputPath, content)

    return outputPath
  }

  async start(requestId: string, input: AgentInput): Promise<string> {
    const { prompt, model, file } = input

    if (!requestId || !prompt.trim()) {
      debugLog("Start invalid request", { requestId, prompt, model })
      return "invalid request"
    }

    if (!env.agentOutput && file?.data_url) {
      return "file input is not supported in CommandRunner"
    }

    const filePath = await this.saveFile(requestId, file?.data_url)

    debugLog("Running", {
      requestId,
      prompt,
      model,
      filePath,
      startCmd: env.agentStartCmd,
      startArgs: this.startArgs,
    })

    try {
      const res = await this.backend.run(
        env.agentStartCmd,
        [
          ...this.startArgs,
          taskId(requestId),
          prompt,
          model ? `model=${model}` : "",
          filePath
            ? `${env.agentEngine === "pi" ? "image" : "file"}=/workspace/output/${filePath.split(/[\\/]/).pop()}`
            : "",
          baseEnv.debug ? "debug=true" : "",
        ].filter(Boolean),
      )

      if (this.cancelled.has(requestId)) {
        debugLog("drop cancelled start result", { requestId, res })
        return "[cancelled]"
      }

      return formatResult(parseCommandResult(res.toText()))
    } finally {
      this.cancelled.delete(requestId)
      if (filePath) {
        try {
          await Bun.file(filePath).unlink()
        } catch (error) {
          debugLog("Failed to remove file", { requestId, filePath, error })
        }
      }
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

  private eventParser = (resp: unknown): ParsedEvent => {
    const event = resp as EventResponse

    if (
      event.type !== "assistant" ||
      !event.model ||
      !Array.isArray(event.content) ||
      !event.tokens
    ) {
      debugLog("Invalid response format", { resp })
      return { text: "invalid response format" }
    }

    const text = event.content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text!)
      .join("\n")

    const tokens = event.tokens

    const usage: ParsedUsage = {
      cost: event.cost ?? 0,
      tokens: {
        total: (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0),
        input: tokens.input ?? 0,
        output: tokens.output ?? 0,
        reasoning: tokens.reasoning ?? 0,
        cache: {
          read: tokens.cache?.read ?? 0,
          write: tokens.cache?.write ?? 0,
        },
      },
    }

    if (!text) {
      debugLog("Assistant message has no text", { resp })
      return { text: "invalid response format" }
    }

    return {
      text,
      modelID: event.model.id,
      providerID: event.model.providerID,
      usage,
    }
  }

  private getFileUrl(file?: string): string | undefined {
    if (file && !/^data:[^,]*,/.test(file)) {
      throw new Error("Invalid file data URL")
    }
    return file
  }

  async start(requestId: string, input: AgentInput): Promise<string> {
    const { prompt, model, file } = input

    const tid = taskId(requestId)
    const startedAt = Date.now()
    let sessionId: string | undefined
    let aborted = false

    this.cancelled.delete(tid)

    const controller = new AbortController()
    this.controllers.set(tid, controller)

    try {
      debugLog("Create a session", {
        requestId,
        model,
        timeoutMs: this.timeout,
      })

      const promptModel = model ? this.oc.parseModel(model) : undefined

      const createResp = await this.oc.createSession(tid, promptModel, {
        signal: controller.signal,
        timeout: this.timeout,
      })

      if (this.cancelled.has(tid)) {
        aborted = true
        return "[cancelled]"
      }

      if (!createResp.ok) {
        debugLog("Create session failed", { createResp })
        return `create session failed: ${createResp.status} ${createResp.statusText}`
      }

      const createData = (await createResp.json()) as {
        data: {
          id: string
        }
      }

      sessionId = createData.data.id
      this.sessionCache.set(tid, sessionId)

      debugLog("Send a sync message", {
        requestId,
        sessionId,
        prompt,
        file: file?.data_url?.slice(0, 30) || "",
        elapsedMs: Date.now() - startedAt,
      })

      const fileUrl = this.getFileUrl(file?.data_url)

      const promptBody: PromptBody = {
        text: prompt,
        ...(fileUrl ? { files: [{ uri: fileUrl }] } : {}),
      }

      const messageResp = await this.oc.sendMessage(sessionId, promptBody, {
        signal: controller.signal,
        timeout: this.timeout,
      })

      if (this.cancelled.has(tid)) {
        aborted = true
        return "[cancelled]"
      }

      if (!messageResp.ok) {
        const body = await messageResp.text()
        debugLog("Send message failed", { messageResp, body })
        return `send message failed: ${messageResp.status} ${messageResp.statusText} ${body}`
      }

      const messageData = await messageResp.json()
      debugLog("Send message responded", {
        requestId,
        data: JSON.stringify(messageData).slice(0, 500),
        elapsedMs: Date.now() - startedAt,
      })

      const waitResp = await this.oc
        .waitSession(sessionId, {
          signal: controller.signal,
          timeout: this.timeout,
        })
        .catch(async (error: Error) => {
          // Bun drops silent connections after ~360s; retry once with the remaining budget
          if (error.name !== "TimeoutError") throw error
          debugLog("Wait session dropped, retrying", {
            requestId,
            elapsedMs: Date.now() - startedAt,
          })
          return this.oc.waitSession(sessionId!, {
            signal: controller.signal,
            timeout: this.timeout - (Date.now() - startedAt),
          })
        })

      if (this.cancelled.has(tid)) {
        aborted = true
        return "[cancelled]"
      }

      if (!waitResp.ok) {
        debugLog("Wait session failed", { waitResp })
        return `wait session failed: ${waitResp.status} ${waitResp.statusText}`
      }

      debugLog("Wait session finished", {
        requestId,
        status: waitResp.status,
        elapsedMs: Date.now() - startedAt,
      })

      const messagesResp = await this.oc.getMessages(sessionId, {
        signal: controller.signal,
        timeout: this.timeout,
      })

      if (this.cancelled.has(tid)) {
        aborted = true
        return "[cancelled]"
      }

      if (!messagesResp.ok) {
        debugLog("Get messages failed", { messagesResp })
        return `get messages failed: ${messagesResp.status} ${messagesResp.statusText}`
      }

      const messagesData = (await messagesResp.json()) as {
        data: Array<{
          id: string
          type: string
          [key: string]: unknown
        }>
        cursor: {
          previous: string | null
          next: string | null
        }
      }

      const assistantMessage = messagesData.data.find((message) => message.type === "assistant")

      debugLog("Messages fetched", {
        requestId,
        count: messagesData.data.length,
        types: messagesData.data.map((message) => message.type),
        cursor: messagesData.cursor,
        elapsedMs: Date.now() - startedAt,
      })

      if (!assistantMessage) {
        debugLog("Assistant message not found", {
          requestId,
          messages: messagesData.data,
        })

        return "error: assistant message not found"
      }

      debugLog("Send message succeeded", {
        requestId,
        messageId: assistantMessage.id,
        elapsedMs: Date.now() - startedAt,
      })

      const { text, modelID, providerID, usage } = this.eventParser(assistantMessage)

      return formatResult({
        text,
        modelID,
        providerID,
        usage,
      })
    } catch (error) {
      const err = error as Error

      if (this.cancelled.has(tid) || err.name === "AbortError") {
        debugLog("Request aborted", {
          requestId,
          name: err.name,
          cancelled: this.cancelled.has(tid),
          elapsedMs: Date.now() - startedAt,
        })
        aborted = true
        return "[cancelled]"
      }

      debugLog("Error occurred", {
        requestId,
        name: err.name,
        message: err.message,
        elapsedMs: Date.now() - startedAt,
      })

      return `error: ${err.message}`
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
