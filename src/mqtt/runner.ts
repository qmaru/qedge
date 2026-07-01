import { debugLog } from "@/shared/utils"
import { env } from "@/mqtt/config"

import { Opencode } from "@/shared/opencode"
import { CommandBackend } from "@/mqtt/utils"

const taskPrefix = "agent-task-"

const taskId = (requestId: string): string => {
  return taskPrefix + requestId
}

export interface AgentRunner {
  start(requestId: string, prompt: string, model?: string): Promise<string>
  stop(requestId: string): Promise<string>
}

export class CommandRunner implements AgentRunner {
  constructor(
    private readonly backend: CommandBackend,
    private readonly cancelled: Set<string>,
  ) {}

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
  constructor(private readonly sessionCache: Map<string, string>) {}

  private oc = new Opencode(env.agentEndpoint, env.agentUsername, env.agentPassword)

  private eventParser = (resp: any) => {
    if (!resp || !resp.parts || !Array.isArray(resp.parts)) {
      debugLog("Invalid response format", { resp })
      return "invalid response format"
    }

    return resp.parts
      .filter(
        (part: any): part is { type: "text"; text: string } =>
          part.type === "text" && typeof part.text === "string",
      )
      .map((part: any) => part.text)
      .join("\n")
  }

  async start(requestId: string, prompt: string, model: string): Promise<string> {
    let sessionId: string | undefined

    try {
      debugLog("Create a session", { requestId })

      const tid = taskId(requestId)

      const createResp = await this.oc.sessionCreate(tid)
      if (!createResp.ok) {
        debugLog("Create session failed", { createResp })
        return `create session failed: ${createResp.status} ${createResp.statusText}`
      }

      const createData = (await createResp.json()) as { id: string }
      sessionId = createData.id
      // Store the session ID in the cache for later use when stopping the session
      this.sessionCache.set(tid, sessionId)

      debugLog("Send a sync message", { requestId, prompt, model })

      const messageResp = await this.oc.messageSend(
        sessionId,
        { parts: [{ type: "text", text: prompt }] },
        model,
      )
      if (!messageResp.ok) {
        debugLog("Send message failed", { messageResp })
        return `send message failed: ${messageResp.status} ${messageResp.statusText}`
      }

      return this.eventParser(await messageResp.json())
    } catch (error) {
      if (sessionId) {
        await this.oc.sessionDelete(sessionId)
      }
      debugLog("Error occurred", { requestId, error })
      return `error: ${error}`
    } finally {
      // Clean up the session cache after processing
      this.sessionCache.delete(taskId(requestId))
      if (sessionId) {
        await this.oc.sessionDelete(sessionId)
      }
    }
  }

  async stop(requestId: string): Promise<string> {
    if (!requestId) return "no request id provided"

    debugLog("Stopping", { requestId })

    const sid = this.sessionCache.get(taskId(requestId))
    if (!sid) {
      debugLog("No session found for request", { requestId })
      return "no session found for request"
    }

    const resp = await this.oc.sessionDelete(sid)
    if (!resp.ok) {
      const body = (await resp.json().catch(() => null)) as { data?: { message?: string } } | null
      debugLog("Stop failed", { requestId, body })
      return body?.data?.message ?? "stop failed"
    }

    return `${env.clientId} has been stopped successfully. (Request ID: ${requestId})`
  }
}
