import { describe, test, expect } from "bun:test"
import { env } from "@/mqtt/config"

import { CommandBackend } from "@/mqtt/utils"
import { CommandRunner } from "@/mqtt/runner"

const eventParser = (text: string) => {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

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

      const text = result.toText()
      const events = eventParser(text)
      expect(events.length).toBeGreaterThan(0)

      const textEvent = events.find((e) => e.type === "text")
      expect(textEvent).toBeDefined()
      console.log(textEvent!.part.text)
    },
    1000 * 600,
  )
})

describe("CommandRunner", () => {
  const test_id = `test-${Date.now()}`
  const test_prompt = "my skills"

  const cancelled = new Set<string>()
  const runner = new CommandRunner(new CommandBackend(), cancelled)

  console.log("request_id:", test_id)

  test(
    "start a agent",
    async () => {
      const result = await runner.start(test_id, test_prompt, "")
      expect(result).toBeString()

      const events = eventParser(result)
      expect(events.length).toBeGreaterThan(0)

      const textEvent = events.find((e) => e.type === "text")
      expect(textEvent).toBeDefined()
      console.log(textEvent!.part.text)
    },
    1000 * 600,
  )

  test(
    "stop a agent",
    async () => {
      const startPromise = runner.start(test_id, test_prompt, "")

      await Bun.sleep(3000)

      const stopResult = await runner.stop(test_id)
      const startResult = await startPromise

      expect(stopResult).toContain("stopped")
      expect(startResult).toBe("[cancelled]")
    },
    1000 * 600,
  )
})
