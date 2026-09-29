import type { AISettings } from "../shared/types";
import type { AIConnectionResult, LocalModel } from "../shared/desktop";
import { readBoundedJSON, resolveAIEndpoint } from "./analysis";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function inventoryEndpoint(settings: AISettings): URL {
  const url = resolveAIEndpoint(settings);
  url.pathname =
    settings.provider === "ollama"
      ? url.pathname.replace(/\/chat$/, "/tags")
      : url.pathname.replace(/\/chat\/completions$/, "/models");
  return url;
}

async function inventory(settings: AISettings): Promise<LocalModel[]> {
  const url = inventoryEndpoint(settings);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers:
        settings.provider === "compatible" && settings.apiKey
          ? { Authorization: `Bearer ${settings.apiKey}` }
          : {},
    });
  } catch {
    throw new Error(
      "Could not reach the model service within 15 seconds. Check the address and that the service is running.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const guidance =
      response.status === 401 || response.status === 403
        ? "Check the API key and its permission to list models."
        : response.status === 404
          ? "This service may not support listing models at this address. Generation has not been tested."
          : response.status === 429
            ? "The service limited this request. Check its usage limits before retrying."
            : "Check the service address and model-list support.";
    throw new Error(
      `Model service returned HTTP ${response.status}. ${guidance}`,
    );
  }
  let payload: unknown;
  try {
    payload = await readBoundedJSON(response);
  } catch {
    throw new Error(
      "The model service returned an unreadable or oversized model list.",
    );
  }
  const data = payload as { models?: unknown; data?: unknown } | null;
  const entries = settings.provider === "ollama" ? data?.models : data?.data;
  if (!Array.isArray(entries) || entries.length > 10_000)
    throw new Error("The model service did not return a supported model list.");
  const result = new Map<string, LocalModel>();
  for (const entry of entries) {
    const name = settings.provider === "ollama" ? entry?.name : entry?.id;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(name)
    )
      continue;
    const size = entry?.size;
    result.set(name, {
      name,
      ...(Number.isSafeInteger(size) && size > 0 ? { size } : {}),
    });
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A deliberate, read-only check; no prompts or project content are sent. */
export function listLocalModels(endpoint: string): Promise<LocalModel[]> {
  if (typeof endpoint !== "string" || endpoint.length > 2048)
    throw new Error("Enter a valid local Ollama address.");
  const settings: AISettings = { provider: "ollama", endpoint, model: "" };
  if (!LOOPBACK.has(inventoryEndpoint(settings).hostname))
    throw new Error(
      "Local model discovery is limited to this computer's loopback address.",
    );
  return inventory(settings);
}

export async function testAIConnection(
  settings: AISettings,
): Promise<AIConnectionResult> {
  if (settings.provider === "offline")
    return {
      ok: true,
      message: "Offline evidence outlines require no AI connection.",
    };
  const models = await inventory(settings);
  if (!models.some((model) => model.name === settings.model))
    throw new Error(
      "The service is reachable, but the selected model was not listed. Check its exact name and your model access. Generation has not been tested.",
    );
  return {
    ok: true,
    message:
      "Service reachable and selected model listed. No research content was sent; generation and billing availability have not been tested.",
  };
}
