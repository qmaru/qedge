import { debugLog } from "@/shared/utils"

export interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
  toText(): string
}

export type RunPayload = Record<string, unknown> | unknown[] | string | number | boolean | null

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
  spawn(cmd: string, args: string[]) {
    return Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })
  }

  async run(cmd: string, args: string[]): Promise<RunResult> {
    const fullCmd = [cmd, ...args].join(" ")
    debugLog("Running process", { fullCmd })

    const proc = this.spawn(cmd, args)

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

export class APIBackend implements RunBackend {
  async run(endpoint: string, payload: RunPayload): Promise<RunResult> {
    debugLog("Running API request", { endpoint, payload })

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })

    const text = await response.text()

    if (!response.ok) {
      return createRunResult({
        ok: false,
        stdout: "",
        stderr: text || `API request failed: ${response.status}`,
        code: response.status,
      })
    }

    return createRunResult({ ok: true, stdout: text || "ok", stderr: "", code: response.status })
  }
}
