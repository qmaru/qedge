import { routes } from "@/gateway/config"
import { log } from "@/shared/utils"

function mask(key: string) {
  return key.length <= 8 ? key : key.slice(0, 4) + "..." + key.slice(-4)
}

export const resolve = (req: Request) => {
  const auth = req.headers.get("authorization")

  if (!auth?.startsWith("Bearer ")) {
    return { error: "missing token", status: 401 }
  }

  const token = auth.slice(7)
  const key = Buffer.from(token).toString("base64url")
  const upstream = routes.get(key)

  log("request", {
    url: req.url,
    token: mask(token),
    key,
    upstream,
  })

  if (!upstream) {
    return { error: "unknown key", status: 404 }
  }

  return { upstream }
}
