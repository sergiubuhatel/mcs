import { io } from "socket.io-client";
import { API_URL_BASE } from "./client";

let socket = null;

export function getSocket() {
  if (!socket) {
    // The backend is served by Waitress, a synchronous WSGI server that
    // can't perform a real WebSocket upgrade (no eventlet/gevent). Restrict
    // to polling so the client never attempts the upgrade at all -- letting
    // it try and fail is noisy (server-side tracebacks) even though it
    // would otherwise fall back to polling on its own.
    const opts = { transports: ["polling"] };
    socket = API_URL_BASE ? io(API_URL_BASE, opts) : io(opts);
  }
  return socket;
}

export function joinRoom(room) {
  getSocket().emit("join", { room });
}

export function leaveRoom(room) {
  getSocket().emit("leave", { room });
}
