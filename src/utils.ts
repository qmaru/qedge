import { env } from "@/config"

export const encodeKey = (key: string) => {
  return Buffer.from(key).toString("base64url")
}

export const decodeKey = (key: string) => {
  return Buffer.from(key, "base64url").toString()
}

export const log = (...args: any[]) => {
  if (!env.debug) return
  console.log(new Date().toISOString(), ...args)
}
