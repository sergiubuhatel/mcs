import { io } from "socket.io-client";
import { API_URL_BASE } from "./client";

let socket = null;

export function getSocket() {
  if (!socket) {
    const opts = { transports: ["websocket", "polling"] };
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
