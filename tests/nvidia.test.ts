import { describe, expect, test } from "bun:test";
import { NvidiaClient, type ChatMessage } from "../src/nvidia";

const messages: ChatMessage[] = [{ role: "user", content: "Say hello" }];

describe("NvidiaClient", () => {
  test("streams content from SSE chunks, including a final line without a newline", async () => {
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}'));
        controller.close();
      },
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });

    const client = new NvidiaClient("test-key", undefined, async () => response);
    const result: string[] = [];
    for await (const token of client.streamChat("test-model", messages)) result.push(token);
    expect(result.join("")).toBe("Hello world");
  });

  test("includes the provider's 403 error details", async () => {
    const response = new Response(JSON.stringify({ error: { message: "model access denied" } }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
    const client = new NvidiaClient("test-key", undefined, async () => response);
    let caught: unknown;
    try {
      for await (const _token of client.streamChat("test-model", messages)) { /* no-op */ }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("HTTP 403");
    expect((caught as Error).message).toContain("model access denied");
  });

  test("uses the NVIDIA chat-completions endpoint and sends the requested model", async () => {
    let requestUrl = "";
    let requestBody: Record<string, unknown> = {};
    const response = new Response('data: [DONE]\n\n', {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
    const client = new NvidiaClient("test-key", "https://integrate.api.nvidia.com/v1", async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return response;
    });
    for await (const _token of client.streamChat("nvidia/test-model", messages)) { /* no-op */ }
    expect(requestUrl).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(requestBody.model).toBe("nvidia/test-model");
    expect(requestBody.stream).toBe(true);
  });
});
