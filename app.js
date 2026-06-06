/*
  Truco 3 vs 3 - GitHub Pages
  - Visitantes: leen data.json.
  - Admin (?admin=1): puede guardar data.json usando un token de GitHub.
*/

const CONFIG = {
  owner: "TrucoVerdaderos",
  repo: "truco",
  branch: "main",
  dataPath: "data.json",
  pollMs: 5000
};

const PLAYER_ORDER = ["nico", "scrava", "gaspe", "valen", "rama", "seba"];
const STORAGE_TOKEN = "truco_admin_token";
const STORAGE_LOCAL_DB = "truco_local_db";

let db = null;
let remoteSha = null;
let lastLoadedVersion = 0;
let isAdmin = new URLSearchParams(window.location.search).get("admin") === "1";
let isSaving = false;
let pollTimer = null;

const $ = (id) => document.getElementById(id);

function createInitialData() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    players: {
      nico: { id: "nico", name: "Nico", rating: 300, played: 0, wins: 0, losses: 0 },
      scrava: { id: "scrava", name: "Scrava", rating: 300, played: 0, wins: 0, losses: 0 },
      gaspe: { id: "gaspe", name: "Gaspe", rating: 300, played: 0, wins: 0, losses: 0 },
      valen: { id: "valen", name: "Valen", rating: 300, played: 0, wins: 0, losses: 0 },
      rama: { id: "rama", name: "Rama", rating: 300, played: 0, wins: 0, losses: 0 },
      seba: { id: "seba", name: "Seba", rating: 300, played: 0, wins: 0, losses: 0 }
    },
    activeMatch: null,
    matches: [],
    headToHead: {}
  };
}

function getGithubConfig() {
  const cfg = { ...CONFIG };
  const host = window.location.hostname;
  const pathParts = window.location.pathname.split("/").filter(Boolean);

  if ((!cfg.owner || !cfg.repo) && host.endsWith(".github.io")) {
    cfg.owner = cfg.owner || host.replace(".github.io", "");
    cfg.repo = cfg.repo || (pathParts[0] || `${cfg.owner}.github.io`);
  }

  return cfg;
}

function hasGithubConfig() {
  const cfg = getGithubConfig();
  return Boolean(cfg.owner && cfg.repo && cfg.dataPath);
}

