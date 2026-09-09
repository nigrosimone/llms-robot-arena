// Provider adapters for controller generation. Two wire formats cover most vendors:
// the OpenAI chat-completions shape (also spoken by aggregators and local servers)
// and the Anthropic messages shape. Keys are read from the environment only.
const PRESETS = {
  openai: {
    api: "openai", baseUrl: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY",
    label: "OpenAI", maxTokensField: "max_completion_tokens",
  },
  openrouter: {
    api: "openai", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY",
    label: null,
  },
  anthropic: {
    api: "anthropic", baseUrl: "https://api.anthropic.com/v1", keyEnv: "ANTHROPIC_API_KEY",
    label: "Anthropic",
  },
  google: {
    api: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY", label: "Google",
  },
  xai: { api: "openai", baseUrl: "https://api.x.ai/v1", keyEnv: "XAI_API_KEY", label: "xAI" },
  deepseek: {
    api: "openai", baseUrl: "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY",
    label: "DeepSeek",
  },
  mistral: {
    api: "openai", baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY",
    label: "Mistral",
  },
  groq: { api: "openai", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", label: null },
  together: {
    api: "openai", baseUrl: "https://api.together.xyz/v1", keyEnv: "TOGETHER_API_KEY", label: null,
  },
  ollama: {
    api: "openai", baseUrl: "http://127.0.0.1:11434/v1", keyEnv: "OLLAMA_API_KEY",
    label: null, keyOptional: true,
  },
  custom: { api: "openai", baseUrl: null, keyEnv: "LLM_API_KEY", label: null, keyOptional: true },
};
export const providerPresets = Object.freeze(
  Object.fromEntries(Object.entries(PRESETS).map(([name, preset]) => [name, Object.freeze(preset)])),
);
// Anthropic extended thinking needs an explicit token budget; effort names keep the
// command line identical across wire formats.
const THINKING_BUDGET = { minimal: 2048, low: 4096, medium: 8192, high: 16384, max: 24576 };

export function resolveProvider({
  provider = "openrouter", baseUrl, apiKeyEnv, api, env = process.env, requireKey = true,
} = {}) {
  const preset = PRESETS[provider];
  if (!preset) throw new Error(
    `Unknown provider "${provider}". Known: ${Object.keys(PRESETS).join(", ")}.`,
  );
  const url = (baseUrl ?? preset.baseUrl)?.replace(/\/+$/, "");
  if (!url) throw new Error(`Provider "${provider}" requires --base-url.`);
  const keyEnv = apiKeyEnv ?? preset.keyEnv,
    apiKey = env[keyEnv]?.trim() || "";
  if (!apiKey && requireKey && !preset.keyOptional)
    throw new Error(`Missing API key: set ${keyEnv} in the environment.`);
  return {
    name: provider, api: api ?? preset.api, baseUrl: url, keyEnv, apiKey,
    label: preset.label, maxTokensField: preset.maxTokensField ?? "max_tokens",
  };
}

// The catalog stores the model vendor, which is not the endpoint used to reach it.
export function inferModelProvider(provider, model = "") {
  const prefix = model.includes("/") ? model.split("/")[0].toLowerCase() : "";
  const vendors = {
    openai: "OpenAI", anthropic: "Anthropic", google: "Google", "x-ai": "xAI", xai: "xAI",
    deepseek: "DeepSeek", mistralai: "Mistral", meta: "Meta", "meta-llama": "Meta",
    qwen: "Qwen", moonshotai: "Moonshot AI", "z-ai": "Z.ai",
  };
  return vendors[prefix] ?? provider.label ?? null;
}

export function buildRequest(provider, { model, system, user, messages = [], temperature, maxTokens, reasoning }) {
  if (!model?.trim()) throw new Error("A model name is required.");
  const turns = [...(user ? [{ role: "user", content: user }] : []), ...messages];
  if (!turns.length) throw new Error("At least one message is required.");
  const headers = { "content-type": "application/json" };
  let url, body;
  if (provider.api === "anthropic") {
    const budget = reasoning ? THINKING_BUDGET[reasoning] : null;
    if (reasoning && !budget) throw new Error(
      `Unknown reasoning effort "${reasoning}". Use: ${Object.keys(THINKING_BUDGET).join(", ")}.`,
    );
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    url = `${provider.baseUrl}/messages`;
    body = {
      model, system, messages: turns,
      max_tokens: Math.max(maxTokens ?? 16000, budget ? budget + 8192 : 0),
      // Extended thinking fixes sampling, so an explicit temperature is dropped.
      ...(budget ? { thinking: { type: "enabled", budget_tokens: budget } }
        : temperature == null ? {} : { temperature }),
    };
  } else {
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
    url = `${provider.baseUrl}/chat/completions`;
    body = {
      model,
      messages: [...(system ? [{ role: "system", content: system }] : []), ...turns],
      ...(maxTokens == null ? {} : { [provider.maxTokensField]: maxTokens }),
      ...(temperature == null ? {} : { temperature }),
      ...(reasoning ? { reasoning_effort: reasoning } : {}),
    };
  }
  return { url, init: { method: "POST", headers, body: JSON.stringify(body) } };
}

function textFrom(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(part => part?.type !== "thinking" && part?.type !== "redacted_thinking")
    .map(part => (typeof part === "string" ? part : part?.text ?? "")).join("");
}

export function parseCompletion(provider, payload) {
  if (payload?.error) throw new Error(
    `Model API error: ${payload.error.message ?? JSON.stringify(payload.error)}`,
  );
  const text = provider.api === "anthropic"
    ? textFrom(payload?.content)
    : textFrom(payload?.choices?.[0]?.message?.content);
  const stop = provider.api === "anthropic"
    ? payload?.stop_reason : payload?.choices?.[0]?.finish_reason;
  if (!text.trim()) throw new Error(
    `The model returned no text (stop reason: ${stop ?? "unknown"}).`,
  );
  return { text, stopReason: stop ?? null, usage: payload?.usage ?? null };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Transient upstream failures are common on shared endpoints; retry with backoff.
export async function requestCompletion(provider, request, {
  fetchImpl = fetch, retries = 3, timeoutMs = 600_000, onRetry = () => {}, wait = sleep,
} = {}) {
  const { url, init } = buildRequest(provider, request);
  for (let attempt = 0; ; attempt++) {
    let response, payload;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      payload = await response.json().catch(() => null);
    } catch (e) {
      if (attempt >= retries) throw new Error(`Request to ${provider.name} failed: ${e.message}`);
      onRetry({ attempt: attempt + 1, reason: e.message });
      await wait(2000 * 2 ** attempt);
      continue;
    }
    if (response.ok) return parseCompletion(provider, payload);
    const detail = payload?.error?.message ?? response.statusText ?? "";
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= retries)
      throw new Error(`Model API returned ${response.status}: ${detail}`);
    onRetry({ attempt: attempt + 1, reason: `HTTP ${response.status} ${detail}` });
    await wait(2000 * 2 ** attempt);
  }
}
