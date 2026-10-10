// WebGPU is reported as available, but the model can't load (here: the WebLLM
// module can't be imported in Node). The app must still hand out a mission.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const until = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
};

test("model load failure degrades to a hand-written mission", async () => {
  const dom = new JSDOM(html.replace(/<script[^>]*app\.js[^>]*><\/script>/, ""), { url: "http://localhost:8080/", pretendToBeVisual: true });
  const { window } = dom;
  window.scrollTo = () => {};
  window.localStorage.setItem("tg.consent", "true");
  const nav = Object.create(window.navigator);
  Object.defineProperty(nav, "gpu", { value: { requestAdapter: async () => ({ features: new Set(["shader-f16"]) }) } });
  for (const k of ["window", "document", "localStorage", "HTMLElement", "Event"]) globalThis[k] = k === "window" ? window : window[k];
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true });
  Object.defineProperty(globalThis, "location", { value: window.location, configurable: true });
  const origError = console.error;
  console.error = () => {};

  await import("../app.js");
  const $ = (s) => window.document.querySelector(s);
  const active = () => window.document.querySelector(".screen[data-active]")?.id;

  await until(() => $("#status").textContent.length > 0);
  assert.match($("#status").textContent, /downloads Gemma 2 2B once/);
  assert.match($("#gpu-info").textContent, /gemma-2-2b-it-q4f16_1-MLC-1k/);

  $("#go").click();
  await until(() => active() === "screen-mission");
  assert.match($("#mission-meta").textContent, /Hand-written mission/);
  assert.match($("#mission-meta").textContent, /Gemma couldn't run/);
  console.error = origError;
  window.close();
});
