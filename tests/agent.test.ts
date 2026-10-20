import { describe, test, expect } from "bun:test"

import { env } from "@/mqtt/config"
import { CommandRunner, APIRunner } from "@/mqtt/runner"
import { CommandBackend } from "@/mqtt/utils"

describe("CommandBackend", () => {
  const test_id = `test-${Date.now()}`
  const test_prompt = "my skills"

  test(
    "run a command",
    async () => {
      const runner = new CommandBackend()
      const result = await runner.run(env.agentStartCmd, [
        ...env.agentStartArgs.trim().split(/\s+/),
        test_id,
        test_prompt,
      ])

      expect(result.ok).toBeBoolean()
      expect(result.stdout).toBeString()
      expect(result.stderr).toBeString()
      expect(result.code).toBeNumber()

      const data = JSON.parse(result.toText()) as { messages?: unknown[] }
      expect(data.messages?.length).toBeGreaterThan(0)
    },
    1000 * 600,
  )
})

describe("CommandRunner", () => {
  const test_id = `test-${Date.now()}`
  const test_prompt = "my skills"

  const runner = new CommandRunner(new CommandBackend())

  console.log("request_id:", test_id)

  test(
    "start a agent",
    async () => {
      const result = await runner.start(test_id, { prompt: test_prompt })
      expect(result).toBeString()
      expect(result).not.toContain("invalid response format")
      console.log(result)
    },
    1000 * 600,
  )

  test(
    "stop a agent",
    async () => {
      const startPromise = runner.start(test_id, { prompt: test_prompt })

      await Bun.sleep(3000)

      const stopResult = await runner.stop(test_id)
      const startResult = await startPromise

      expect(stopResult).toContain("stopped")
      expect(startResult).toBe("[cancelled]")
    },
    1000 * 600,
  )
})

describe("APIRunner", () => {
  const test_id = `test-${Date.now()}`
  const test_prompt = "my skills"

  const runner = new APIRunner()

  console.log("request_id:", test_id)

  test(
    "start a agent",
    async () => {
      const result = await runner.start(test_id, { prompt: test_prompt })
      expect(result).toBeString()
      console.log(result)
    },
    1000 * 600,
  )
})
