export function createDeviceId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function randomCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

export function getTeamDisplayNameByColor(colorClass) {
  const names = {
    "team-blue": "الفريق الأزرق",
    "team-red": "الفريق الأحمر",
    "team-green": "الفريق الأخضر",
    "team-purple": "الفريق البنفسجي",
    "team-orange": "الفريق البرتقالي",
    "team-yellow": "الفريق الأصفر",
    "team-cyan": "الفريق السماوي",
  };

  return names[colorClass] || "فريق جديد";
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function sanitizeName(value) {
  const clean = String(value || "")
    .replace(/[<>]/g, "")
    .trim();

  return clean.slice(0, 40);
}

export function getBaseUrl() {
  return `${window.location.origin}${window.location.pathname.replace(
    /[^/]+$/,
    "",
  )}`;
}

export function getPlayerJoinUrl(code = "") {
  return `${getBaseUrl()}player.html?session=${encodeURIComponent(code)}`;
}