import { debugLog } from "@/shared/utils"
import { env } from "@/mqtt/config"

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
  toText(): string
}

export interface RunBackend {
  run(...args: any[]): Promise<RunResult>
}

const createRunResult = (result: Omit<RunResult, "toText">): RunResult => ({
  ...result,
  toText() {
    if (!this.ok) {
      return this.stderr || this.stdout || `code=${this.code}`
    }

    return this.stdout || "ok"
  },
})

export class CommandBackend implements RunBackend {
  async run(cmd: string, args: string[]): Promise<RunResult> {
    const fullCmd = [cmd, ...args].join(" ")
    debugLog("Running process", { fullCmd })

    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(env.agentTimeout * 1000),
    })

    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (code !== 0) {
      return createRunResult({ ok: false, stdout, stderr, code })
    }

    return createRunResult({ ok: true, stdout: stdout || "ok", stderr, code })
  }
}
