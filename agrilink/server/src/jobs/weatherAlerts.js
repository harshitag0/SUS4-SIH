import { User } from "../modules/users/model.js";
import { Notification } from "../modules/notifications/model.js";
import { alertsFor, currentWeather } from "../modules/alerts/routes.js";

/**
 * Background check: for every farmer, fetch live weather and push a notification for each HIGH-severity alert
 * (storm, hail), at most once per alert code per day.
 */
export async function runWeatherAlerts({ ml, notifier, weather = currentWeather }) {
  const farmers = await User.find({ role: "farmer", farm: { $exists: true } });
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  let sent = 0;
  for (const f of farmers) {
    try {
      const { alerts, weather: w } = await alertsFor(f, ml, weather);
      for (const a of alerts.filter((x) => x.severity === "high")) {
        const dup = await Notification.exists({ user: f._id, type: "weather", "data.code": a.code, createdAt: { $gte: since } });
        if (dup) continue;
        await notifier.toUsers([f._id], "weather", { code: a.code, tons_at_risk: a.params.tons_at_risk, rain: w.rain_mm_48h, wind: w.wind_kmh });
        sent++;
      }
    } catch (e) {
      console.warn("weather alert check failed for", String(f._id), e.message);
    }
  }
  return sent;
}

export function scheduleWeatherAlerts(deps, everyMs = 3 * 3600 * 1000) {
  const tick = () => runWeatherAlerts(deps).then((n) => n && console.log(`weather alerts sent: ${n}`)).catch(() => {});
  setTimeout(tick, 15000);
  return setInterval(tick, everyMs);
}
