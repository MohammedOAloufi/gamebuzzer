import { els } from "./dom.js";
import { local, pageType, getServerNow } from "./state.js";
import { escapeHtml, getPlayerJoinUrl } from "./utils.js";
import {
  canBuzz,
  getCooldownSecondsLeft,
  getPlayersByTeam,
  getSelectedTeam,
  getSortedPresses,
  getWinnerTeam,
  isMyCooldownActive,
  normalizeSession,
  removeTeam,
  changeTeamPoints,
  updateTeamName,
} from "./session-service.js";

function playAudioSafe(audioEl) {
  if (!audioEl) return;

  try {
    audioEl.pause();
    audioEl.currentTime = 0;

    const playPromise = audioEl.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  } catch (error) {
    console.error(error);
  }
}

function ensureCountdownPool(audioEl) {
  if (!audioEl) return [];

  if (ensureCountdownPool._pool?.length) {
    return ensureCountdownPool._pool;
  }

  const src =
    audioEl.currentSrc ||
    audioEl.querySelector("source")?.src ||
    audioEl.getAttribute("src") ||
    "";

  if (!src) {
    ensureCountdownPool._pool = [audioEl];
    return ensureCountdownPool._pool;
  }

  const pool = [];

  for (let i = 0; i < 6; i += 1) {
    const tick = new Audio(src);
    tick.preload = "auto";
    tick.volume = audioEl.volume;
    tick.playbackRate = audioEl.playbackRate || 1;
    pool.push(tick);
  }

  ensureCountdownPool._pool = pool;
  ensureCountdownPool._index = 0;
  return pool;
}

function playCountdownTick(audioEl) {
  if (!audioEl) return;

  try {
    const pool = ensureCountdownPool(audioEl);
    if (!pool.length) return;

    const currentIndex = Number(ensureCountdownPool._index || 0) % pool.length;
    const tick = pool[currentIndex];
    ensureCountdownPool._index = (currentIndex + 1) % pool.length;

    tick.pause();
    tick.currentTime = 0;

    const playPromise = tick.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  } catch (error) {
    console.error(error);
  }
}

function cloneSoundSession(session) {
  return {
    code: String(session.code || ""),
    roundId: Number(session.roundId || 1),
    winnerTeamId:
      session.winnerTeamId === null || session.winnerTeamId === undefined
        ? null
        : Number(session.winnerTeamId),
    winnerPlayerId: String(session.winnerPlayerId || ""),
    answerExpired: Boolean(session.answerExpired),
    timerRunning: Boolean(session.timerRunning),
    timeLeft: Number(session.timeLeft || 0),
    maxTime: Number(session.maxTime || 0),
    roundStartedAt: Number(session.roundStartedAt || 0),
    teams: Array.isArray(session.teams)
      ? session.teams.map((team) => ({
          id: Number(team.id),
          points: Number(team.points || 0),
        }))
      : [],
  };
}

function formatCountdownValue(value, showDecimal = false) {
  const safeValue = Math.max(0, Number(value || 0));

  if (!showDecimal) {
    return String(Math.ceil(safeValue));
  }

  return safeValue.toFixed(1);
}

function syncHostSounds(session, displayTimeRaw = null) {
  if (pageType !== "host") return;

  const prevSession = syncHostSounds._prevSession || null;
  const currentRoundKey = [
    String(session.code || ""),
    Number(session.roundId || 1),
    String(session.winnerPlayerId || ""),
    Number(session.roundStartedAt || 0),
  ].join(":");

  const effectiveDisplayTime =
    displayTimeRaw === null || displayTimeRaw === undefined
      ? Number(session.timeLeft || 0)
      : Number(displayTimeRaw || 0);

  if (
    session.timerRunning &&
    !session.answerExpired &&
    session.winnerTeamId !== null &&
    Number.isFinite(effectiveDisplayTime) &&
    effectiveDisplayTime > 0
  ) {
    const currentSecond = Math.max(1, Math.ceil(effectiveDisplayTime));

    if (syncHostSounds._roundKey !== currentRoundKey) {
      syncHostSounds._roundKey = currentRoundKey;
      syncHostSounds._lastTickSecond = currentSecond;
      playCountdownTick(els.countdownTickAudio);
    } else if (currentSecond !== syncHostSounds._lastTickSecond) {
      if (currentSecond < syncHostSounds._lastTickSecond) {
        playCountdownTick(els.countdownTickAudio);
      }
      syncHostSounds._lastTickSecond = currentSecond;
    }
  } else {
    syncHostSounds._roundKey = "";
    syncHostSounds._lastTickSecond = null;
  }

  if (prevSession) {
    const previousPointsByTeam = new Map(
      (prevSession.teams || []).map((team) => [
        Number(team.id),
        Number(team.points || 0),
      ]),
    );

    const currentPointsByTeam = new Map(
      (session.teams || []).map((team) => [
        Number(team.id),
        Number(team.points || 0),
      ]),
    );

    const pointAddedFromWinnerButton =
      prevSession.answerExpired === false &&
      prevSession.winnerTeamId !== null &&
      session.winnerTeamId === null &&
      Number(session.roundId || 0) > Number(prevSession.roundId || 0) &&
      Number(
        currentPointsByTeam.get(Number(prevSession.winnerTeamId)) || 0,
      ) ===
        Number(
          previousPointsByTeam.get(Number(prevSession.winnerTeamId)) || 0,
        ) + 1;

    if (pointAddedFromWinnerButton) {
      playAudioSafe(els.pointAddedAudio);
    }
  }

  syncHostSounds._prevSession = cloneSoundSession(session);
}

