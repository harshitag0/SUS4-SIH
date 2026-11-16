/** Live weather from Open-Meteo (free, no key). Falls back to demo values if the call fails. */
export const DISTRICT_COORDS = {
  Sindhudurg: { lat: 16.38, lon: 73.38 }, // Devgad
  Ratnagiri: { lat: 16.99, lon: 73.31 },
  Raigad: { lat: 18.64, lon: 72.87 }, // Alibag
  Palghar: { lat: 19.7, lon: 72.77 },
};
const DEMO = { rain_mm_48h: 35, wind_kmh: 25, temp_c: 33, hail: false };
const TTL = 30 * 60 * 1000;
const cache = new Map();

export async function fetchWeather(district, fetchImpl = fetch) {
  const c = DISTRICT_COORDS[district] || DISTRICT_COORDS.Sindhudurg;
  const hit = cache.get(district);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}` +
      "&daily=precipitation_sum,wind_speed_10m_max,temperature_2m_max,weather_code&forecast_days=2&timezone=Asia%2FKolkata";
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(String(res.status));
    const d = (await res.json()).daily;
    value = {
      rain_mm_48h: +d.precipitation_sum.reduce((a, b) => a + (b || 0), 0).toFixed(1),
      wind_kmh: Math.max(...d.wind_speed_10m_max),
      temp_c: Math.max(...d.temperature_2m_max),
      hail: d.weather_code.some((w) => w === 96 || w === 99), // thunderstorm with hail
      source: "open-meteo",
    };
  } catch {
    value = { ...DEMO, source: "demo" };
  }
  cache.set(district, { at: Date.now(), value });
  return value;
}
