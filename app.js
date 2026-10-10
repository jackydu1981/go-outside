import { buildContext, parseWeather, weatherUrl } from "./context.js";
import { pickFallbackMission } from "./missions.js";
import { MODELS, chooseModel, generateMission, isLoaded, isModelCached, loadModel, probeWebGPU } from "./llm.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------- tiny persistence layer (localStorage only) ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("tg." + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem("tg." + key, JSON.stringify(value)); } catch { /* private mode: fine */ }
  },
  del(key) {
    try { localStorage.removeItem("tg." + key); } catch { /* ignore */ }
  },
};

const state = {
  gpu: null, // {ok, f16, reason}
  lastCtx: null, // {ctx, weather, at}
  mission: null,
  timer: null,
  audio: null,
};

// ---------- screens ----------
function show(name) {
  $$(".screen").forEach((s) => s.removeAttribute("data-active"));
  $(`#screen-${name}`).setAttribute("data-active", "");
  document.body.classList.toggle("away", name === "away");
  window.scrollTo?.(0, 0);
  if (name === "journal") renderJournal();
  if (name === "home") renderJournalCount();
}

function setStatus(text, warn = false) {
  const el = $("#status");
  el.textContent = text;
  el.classList.toggle("warn", warn);
}

function setLoading(title, detail = "", progress = null) {
  $("#loading-title").textContent = title;
  $("#loading-detail").textContent = detail;
  const bar = $(".progress");
  if (progress === null) {
    bar.classList.add("indeterminate");
    $("#progress-bar").style.width = "";
  } else {
    bar.classList.remove("indeterminate");
    $("#progress-bar").style.width = `${Math.round(progress * 100)}%`;
  }
}

const selected = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value;

// ---------- weather (optional) ----------
function getPosition(timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 30 * 60 * 1000 }
    );
  });
}

async function getWeather(pos) {
  if (!pos || !navigator.onLine) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(weatherUrl(pos.lat, pos.lon), { signal: ctrl.signal });
    if (!res.ok) return null;
    return parseWeather(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function gatherContext() {
  const minutes = Number(selected("minutes") || 30);
  const setting = selected("setting") || "anywhere nearby on foot";
  const fresh = state.lastCtx && Date.now() - state.lastCtx.at < 15 * 60 * 1000;
  let weather = null;
  let latitude;
  if (fresh) {
    ({ weather, latitude } = state.lastCtx);
  } else if ($("#use-location").checked) {
    setLoading("Checking the sky…");
    const pos = await getPosition();
    latitude = pos?.lat;
    weather = await getWeather(pos);
  }
  const ctx = buildContext({
    now: new Date(), minutes, setting, weather, latitude,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  state.lastCtx = { weather, latitude, at: fresh ? state.lastCtx.at : Date.now() };
  return { ctx, weather, minutes };
}

// ---------- first-run consent for the model download ----------
function askConsent(model) {
  $("#consent-model").textContent = model.label;
  $("#consent-size").textContent = model.approxMB >= 1000 ? `${(model.approxMB / 1000).toFixed(1)} GB` : `${model.approxMB} MB`;
  show("consent");
  return new Promise((resolve) => {
    $("#consent-yes").onclick = () => { store.set("consent", true); resolve(true); };
    $("#consent-no").onclick = () => resolve(false);
  });
}

// ---------- the main action ----------
async function makeMission() {
  const goBtn = $("#go");
  goBtn.disabled = true;
  $("#reroll").disabled = true;
  show("loading");
  setLoading("Checking the sky…");
  const recent = store.get("recent", []);
  let note = "";

  try {
    const { ctx, weather, minutes } = await gatherContext();
    let mission = null;

    if (state.gpu?.ok) {
      const model = chooseModel(store.get("model", "standard"), state.gpu);
      let allowed = isLoaded(model.id) || store.get("consent", false) || (await isModelCached(model.id));
      if (!allowed) allowed = await askConsent(model);
      if (allowed) {
        try {
          show("loading");
          setLoading(`Waking up ${model.label}…`, "", 0);
          await loadModel(model.id, ({ progress, text }) => setLoading(`Waking up ${model.label}…`, text, progress));
          setLoading(`${model.label} is writing your mission…`, "on this device, no server involved");
          mission = await generateMission(ctx, recent);
          if (mission) mission.label = model.label;
          else note = "Gemma's reply didn't fit, so here's a hand-written one.";
        } catch (err) {
          console.error(err);
          note = "Gemma couldn't run on this device just now, so here's a hand-written one.";
        }
      } else {
        note = "Hand-written mission. You can download Gemma any time.";
      }
    }

    if (!mission) mission = pickFallbackMission(ctx.flags, recent);
    state.mission = { ...mission, minutes, weather, ctx };
    store.set("recent", [mission.title, ...recent.filter((t) => t !== mission.title)].slice(0, 8));
    renderMission(note);
    show("mission");
  } finally {
    goBtn.disabled = false;
    $("#reroll").disabled = false;
  }
}

function renderMission(note) {
  const m = state.mission;
  $("#mission-title").textContent = m.title;
  $("#mission-text").textContent = m.text;
  const bits = [];
  bits.push(m.source === "gemma" ? `Written on this device by ${m.label}` : "Hand-written mission");
  if (m.weather) bits.push(`${m.weather.description}, ${m.weather.tempC}°C`);
  bits.push(`${m.minutes} min`);
  $("#mission-meta").textContent = bits.join(" · ") + (note ? `. ${note}` : "");
  $("#start").textContent = `Start ${m.minutes} minutes. Phone away.`;
}

// ---------- away mode ----------
function primeAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !state.audio) state.audio = new AC();
  } catch { /* no audio: fine */ }
}

function chime() {
  const ac = state.audio;
  if (!ac) return;
  try {
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.25 + 0.8);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.25);
      o.stop(ac.currentTime + i * 0.25 + 0.9);
    });
  } catch { /* ignore */ }
}

