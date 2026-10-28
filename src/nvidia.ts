export type NvidiaModel = {
  id: string;
  object?: string;
  owned_by?: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ModelsResponse = { data?: NvidiaModel[] };
type ChatChunk = {
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  error?: { message?: string; detail?: string } | string;
};

export class NvidiaClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://integrate.api.nvidia.com/v1",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async listModels(signal?: AbortSignal): Promise<NvidiaModel[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal,
    });
    if (!response.ok) throw await this.apiError(response, "listing models");
    const payload = (await response.json()) as ModelsResponse;
    return (payload.data ?? []).filter((model) => typeof model.id === "string");
  }

  async *streamChat(
    model: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.2 }),
      signal,
    });

    if (!response.ok) throw await this.apiError(response, "starting chat");
    if (!response.body) throw new Error("NVIDIA response did not include a stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const parseLine = (line: string): string | undefined => {
      if (!line.startsWith("data:")) return undefined;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return undefined;
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(data) as ChatChunk;
      } catch {
        return undefined;
      }
      if (chunk.error) {
        const detail = typeof chunk.error === "string"
          ? chunk.error
          : chunk.error.message ?? chunk.error.detail;
        if (detail) throw new Error(`NVIDIA stream error: ${detail}`);
      }
      const delta = chunk.choices?.[0]?.delta;
      const content = delta?.content ?? delta?.reasoning_content;
      return typeof content === "string" && content.length > 0 ? content : undefined;
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const content = parseLine(line);
          if (content !== undefined) yield content;
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        const content = parseLine(buffer.trim());
        if (content !== undefined) yield content;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async apiError(response: Response, action: string): Promise<Error> {
    let detail = "";
    try {
      const raw = await response.text();
      if (raw) {
        try {
          const body = JSON.parse(raw) as {
            error?: { message?: string; detail?: string } | string;
            message?: string;
            detail?: string;
            title?: string;
          };
          const errorDetail = typeof body.error === "string"
            ? body.error
            : body.error?.message ?? body.error?.detail;
          detail = errorDetail ?? body.message ?? body.detail ?? body.title ?? raw;
        } catch {
          detail = raw;
        }
      }
    } catch {
      detail = "Could not read NVIDIA's error response.";
    }

    detail = detail
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/nvapi-[A-Za-z0-9_-]+/g, "[REDACTED]")
      .slice(0, 1000);

    const friendly = response.status === 401 || response.status === 403
      ? "NVIDIA rejected the request. Check the details below; a 403 can also indicate model or account access restrictions."
      : response.status === 429
        ? "NVIDIA rate limit or quota reached. Try again later."
        : response.status >= 500
          ? "NVIDIA's service may be temporarily unavailable."
          : "Check the endpoint, request body, and model access.";

    return new Error(
      `Failed ${action} (HTTP ${response.status}). ${friendly}${detail ? ` Details: ${detail}` : ""}`,
    );
  }
}