function githubContentUrl() {
  const cfg = getGithubConfig();
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${cfg.dataPath}?ref=${encodeURIComponent(cfg.branch)}`;
}

function b64ToText(b64) {
  const clean = b64.replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function textToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary);
}

async function getRemoteData(token = "") {
  const headers = { "Accept": "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(githubContentUrl(), { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`No pude leer GitHub: ${response.status}`);

  const payload = await response.json();
  const parsed = JSON.parse(b64ToText(payload.content));
  return { data: normalizeData(parsed), sha: payload.sha };
}

async function loadData({ silent = false } = {}) {
  setSync("Sincronizando", "warn");

  try {
    if (hasGithubConfig()) {
      const token = isAdmin ? (localStorage.getItem(STORAGE_TOKEN) || "") : "";
      const remote = await getRemoteData(token);
      db = remote.data;
      remoteSha = remote.sha;
      lastLoadedVersion = db.version || 1;
      localStorage.setItem(STORAGE_LOCAL_DB, JSON.stringify(db));
      setSync("Actualizado", "good");
      render();
      return;
    }
  } catch (error) {
    console.warn(error);
  }

  try {
    const response = await fetch(`${CONFIG.dataPath}?t=${Date.now()}`, { cache: "no-store" });
    if (response.ok) {
      db = normalizeData(await response.json());
      lastLoadedVersion = db.version || 1;
      localStorage.setItem(STORAGE_LOCAL_DB, JSON.stringify(db));
      const hostedOnGithubPages = window.location.hostname.endsWith(".github.io");
      setSync(hostedOnGithubPages ? "Actualizado" : "Modo local", hostedOnGithubPages ? "good" : "warn");
      render();
      return;
    }
  } catch (error) {
    console.warn(error);
  }

  const local = localStorage.getItem(STORAGE_LOCAL_DB);
  db = local ? normalizeData(JSON.parse(local)) : createInitialData();
  lastLoadedVersion = db.version || 1;
  setSync("Modo local", "warn");
  render();
  if (!silent) showToast("No pude leer GitHub. Estoy usando datos locales.");
}

function normalizeData(input) {
  const base = createInitialData();
  const next = { ...base, ...input };
  next.players = { ...base.players, ...(input.players || {}) };

  for (const id of PLAYER_ORDER) {
    const p = next.players[id] || base.players[id];
    next.players[id] = {
      id,
      name: p.name || base.players[id].name,
      rating: Number.isFinite(Number(p.rating)) ? Number(p.rating) : 300,
      played: Number.isFinite(Number(p.played)) ? Number(p.played) : 0,
      wins: Number.isFinite(Number(p.wins)) ? Number(p.wins) : 0,
      losses: Number.isFinite(Number(p.losses)) ? Number(p.losses) : 0
    };
  }

  next.matches = Array.isArray(next.matches) ? next.matches : [];
  next.headToHead = next.headToHead || {};
  next.activeMatch = next.activeMatch || null;
  if (next.activeMatch) {
    next.activeMatch.rounds = Array.isArray(next.activeMatch.rounds) ? next.activeMatch.rounds : [];
    next.activeMatch.picaLoadedInTurn = Boolean(next.activeMatch.picaLoadedInTurn);
    next.activeMatch.nextRoundType = next.activeMatch.nextRoundType || "redonda";
  }
  next.version = Number.isFinite(Number(next.version)) ? Number(next.version) : 1;
  next.updatedAt = next.updatedAt || new Date().toISOString();
  pruneOldMatches(next);
  return next;
}

async function persistData(message = "Actualizar datos del truco") {
  if (!db) return;
  pruneOldMatches(db);

  const token = localStorage.getItem(STORAGE_TOKEN);
  if (!token || !hasGithubConfig()) {
    db.version = (db.version || 0) + 1;
    db.updatedAt = new Date().toISOString();
    lastLoadedVersion = db.version;
    localStorage.setItem(STORAGE_LOCAL_DB, JSON.stringify(db));
    setSync("Guardado local", "warn");
    render();
    showToast("Guardado solo en este navegador. Para compartir, cargá el token admin.");
    return;
  }

  if (isSaving) return;
  isSaving = true;
  setSync("Guardando", "warn");

  try {
    const remote = await getRemoteData(token);
    if ((remote.data.version || 0) !== lastLoadedVersion && remote.sha !== remoteSha) {
      db = remote.data;
      remoteSha = remote.sha;
      lastLoadedVersion = db.version || 1;
      localStorage.setItem(STORAGE_LOCAL_DB, JSON.stringify(db));
      render();
      throw new Error("Hay una versión nueva en GitHub. Recargué los datos para no pisar cambios.");
    }

    db.version = Math.max(db.version || 0, remote.data.version || 0) + 1;
    db.updatedAt = new Date().toISOString();

    const cfg = getGithubConfig();
    const response = await fetch(githubContentUrl().replace(`?ref=${encodeURIComponent(cfg.branch)}`, ""), {
      method: "PUT",
      headers: {
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        message,
        content: textToB64(JSON.stringify(db, null, 2)),
        sha: remote.sha,
        branch: cfg.branch
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || `GitHub rechazó el guardado: ${response.status}`);
    }

    const saved = await response.json();
    remoteSha = saved.content?.sha || null;
    lastLoadedVersion = db.version;
    localStorage.setItem(STORAGE_LOCAL_DB, JSON.stringify(db));
    setSync("Guardado", "good");
    render();
  } catch (error) {
    console.error(error);
    setSync("Error", "bad");
    showToast(error.message);
  } finally {
    isSaving = false;
  }
}

function pruneOldMatches(data) {
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  data.matches = (data.matches || []).filter(match => {
    const t = new Date(match.finishedAt || match.date || match.createdAt || 0).getTime();
    return Number.isFinite(t) && t >= oneYearAgo;
  });
}

function playerName(id) {
  return db?.players?.[id]?.name || id;
}

function teamName(match, side) {
  const ids = side === "A" ? match.teamA : match.teamB;
  return ids.map(playerName).join(" / ");
}

function clampScore(value) {
  return Math.max(0, Math.min(30, Number(value) || 0));
}

function getMaxScore(match) {
  return Math.max(match.scoreA || 0, match.scoreB || 0);
}

function nextRoundLabel(type) {
  if (type === "pica-pica") return "Pica pica";
  if (type === "finalizado") return "Finalizado";
  return "Redonda";
}

function createSnapshot(match) {
  return {
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    nextRoundType: match.nextRoundType,
    hasReachedFive: Boolean(match.hasReachedFive),
    picaLoadedInTurn: Boolean(match.picaLoadedInTurn)
  };
}

function restoreSnapshot(match, snapshot) {
  match.scoreA = snapshot.scoreA;
  match.scoreB = snapshot.scoreB;
  match.nextRoundType = snapshot.nextRoundType;
  match.hasReachedFive = Boolean(snapshot.hasReachedFive);
  match.picaLoadedInTurn = Boolean(snapshot.picaLoadedInTurn);
}

function calculateNextRoundType(match, currentRoundType) {
  const max = getMaxScore(match);
  if (max >= 30) return "finalizado";
  if (max >= 25) return "redonda";
  if (currentRoundType === "pica-pica") return "redonda";
  if (max >= 5) return "pica-pica";
  return "redonda";
}

function goToNextRound() {
  const match = db.activeMatch;
  if (!match) return;

  if (match.nextRoundType === "finalizado") {
    showToast("El partido ya puede finalizarse.");
    return;
  }

  if (match.nextRoundType === "pica-pica" && !match.picaLoadedInTurn) {
    showToast("Primero cargá el pica pica.");
    return;
  }

  const previous = createSnapshot(match);
  const from = match.nextRoundType;
  const to = calculateNextRoundType(match, from);
  match.nextRoundType = to;
  match.hasReachedFive = getMaxScore(match) >= 5;
  match.picaLoadedInTurn = false;

  match.rounds.push({
    id: crypto.randomUUID(),
    type: "siguiente-ronda",
    createdAt: new Date().toISOString(),
    from,
    to,
    previous
  });

  persistData("Truco: siguiente ronda");
  maybeOfferFinish();
}

function normalizeAfterCorrection(match) {
  const max = getMaxScore(match);
  if (max >= 30) {
    match.nextRoundType = "finalizado";
    match.hasReachedFive = true;
    match.picaLoadedInTurn = false;
  } else if (max < 5) {
    match.nextRoundType = "redonda";
    match.hasReachedFive = false;
    match.picaLoadedInTurn = false;
  } else if (max >= 25 && match.nextRoundType === "pica-pica") {
    match.nextRoundType = "redonda";
    match.hasReachedFive = true;
    match.picaLoadedInTurn = false;
  }
}

function addRedondaPoints(team, points) {
  const match = db.activeMatch;
  if (!match) return;

  points = Number(points);
  if (!Number.isFinite(points) || points === 0) return;

  if (points > 0 && match.nextRoundType === "pica-pica") {
    showToast("Toca pica pica. Cargalo desde el botón central.");
    return;
  }

  const previous = createSnapshot(match);
  if (team === "A") match.scoreA = clampScore((match.scoreA || 0) + points);
  if (team === "B") match.scoreB = clampScore((match.scoreB || 0) + points);

  const round = {
    id: crypto.randomUUID(),
    type: points > 0 ? "redonda" : "correccion",
    createdAt: new Date().toISOString(),
    team,
    points,
    previous
  };
  match.rounds.push(round);

  if (getMaxScore(match) >= 30) {
    match.nextRoundType = "finalizado";
  }
  if (points < 0) normalizeAfterCorrection(match);

  persistData(`Truco: ${playerTeamLabel(match, team)} ${points > 0 ? "+" : ""}${points}`);
  maybeOfferFinish();
}

function sideLabel(side) {
  return side === "A" ? "Nosotros" : "Ellos";
}

function playerInitial(id) {
  return (playerName(id) || "?").slice(0, 1).toUpperCase();
}

function teamAccentClass(id) {
  const match = db?.activeMatch;
  if (match?.teamA?.includes(id)) return "avatar-a";
  if (match?.teamB?.includes(id)) return "avatar-b";
  return PLAYER_ORDER.indexOf(id) < 3 ? "avatar-a" : "avatar-b";
}

function playerTeamLabel(match, side) {
  return sideLabel(side);
}

function openPicaDialog() {
  const match = db.activeMatch;
  if (!match) return;

  if (match.nextRoundType !== "pica-pica") {
    showToast("Ahora no toca pica pica.");
    return;
  }
  if (match.picaLoadedInTurn) {
    showToast("Este pica pica ya fue cargado. Tocá Siguiente ronda.");
    return;
  }

  const wrap = $("picaInputs");
  wrap.innerHTML = "";

  match.picaPairs.forEach((pair, index) => {
    const row = document.createElement("div");
    row.className = "pica-row";
    row.innerHTML = `
      <strong>${playerName(pair.a)}</strong>
      <input id="picaA${index}" type="number" min="0" step="1" aria-label="Puntos ${playerName(pair.a)}">
      <input id="picaB${index}" type="number" min="0" step="1" aria-label="Puntos ${playerName(pair.b)}">
      <strong>${playerName(pair.b)}</strong>
    `;
    wrap.appendChild(row);
  });

  $("picaDialog").showModal();
}

function savePicaPica(event) {
  event.preventDefault();
  const match = db.activeMatch;
  if (!match) return;

  const previous = createSnapshot(match);
  const duels = match.picaPairs.map((pair, index) => {
    const pointsA = Math.max(0, Number($(`picaA${index}`).value) || 0);
    const pointsB = Math.max(0, Number($(`picaB${index}`).value) || 0);
    return {
      playerA: pair.a,
      playerB: pair.b,
      pointsA,
      pointsB
    };
  });

  const totalA = duels.reduce((sum, duel) => sum + duel.pointsA, 0);
  const totalB = duels.reduce((sum, duel) => sum + duel.pointsB, 0);
  const diff = totalA - totalB;

  let netWinner = "empate";
  let netPoints = 0;
  if (diff > 0) {
    netWinner = "A";
    netPoints = diff;
    match.scoreA = clampScore(match.scoreA + diff);
  } else if (diff < 0) {
    netWinner = "B";
    netPoints = Math.abs(diff);
    match.scoreB = clampScore(match.scoreB + Math.abs(diff));
  }

  match.rounds.push({
    id: crypto.randomUUID(),
    type: "pica-pica",
    createdAt: new Date().toISOString(),
    duels,
    totalA,
    totalB,
    netWinner,
    netPoints,
    previous
  });

  match.picaLoadedInTurn = true;
  if (getMaxScore(match) >= 30) {
    match.nextRoundType = "finalizado";
    match.picaLoadedInTurn = false;
  }
  $("picaDialog").close();
  persistData("Truco: cargar pica pica");
  maybeOfferFinish();
}

function undoLastRound() {
  const match = db.activeMatch;
  if (!match || !match.rounds.length) {
    showToast("No hay cargas para deshacer.");
    return;
  }
  const last = match.rounds.pop();
  if (last.previous) restoreSnapshot(match, last.previous);
  persistData("Truco: deshacer última carga");
}


function openCorrectDialog() {
  const match = db.activeMatch;
  if (!match) return;
  $("correctA").value = match.scoreA;
  $("correctB").value = match.scoreB;
  $("correctDialog").showModal();
}

function saveCorrection(event) {
  event.preventDefault();
  const match = db.activeMatch;
  if (!match) return;
  const previous = createSnapshot(match);
  match.scoreA = clampScore($("correctA").value);
  match.scoreB = clampScore($("correctB").value);
  normalizeAfterCorrection(match);
  match.rounds.push({
    id: crypto.randomUUID(),
    type: "correccion",
    createdAt: new Date().toISOString(),
    scoreA: match.scoreA,
    scoreB: match.scoreB,
    previous
  });
  $("correctDialog").close();
  persistData("Truco: corregir marcador");
  maybeOfferFinish();
}

function maybeOfferFinish() {
  const match = db.activeMatch;
  if (!match || !isAdmin) return;
  if (match.scoreA >= 30 || match.scoreB >= 30) {
    setTimeout(() => showToast("Un equipo llegó a 30. Ya podés finalizar el partido."), 400);
  }
}

function finishMatch() {
  const match = db.activeMatch;
  if (!match) return;

  if (match.scoreA === match.scoreB) {
    showToast("No se puede finalizar empatado.");
    return;
  }

  const winner = match.scoreA > match.scoreB ? "A" : "B";
  if (getMaxScore(match) < 30 && !confirm("Nadie llegó a 30. ¿Finalizar igual?")) return;

  const ratingChanges = calculateRatingChanges(match, winner);
  const winnerTeam = winner === "A" ? match.teamA : match.teamB;
  const loserTeam = winner === "A" ? match.teamB : match.teamA;

  for (const id of winnerTeam) {
    db.players[id].wins += 1;
    db.players[id].played += 1;
    db.players[id].rating = Math.max(0, Math.round(db.players[id].rating + ratingChanges[id]));
  }
  for (const id of loserTeam) {
    db.players[id].losses += 1;
    db.players[id].played += 1;
    db.players[id].rating = Math.max(0, Math.round(db.players[id].rating + ratingChanges[id]));
  }

  updateHeadToHeadFromMatch(match);

  const finished = {
    ...match,
    winner,
    ratingChanges,
    finishedAt: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10)
  };

  db.matches.unshift(finished);
  db.activeMatch = null;
  pruneOldMatches(db);
  persistData("Truco: finalizar partido");
}

function calculatePicaNetByPlayer(match) {
  const net = Object.fromEntries(PLAYER_ORDER.map(id => [id, 0]));
  for (const round of match.rounds || []) {
    if (round.type !== "pica-pica") continue;
    for (const duel of round.duels || []) {
      const diff = (duel.pointsA || 0) - (duel.pointsB || 0);
      net[duel.playerA] += diff;
      net[duel.playerB] -= diff;
    }
  }
  return net;
}

function calculateRatingChanges(match, winner) {
  const changes = {};
  const margin = Math.abs(match.scoreA - match.scoreB);
  const marginBonus = margin >= 11 ? 8 : margin >= 6 ? 5 : margin >= 1 ? 2 : 0;
  const base = 20 + marginBonus;
  const picaNet = calculatePicaNetByPlayer(match);
  const winnerTeam = winner === "A" ? match.teamA : match.teamB;
  const loserTeam = winner === "A" ? match.teamB : match.teamA;

  for (const id of winnerTeam) changes[id] = base + (picaNet[id] || 0) * 2;
  for (const id of loserTeam) changes[id] = -base + (picaNet[id] || 0) * 2;
  return changes;
}

function h2hKey(a, b) {
  return [a, b].sort().join("__");
}

function updateHeadToHeadFromMatch(match) {
  db.headToHead = db.headToHead || {};
  for (const round of match.rounds || []) {
    if (round.type !== "pica-pica") continue;
    for (const duel of round.duels || []) {
      const key = h2hKey(duel.playerA, duel.playerB);
      if (!db.headToHead[key]) {
        db.headToHead[key] = {
          players: key.split("__"),
          played: 0,
          wins: {},
          points: {}
        };
      }
      const stat = db.headToHead[key];
      stat.played += 1;
      stat.points[duel.playerA] = (stat.points[duel.playerA] || 0) + duel.pointsA;
      stat.points[duel.playerB] = (stat.points[duel.playerB] || 0) + duel.pointsB;
      if (duel.pointsA > duel.pointsB) stat.wins[duel.playerA] = (stat.wins[duel.playerA] || 0) + 1;
      if (duel.pointsB > duel.pointsA) stat.wins[duel.playerB] = (stat.wins[duel.playerB] || 0) + 1;
    }
  }
}

function createNewMatch(event) {
  event.preventDefault();

  const teamA = [$("teamA1").value, $("teamA2").value, $("teamA3").value];
  const teamB = [$("teamB1").value, $("teamB2").value, $("teamB3").value];
  const all = [...teamA, ...teamB];
  const unique = new Set(all);

  if (unique.size !== 6 || all.some(Boolean) === false) {
    showToast("Cada jugador debe estar una sola vez y los equipos tienen que ser de 3.");
    return;
  }

  const pairs = [
    { a: $("pairA1").value, b: $("pairB1").value },
    { a: $("pairA2").value, b: $("pairB2").value },
    { a: $("pairA3").value, b: $("pairB3").value }
  ];

  const pairAs = new Set(pairs.map(p => p.a));
  const pairBs = new Set(pairs.map(p => p.b));
  if (pairAs.size !== 3 || pairBs.size !== 3 || pairs.some(p => !teamA.includes(p.a) || !teamB.includes(p.b))) {
    showToast("Los cruces de pica pica deben usar a los 3 jugadores de cada equipo una sola vez.");
    return;
  }

  if (db.activeMatch && !confirm("Ya hay una partida activa. ¿Reemplazarla?")) return;

  db.activeMatch = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    teamA,
    teamB,
    picaPairs: pairs,
    scoreA: 0,
    scoreB: 0,
    nextRoundType: "redonda",
    hasReachedFive: false,
    picaLoadedInTurn: false,
    rounds: []
  };

  persistData("Truco: crear partida");
  setActiveTab("partido");
}

function render() {
  if (!db) return;
  renderStatus();
  renderMatch();
  renderRanking();
  renderCurrentH2H();
  renderHistoricH2H();
  renderHistory();
  renderQuickStats();
  populateAdminSelects();
}

function renderStatus() {
  const match = db.activeMatch;
  $("roleBadge").textContent = isAdmin ? "Admin" : "Visitante";
  $("updatedAt").textContent = db.updatedAt ? `Última actualización: ${formatDateTime(db.updatedAt)}` : "";

  $("stickyScore").classList.toggle("hidden", !match);

  if (!match) {
    $("matchStatus").textContent = "No hay partida activa";
    return;
  }

  if (match.scoreA >= 30 || match.scoreB >= 30) {
    const winner = match.scoreA > match.scoreB ? "Nosotros" : "Ellos";
    $("matchStatus").textContent = `${winner} llegó a 30`;
  } else {
    $("matchStatus").textContent = `${teamName(match, "A")} vs ${teamName(match, "B")}`;
  }
}

function renderMatch() {
  const match = db.activeMatch;
  $("noMatch").classList.toggle("hidden", Boolean(match));
  $("matchView").classList.toggle("hidden", !match);
  if (!match) return;

  $("teamAName").textContent = "Nosotros";
  $("teamBName").textContent = "Ellos";
  $("scoreA").textContent = match.scoreA;
  $("scoreB").textContent = match.scoreB;
  $("nextRound").textContent = nextRoundLabel(match.nextRoundType);
  $("stickyScoreA").textContent = match.scoreA;
  $("stickyScoreB").textContent = match.scoreB;
  $("stickyNextRound").textContent = nextRoundLabel(match.nextRoundType);
  $("roundHint").textContent = getRoundHint(match);

  $("teamAPlayers").innerHTML = match.teamA.map(id => `<span class="chip">${playerName(id)}</span>`).join("");
  $("teamBPlayers").innerHTML = match.teamB.map(id => `<span class="chip">${playerName(id)}</span>`).join("");

  $("teamACard").classList.toggle("winning", match.scoreA > match.scoreB);
  $("teamBCard").classList.toggle("winning", match.scoreB > match.scoreA);
  $("teamACard").classList.toggle("losing", match.scoreA < match.scoreB);
  $("teamBCard").classList.toggle("losing", match.scoreB < match.scoreA);

  $("loadPicaBtn").disabled = match.nextRoundType !== "pica-pica" || Boolean(match.picaLoadedInTurn);
  $("nextRoundBtn").disabled = match.nextRoundType === "finalizado" || (match.nextRoundType === "pica-pica" && !match.picaLoadedInTurn);
  $("finishBtn").disabled = match.scoreA === match.scoreB;

  $("picaPairs").innerHTML = match.picaPairs.map((pair, index) => `
    <div class="list-item pica-match">
      <div class="pica-player pica-player-a">
        <span class="avatar avatar-a">${playerInitial(pair.a)}</span>
        <div><strong>${playerName(pair.a)}</strong></div>
      </div>
      <div class="pica-scoreline">
        <span>0</span><em>vs</em><span>0</span>
      </div>
      <div class="pica-player pica-player-b">
        <div><strong>${playerName(pair.b)}</strong></div>
        <span class="avatar avatar-b">${playerInitial(pair.b)}</span>
      </div>
    </div>
  `).join("");

  const recent = [...(match.rounds || [])].slice(-6).reverse();
  $("roundLog").innerHTML = recent.length ? recent.map(roundLogHtml).join("") : `<p class="muted">Todavía no se cargaron puntos.</p>`;
}

function getRoundHint(match) {
  const max = getMaxScore(match);
  if (max >= 30) return "El partido ya puede finalizarse.";
  if (max >= 25) return "Desde 25 no hay más pica pica.";
  if (match.nextRoundType === "pica-pica" && match.picaLoadedInTurn) return "Pica pica cargado. Tocá Siguiente ronda.";
  if (match.nextRoundType === "pica-pica") return "Cargá los tres mano a mano y se suma el neto.";
  if (max < 5) return "Sumá los puntos y tocá Siguiente ronda al cerrar la mano.";
  return "Sumá los puntos y tocá Siguiente ronda. Alterna hasta 25.";
}

function roundLogHtml(round) {
  if (round.type === "pica-pica") {
    const winner = round.netWinner === "empate" ? "Empate" : `${sideLabel(round.netWinner)} +${round.netPoints}`;
    return `<div class="list-item"><div><strong>Pica pica</strong><div class="small">${round.totalA} a ${round.totalB}</div></div><span class="pill">${winner}</span></div>`;
  }
  if (round.type === "correccion") {
    return `<div class="list-item"><div><strong>Corrección</strong><div class="small">Marcador ajustado</div></div><span class="pill">${round.scoreA ?? ""} - ${round.scoreB ?? ""}</span></div>`;
  }
  if (round.type === "siguiente-ronda") {
    return `<div class="list-item"><div><strong>Siguiente ronda</strong><div class="small">${nextRoundLabel(round.from)} → ${nextRoundLabel(round.to)}</div></div><span class="pill">${nextRoundLabel(round.to)}</span></div>`;
  }
  return `<div class="list-item"><div><strong>Redonda</strong><div class="small">${sideLabel(round.team)}</div></div><span class="pill">${round.points > 0 ? "+" : ""}${round.points}</span></div>`;
}

function renderRanking() {
  const rows = PLAYER_ORDER
    .map(id => db.players[id])
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.name.localeCompare(b.name));

  $("rankingRows").innerHTML = rows.map((p, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><span class="avatar ${teamAccentClass(p.id)}">${playerInitial(p.id)}</span> ${p.name}</td>
      <td><strong>${Math.round(p.rating)}</strong></td>
      <td>${p.played}</td>
      <td>${p.wins}</td>
      <td>${p.losses}</td>
    </tr>
  `).join("");

  if ($("miniRankingRows")) {
    $("miniRankingRows").innerHTML = rows.map((p, index) => `
      <tr>
        <td>${index + 1}</td>
        <td><span class="avatar ${teamAccentClass(p.id)}">${playerInitial(p.id)}</span> ${p.name}</td>
        <td>${p.played}</td>
        <td><strong>${Math.round(p.rating)}</strong></td>
      </tr>
    `).join("");
  }
}