function startAway() {
  const m = state.mission;
  primeAudio();
  const session = { title: m.title, text: m.text, source: m.source, minutes: m.minutes, startedAt: Date.now(), endAt: Date.now() + m.minutes * 60 * 1000 };
  store.set("session", session);
  enterAway(session);
}

function enterAway(session) {
  $("#away-mission").textContent = session.text;
  show("away");
  clearInterval(state.timer);
  const tick = () => {
    const left = session.endAt - Date.now();
    if (left <= 0) return finishAway(false);
    const s = Math.ceil(left / 1000);
    $("#countdown").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  tick();
  state.timer = setInterval(tick, 1000);
}

function finishAway(early) {
  clearInterval(state.timer);
  const session = store.get("session", null);
  if (!session) return show("home");
  store.set("session", { ...session, returnedAt: Date.now(), early });
  if (!early) {
    navigator.vibrate?.([200, 100, 200]);
    chime();
  }
  $("#back-mission").textContent = `${session.title}: ${session.text}`;
  $("#note").value = "";
  show("back");
}

function closeSession(note) {
  const session = store.get("session", null);
  if (session && note) {
    const journal = store.get("journal", []);
    journal.unshift({
      at: session.startedAt,
      minutes: Math.max(1, Math.round(((session.returnedAt || Date.now()) - session.startedAt) / 60000)),
      title: session.title,
      mission: session.text,
      note,
      source: session.source,
    });
    store.set("journal", journal.slice(0, 365));
  }
  store.del("session");
  show("home");
}

// ---------- journal ----------
function renderJournalCount() {
  const n = store.get("journal", []).length;
  $("#journal-count").textContent = n ? `(${n})` : "";
}

function renderJournal() {
  const list = $("#journal-list");
  const journal = store.get("journal", []);
  list.replaceChildren(
    ...journal.map((e) => {
      const li = document.createElement("li");
      const when = document.createElement("div");
      when.className = "when";
      when.textContent = `${new Date(e.at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${e.minutes} min`;
      const what = document.createElement("div");
      what.className = "what";
      what.textContent = e.note;
      const which = document.createElement("div");
      which.className = "which";
      which.textContent = e.title;
      li.append(when, what, which);
      return li;
    })
  );
  $("#journal-empty").hidden = journal.length > 0;
}

// ---------- device capability ----------
async function describeDevice() {
  state.gpu = await probeWebGPU();
  const pref = store.get("model", "standard");
  const radio = document.querySelector(`input[name="model"][value="${pref}"]`);
  if (radio) radio.checked = true;
  if (!state.gpu.ok) {
    setStatus(`${state.gpu.reason} Missions will come from a hand-written set, still matched to your weather. For Gemma, try a recent Chrome or Edge on desktop or Android.`, true);
    $("#gpu-info").textContent = "WebGPU: not available on this device, so the model can't run here.";
    return;
  }
  const model = chooseModel(pref, state.gpu);
  $("#gpu-info").textContent = `WebGPU: available${state.gpu.f16 ? " (16-bit shaders)" : ""}. Using ${model.label} (${model.id}).`;
  if (pref === "lite" && model.id !== MODELS.lite.id) $("#gpu-info").textContent += " The lighter model needs 16-bit shader support, which this GPU lacks.";
  const cached = await isModelCached(model.id);
  setStatus(cached ? `${model.label} is on this device and works offline.` : `First mission downloads ${model.label} once. After that, it's all on-device.`);
}

// ---------- wiring ----------
function init() {
  $("#go").addEventListener("click", () => makeMission());
  $("#reroll").addEventListener("click", () => makeMission());
  $("#start").addEventListener("click", startAway);
  $("#back-early").addEventListener("click", () => finishAway(true));
  $("#note-form").addEventListener("submit", (e) => {
    e.preventDefault();
    closeSession($("#note").value.trim());
  });
  $("#skip-note").addEventListener("click", () => closeSession(""));
  $("#clear-journal").addEventListener("click", () => {
    if (confirm("Delete every journal entry on this device?")) {
      store.del("journal");
      renderJournal();
    }
  });
  $$("[data-goto]").forEach((b) => b.addEventListener("click", () => show(b.dataset.goto)));
  $$('input[name="model"]').forEach((r) =>
    r.addEventListener("change", () => {
      store.set("model", r.value);
      describeDevice();
    })
  );
  const loc = $("#use-location");
  loc.checked = store.get("useLocation", false);
  loc.addEventListener("change", () => {
    store.set("useLocation", loc.checked);
    state.lastCtx = null;
  });
  document.addEventListener("visibilitychange", () => {
    const s = store.get("session", null);
    if (document.visibilityState === "visible" && s && !s.returnedAt && Date.now() >= s.endAt) finishAway(false);
  });

  // Resume an outing in progress (the page may have been closed while outside).
  const session = store.get("session", null);
  if (session && !session.returnedAt && Date.now() < session.endAt) enterAway(session);
  else if (session) {
    if (!session.returnedAt) store.set("session", { ...session, returnedAt: session.endAt });
    $("#back-mission").textContent = `${session.title}: ${session.text}`;
    show("back");
  } else show("home");

  describeDevice();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW registration failed", e));
  }
}

init();
