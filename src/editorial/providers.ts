import { request } from "node:http";
import type { WritingProvider, WritingSettings } from "./settings.js";
import { writingBaseUrl } from "./settings.js";

export interface WritingUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
export class WritingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly usage?: WritingUsage,
  ) {
    super(message);
  }
}
export interface WritingModel {
  id: string;
  chat: boolean;
  loaded?: boolean;
  recommended?: boolean;
}
export interface WritingCatalog {
  provider: WritingProvider;
  status: "ready" | "auth-required" | "unavailable" | "error";
  message: string;
  models: WritingModel[];
}
export type JsonTransport = (
  url: string,
  options?: {
    body?: unknown;
    apiKey?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
) => Promise<unknown>;

/** Direct loopback HTTP, with bounded bytes/time and no redirect/proxy forwarding. */
export const writingHttp: JsonTransport = (address, options = {}) =>
  new Promise((done, reject) => {
    const url = new URL(address);
    if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname))
      return reject(new WritingError("INVALID_ENDPOINT", "Use a loopback writing service."));
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 10_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    const req = request(
      url,
      {
        method: body === undefined ? "GET" : "POST",
        signal,
        headers: {
          accept: "application/json",
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              }),
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            response.destroy();
            reject(new WritingError("INVALID_RESPONSE", "Writing service returned too much data."));
          } else chunks.push(chunk);
        });
        response.on("error", () =>
          reject(
            new WritingError(
              "UNAVAILABLE",
              "Writing service disconnected. No generation was retried.",
            ),
          ),
        );
        response.on("end", () => {
          const status = response.statusCode ?? 500;
          if (status === 401 || status === 403)
            return reject(
              new WritingError(
                "AUTH_REQUIRED",
                "Hyperspace requires a valid proxy API key. Update it in Writing setup.",
              ),
            );
          if (status === 429)
            return reject(
              new WritingError(
                "RATE_LIMITED",
                "The writing service has reached a limit. Check your proxy quota before trying again.",
              ),
            );
          if (status < 200 || status >= 300)
            return reject(
              new WritingError(
                "PROVIDER_ERROR",
                `Writing service returned HTTP ${status}. Check the model and service configuration. No request was retried.`,
              ),
            );
          try {
            done(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(
              new WritingError("INVALID_RESPONSE", "Writing service did not return complete JSON."),
            );
          }
        });
      },
    );
    req.on("error", () =>
      reject(
        options.signal?.aborted
          ? new WritingError(
              "CANCELED",
              "Writing request canceled. The proxy may still charge for work already processed.",
            )
          : signal.aborted
            ? new WritingError(
                "TIMEOUT",
                "Writing service timed out. It may have processed the request; no automatic retry was made.",
              )
            : new WritingError(
                "UNAVAILABLE",
                "Writing service is unavailable. Start Hyperspace AI or LM Studio and test the connection.",
              ),
      ),
    );
    req.end(body);
  });