function renderCurrentH2H() {
  const match = db.activeMatch;
  if (!match) {
    $("currentH2H").innerHTML = `<p class="muted">No hay partida activa.</p>`;
    return;
  }

  const totals = {};
  for (const pair of match.picaPairs) {
    totals[h2hKey(pair.a, pair.b)] = { a: pair.a, b: pair.b, netA: 0, netB: 0 };
  }

  for (const round of match.rounds || []) {
    if (round.type !== "pica-pica") continue;
    for (const duel of round.duels || []) {
      const key = h2hKey(duel.playerA, duel.playerB);
      if (!totals[key]) totals[key] = { a: duel.playerA, b: duel.playerB, netA: 0, netB: 0 };
      const diff = (duel.pointsA || 0) - (duel.pointsB || 0);
      if (totals[key].a === duel.playerA) {
        totals[key].netA += diff;
        totals[key].netB -= diff;
      } else {
        totals[key].netA -= diff;
        totals[key].netB += diff;
      }
    }
  }

  $("currentH2H").innerHTML = Object.values(totals).map(item => {
    const leader = item.netA === item.netB ? "Empate" : item.netA > item.netB ? `${playerName(item.a)} +${item.netA}` : `${playerName(item.b)} +${item.netB}`;
    return `<div class="list-item"><div><strong>${playerName(item.a)} vs ${playerName(item.b)}</strong><div class="small">Neto de esta partida</div></div><span class="pill">${leader}</span></div>`;
  }).join("");
}

