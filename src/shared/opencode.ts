import { debugLog } from "@/shared/utils"

export interface Model {
  id: string
  providerID: string
  variant?: string
}

export interface FilePart {
  uri: string
  name?: string
}

export interface PromptBody {
  text: string
  files?: FilePart[]
}

export interface RequestOptions {
  timeout?: number
  signal?: AbortSignal
}

export class Opencode {
  constructor(
    readonly endpoint: string,
    readonly auth?: { username: string; password: string },
  ) {}

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    if (this.auth) {
      headers.Authorization =
        "Basic " + Buffer.from(`${this.auth.username}:${this.auth.password}`).toString("base64")
    }

    return headers
  }

  private request(path: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const { timeout, signal, ...rest } = init

    return fetch(new URL(path, this.endpoint), {
      ...rest,
      signal:
        timeout != null
          ? AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])])
          : signal,
      headers: Object.assign({}, this.headers, init.headers),
    })
  }

  parseModel(model: string): Model {
    const [providerID, id, ...rest] = model.split("/")

    if (!providerID || !id || rest.length > 0) {
      throw new Error(`Invalid model: ${model}`)
    }

    return { providerID, id }
  }

  createSession(title?: string, model?: Model, options?: RequestOptions) {
    return this.request("/api/session", {
      method: "POST",
      body: JSON.stringify({
        title: title || undefined,
        model: model || undefined,
      }),
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  getSession(sessionId: string, options?: RequestOptions) {
    return this.request(`/api/session/${encodeURIComponent(sessionId)}`, {
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  listSessions(options?: RequestOptions) {
    return this.request("/api/session", {
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  interruptSession(sessionId: string, options?: RequestOptions) {
    return this.request(`/api/session/${encodeURIComponent(sessionId)}/interrupt`, {
      method: "POST",
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  deleteSession(sessionId: string, options?: RequestOptions) {
    return this.request(`/api/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  sendMessage(sessionId: string, prompt: PromptBody, options?: RequestOptions) {
    debugLog("Send body", {
      sessionId,
      body: {
        ...prompt,
        files: prompt.files?.map((file) => ({
          ...file,
          uri: file.uri.length > 100 ? `${file.uri.slice(0, 100)}...` : file.uri,
        })),
      },
    })

    return this.request(`/api/session/${encodeURIComponent(sessionId)}/prompt`, {
      method: "POST",
      body: JSON.stringify(prompt),
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  waitSession(sessionId: string, options?: RequestOptions) {
    return this.request(`/api/experimental/session/${encodeURIComponent(sessionId)}/wait`, {
      method: "POST",
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  getMessages(sessionId: string, options?: RequestOptions) {
    return this.request(`/api/session/${encodeURIComponent(sessionId)}/message`, {
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }
}
