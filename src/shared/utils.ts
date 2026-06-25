import { baseEnv } from "@/config"

type CleanupFn = () => void | Promise<void>

export const encodeToBase64 = (key: string) => {
  return Buffer.from(key).toString("base64url")
}

export const decodeFromBase64 = (key: string) => {
  return Buffer.from(key, "base64url").toString()
}

export const log = (...args: any[]) => {
  if (!baseEnv.debug) return
  console.log(new Date().toISOString(), ...args)
}

export function createShutdown() {
  const cleanups: CleanupFn[] = []
  let shuttingDown = false
  let listening = false

  const register = (fn: CleanupFn) => cleanups.push(fn)

  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true

    console.log(`[shutdown] ${signal}`)

    await Promise.allSettled(cleanups.map((fn) => fn()))
    process.exit(0)
  }

  const listen = () => {
    if (listening) return
    listening = true

    process.on("SIGINT", () => shutdown("SIGINT"))
    process.on("SIGTERM", () => shutdown("SIGTERM"))
  }

  return { register, shutdown, listen }
}
