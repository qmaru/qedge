import { debugLog } from "@/shared/utils"
import { env } from "@/mqtt/config"
import { CommandBackend } from "@/mqtt/utils"

const taskPrefix = "agent-task-"

export interface AgentRunner {
  start(requestId: string, prompt: string, model?: string): Promise<string>
  stop(requestId: string): Promise<string>
}

export class CommandRunner implements AgentRunner {
  constructor(
    private readonly backend: CommandBackend,
    private readonly cancelled: Set<string>,
    private readonly startArgs = CommandRunner.parseArgs(env.agentStartArgs),
    private readonly stopArgs = CommandRunner.parseArgs(env.agentStopArgs),
  ) {}

  private taskId(requestId: string): string {
    return taskPrefix + requestId
  }
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

    const res = await this.backend.run(env.agentStartCmd, [
      ...this.startArgs,
      this.taskId(requestId),
      prompt,
      model,
    ])

    if (this.cancelled.has(requestId)) {
      this.cancelled.delete(requestId)
      debugLog("drop cancelled start result", { requestId, res })
      return "[cancelled]"
    }

    return res.toText()
  }

  async stop(requestId: string): Promise<string> {
    if (!requestId) return "no request id provided"

    debugLog("Stopping", { requestId, stopCmd: env.agentStopCmd, stopArgs: this.stopArgs })
    this.cancelled.add(requestId)

    const res = await this.backend.run(env.agentStopCmd, [...this.stopArgs, this.taskId(requestId)])

    if (!res.ok) {
      const msg = `stop failed: ${res.toText()}`
      debugLog("Stop failed", { requestId, msg, res })
      return msg
    }

    return `${env.clientId} has been stopped successfully. (Request ID: ${requestId})`
  }
}

export class APIRunner implements AgentRunner {
  async start(requestId: string, prompt: string, model: string): Promise<string> {
    return "start"
  }

  async stop(requestId: string): Promise<string> {
    return "stop"
  }
}