function renderHistoricH2H() {
  const stats = Object.values(db.headToHead || {});
  if (!stats.length) {
    $("historicH2H").innerHTML = `<p class="muted">Todavía no hay mano a mano históricos.</p>`;
    return;
  }

  stats.sort((a, b) => b.played - a.played);
  $("historicH2H").innerHTML = stats.map(stat => {
    const [a, b] = stat.players;
    const winsA = stat.wins?.[a] || 0;
    const winsB = stat.wins?.[b] || 0;
    const pointsA = stat.points?.[a] || 0;
    const pointsB = stat.points?.[b] || 0;
    return `<div class="list-item">
      <div><strong>${playerName(a)} vs ${playerName(b)}</strong><div class="small">${stat.played} pica pica · victorias ${winsA}-${winsB} · puntos ${pointsA}-${pointsB}</div></div>
      <span class="pill">${pointsA === pointsB ? "Empate" : pointsA > pointsB ? playerName(a) : playerName(b)}</span>
    </div>`;
  }).join("");
}

function renderHistory() {
  const matches = db.matches || [];
  if (!matches.length) {
    $("historyList").innerHTML = `<p class="muted">Todavía no hay partidas finalizadas.</p>`;
    return;
  }

  $("historyList").innerHTML = matches.map(match => {
    const winnerName = match.winner === "A" ? teamName(match, "A") : teamName(match, "B");
    return `<div class="list-item">
      <div>
        <strong>${match.scoreA} - ${match.scoreB}</strong>
        <div class="small">${formatDateTime(match.finishedAt)} · ganó ${winnerName}</div>
      </div>
      <span class="pill">${match.rounds?.length || 0} rondas</span>
    </div>`;
  }).join("");
}

