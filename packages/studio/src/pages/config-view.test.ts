import { describe, expect, it, vi } from "vitest";
import { saveProjectConfig } from "./ConfigView";

type PutApiLike = <T>(path: string, body?: unknown) => Promise<T>;

describe("saveProjectConfig", () => {
  it("persists project settings through putApi so project listeners invalidate immediately", async () => {
    const putApiMock = vi.fn(async () => undefined);
    const draft = {
      provider: "codex-cli",
      model: "gpt-5.4",
      baseUrl: "",
      language: "en",
      temperature: 0.2,
      maxTokens: 2048,
      stream: true,
    };

    await saveProjectConfig(draft, { putApiImpl: putApiMock as PutApiLike });

    expect(putApiMock).toHaveBeenCalledWith("/project", draft);
  });
});
