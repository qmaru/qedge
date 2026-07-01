import { describe, test, expect } from "bun:test"
import { env } from "@/mqtt/config"
import { CommandRun } from "@/mqtt/utils"

describe("CommandRun", () => {
  const test_id = `test-${Date.now()}`
  const test_prompt = "my skills"

  console.log("request_id:", test_id)

  test(
    "start a agent",
    async () => {
      expect(env.agentStartCmd).toBeTruthy()

      const args = [...env.agentStartArgs.trim().split(/\s+/), test_id, test_prompt]

      const runner = new CommandRun()
      const result = await runner.run(env.agentStartCmd, args)

      expect(result.ok).toBeBoolean()
      expect(result.stdout).toBeString()
      expect(result.stderr).toBeString()
      expect(result.code).toBeNumber()

      const text = result.toText()
      const events = text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))

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
      const runner = new CommandRun()

      runner.spawn(env.agentStartCmd, [...env.agentStartArgs.trim().split(/\s+/), test_id, test_prompt])
      console.log("start finished")
      await Bun.sleep(5_000)

      const stopArgs = [...env.agentStopArgs.trim().split(/\s+/), test_id]
      const result = await runner.run(env.agentStopCmd, stopArgs)

      expect(result.ok).toBeBoolean()
      expect(result.stdout).toBeString()
      expect(result.stderr).toBeString()
      expect(result.code).toBeNumber()

      const text = result.toText()
      console.log(text)
    },
    1000 * 600,
  )
})
