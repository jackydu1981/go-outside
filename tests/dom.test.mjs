// Headless smoke test of the real index.html + app.js in jsdom, on a device
// WITHOUT WebGPU (the fallback path). Location is off, so no network is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
};

test("fallback flow: mission -> away -> back -> journal", async () => {
  const dom = new JSDOM(html.replace(/<script[^>]*app\.js[^>]*><\/script>/, ""), { url: "http://localhost:8080/", pretendToBeVisual: true });
  const { window } = dom;
  window.scrollTo = () => {};
  window.confirm = () => true;
  for (const k of ["window", "document", "localStorage", "HTMLElement", "Event"]) {
    globalThis[k] = k === "window" ? window : window[k];
  }
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true }); // no navigator.gpu
  Object.defineProperty(globalThis, "location", { value: window.location, configurable: true });
  globalThis.confirm = window.confirm;
  globalThis.Intl = Intl;

  await import("../app.js");
  const $ = (s) => window.document.querySelector(s);
  const active = () => window.document.querySelector(".screen[data-active]")?.id;

  assert.equal(active(), "screen-home");
  await until(() => $("#status").textContent.length > 0);
  assert.match($("#status").textContent, /WebGPU/);
  assert.match($("#status").textContent, /hand-written/);
  assert.ok($("#status").classList.contains("warn"));

  // choose 20 minutes, then ask for a mission
  $('input[name="minutes"][value="20"]').checked = true;
  $("#go").click();
  await until(() => active() === "screen-mission");
  assert.ok($("#mission-text").textContent.length > 20);
  assert.match($("#mission-meta").textContent, /Hand-written mission · 20 min/);
  assert.match($("#start").textContent, /20 minutes/);

  // reroll gives another (different) mission
  const first = $("#mission-title").textContent;
  $("#reroll").click();
  await until(() => active() === "screen-mission" && $("#mission-title").textContent !== first);

  // start: the screen goes dark with a countdown
  $("#start").click();
  assert.equal(active(), "screen-away");
  assert.ok(window.document.body.classList.contains("away"));
  assert.match($("#countdown").textContent, /^(20:00|19:5\d)$/);
  const session = JSON.parse(window.localStorage.getItem("tg.session"));
  assert.equal(Math.round((session.endAt - session.startedAt) / 60000), 20);

  // back early -> one-line note -> journal
  $("#back-early").click();
  assert.equal(active(), "screen-back");
  $("#note").value = "A heron on the lamppost";
  $("#note-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  assert.equal(active(), "screen-home");
  const journal = JSON.parse(window.localStorage.getItem("tg.journal"));
  assert.equal(journal.length, 1);
  assert.equal(journal[0].note, "A heron on the lamppost");
  assert.equal(window.localStorage.getItem("tg.session"), null);
  assert.equal($("#journal-count").textContent, "(1)");

  $('[data-goto="journal"]').click();
  assert.equal(active(), "screen-journal");
  assert.match($("#journal-list").textContent, /heron/);
  assert.equal($("#journal-empty").hidden, true);
  $("#clear-journal").click();
  assert.equal($("#journal-empty").hidden, false);
  window.close();
});
