// The prompt Gemma sees, and the parser for what it writes back.
// Gemma's chat template has no separate system turn, so all instructions
// go in the single user message.

export function buildPrompt(ctx, recentTitles = []) {
  const { flags, lines } = ctx;
  const rules = [
    "One mission only, one or two sentences, under 40 words.",
    "Make it concrete and finishable: something to find, count, listen for, touch or compare. Use a small number when it fits (three, five).",
    "Fit it to the conditions above: the season, the light, the weather and the place.",
    "On foot, close to where they are. No buying anything, no photos, no apps, no trespassing, nothing risky.",
    "Write it to the person directly, warm and plain. No emojis, no hashtags.",
  ];
  if (!flags.isDay) rules.push("It is dark: keep them on lit streets or near home.");
  if (flags.stormy) rules.push("The weather is rough: keep it very close, a porch, a doorway or an awning, and short.");
  else if (flags.wet) rules.push("It is wet: make the rain part of the mission instead of avoiding it.");
  if (flags.cold) rules.push("It is cold: keep them moving.");
  if (flags.warm) rules.push("It is hot: favour shade.");

  const avoid = recentTitles.length
    ? `\nDo not repeat these recent missions: ${recentTitles.slice(0, 5).join("; ")}.\n`
    : "";

  return `You write tiny outdoor missions for someone who is about to put their phone away and step outside.

Conditions right now:
${lines.map((l) => `- ${l}`).join("\n")}

Rules:
${rules.map((r) => `- ${r}`).join("\n")}
${avoid}
Reply in exactly this format and nothing else:
TITLE: <a 2 to 4 word name>
MISSION: <the mission>`;
}

const clean = (s) =>
  s
    .replace(/\*\*/g, "")
    .replace(/^[\s"'“”*#-]+|[\s"'“”*]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Pull TITLE/MISSION out of the model's reply. Returns null if the reply is
 * unusable, so the caller can retry or fall back.
 */
export function parseMission(raw) {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.match(/TITLE\s*:\s*(.+)/i);
  const m = raw.match(/MISSION\s*:\s*([\s\S]+)/i);
  let title = t ? clean(t[1].split("\n")[0]) : "";
  let text = m ? clean(m[1].split(/\n\s*\n|\nTITLE\s*:/i)[0]) : "";

  if (!text) {
    // Model ignored the format: take the first non-empty line that reads like a sentence.
    const line = raw.split("\n").map(clean).find((l) => l.length > 25 && !/^TITLE/i.test(l));
    text = line || "";
  }
  if (!text) return null;
  if (text.length > 280) {
    // keep whole sentences up to the limit
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    text = "";
    for (const s of sentences) {
      if ((text + s).length > 280) break;
      text += s;
    }
    text = text.trim() || sentences[0].slice(0, 280);
  }
  if (text.length < 20) return null;
  if (!title || title.length > 40) title = "Your mission";
  return { title, text };
}
