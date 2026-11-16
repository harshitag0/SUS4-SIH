import { User } from "../users/model.js";
import { Notification } from "./model.js";

/**
 * Stores notifications in MongoDB (so offline users see them later) and pushes them live over Socket.IO.
 * `io` may be null (tests, scripts): then only persistence happens.
 * Future channels (SMS / WhatsApp) plug in here.
 */
export function createNotifier(initialIo = null) {
  let io = initialIo;
  const listeners = [];
  const emit = (room, event, payload) => { if (io) io.to(room).emit(event, payload); };

  async function toUsers(userIds, type, data = {}) {
    const ids = [...new Set(userIds.map(String))];
    if (!ids.length) return [];
    const docs = await Notification.insertMany(ids.map((user) => ({ user, type, data })));
    for (const d of docs) emit(`user:${d.user}`, "notification", d.toObject());
    for (const fn of listeners) Promise.resolve(fn(docs)).catch(() => {});   // e.g. WhatsApp / SMS bridge
    return docs;
  }

  async function toFarmers(type, data, filter = {}) {
    const farmers = await User.find({ role: "farmer", farm: { $exists: true }, ...filter }).select("_id");
    return toUsers(farmers.map((f) => f._id), type, data);
  }

  /** Tell every open screen that a resource changed, so lists refresh instantly. */
  const changed = (...resources) => resources.forEach((resource) => emit("all", "data:changed", { resource }));

  /** Socket.IO is created after the HTTP server, so it is attached late. */
  const attach = (newIo) => { io = newIo; };

  /** Extra delivery channels subscribe here (messaging bridge). */
  const subscribe = (fn) => { listeners.push(fn); };

  return { toUsers, toFarmers, changed, attach, subscribe };
}

export const nullNotifier = { toUsers: async () => [], toFarmers: async () => [], changed: () => {} };
