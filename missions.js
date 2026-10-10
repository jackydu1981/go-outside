// Hand-written missions. Used when the device can't run Gemma (no WebGPU),
// when the user chooses not to download the model, or if a generation fails.
// Each mission carries tags so the fallback is still fitted to the conditions.
//   tags: any | day | night | dry | wet | cold | warm | windy

export const MISSIONS = [
  { title: "Three leaf colours", text: "Find three leaves on your block that are three clearly different colours. Hold each one up to the sky before you put it back.", tags: ["day", "dry"] },
  { title: "Count the birds", text: "Walk until you have heard five different bird calls. You don't need names. Just notice that each one sounds different.", tags: ["day"] },
  { title: "The oldest tree", text: "Find the biggest tree you can reach on foot. Put a hand on the bark and guess how many winters it has seen.", tags: ["day", "dry", "cold", "warm"] },
  { title: "Sky in three", text: "Stop in three different spots and look straight up for ten slow breaths each time. Notice what changes between them.", tags: ["any"] },
  { title: "Puddle mirrors", text: "Find three puddles that reflect something tall: a tree, a lamppost, a roofline. Pick a favourite.", tags: ["wet", "day"] },
  { title: "Rain sounds", text: "Stand under a tree, an awning or a bus shelter and listen for four different sounds the rain makes on four different surfaces.", tags: ["wet"] },
  { title: "Lit windows", text: "Walk a loop and count the windows with a lamp, a plant or a cat in them. Stop when you reach ten.", tags: ["night"] },
  { title: "Brightest star", text: "Find a spot away from the nearest streetlight, let your eyes adjust for two minutes, then find the brightest point in the sky.", tags: ["night", "dry"] },
  { title: "Your breath", text: "Find the spot on your walk where your breath shows most clearly. Then find the warmest-feeling spot in the sun or out of the wind.", tags: ["cold"] },
  { title: "Wind detective", text: "Work out which way the wind is blowing using only things you can see: flags, branches, smoke, grass. Then walk into it for five minutes.", tags: ["windy"] },
  { title: "Shade map", text: "Walk only on the shady side of the street. Count how many different things are casting the shade you walk through.", tags: ["warm", "day"] },
  { title: "Five textures", text: "Touch five different natural textures on your walk: rough bark, smooth stone, soft moss, a leaf, something you didn't expect.", tags: ["day", "dry"] },
  { title: "Something new", text: "Walk a street you have never walked before, even if it is only one block over. Find one thing on it worth coming back for.", tags: ["any"] },
  { title: "Seed hunt", text: "Find three different kinds of seed: a helicopter, a nut, a pod, a fluffy one. Leave them where they are.", tags: ["day", "dry"] },
  { title: "Dog census", text: "Count the dogs you see on your walk and give each one a name in your head that fits it better than its real one.", tags: ["day", "any"] },
  { title: "Slow block", text: "Walk one block as slowly as you possibly can. Notice three things you have walked past a hundred times and never seen.", tags: ["any"] },
  { title: "Cloud shapes", text: "Lie on the grass or lean on a wall and find two clouds that look like animals. Watch one until it stops looking like one.", tags: ["day", "dry", "warm"] },
  { title: "Moss and lichen", text: "Find moss or lichen in three different places: a wall, a tree, the ground. Look closely at the tiny world in each.", tags: ["wet", "day", "cold"] },
  { title: "Streetlight halos", text: "In the mist or drizzle, find the streetlight with the biggest glow around it. Count the lights you pass on the way.", tags: ["night", "wet"] },
  { title: "Long view", text: "Find the spot within ten minutes of home with the longest view. Name every colour you can see in the sky from there.", tags: ["day", "dry"] },
  { title: "Night sounds", text: "Stand still somewhere quiet and count the sounds you can hear: far, near, mechanical, alive. Try for eight.", tags: ["night"] },
  { title: "Fallen treasure", text: "Find the single most beautiful fallen leaf on your street. Take it home, not a photo of it.", tags: ["day", "dry", "cold"] },
];

/**
 * Pick a hand-written mission that fits the conditions.
 * @param {{isDay?: boolean, wet?: boolean, cold?: boolean, warm?: boolean, windy?: boolean}} cond
 * @param {string[]} recentTitles titles to avoid repeating
 * @param {() => number} rand injectable RNG for tests
 */
export function pickFallbackMission(cond = {}, recentTitles = [], rand = Math.random) {
  const want = new Set(["any"]);
  if (cond.isDay === false) want.add("night"); else want.add("day");
  if (cond.wet) want.add("wet"); else want.add("dry");
  if (cond.cold) want.add("cold");
  if (cond.warm) want.add("warm");
  if (cond.windy) want.add("windy");

  const blocked = (m) =>
    (cond.isDay === false && m.tags.includes("day") && !m.tags.includes("night")) ||
    (cond.isDay !== false && m.tags.includes("night") && !m.tags.includes("day")) ||
    (cond.wet && m.tags.includes("dry") && !m.tags.includes("wet")) ||
    (!cond.wet && m.tags.includes("wet") && !m.tags.includes("dry"));

  const score = (m) => m.tags.filter((t) => want.has(t)).length;
  let pool = MISSIONS.filter((m) => !blocked(m) && !recentTitles.includes(m.title));
  if (pool.length === 0) pool = MISSIONS.filter((m) => !blocked(m));
  if (pool.length === 0) pool = MISSIONS;
  const best = Math.max(...pool.map(score));
  const top = pool.filter((m) => score(m) >= best - 1);
  return { ...top[Math.floor(rand() * top.length)], source: "handwritten" };
}
