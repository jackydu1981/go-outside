// Gemma, in the browser, via WebLLM (https://github.com/mlc-ai/web-llm).
// The model runs on the user's GPU through WebGPU inside a Web Worker.
// Weights are downloaded once from Hugging Face and kept in the browser's
// Cache Storage by WebLLM, so later runs work offline.

import { buildPrompt, parseMission } from "./prompt.js";

export const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";

// Model ids from WebLLM 0.2.85's prebuiltAppConfig.
export const MODELS = {
  // Gemma 2 2B instruction-tuned, 4-bit, 1k context (plenty for one short prompt).
  standard: { id: "gemma-2-2b-it-q4f16_1-MLC-1k", label: "Gemma 2 2B", approxMB: 1500, needsF16: true },
  // Same model without 16-bit float shaders, for GPUs that lack shader-f16.
  standardF32: { id: "gemma-2-2b-it-q4f32_1-MLC-1k", label: "Gemma 2 2B (f32)", approxMB: 1500, needsF16: false },
  // Smaller download for phones.
  // (q4f16 weights, so we only offer it when the GPU has shader-f16.)
  lite: { id: "gemma3-1b-it-q4f16_1-MLC", label: "Gemma 3 1B", approxMB: 600, needsF16: true },
};

let webllm = null;
let engine = null;
let loadedId = null;

/** Does this browser have a usable WebGPU adapter? Returns {ok, f16, reason}. */
export async function probeWebGPU(nav = globalThis.navigator) {
  if (!nav || !("gpu" in nav) || !nav.gpu) return { ok: false, f16: false, reason: "This browser doesn't support WebGPU." };
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return { ok: false, f16: false, reason: "WebGPU is present but no GPU adapter is available." };
    return { ok: true, f16: adapter.features?.has?.("shader-f16") ?? false, reason: "" };
  } catch (e) {
    return { ok: false, f16: false, reason: "WebGPU failed to start: " + (e?.message || e) };
  }
}

export function chooseModel(pref, gpu) {
  if (pref === "lite" && gpu.f16) return MODELS.lite;
  return gpu.f16 ? MODELS.standard : MODELS.standardF32;
}

async function lib() {
  if (!webllm) webllm = await import(/* @vite-ignore */ WEBLLM_URL);
  return webllm;
}

export async function isModelCached(modelId) {
  try {
    const w = await lib();
    return await w.hasModelInCache(modelId);
  } catch {
    return false;
  }
}

export function isLoaded(modelId) {
  return engine !== null && loadedId === modelId;
}

/**
 * Load (download on first use) the model. onProgress receives
 * {progress: 0..1, text} straight from WebLLM's initProgressCallback.
 */
export async function loadModel(modelId, onProgress = () => {}) {
  if (isLoaded(modelId)) return engine;
  const w = await lib();
  const initProgressCallback = (r) => onProgress({ progress: r.progress, text: r.text });
  if (engine && loadedId !== modelId) {
    await engine.reload(modelId);
    loadedId = modelId;
    return engine;
  }
  try {
    const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    // If the worker script itself fails (e.g. module workers unsupported), the
    // engine promise would never settle, so race it against the worker's error event.
    const workerFailed = new Promise((_, reject) =>
      worker.addEventListener("error", (e) => reject(Object.assign(new Error(e.message || "worker failed"), { workerFailed: true })), { once: true })
    );
    engine = await Promise.race([
      w.CreateWebWorkerMLCEngine(worker, modelId, { initProgressCallback }),
      workerFailed,
    ]);
  } catch (err) {
    if (!err?.workerFailed) throw err; // a real model/GPU error: let the caller fall back
    // Some browsers can't start module workers; run on the main thread instead.
    console.warn("Worker engine failed, falling back to main thread:", err);
    engine = await w.CreateMLCEngine(modelId, { initProgressCallback });
  }
  loadedId = modelId;
  return engine;
}

/**
 * Ask Gemma for one mission. Retries once if the reply can't be parsed.
 * @returns {Promise<{title:string,text:string,source:"gemma",model:string}|null>}
 */
export async function generateMission(ctx, recentTitles, eng = engine, modelId = loadedId) {
  if (!eng) throw new Error("Model not loaded");
  const prompt = buildPrompt(ctx, recentTitles);
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await eng.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      temperature: attempt === 0 ? 0.9 : 0.7,
      top_p: 0.95,
      max_tokens: 120,
    });
    const parsed = parseMission(reply?.choices?.[0]?.message?.content);
    if (parsed) return { ...parsed, source: "gemma", model: modelId };
  }
  return null;
}
