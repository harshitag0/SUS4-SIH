import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "./config/env.js";

/** Socket.IO on the same HTTP server. Each socket joins: all, user:<id>, role:<role>. */
export function attachRealtime(httpServer) {
  const io = new Server(httpServer, { cors: { origin: "*" } });
  io.use((socket, next) => {
    try {
      socket.data.user = jwt.verify(socket.handshake.auth?.token, env.jwtSecret);
      next();
    } catch {
      next(new Error("unauthenticated"));
    }
  });
  io.on("connection", (socket) => {
    const { sub, role } = socket.data.user;
    socket.join(["all", `user:${sub}`, `role:${role}`]);
  });
  return io;
}
