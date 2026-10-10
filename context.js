// Turns "where and when am I" into plain facts for the model and for the
// hand-written fallback. Pure functions, no network: easy to test.

export const WMO = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "freezing fog", 51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
  56: "light freezing drizzle", 57: "freezing drizzle", 61: "light rain", 63: "rain",
  65: "heavy rain", 66: "light freezing rain", 67: "freezing rain", 71: "light snow",
  73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers",
  82: "violent showers", 85: "light snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 97: "heavy thunderstorm", 99: "thunderstorm with hail",
};

const WET_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
const STORM_CODES = new Set([65, 67, 82, 95, 96, 97, 99]);

// Southern-hemisphere guess when we have no latitude (location declined).
const SOUTHERN_TZ = /^(Australia|Antarctica|Pacific\/(Auckland|Chatham|Fiji|Tongatapu|Noumea)|America\/(Argentina|Santiago|Sao_Paulo|Montevideo|Asuncion|La_Paz|Lima)|Africa\/(Johannesburg|Maputo|Harare|Windhoek|Gaborone|Lusaka|Maseru|Mbabane)|Indian\/(Mauritius|Reunion))/;

export function season(date, latitude, timeZone) {
  const m = date.getMonth(); // 0-11
  const north = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"][m];
  const flip = { winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" };
  const southern = typeof latitude === "number" ? latitude < 0 : SOUTHERN_TZ.test(timeZone || "");
  return southern ? flip[north] : north;
}

export function partOfDay(date) {
  const h = date.getHours();
  if (h < 5) return "the middle of the night";
  if (h < 8) return "early morning";
  if (h < 12) return "morning";
  if (h < 14) return "midday";
  if (h < 17) return "afternoon";
  if (h < 20) return "evening";
  return "night";
}

/** Round to ~11 km so the weather request never carries a precise position. */
export function coarse(n) {
  return Math.round(n * 10) / 10;
}

export function weatherUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: String(coarse(lat)),
    longitude: String(coarse(lon)),
    current: "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day",
    daily: "sunrise,sunset",
    timezone: "auto",
    forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

/** Normalise an Open-Meteo response into the few facts we use. */
export function parseWeather(json) {
  const c = json && json.current;
  if (!c || typeof c.weather_code !== "number") return null;
  const sunset = json.daily && json.daily.sunset && json.daily.sunset[0];
  return {
    code: c.weather_code,
    description: WMO[c.weather_code] || "mixed weather",
    tempC: Math.round(c.temperature_2m),
    feelsC: Math.round(c.apparent_temperature ?? c.temperature_2m),
    windKmh: Math.round(c.wind_speed_10m ?? 0),
    precipMm: c.precipitation ?? 0,
    isDay: c.is_day === 1,
    sunset: sunset || null, // local ISO without offset, e.g. "2026-10-10T18:31"
    localTime: c.time || null,
  };
}

/**
 * Everything the mission needs to know, as flags + a human-readable list.
 * @param {{now: Date, minutes: number, setting: string, weather: object|null, latitude?: number, timeZone?: string}} o
 */
export function buildContext({ now, minutes, setting, weather, latitude, timeZone }) {
  const w = weather;
  const isDay = w ? w.isDay : now.getHours() >= 7 && now.getHours() < 19;
  const feels = w ? w.feelsC : null;
  const flags = {
    isDay,
    wet: w ? WET_CODES.has(w.code) || w.precipMm > 0.2 : false,
    snowy: w ? SNOW_CODES.has(w.code) : false,
    stormy: w ? STORM_CODES.has(w.code) : false,
    cold: feels !== null ? feels <= 6 : false,
    warm: feels !== null ? feels >= 26 : false,
    windy: w ? w.windKmh >= 30 : false,
  };

  let minutesToSunset = null;
  if (w && w.sunset && w.localTime) {
    const diff = (Date.parse(w.sunset) - Date.parse(w.localTime)) / 60000;
    if (Number.isFinite(diff)) minutesToSunset = Math.round(diff);
  }

  const lines = [
    `Time: ${partOfDay(now)}, ${now.toLocaleDateString("en-US", { weekday: "long" })}`,
    `Season: ${season(now, latitude, timeZone)}`,
    `Light: ${isDay ? "daylight" : "dark"}${minutesToSunset !== null && minutesToSunset > 0 && minutesToSunset <= 90 ? `, sunset in about ${minutesToSunset} minutes` : ""}`,
    w
      ? `Weather: ${w.description}, ${w.tempC}°C (feels like ${w.feelsC}°C), wind ${w.windKmh} km/h`
      : "Weather: unknown, so the mission must work in most conditions",
    `Where: ${setting}`,
    `Time available: ${minutes} minutes`,
  ];
  return { flags, lines, minutesToSunset };
}
