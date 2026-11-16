import { currentWeather } from "../modules/alerts/routes.js";
import { generateAll, runReminders } from "../modules/advisory/service.js";
import { forwardModule2 } from "../modules/messaging/bridge.js";

/**
 * Continuous advisory loop:
 *   every 6 h  — rebuild every farmer's advisory (new inspections → comparison → updated recommendations → messages)
 *   every hour — reminders (due tomorrow, follow-up inspection, farmer-doctor visit)
 *   every 2 min — retry failed messages; forward farm-operations farmer messages (photo check due, harvest notice…)
 */
export function scheduleAdvisory(deps) {
  const d = { ...deps, weather: deps.weather || currentWeather };
  const rebuild = () => generateAll(d).then((n) => n && console.log(`advisory refreshed for ${n} farmer(s)`)).catch((e) => console.warn("advisory job:", e.message));
  const remind = () => runReminders(d).then((n) => n && console.log(`advisory reminders: ${n}`)).catch((e) => console.warn("reminders:", e.message));
  const messages = async () => {
    try {
      const r = await d.messenger?.retryDue();
      const f = await forwardModule2(d.messenger);
      if (r || f) console.log(`messages: ${r} retried, ${f} forwarded from farm operations`);
    } catch (e) { console.warn("messages job:", e.message); }
  };
  setTimeout(rebuild, 30000);
  setTimeout(remind, 60000);
  setTimeout(messages, 20000);
  return [setInterval(rebuild, 6 * 3600 * 1000), setInterval(remind, 3600 * 1000), setInterval(messages, 120 * 1000)];
}
