import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext, parseWeather, weatherUrl, season, coarse } from "../context.js";
import { buildPrompt, parseMission } from "../prompt.js";
import { pickFallbackMission, MISSIONS } from "../missions.js";
import { chooseModel, generateMission, MODELS, probeWebGPU } from "../llm.js";

// A real-shaped Open-Meteo response (fields as documented at open-meteo.com/en/docs).
const sample = {
  current: { time: "2026-10-10T17:15", interval: 900, temperature_2m: 11.4, apparent_temperature: 8.9, precipitation: 0.4, weather_code: 61, wind_speed_10m: 14.2, is_day: 1 },
  daily: { time: ["2026-10-10"], sunrise: ["2026-10-10T07:24"], sunset: ["2026-10-10T18:30"] },
};

test("weather url rounds coordinates to ~10 km", () => {
  const u = new URL(weatherUrl(12.34567, -45.67891));
  assert.equal(u.searchParams.get("latitude"), "12.3");
  assert.equal(u.searchParams.get("longitude"), "-45.7");
  assert.match(u.searchParams.get("current"), /weather_code/);
  assert.equal(coarse(-33.8688), -33.9);
});

test("parseWeather normalises Open-Meteo", () => {
  const w = parseWeather(sample);
  assert.equal(w.description, "light rain");
  assert.equal(w.tempC, 11);
  assert.equal(w.isDay, true);
  assert.equal(parseWeather({ error: true }), null);
});

test("season flips by hemisphere", () => {
  const oct = new Date(2026, 9, 10, 12);
  assert.equal(season(oct, 40), "autumn");
  assert.equal(season(oct, -33), "spring");
  assert.equal(season(oct, undefined, "Australia/Sydney"), "spring");
  assert.equal(season(oct, undefined, "America/Los_Angeles"), "autumn");
});

test("context flags and sunset", () => {
  const ctx = buildContext({ now: new Date(2026, 9, 10, 17, 15), minutes: 30, setting: "a park", weather: parseWeather(sample), latitude: 40 });
  assert.equal(ctx.flags.wet, true);
  assert.equal(ctx.flags.isDay, true);
  assert.equal(ctx.minutesToSunset, 75);
  assert.ok(ctx.lines.some((l) => l.includes("sunset in about 75 minutes")));
  const noWeather = buildContext({ now: new Date(2026, 9, 10, 22), minutes: 20, setting: "anywhere", weather: null });
  assert.equal(noWeather.flags.isDay, false);
  assert.ok(noWeather.lines.some((l) => l.includes("unknown")));
});

test("prompt carries conditions and safety rules", () => {
  const ctx = buildContext({ now: new Date(2026, 9, 10, 21), minutes: 45, setting: "a city street", weather: { ...parseWeather(sample), isDay: false, code: 95, description: "thunderstorm" } });
  const p = buildPrompt(ctx, ["Lit windows"]);
  assert.match(p, /thunderstorm/);
  assert.match(p, /dark/);
  assert.match(p, /porch/);
  assert.match(p, /Do not repeat these recent missions: Lit windows/);
  assert.match(p, /TITLE:/);
});

test("parseMission handles format, markdown, drift and junk", () => {
  assert.deepEqual(parseMission("TITLE: Puddle Mirrors\nMISSION: Find three puddles that reflect a tree, then pick the clearest one."), { title: "Puddle Mirrors", text: "Find three puddles that reflect a tree, then pick the clearest one." });
  const md = parseMission("**TITLE:** Leaf Hunt\n**MISSION:** \"Find three leaves in three different colours on your block.\"");
  assert.equal(md.title, "Leaf Hunt");
  assert.equal(md.text, "Find three leaves in three different colours on your block.");
  const drift = parseMission("Sure! Walk to the nearest tree and count how many birds land on it in ten minutes.");
  assert.match(drift.text, /count how many birds/);
  assert.equal(parseMission(""), null);
  assert.equal(parseMission("TITLE: x\nMISSION: ok"), null);
  const long = parseMission("MISSION: " + "Walk to the corner and look up. ".repeat(20));
  assert.ok(long.text.length <= 280);
});

test("fallback respects night and rain", () => {
  for (let i = 0; i < 50; i++) {
    const m = pickFallbackMission({ isDay: false, wet: false }, [], Math.random);
    assert.ok(!(m.tags.includes("day") && !m.tags.includes("night")), m.title);
    const r = pickFallbackMission({ isDay: true, wet: true }, [], Math.random);
    assert.ok(!(r.tags.includes("dry") && !r.tags.includes("wet")), r.title);
  }
  const m = pickFallbackMission({}, MISSIONS.map((x) => x.title));
  assert.ok(m.title); // still returns something when everything is "recent"
});

test("model choice follows GPU features", () => {
  assert.equal(chooseModel("standard", { f16: true }).id, "gemma-2-2b-it-q4f16_1-MLC-1k");
  assert.equal(chooseModel("standard", { f16: false }).id, "gemma-2-2b-it-q4f32_1-MLC-1k");
  assert.equal(chooseModel("lite", { f16: true }).id, "gemma3-1b-it-q4f16_1-MLC");
  assert.equal(chooseModel("lite", { f16: false }).id, "gemma-2-2b-it-q4f32_1-MLC-1k");
});

test("probeWebGPU reports missing WebGPU", async () => {
  assert.equal((await probeWebGPU({})).ok, false);
  assert.equal((await probeWebGPU({ gpu: { requestAdapter: async () => null } })).ok, false);
  const ok = await probeWebGPU({ gpu: { requestAdapter: async () => ({ features: new Set(["shader-f16"]) }) } });
  assert.deepEqual([ok.ok, ok.f16], [true, true]);
});

test("generateMission speaks the OpenAI-style WebLLM API and retries bad output", async () => {
  const calls = [];
  const replies = ["I can't help with that.", "TITLE: Moss Map\nMISSION: Find moss growing in three different places on your street."];
  const fake = { chat: { completions: { create: async (req) => { calls.push(req); return { choices: [{ message: { content: replies[calls.length - 1] } }] }; } } } };
  const ctx = buildContext({ now: new Date(2026, 9, 10, 15), minutes: 30, setting: "a city street", weather: parseWeather(sample) });
  const m = await generateMission(ctx, [], fake, MODELS.standard.id);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].messages[0].role, "user"); // Gemma has no system turn
  assert.equal(calls[0].max_tokens, 120);
  assert.equal(m.title, "Moss Map");
  assert.equal(m.source, "gemma");
});
