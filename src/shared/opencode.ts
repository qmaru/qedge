export interface TextPart {
  type: "text"
  text: string
}

export interface FilePart {
  type: "file"
  mime: string
  filename?: string
  url: string
}

export type MessagePart = TextPart | FilePart

export interface RequestOptions {
  timeout?: number
  signal?: AbortSignal
}

export interface SendMessageOptions extends RequestOptions {
  model?: string
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

  private async request(
    path: string,
    init: RequestInit & { timeout?: number } = {},
  ): Promise<Response> {
    const { timeout, signal, ...rest } = init

    return fetch(new URL(path, this.endpoint), {
      ...rest,
      signal:
        timeout != null
          ? AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])])
          : signal,
      headers: {
        ...this.headers,
        ...init.headers,
      },
    })
  }

  private parseModel(model: string) {
    const [providerID, modelID, ...rest] = model.split("/")

    if (!providerID || !modelID || rest.length > 0) {
      throw new Error(`Invalid model: ${model}`)
    }

    return { providerID, modelID }
  }

  buildMessageParts(prompt: string, image?: string): MessagePart[] {
    if (image === "" || image === undefined) {
      return [{ type: "text", text: prompt }]
    }

    if (prompt.trim() === "") {
      prompt = "Please describe the image."
    }

    const mime = image.slice(5, image.indexOf(";base64,"))
    if (!mime.startsWith("image/")) {
      throw new Error("Invalid image data URL")
    }

    const parts: MessagePart[] = [
      { type: "text", text: prompt },
      {
        type: "file",
        mime,
        url: image,
      },
    ]

    return parts
  }

  createSession(title?: string, options?: RequestOptions) {
    return this.request("/session", {
      method: "POST",
      body: title ? JSON.stringify({ title }) : undefined,
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  getSession(sessionId?: string, options?: RequestOptions) {
    const path = sessionId ? `/session/${encodeURIComponent(sessionId)}` : "/session"

    return this.request(path, {
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  getSessionStatus(options?: RequestOptions) {
    return this.request("/session/status", {
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  abortSession(sessionId: string, options?: RequestOptions) {
    return this.request(`/session/${encodeURIComponent(sessionId)}/abort`, {
      method: "POST",
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  deleteSession(sessionId: string, options?: RequestOptions) {
    return this.request(`/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  sendMessage(sessionId: string, parts: MessagePart[], options?: SendMessageOptions) {
    const body = {
      parts,
      ...(options?.model ? { model: this.parseModel(options.model) } : {}),
    }

    return this.request(`/session/${encodeURIComponent(sessionId)}/message`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }

  getMessages(sessionId: string, options?: RequestOptions) {
    return this.request(`/session/${encodeURIComponent(sessionId)}/message`, {
      signal: options?.signal,
      timeout: options?.timeout,
    })
  }
}