function resetPlayerBuzzUiState(session) {
  if (!els.deviceBuzzBtn) return;

  const roundUiKey = [
    String(session.code || ""),
    Number(session.roundId || 0),
    Number(session.winnerTeamId ?? -1),
    Boolean(session.timerRunning),
    Boolean(session.answerExpired),
  ].join(":");

  if (resetPlayerBuzzUiState._lastRoundUiKey !== roundUiKey) {
    els.deviceBuzzBtn.dataset.pending = "0";
    els.deviceBuzzBtn.dataset.hardLocked = "0";
    els.deviceBuzzBtn.dataset.lockedAt = "";
    resetPlayerBuzzUiState._lastRoundUiKey = roundUiKey;
  }

  const roundIsFresh =
    session.winnerTeamId === null &&
    !session.locked &&
    !session.timerRunning &&
    !session.answerExpired;

  if (roundIsFresh) {
    els.deviceBuzzBtn.dataset.pending = "0";
    els.deviceBuzzBtn.dataset.hardLocked = "0";
    els.deviceBuzzBtn.dataset.lockedAt = "";
  }
}

export function showToast(message, isError = false) {
  if (!els.toast) return;

  els.toast.textContent = message;
  els.toast.style.background = isError ? "#dc2626" : "#10b981";
  els.toast.classList.add("show");

  clearTimeout(showToast._timer);

  showToast._timer = setTimeout(() => {
    els.toast.classList.remove("show");
  }, 1800);
}

export function showJoinError(message) {
  if (!els.joinErrorMessage) return;
  els.joinErrorMessage.textContent = message;
  els.joinErrorMessage.classList.remove("hidden");
}

export function hideJoinError() {
  if (!els.joinErrorMessage) return;
  els.joinErrorMessage.classList.add("hidden");
}

export function showPlayerJoinView() {
  if (els.joinView) els.joinView.classList.remove("hidden");
  if (els.buzzerView) els.buzzerView.classList.add("hidden");
}

export function showPlayerBuzzerView() {
  if (els.joinView) els.joinView.classList.add("hidden");
  if (els.buzzerView) els.buzzerView.classList.remove("hidden");
}

export function updateQRCode(code = local.currentSessionCode) {
  if (!els.qrcode || typeof QRCode === "undefined") return;
  if (!code) return;
  if (local.lastQrCodeValue === code) return;

  els.qrcode.innerHTML = "";

  new QRCode(els.qrcode, {
    text: getPlayerJoinUrl(code),
    width: 132,
    height: 132,
    colorDark: "#111827",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H,
  });

  local.lastQrCodeValue = code;
}

export function renderWinner(session) {
  if (!els.winnerEmpty || !els.winnerBox || !els.winnerName) return;

  const winnerTeam = getWinnerTeam(session);

  if (!winnerTeam || !session.winnerTeamId) {
    els.winnerEmpty.classList.remove("hidden");
    els.winnerBox.className = "winner-box";
    els.winnerName.textContent = "-";

    if (els.winnerTeamText) {
      els.winnerTeamText.textContent = "الفريق: -";
    }

    if (els.addPointBtn) {
      els.addPointBtn.textContent = "إضافة نقطة";
      els.addPointBtn.disabled = false;
    }

    return;
  }

  els.winnerEmpty.classList.add("hidden");

  if (session.answerExpired) {
    els.winnerBox.className = "winner-box show winner-box-expired";

    if (els.addPointBtn) {
      els.addPointBtn.textContent = "انتهى الوقت";
      els.addPointBtn.disabled = true;
    }
  } else {
    els.winnerBox.className = `winner-box show ${winnerTeam.colorClass}`;

    if (els.addPointBtn) {
      els.addPointBtn.textContent = "إضافة نقطة";
      els.addPointBtn.disabled = false;
    }
  }

  els.winnerName.textContent = session.winnerPlayerName || winnerTeam.name;

  if (els.winnerTeamText) {
    els.winnerTeamText.textContent = session.answerExpired
      ? `${winnerTeam.name} - انتهى وقته`
      : winnerTeam.name;
  }
}