function renderQuickStats() {
  if (!$('statMatches')) return;
  const match = db?.activeMatch;
  const rounds = match?.rounds || [];
  $('statMatches').textContent = String((db?.matches?.length || 0) + (match ? 1 : 0));
  $('statRounds').textContent = String(rounds.filter(r => r.type !== 'siguiente-ronda').length);
  const lead = match ? Math.abs((match.scoreA || 0) - (match.scoreB || 0)) : 0;
  $('statLead').textContent = String(lead);
  $('statLeadTeam').textContent = !match || lead === 0 ? 'Empate' : match.scoreA > match.scoreB ? 'Nosotros' : 'Ellos';
  if (match?.createdAt) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(match.createdAt).getTime()) / 60000));
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    $('statTime').textContent = hours ? `${hours}h ${mins}m` : `${mins}m`;
  } else {
    $('statTime').textContent = '0m';
  }
}

function populateAdminSelects() {
  if (!isAdmin || !db) return;

  const allOptions = PLAYER_ORDER.map(id => `<option value="${id}">${playerName(id)}</option>`).join("");
  ["teamA1", "teamA2", "teamA3", "teamB1", "teamB2", "teamB3"].forEach(id => {
    if (!$(id).dataset.ready) {
      $(id).innerHTML = allOptions;
      $(id).dataset.ready = "1";
    }
  });

  setDefaultTeamsIfBlank();
  updatePairSelects();
}

