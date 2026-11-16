import { useEffect, useState } from "react";
import { api, ApiError } from "./api.js";

/**
 * Offline support for farmers with weak connectivity:
 *  - a service worker (public/sw.js) keeps the app shell and the last advice / messages available offline;
 *  - farmer actions (acknowledge, done, ask for help) made offline are kept in an outbox and sent automatically
 *    when the phone is back online. The farmer sees that they are queued, never that they were sent.
 */
const KEY = "agrilink_outbox";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ } window.dispatchEvent(new Event("agrilink-outbox")); };

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

/** POST now if online; otherwise (or on a network error) queue it. Returns { queued } or the server response. */
export async function sendOrQueue(path, body) {
  if (!navigator.onLine) { write([...read(), { path, body, at: Date.now() }]); return { queued: true }; }
  try { return await api(path, { method: "POST", body }); }
  catch (e) {
    if (e instanceof ApiError && e.status === 0) { write([...read(), { path, body, at: Date.now() }]); return { queued: true }; }
    throw e;
  }
}

export async function flushOutbox() {
  const list = read();
  if (!list.length || !navigator.onLine) return 0;
  const left = [];
  let sent = 0;
  for (const m of list) {
    try { await api(m.path, { method: "POST", body: m.body }); sent++; }
    catch (e) { if (e instanceof ApiError && e.status === 0) left.push(m); /* server refused: drop, the latest state wins */ }
  }
  write(left);
  return sent;
}

export function useConnectivity() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [queued, setQueued] = useState(read().length);
  useEffect(() => {
    const on = () => { setOnline(true); flushOutbox().then(() => setQueued(read().length)); };
    const off = () => setOnline(false);
    const q = () => setQueued(read().length);
    window.addEventListener("online", on); window.addEventListener("offline", off); window.addEventListener("agrilink-outbox", q);
    if (navigator.onLine) flushOutbox().then(() => setQueued(read().length));
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); window.removeEventListener("agrilink-outbox", q); };
  }, []);
  return { online, queued };
}