export function renderHostBuzzButtons(session) {
  if (!els.hostBuzzGrid) return;

  els.hostBuzzGrid.innerHTML = "";
  const activePresses = getSortedPresses(session);

  session.teams.forEach((team) => {
    const isWinner = session.winnerTeamId === team.id;
    const players = getPlayersByTeam(session, team.id);
    const hasPlayers = players.length > 0;
    const currentPress = activePresses.find(
      (press) => Number(press.teamId) === Number(team.id),
    );

    const button = document.createElement("button");
    button.className = `team-buzz-btn ${team.colorClass} ${
      hasPlayers ? "has-players" : "no-players"
    } ${isWinner ? "is-current-winner" : ""} ${
      session.answerExpired && isWinner ? "expired-winner" : ""
    }`.trim();

    button.disabled = true;

    button.innerHTML = `
      <div class="team-buzz-top">
        <span class="team-buzz-name">${escapeHtml(team.name)}</span>
        <span class="team-players-count">${players.length}</span>
      </div>

      <div class="team-buzz-players">
        ${
          players.length
            ? players
                .map(
                  (player) =>
                    `<span class="team-player-chip">${escapeHtml(player)}</span>`,
                )
                .join("")
            : `<span class="team-player-chip muted-chip">لا يوجد لاعبين</span>`
        }
      </div>

      ${
        currentPress && !isWinner
          ? `<div class="team-winner-indicator">تم تسجيل ضغطة</div>`
          : ""
      }

      ${
        isWinner
          ? `<div class="team-winner-indicator">${
              session.answerExpired ? "انتهى وقت هذا الفريق" : "الفريق الفائز الحالي"
            }</div>`
          : ""
      }
    `;

    button.addEventListener("click", () => {
      showToast("ضغط الفرق من أجهزة اللاعبين فقط", true);
    });

    els.hostBuzzGrid.appendChild(button);
  });
}

export function renderTeamManager(session) {
  if (!els.teamManageList) return;

  const activeElement = document.activeElement;
  const isEditingTeamName =
    activeElement &&
    activeElement.tagName === "INPUT" &&
    activeElement.closest("#teamManageList");

  const renderKey = JSON.stringify(
    session.teams.map((team) => ({
      id: team.id,
      name: team.name,
      points: team.points,
      colorClass: team.colorClass,
    })),
  );

  if (local.lastTeamsRenderKey === renderKey) return;

  if (isEditingTeamName) {
    return;
  }

  local.lastTeamsRenderKey = renderKey;
  els.teamManageList.innerHTML = "";

  session.teams.forEach((team) => {
    const row = document.createElement("div");
    row.className = "team-manage-row modern-team-row";

    const removeBtn = document.createElement("button");
    removeBtn.className = "icon-trash-btn";
    removeBtn.type = "button";
    removeBtn.title = "حذف الفريق";
    removeBtn.innerHTML =
      '<img src="media/delete.png" alt="حذف" class="trash-icon-img" />';

    removeBtn.addEventListener("click", async () => {
      try {
        await removeTeam(team.id);
      } catch (error) {
        console.error(error);
        showToast(error.message || "تعذر حذف الفريق", true);
      }
    });

    const input = document.createElement("input");
    input.className = "input";
    input.value = team.name;
    input.maxLength = 40;

    input.addEventListener("input", (e) => {
      const newName = e.target.value.trim() ? e.target.value : team.name;

      clearTimeout(input._nameUpdateTimer);

      input._nameUpdateTimer = setTimeout(async () => {
        try {
          await updateTeamName(team.id, newName);
          local.lastTeamsRenderKey = "";
        } catch (error) {
          console.error(error);
          showToast("تعذر تحديث اسم الفريق", true);
        }
      }, 250);
    });

    input.addEventListener("blur", async (e) => {
      try {
        clearTimeout(input._nameUpdateTimer);
        const name = e.target.value.trim() ? e.target.value : team.name;
        await updateTeamName(team.id, name);
        local.lastTeamsRenderKey = "";
      } catch (error) {
        console.error(error);
        showToast("تعذر تحديث اسم الفريق", true);
      }
    });

    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();

        try {
          clearTimeout(input._nameUpdateTimer);
          const name = e.target.value.trim() ? e.target.value : team.name;
          await updateTeamName(team.id, name);
          local.lastTeamsRenderKey = "";
          input.blur();
        } catch (error) {
          console.error(error);
          showToast("تعذر تحديث اسم الفريق", true);
        }
      }
    });

    const scoreWrap = document.createElement("div");
    scoreWrap.className = "score-control-wrap";

    const plusBtn = document.createElement("button");
    plusBtn.className = "score-icon-btn";
    plusBtn.type = "button";
    plusBtn.textContent = "+";
    plusBtn.title = "زيادة نقطة";

    plusBtn.addEventListener("click", async () => {
      try {
        await changeTeamPoints(team.id, 1);
      } catch (error) {
        console.error(error);
        showToast("تعذر زيادة النقاط", true);
      }
    });

    const score = document.createElement("div");
    score.className = "score-box";
    score.textContent = String(team.points);

    const minusBtn = document.createElement("button");
    minusBtn.className = "score-icon-btn";
    minusBtn.type = "button";
    minusBtn.textContent = "−";
    minusBtn.title = "نقصان نقطة";

    minusBtn.addEventListener("click", async () => {
      try {
        await changeTeamPoints(team.id, -1);
      } catch (error) {
        console.error(error);
        showToast("تعذر إنقاص النقاط", true);
      }
    });

    scoreWrap.appendChild(plusBtn);
    scoreWrap.appendChild(score);
    scoreWrap.appendChild(minusBtn);

    row.appendChild(removeBtn);
    row.appendChild(input);
    row.appendChild(scoreWrap);

    els.teamManageList.appendChild(row);
  });
}

