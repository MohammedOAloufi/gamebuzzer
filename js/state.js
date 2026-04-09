import { createDeviceId } from "./utils.js";

export const TEAM_COLORS = [
  "team-blue",
  "team-red",
  "team-green",
  "team-purple",
  "team-orange",
  "team-yellow",
  "team-cyan",
];

export const PLAYER_ACTIVE_WINDOW_MS = 120000;
export const SESSION_IDLE_DELETE_MS = 600000;
export const PLAYER_HEARTBEAT_MS = 15000;
export const HOST_HEARTBEAT_MS = 20000;
export const SESSION_EXPIRY_MS = 600000;

export const pageType = (() => {
  const path = window.location.pathname.toLowerCase();

  if (path.endsWith("/host.html") || path.includes("host.html")) return "host";
  if (path.endsWith("/player.html") || path.includes("player.html")) {
    return "player";
  }

  return "home";
})();

export const local = {
  currentSessionCode: "",
  unsubscribeSession: null,
  deviceId: createDeviceId(),
  joinedPlayer: false,
  playerTeamId: null,
  playerName: "",
  lastSession: null,
  uiTickerStarted: false,
  lastQrCodeValue: "",
  lastTeamsRenderKey: "",
  playerHeartbeat: null,
  hostHeartbeat: null,
};