function setDefaultTeamsIfBlank() {
  const defaults = {
    teamA1: "nico", teamA2: "seba", teamA3: "gaspe",
    teamB1: "rama", teamB2: "valen", teamB3: "scrava"
  };
  for (const [id, value] of Object.entries(defaults)) {
    if (!$(id).value || !$(id).dataset.defaultSet) {
      $(id).value = value;
      $(id).dataset.defaultSet = "1";
    }
  }
}

function updatePairSelects() {
  if (!isAdmin || !db) return;
  const teamA = [$("teamA1").value, $("teamA2").value, $("teamA3").value];
  const teamB = [$("teamB1").value, $("teamB2").value, $("teamB3").value];
  const optsA = teamA.map(id => `<option value="${id}">${playerName(id)}</option>`).join("");
  const optsB = teamB.map(id => `<option value="${id}">${playerName(id)}</option>`).join("");

  ["pairA1", "pairA2", "pairA3"].forEach((id, i) => {
    const previous = $(id).value || teamA[i];
    $(id).innerHTML = optsA;
    $(id).value = teamA.includes(previous) ? previous : teamA[i];
  });
  ["pairB1", "pairB2", "pairB3"].forEach((id, i) => {
    const previous = $(id).value || teamB[i];
    $(id).innerHTML = optsB;
    $(id).value = teamB.includes(previous) ? previous : teamB[i];
  });

  const defaultPairs = {
    pairA1: "seba", pairB1: "scrava",
    pairA2: "gaspe", pairB2: "valen",
    pairA3: "nico", pairB3: "rama"
  };
  for (const [id, value] of Object.entries(defaultPairs)) {
    const select = $(id);
    if ([...select.options].some(o => o.value === value) && !select.dataset.defaultSet) {
      select.value = value;
      select.dataset.defaultSet = "1";
    }
  }
}