export function renderTeamSelect(session) {
  if (!els.selectedTeam) return;

  const storedTeamId = (() => {
    try {
      const raw = sessionStorage.getItem("gb_player_profile");
      if (!raw) return null;
      const data = JSON.parse(raw);
      return Number(data?.teamId);
    } catch (error) {
      return null;
    }
  })();

  const currentValue =
    Number(els.selectedTeam.value) || storedTeamId || session.teams[0]?.id || 1;

  const nextRenderKey = JSON.stringify(
    session.teams.map((team) => ({
      id: Number(team.id),
      name: String(team.name || "فريق"),
    })),
  );

  const isSelectFocused = document.activeElement === els.selectedTeam;

  if (
    els.selectedTeam.dataset.renderKey === nextRenderKey &&
    isSelectFocused
  ) {
    renderPlayerTeam(session);
    return;
  }

  if (els.selectedTeam.dataset.renderKey === nextRenderKey) {
    const hasCurrentOption = Array.from(els.selectedTeam.options).some(
      (option) => Number(option.value) === currentValue,
    );

    if (hasCurrentOption) {
      els.selectedTeam.value = String(currentValue);
      renderPlayerTeam(session);
      return;
    }
  }

  els.selectedTeam.innerHTML = "";

  session.teams.forEach((team) => {
    const option = document.createElement("option");
    option.value = String(team.id);
    option.textContent = team.name;

    if (team.id === currentValue) {
      option.selected = true;
    }

    els.selectedTeam.appendChild(option);
  });

  els.selectedTeam.dataset.renderKey = nextRenderKey;
  renderPlayerTeam(session);
}

export function renderPlayerTeam(session) {
  const selected = getSelectedTeam(session);

  if (els.deviceTeamName) {
    els.deviceTeamName.textContent = selected ? selected.name : "-";
  }

  if (els.deviceTeamPoints) {
    els.deviceTeamPoints.textContent = selected
      ? String(Number(selected.points || 0))
      : "0";
  }
}

