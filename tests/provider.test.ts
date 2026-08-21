/// <reference types="jest" />

import * as vscode from "vscode";

import { ZaiChatModelProvider } from "../src/provider";
import { secrets } from "../__mocks__/vscode";

function createDoneStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n"));
      controller.close();
    },
  });
}

function createToken(): vscode.CancellationToken {
  return {
    isCancellationRequested: false,
    onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
  } as unknown as vscode.CancellationToken;
}

describe("ZaiChatModelProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (secrets.get as jest.Mock).mockResolvedValue("test-api-key");
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: createDoneStream(),
    });
  });

  it("should expose the full context window as maxInputTokens", async () => {
    const provider = new ZaiChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent"
    );

    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken()
    );

    const glm47 = models.find((m) => m.id === "glm-4.7");
    expect(glm47).toBeDefined();
    expect(glm47?.maxInputTokens).toBe(202752 - Math.min(65535, 65536));
    expect(glm47?.maxOutputTokens).toBe(65535);
  });

  it("should allow prompts larger than the old reserved-output cap", async () => {
    const provider = new ZaiChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent"
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken()
    );
    const glm5 = models.find((m) => m.id === "glm-5");
    if (!glm5) {
      throw new Error("glm-5 not found");
    }

    const largePrompt = "a".repeat(72000 * 4);
    const messages = [vscode.LanguageModelChatMessage.User(largePrompt)];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    await expect(
      provider.provideLanguageModelChatResponse(
        glm5,
        messages,
        {},
        progress,
        createToken()
      )
    ).resolves.toBeUndefined();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("should use the official default max_tokens when not specified", async () => {
    const provider = new ZaiChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent"
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken()
    );
    const glm47 = models.find((m) => m.id === "glm-4.7");
    if (!glm47) {
      throw new Error("glm-4.7 not found");
    }

    const messages = [vscode.LanguageModelChatMessage.User("hello")];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    await provider.provideLanguageModelChatResponse(
      glm47,
      messages,
      {},
      progress,
      createToken()
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const requestInit = (global.fetch as jest.Mock).mock.calls[0]?.[1] as {
      body?: string;
    };
    expect(requestInit.body).toBeDefined();
    const requestBody = JSON.parse(requestInit.body ?? "{}");
    expect(requestBody.max_tokens).toBe(65535);
  });

  it("should reject prompts that exceed the documented context window", async () => {
    const provider = new ZaiChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent"
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken()
    );
    const glm5 = models.find((m) => m.id === "glm-5");
    if (!glm5) {
      throw new Error("glm-5 not found");
    }

    const tooLargePrompt = "a".repeat(202753 * 4);
    const messages = [vscode.LanguageModelChatMessage.User(tooLargePrompt)];
    const progress = {
      report: jest.fn(),
    } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;

    await expect(
      provider.provideLanguageModelChatResponse(
        glm5,
        messages,
        {},
        progress,
        createToken()
      )
    ).rejects.toThrow("Message exceeds token limit.");

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should count tokens for text data parts in provideTokenCount", async () => {
    const provider = new ZaiChatModelProvider(
      secrets as unknown as vscode.SecretStorage,
      "jest-agent"
    );
    const models = await provider.provideLanguageModelChatInformation(
      { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
      createToken()
    );
    const glm5 = models.find((m) => m.id === "glm-5");
    if (!glm5) {
      throw new Error("glm-5 not found");
    }

    const text = "text from LanguageModelDataPart";
    const message = vscode.LanguageModelChatMessage.User([
      vscode.LanguageModelDataPart.text(text),
    ]);

    const count = await provider.provideTokenCount(
      glm5,
      message,
      createToken()
    );
    expect(count).toBe(Math.ceil(text.length / 2));
  });

  describe("GLM-5.3", () => {
    function mockConfig(settings: Record<string, unknown>) {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn((key: string, defaultValue: unknown) =>
          key in settings ? settings[key] : defaultValue
        ),
      });
    }

    async function createProviderWithGlm53() {
      const provider = new ZaiChatModelProvider(
        secrets as unknown as vscode.SecretStorage,
        "jest-agent"
      );
      const models = await provider.provideLanguageModelChatInformation(
        { silent: true } as vscode.PrepareLanguageModelChatModelOptions,
        createToken()
      );
      const glm53 = models.find((m) => m.id === "glm-5.3");
      if (!glm53) {
        throw new Error("glm-5.3 not found");
      }
      return { provider, glm53 };
    }

    async function sendPrompt(
      provider: ZaiChatModelProvider,
      glm53: { id: string },
      options: Record<string, unknown> = {}
    ) {
      const messages = [vscode.LanguageModelChatMessage.User("hello")];
      const progress = {
        report: jest.fn(),
      } as unknown as vscode.Progress<vscode.LanguageModelResponsePart>;
      await provider.provideLanguageModelChatResponse(
        glm53 as vscode.LanguageModelChatInformation,
        messages,
        options as never,
        progress,
        createToken()
      );
      const requestInit = (global.fetch as jest.Mock).mock.calls[0]?.[1] as {
        body?: string;
      };
      return JSON.parse(requestInit.body ?? "{}") as Record<string, unknown>;
    }

    it("should advertise the documented context window and max output", async () => {
      const { glm53 } = await createProviderWithGlm53();
      // The provider reserves at most 64K tokens for output (capped reserve).
      expect(glm53.maxInputTokens).toBe(1000000 - 65536);
      expect(glm53.maxOutputTokens).toBe(131072);
    });

    it("should always send thinking.type enabled even when thinking display is disabled", async () => {
      mockConfig({ enableThinking: false });
      const { provider, glm53 } = await createProviderWithGlm53();
      const requestBody = await sendPrompt(provider, glm53);
      expect(requestBody.thinking).toEqual({ type: "enabled" });
    });

    it("should send reasoning_effort from the zai.reasoningEffort setting", async () => {
      mockConfig({ reasoningEffort: "low" });
      const { provider, glm53 } = await createProviderWithGlm53();
      const requestBody = await sendPrompt(provider, glm53);
      expect(requestBody.reasoning_effort).toBe("low");
    });

    it("should omit reasoning_effort when the setting is default", async () => {
      const { provider, glm53 } = await createProviderWithGlm53();
      const requestBody = await sendPrompt(provider, glm53);
      expect(requestBody).not.toHaveProperty("reasoning_effort");
    });

    it("should let model options override the reasoning effort setting", async () => {
      mockConfig({ reasoningEffort: "low" });
      const { provider, glm53 } = await createProviderWithGlm53();
      const requestBody = await sendPrompt(provider, glm53, {
        modelOptions: { reasoning_effort: "high" },
      });
      expect(requestBody.reasoning_effort).toBe("high");
    });

    it("should default temperature to 1.0 for always-thinking models", async () => {
      const { provider, glm53 } = await createProviderWithGlm53();
      const requestBody = await sendPrompt(provider, glm53);
      expect(requestBody.temperature).toBe(1.0);
    });

    it("should cap max_tokens at the documented 128K output limit", async () => {
      const { provider, glm53 } = await createProviderWithGlm53();
      const requestBody = await sendPrompt(provider, glm53, {
        modelOptions: { max_tokens: 999999 },
      });
      expect(requestBody.max_tokens).toBe(131072);
    });
  });
});