const embeddingId = (id: string) => /(?:embed|embedding|rerank|whisper|tts|speech)/iu.test(id);
export async function writingCatalog(
  settings: WritingSettings,
  provider: WritingProvider,
  apiKey?: string,
  transport: JsonTransport = writingHttp,
): Promise<WritingCatalog> {
  const base = writingBaseUrl(settings[provider].baseUrl, provider);
  try {
    const data = (await transport(`${base}/models`, {
      ...(provider === "hyperspace" && apiKey ? { apiKey } : {}),
    })) as { data?: unknown };
    if (!Array.isArray(data?.data))
      throw new WritingError(
        "INVALID_RESPONSE",
        "The writing service returned an invalid model catalog.",
      );
    const models: WritingModel[] = [];
    for (const value of data.data.slice(0, 500)) {
      const item = value as { id?: unknown; type?: unknown; mode?: unknown };
      if (
        typeof item?.id !== "string" ||
        !item.id ||
        item.id.length > 200 ||
        /\p{Cc}/u.test(item.id)
      )
        continue;
      const mode = String(item.mode ?? item.type ?? "").toLowerCase();
      models.push({
        id: item.id,
        chat: !embeddingId(item.id) && !/embed|audio|speech|rerank/u.test(mode),
        ...(provider === "local" ? { recommended: /gemma.*4.*31b/iu.test(item.id) } : {}),
      });
    }
    // Native metadata distinguishes downloaded models from loaded instances. Discovery never loads one.
    if (provider === "local") {
      const native = (await transport(`${new URL(base).origin}/api/v1/models`)) as {
        models?: { key?: string; format?: string; loaded_instances?: { id?: string }[] }[];
      };
      if (!Array.isArray(native.models))
        throw new WritingError("INVALID_RESPONSE", "LM Studio did not report loaded models.");
      for (const model of models) {
        const loaded = native.models.find(
          (item) =>
            ["mlx", "gguf"].includes(item.format ?? "") &&
            item.loaded_instances?.some((instance) => instance.id === model.id),
        );
        model.loaded = Boolean(loaded);
        if (loaded && /gemma.*4.*31b/iu.test(loaded.key ?? "")) model.recommended = true;
      }
    }
    return {
      provider,
      status: "ready",
      message: models.some((model) => model.chat)
        ? provider === "local"
          ? "LM Studio connected. Gemma 4 31B is recommended; load your selected model in LM Studio before writing."
          : "Hyperspace connected. Writing requests use SAP's downstream service and may incur cost."
        : "Connected, but no chat models were advertised.",
      models,
    };
  } catch (error) {
    return {
      provider,
      status:
        error instanceof WritingError && error.code === "AUTH_REQUIRED"
          ? "auth-required"
          : error instanceof WritingError && error.code === "UNAVAILABLE"
            ? "unavailable"
            : "error",
      message:
        error instanceof WritingError ? error.message : "The writing service could not be checked.",
      models: [],
    };
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface ChatResult {
  content: string;
  seconds: number;
  usage?: WritingUsage;
}
export async function writingCompletion(
  settings: WritingSettings,
  messages: ChatMessage[],
  options: { apiKey?: string; signal?: AbortSignal; transport?: JsonTransport } = {},
): Promise<ChatResult> {
  const provider = settings.provider;
  const selected = settings[provider];
  const started = performance.now();
  const data = (await (options.transport ?? writingHttp)(
    `${writingBaseUrl(selected.baseUrl, provider)}/chat/completions`,
    {
      ...(provider === "hyperspace" && options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      timeoutMs: 180_000,
      body: {
        model: selected.model,
        messages,
        stream: false,
        ...(provider === "local"
          ? {
              max_tokens: 3072,
              ...(/gemma/iu.test(selected.model)
                ? { temperature: 1.0, top_p: 0.95, top_k: 64, reasoning_effort: "none" }
                : {}),
            }
          : /^(?:gpt-[56]|o[134])/u.test(selected.model)
            ? { max_completion_tokens: 4096 }
            : { max_tokens: 3072 }),
      },
    },
  )) as {
    choices?: { message?: { content?: unknown; refusal?: unknown }; finish_reason?: string }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  };
  const choice = data?.choices?.[0];
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  const usage = {
    ...(count(data?.usage?.prompt_tokens) !== undefined
      ? { inputTokens: count(data?.usage?.prompt_tokens) as number }
      : {}),
    ...(count(data?.usage?.completion_tokens) !== undefined
      ? { outputTokens: count(data?.usage?.completion_tokens) as number }
      : {}),
    ...(count(data?.usage?.total_tokens) !== undefined
      ? { totalTokens: count(data?.usage?.total_tokens) as number }
      : {}),
  };
  if (
    choice?.finish_reason !== "stop" ||
    choice.message?.refusal ||
    typeof choice.message?.content !== "string" ||
    !choice.message.content.trim()
  )
    throw new WritingError(
      "INCOMPLETE_OUTPUT",
      "The model did not return a complete usable answer. Try a different model or a shorter request.",
      usage,
    );
  if (options.apiKey && choice.message.content.includes(options.apiKey))
    throw new WritingError(
      "INVALID_RESPONSE",
      "Writing service returned unexpected credential material; the answer was discarded.",
    );
  return {
    content: choice.message.content,
    seconds: (performance.now() - started) / 1000,
    ...(Object.keys(usage).length ? { usage } : {}),
  };
}