export function renderSession(session) {
  if (els.sessionCode) els.sessionCode.textContent = session.code;
  if (els.deviceSessionCode) els.deviceSessionCode.textContent = session.code;
  if (els.miniSessionCode) els.miniSessionCode.textContent = session.code;

  if (els.joinUrlText) {
    els.joinUrlText.textContent = getPlayerJoinUrl(session.code);
  }

  updateQRCode(session.code);

  const serverNow = getServerNow();

  let displayTimeRaw = Number(session.timeLeft || session.maxTime || 0);
  let showDecimalTime = false;
  let locallyFinished = false;

  if (session.timerRunning && session.roundEndsAt) {
    const leftMs = Number(session.roundEndsAt) - serverNow;
    displayTimeRaw = Math.max(0, leftMs / 1000);
    showDecimalTime = true;
    locallyFinished = leftMs <= 0;
  }

  const activeCooldownSeconds = getCooldownSecondsLeft(session);
  const cooldownDisplay =
    activeCooldownSeconds > 0
      ? activeCooldownSeconds
      : Number(session.cooldown || 0);

  const isExpiredDisplay =
    locallyFinished ||
    (Boolean(session.answerExpired) &&
      !session.timerRunning &&
      Number(session.timeLeft || 0) === 0);

  const progress =
    session.maxTime > 0 ? (displayTimeRaw / session.maxTime) * 100 : 0;

  const displayTimeText = formatCountdownValue(displayTimeRaw, showDecimalTime);

  if (els.timeLeftText) els.timeLeftText.textContent = displayTimeText;
  if (els.timerBig) els.timerBig.textContent = displayTimeText;
  if (els.answerTimeBig) els.answerTimeBig.textContent = displayTimeText;

  if (els.cooldownTimeLeft) {
    els.cooldownTimeLeft.textContent = String(cooldownDisplay);
  }

  if (els.progressBar) {
    if (isExpiredDisplay) {
      els.progressBar.style.width = "100%";
      els.progressBar.classList.remove("expired");
    } else {
      els.progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
      els.progressBar.classList.remove("expired");
    }
  }

  if (els.timerStatusBadge) {
    if (isExpiredDisplay) {
      els.timerStatusBadge.textContent = "انتهى الوقت";
      els.timerStatusBadge.className = "state-badge gray";
    } else {
      els.timerStatusBadge.textContent = session.timerRunning
        ? "الوقت يعمل"
        : "متوقف";

      els.timerStatusBadge.className = `state-badge ${
        session.timerRunning ? "green" : ""
      }`.trim();
    }
  }

  if (els.lockStatusBadge) {
    const isOpen = !session.locked;
    els.lockStatusBadge.textContent = isOpen ? "الأزرار مفتوحة" : "الأزرار مقفلة";
    els.lockStatusBadge.className = `state-badge ${isOpen ? "green" : "red"}`;
  }

  if (els.toggleLockBtn) {
    els.toggleLockBtn.textContent = session.locked ? "فتح الأزرار" : "قفل الأزرار";
  }

  if (
    els.timeSelector &&
    pageType === "host" &&
    document.activeElement !== els.timeSelector
  ) {
    els.timeSelector.value = String(session.maxTime || 3);
  }

  if (
    els.cooldownSelector &&
    pageType === "host" &&
    document.activeElement !== els.cooldownSelector
  ) {
    els.cooldownSelector.value = String(session.cooldown ?? 0);
  }

  resetPlayerBuzzUiState(session);

  if (els.deviceBuzzBtn) {
    const enabled = !locallyFinished && canBuzz(session);
    els.deviceBuzzBtn.disabled = !enabled;

    if (enabled) {
      els.deviceBuzzBtn.dataset.pending = "0";
      els.deviceBuzzBtn.dataset.hardLocked = "0";
      els.deviceBuzzBtn.dataset.lockedAt = "";
    }

    const amIWinner =
      session.winnerPlayerId && session.winnerPlayerId === local.deviceId;

    if (amIWinner && !session.answerExpired && !locallyFinished) {
      els.deviceBuzzBtn.style.background =
        "linear-gradient(135deg, #22c55e, #16a34a)";
    } else if (isMyCooldownActive(session)) {
      els.deviceBuzzBtn.style.background =
        "linear-gradient(135deg, #64748b, #475569)";
    } else {
      els.deviceBuzzBtn.style.background = "";
    }
  }

  if (els.connectionBadge) {
    els.connectionBadge.textContent = local.joinedPlayer ? "متصل" : "بانتظار الانضمام";
    els.connectionBadge.className =
      `state-badge ${local.joinedPlayer ? "green" : ""}`.trim();
  }

  renderWinner(session);
  renderHostBuzzButtons(session);
  renderTeamManager(session);

  if (!local.joinedPlayer) {
    renderTeamSelect(session);
  }

  renderPlayerTeam(session);
  syncHostSounds(session, displayTimeRaw);
}

export function startUiTicker() {
  if (local.uiTickerStarted) return;
  local.uiTickerStarted = true;

  setInterval(() => {
    if (!local.lastSession) return;

    const session = normalizeSession(
      local.lastSession,
      local.currentSessionCode,
    );

    if (
      session.cooldownTeamId !== null &&
      session.cooldownEndsAt &&
      getServerNow() >= Number(session.cooldownEndsAt)
    ) {
      session.cooldownTeamId = null;
      session.cooldownEndsAt = null;
    }

    renderSession(session);
  }, 100);
}