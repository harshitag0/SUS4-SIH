// Manual end-to-end check against a running API (node test/realtime-check.mjs from client/ or server/ with socket.io-client available).
// Connects as the demo farmer over Socket.IO, posts a requirement as a demo buyer, and waits for the live notification.
import { io } from "socket.io-client";

const BASE = process.env.API || "http://127.0.0.1:4000";
const post = async (path, body, token) => (await fetch(BASE + "/api" + path, {
  method: "POST", headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body),
})).json();

const farmer = await post("/auth/verify", { mobile: "9876543210", otp: "1234", role: "farmer" });
const buyer = await post("/auth/verify", { mobile: "6500000001", otp: "1234", role: "buyer" });
const socket = io(BASE, { auth: { token: farmer.token }, transports: ["websocket"] });
await new Promise((ok, fail) => { socket.on("connect", ok); socket.on("connect_error", fail); });

const got = new Promise((ok) => {
  const events = [];
  socket.on("data:changed", (e) => events.push(e.resource));
  socket.on("notification", (n) => ok({ n, events }));
});
const t0 = Date.now();
await post("/requirements", { grade: "A", tons: 3, priceUsd: 5.2, deliverBy: "2026-05-18" }, buyer.token);
const { n } = await Promise.race([got, new Promise((_, f) => setTimeout(() => f(new Error("no notification within 5s")), 5000))]);
console.log(`farmer notified in ${Date.now() - t0} ms:`, n.type, n.data);
socket.close();
process.exit(0);
