export interface TextPart {
  type: "text"
  text: string
}

export interface SendMessageOptions {
  model?: string
  signal?: AbortSignal
}

export interface RequestOptions {
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

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(new URL(path, this.endpoint), {
      ...init,
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

  createSession(title?: string, options?: RequestOptions) {
    return this.request("/session", {
      method: "POST",
      body: title ? JSON.stringify({ title }) : undefined,
      signal: options?.signal,
    })
  }

  getSession(sessionId?: string, options?: RequestOptions) {
    const path = sessionId ? `/session/${encodeURIComponent(sessionId)}` : "/session"

    return this.request(path, {
      signal: options?.signal,
    })
  }

  getSessionStatus(options?: RequestOptions) {
    return this.request("/session/status", {
      signal: options?.signal,
    })
  }

  abortSession(sessionId: string, options?: RequestOptions) {
    return this.request(`/session/${encodeURIComponent(sessionId)}/abort`, {
      method: "POST",
      signal: options?.signal,
    })
  }

  deleteSession(sessionId: string, options?: RequestOptions) {
    return this.request(`/session/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      signal: options?.signal,
    })
  }

  sendMessage(sessionId: string, parts: TextPart[], options?: SendMessageOptions) {
    const body = {
      parts,
      ...(options?.model ? this.parseModel(options.model) : {}),
    }

    return this.request(`/session/${encodeURIComponent(sessionId)}/message`, {
      method: "POST",
      body: JSON.stringify(body),
      signal: options?.signal,
    })
  }

  getMessages(sessionId: string, options?: RequestOptions) {
    return this.request(`/session/${encodeURIComponent(sessionId)}/message`, {
      signal: options?.signal,
    })
  }
}