function setSync(text, type = "") {
  const el = $("syncStatus");
  el.textContent = text;
  el.className = `pill ${type}`.trim();
}

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.add("hidden"), 4200);
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function setActiveTab(id) {
  document.querySelectorAll(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === id));
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === id));
}

function exportJson() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `truco-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    db = normalizeData(JSON.parse(text));
    await persistData("Truco: importar backup");
  } catch (error) {
    showToast("El JSON no es válido.");
  } finally {
    event.target.value = "";
  }
}

function resetAll() {
  if (!confirm("Esto borra ranking, historial y partida activa. ¿Seguro?")) return;
  db = createInitialData();
  persistData("Truco: reset total");
}

function bindEvents() {
  document.body.classList.toggle("admin-mode", isAdmin);
  $("roleBadge").textContent = isAdmin ? "Admin" : "Visitante";

  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  $("refreshBtn").addEventListener("click", () => loadData());

  document.querySelectorAll("[data-quick]").forEach(btn => {
    btn.addEventListener("click", () => {
      const [team, points] = btn.dataset.quick.split(":");
      addRedondaPoints(team, Number(points));
    });
  });

  $("loadPicaBtn").addEventListener("click", openPicaDialog);
  $("nextRoundBtn").addEventListener("click", goToNextRound);
  $("cancelPicaBtn").addEventListener("click", () => $("picaDialog").close());
  $("picaForm").addEventListener("submit", savePicaPica);
  $("undoBtn").addEventListener("click", undoLastRound);
  $("correctBtn").addEventListener("click", openCorrectDialog);
  $("cancelCorrectBtn").addEventListener("click", () => $("correctDialog").close());
  $("correctForm").addEventListener("submit", saveCorrection);
  $("finishBtn").addEventListener("click", finishMatch);

  $("newMatchForm").addEventListener("submit", createNewMatch);
  ["teamA1", "teamA2", "teamA3", "teamB1", "teamB2", "teamB3"].forEach(id => {
    $(id).addEventListener("change", updatePairSelects);
  });

  $("saveTokenBtn").addEventListener("click", () => {
    const token = $("tokenInput").value.trim();
    if (!token) {
      showToast("Pegá un token primero.");
      return;
    }
    localStorage.setItem(STORAGE_TOKEN, token);
    $("tokenInput").value = "";
    showToast("Token guardado en este navegador.");
  });

  $("clearTokenBtn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_TOKEN);
    showToast("Token borrado.");
  });

  $("exportBtn").addEventListener("click", exportJson);
  $("importInput").addEventListener("change", importJson);
  $("resetBtn").addEventListener("click", resetAll);
}

async function init() {
  bindEvents();
  await loadData({ silent: true });

  if (!isAdmin) {
    pollTimer = setInterval(() => loadData({ silent: true }), CONFIG.pollMs);
  }
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-tab-jump]");
  if (!target) return;
  setActiveTab(target.dataset.tabJump);
});

init();
