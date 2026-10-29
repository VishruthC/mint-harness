export type NvidiaModel = {
  id: string;
  object?: string;
  owned_by?: string;
};

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};
export type FunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  };
};
export type ChatStreamEvent = { type: "content"; content: string } | { type: "tool_calls"; toolCalls: ToolCall[] };

type ModelsResponse = { data?: NvidiaModel[] };
type ChatChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{ index: number; id?: string; type?: "function"; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string; detail?: string } | string;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class NvidiaClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://integrate.api.nvidia.com/v1",
    private readonly fetchImpl: FetchLike = fetch,
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

  /** Stream a single model turn, including fragmented OpenAI-compatible function calls. */
  async *streamAgent(
    model: string,
    messages: ChatMessage[],
    tools: FunctionTool[] = [],
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const body: Record<string, unknown> = { model, messages, stream: true, temperature: 0.2 };
    if (tools.length) body.tools = tools;
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) throw await this.apiError(response, "starting chat");
    if (!response.body) throw new Error("NVIDIA response did not include a stream.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const calls = new Map<number, ToolCall>();

    const parseLine = (line: string): ChatStreamEvent[] => {
      if (!line.startsWith("data:")) return [];
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return [];
      let chunk: ChatChunk;
      try { chunk = JSON.parse(data) as ChatChunk; } catch { return []; }
      if (chunk.error) {
        const detail = typeof chunk.error === "string" ? chunk.error : chunk.error.message ?? chunk.error.detail;
        if (detail) throw new Error(`NVIDIA stream error: ${detail}`);
      }
      const delta = chunk.choices?.[0]?.delta;
      const events: ChatStreamEvent[] = [];
      // Only user-facing content is rendered. Reasoning is intentionally not surfaced as the answer.
      if (typeof delta?.content === "string" && delta.content.length) events.push({ type: "content", content: delta.content });
      for (const part of delta?.tool_calls ?? []) {
        const existing = calls.get(part.index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
        if (part.id) existing.id = part.id;
        if (part.function?.name) existing.function.name += part.function.name;
        if (part.function?.arguments) existing.function.arguments += part.function.arguments;
        calls.set(part.index, existing);
      }
      return events;
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) for (const event of parseLine(line)) yield event;
      }
      buffer += decoder.decode();
      if (buffer.trim()) for (const event of parseLine(buffer.trim())) yield event;
      const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
      if (toolCalls.length) yield { type: "tool_calls", toolCalls };
    } finally {
      reader.releaseLock();
    }
  }

  /** Backwards-compatible text-only streaming helper used by tests and simple callers. */
  async *streamChat(model: string, messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    for await (const event of this.streamAgent(model, messages, [], signal)) {
      if (event.type === "content") yield event.content;
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
          const errorDetail = typeof body.error === "string" ? body.error : body.error?.message ?? body.error?.detail;
          detail = errorDetail ?? body.message ?? body.detail ?? body.title ?? raw;
        } catch { detail = raw; }
      }
    } catch { detail = "Could not read NVIDIA's error response."; }

    detail = detail.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/nvapi-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 1000);
    const friendly = response.status === 401 || response.status === 403
      ? "NVIDIA rejected the request. Check the details below; a 403 can also indicate model or account access restrictions."
      : response.status === 429
        ? "NVIDIA rate limit or quota reached. Try again later."
        : response.status >= 500
          ? "NVIDIA's service may be temporarily unavailable."
          : "Check the endpoint, request body, and model access.";
    return new Error(`Failed ${action} (HTTP ${response.status}). ${friendly}${detail ? ` Details: ${detail}` : ""}`);
  }
}
