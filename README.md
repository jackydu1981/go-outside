# Go Outside

**One tap. One small outdoor mission written on your own device by Gemma. Then the screen goes dark until you're back.**

Go Outside is a tiny web app for the moment you notice you've been scrolling for too long. Tap one button and a small open-weight model, Google's **Gemma**, running *in your browser* through [WebLLM](https://github.com/mlc-ai/web-llm), writes a single mission for the next 20, 30 or 45 minutes. It's fitted to your weather, the time of day and the season. Something like:

> *Find three puddles that reflect something tall: a tree, a lamppost, a roofline. Pick a favourite.*

Then the app gets out of the way. The screen turns almost black, shows a big countdown and says **Phone away. Go.** When you come back you can leave one line, *what did you see?*, in a small field journal that never leaves your device.

Built for the [DEV Hacktoberfest Open-Source AI Challenge, Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05).

## Why

Most apps are designed to keep you looking at them. This one is designed to be the shortest part of your walk: the screen is on for roughly the ten seconds it takes to read a sentence. The model's job isn't to chat. It writes one good, specific prompt that turns "I should go outside" into "I'm going to find three different leaf colours on my block".

## How it works

1. **Context, on device.** You choose how long (20/30/45 min) and roughly where (street, park, yard, anywhere). If you allow location, the coordinates are **rounded to one decimal place (about 10 km)** and used for a single request to the free, keyless [Open-Meteo](https://open-meteo.com/) API for current weather and today's sunset. Location is never stored. Season is worked out from the date and hemisphere.
2. **Gemma writes the mission.** The conditions plus a short set of rules (one concrete, finishable task; walking distance; nothing risky; respect the dark, the rain, the cold) go into one prompt. Gemma replies in a fixed `TITLE:` / `MISSION:` format. The app parses it, retries once if the reply doesn't fit, and falls back to a hand-written mission if it still doesn't.
3. **Screen off.** A near-black countdown. It survives closing the tab: the end time is saved, so reopening the app takes you to the right place. When time is up it vibrates and plays a short chime (if the page is open).
4. **Journal.** One optional line, saved in `localStorage` only.

### The open model

| | |
|---|---|
| Runtime | `@mlc-ai/web-llm@0.2.85` loaded as an ES module from jsDelivr, running in a Web Worker on WebGPU |
| Default model | **`gemma-2-2b-it-q4f16_1-MLC-1k`** (Gemma 2 2B instruct, 4-bit, 1k context; about 1.5 GB download) |
| No 16-bit shader support | `gemma-2-2b-it-q4f32_1-MLC-1k` is picked automatically |
| "Lighter" option | `gemma3-1b-it-q4f16_1-MLC` (Gemma 3 1B, about 0.6 GB) |

All three ids are taken from WebLLM 0.2.85's `prebuiltAppConfig`, and `tests/webllm-api.test.mjs` checks that they're still there. The first mission asks before downloading the weights; after that WebLLM keeps them in the browser's Cache Storage and the model loads offline. Gemma's chat template has no system turn, so all instructions go in the single user message.

### Graceful fallback

No WebGPU (many phones, Firefox, older browsers)? The app says so plainly and serves a mission from 22 hand-written ones, still filtered for day/night, wet/dry, cold, hot and windy. The same fallback catches a model that fails to load, runs out of memory, or returns something unusable. You always get a mission.

### Offline

`sw.js` precaches the app shell and caches the version-pinned WebLLM bundle the first time it's used. Model weights are cached by WebLLM itself. Once you've had one Gemma-written mission, the app opens and writes missions with no connection. Weather is then simply "unknown", and the prompt asks for something that works in most conditions.

## Run it

It's a static folder with no build step.

```bash
python3 -m http.server 8080   # or: npx serve .
# open http://localhost:8080
```

WebGPU and service workers need a secure context: `localhost` or HTTPS. Any static host works (GitHub Pages, Netlify, Cloudflare Pages, Render static sites).

For Gemma you need a browser with WebGPU, such as recent Chrome or Edge on desktop or Android, plus roughly 2 GB of free GPU memory for the default model (WebLLM lists ~1.6 GB VRAM for it). Use the lighter model on smaller devices.

### Tests

```bash
npm install   # only installs jsdom, for the headless DOM tests
npm test
```

- `tests/unit.test.mjs`: weather parsing, coordinate rounding, season by hemisphere, prompt rules, output parsing (markdown, format drift, junk, over-long replies), fallback filtering, model choice, and the WebLLM chat call shape against a fake engine (including the retry).
- `tests/dom.test.mjs`: loads the real `index.html` + `app.js` in jsdom **without WebGPU** and walks the whole flow: mission → reroll → away countdown → back → journal → clear.
- `tests/dom-gpu-error.test.mjs`: WebGPU "present" but the model can't load, so the app must still hand out a hand-written mission.
- `tests/webllm-api.test.mjs`: downloads the exact pinned WebLLM bundle and checks the exports we call (`CreateWebWorkerMLCEngine`, `CreateMLCEngine`, `WebWorkerMLCEngineHandler`, `hasModelInCache`) and that our model ids exist. It needs network access and skips without it.

Actual on-GPU generation can't run in a headless sandbox. Test it in a real WebGPU browser.

## Privacy

- No accounts, no analytics, no backend, no AI API.
- The prompt and Gemma's reply never leave the device.
- Location is optional, rounded to ~10 km, used for one weather request to Open-Meteo, and not stored.
- Network requests: the static app files, the WebLLM library (jsDelivr), the model weights and WebGPU kernels (Hugging Face / GitHub, first run only), and the weather request if you opted in.
- The journal lives in `localStorage` under `tg.*` keys. "Clear journal" deletes it.

## Files

```
index.html          screens and markup
style.css           mobile-first styles
app.js              UI flow, timer, journal
llm.js              WebGPU probe, model choice, WebLLM engine, generation
worker.js           WebLLM Web Worker handler
prompt.js           prompt builder + reply parser
context.js          weather/time/season → facts and flags (pure)
missions.js         hand-written fallback missions
sw.js               service worker (offline app shell)
manifest.webmanifest, icon.svg
tests/              node:test suites
```

## Known limitations

- Needs WebGPU for Gemma. Without it you get the hand-written set, which is good but not generative.
- The first download is large (about 1.5 GB, or 0.6 GB for the lighter model). The app asks before starting it.
- Browsers may throttle or pause timers in a background tab. The countdown is based on a saved end time, so it's always correct when you look, but the end-of-time chime only plays if the page is open.
- A 1–2B model sometimes writes a mission that's a little generic or ignores one of the conditions. The prompt, parsing, retry and fallback keep it usable, not perfect.
- Weather data: Open-Meteo's free API is for non-commercial use.

## Credits & licences

- Code: MIT (see `LICENSE`).
- [Gemma](https://ai.google.dev/gemma) by Google, used under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms). The weights are not part of this repo.
- [WebLLM / MLC LLM](https://github.com/mlc-ai/web-llm) (Apache-2.0) for in-browser inference and the compiled Gemma builds.
- Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).
- Built with AI assistance: an AI assistant helped write the code, tests and docs.

## Challenge note

Created during the challenge window (Oct 5–11, 2026). Any commits after the submission deadline (Oct 11, 2026, 11:59 PM PDT) will be listed here.
