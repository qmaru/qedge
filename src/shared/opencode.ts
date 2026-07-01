export interface MessageTextPart {
  type: "text"
  text: string
}

export interface Message {
  parts: MessageTextPart[]
}

export class Opencode {
  constructor(
    private readonly endpoint: string,
    private readonly username?: string,
    private readonly password?: string,
  ) {}

  private authHeader() {
    if (!this.username || !this.password) return undefined
    const token = Buffer.from(`${this.username}:${this.password}`).toString("base64")
    return `Basic ${token}`
  }

  private headers = {
    "Content-Type": "application/json",
    ...(this.authHeader() ? { Authorization: this.authHeader() } : {}),
  }

  private getModel(model: string) {
    const parts = model.split("/")

    if (parts.length !== 2) {
      throw new Error(`Invalid model: ${model}`)
    }

    const [providerID, modelID] = parts

    if (!providerID || !modelID) {
      throw new Error(`Invalid model: ${model}`)
    }

    return { providerID, modelID }
  }

  async sessionCreate(title?: string) {
    return await fetch(`${this.endpoint}/session`, {
      method: "POST",
      headers: this.headers,
      body: title ? JSON.stringify({ title }) : undefined,
    })
  }

  async sessionGet(sid?: string) {
    const url = sid
      ? `${this.endpoint}/session/${encodeURIComponent(sid)}`
      : `${this.endpoint}/session`

    return fetch(url, {
      method: "GET",
      headers: this.headers,
    })
  }

  async sessionStatus() {
    return await fetch(`${this.endpoint}/session/status`, {
      method: "GET",
      headers: this.headers,
    })
  }

  async sessionAbort(sid: string) {
    return await fetch(`${this.endpoint}/session/${sid}/abort`, {
      method: "POST",
      headers: this.headers,
    })
  }

  async sessionDelete(sid: string) {
    return await fetch(`${this.endpoint}/session/${sid}`, {
      method: "DELETE",
      headers: this.headers,
    })
  }

  async messageSend(sid: string, message: Message, model: string = "") {
    const body = {
      parts: message.parts,
      ...(model ? this.getModel(model) : {}),
    }
    return await fetch(`${this.endpoint}/session/${sid}/message`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    })
  }

  async messageGet(sid: string) {
    return await fetch(`${this.endpoint}/session/${sid}/message`, {
      method: "GET",
      headers: this.headers,
    })
  }
}
