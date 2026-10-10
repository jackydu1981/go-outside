// Checks our assumptions against the exact WebLLM build the app loads.
// Downloads the pinned jsDelivr bundle (network needed) and inspects its exports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WEBLLM_URL, MODELS } from "../llm.js";

test("pinned WebLLM exports the APIs we call and lists our Gemma model ids", async (t) => {
  let src;
  try {
    const res = await fetch(WEBLLM_URL);
    if (!res.ok) throw new Error(String(res.status));
    src = await res.text();
  } catch (e) {
    t.skip("network unavailable: " + e.message);
    return;
  }
  const file = join(await mkdtemp(join(tmpdir(), "webllm-")), "webllm.mjs");
  await writeFile(file, src);
  const w = await import(file);
  for (const name of ["CreateWebWorkerMLCEngine", "CreateMLCEngine", "WebWorkerMLCEngineHandler", "hasModelInCache"]) {
    assert.equal(typeof w[name], "function", name);
  }
  const ids = new Set(w.prebuiltAppConfig.model_list.map((m) => m.model_id));
  for (const m of Object.values(MODELS)) assert.ok(ids.has(m.id), m.id);
  const std = w.prebuiltAppConfig.model_list.find((m) => m.model_id === MODELS.standard.id);
  assert.deepEqual(std.required_features, ["shader-f16"]);
});
