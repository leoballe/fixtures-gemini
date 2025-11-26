// =====================================================================
// APP.JS - VERSIÓN FINAL RESTAURADA
// Funcionalidad completa: Navegación + Lógica 20-24 Equipos + Fix IDs
// =====================================================================

const appState = {
  currentTournament: null,
  tournaments: [],
};

let currentExportMode = "zone";

// --- UTILIDADES ---
function safeId(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

function createEmptyTournament() {
  return {
    id: safeId("t"),
    name: "",
    category: "",
    dateStart: "",
    dateEnd: "",
    storageMode: "local",
    format: {
      type: "especial-8x3",
      liga: { rounds: "ida" },
      zonas: { qualifiersPerZone: 2, bestPlacesMode: "none" },
      eliminacion: { type: "simple" },
      restrictions: {},
    },
    teams: [],
    fields: [],
    breaks: [],
    dayTimeMin: "09:00",
    dayTimeMax: "22:00",
    matchDurationMinutes: 60,
    restMinMinutes: 90,
    matches: [],
    schedule: { dayConfigs: [] }
  };
}

// --- MANEJO DE FECHAS ---
function ensureDayConfigs(t) {
  if (!t || !t.dateStart || !t.dateEnd) {
    t.dayConfigs = [];
    return;
  }
  const start = new Date(t.dateStart + "T00:00:00");
  const end = new Date(t.dateEnd + "T00:00:00");
  
  if (end < start) return;

  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
  
  const oldConfigs = t.dayConfigs || [];
  const newConfigs = [];

  for (let i = 0; i < diffDays; i++) {
    const current = new Date(start);
    current.setDate(current.getDate() + i);
    const dateStr = current.toISOString().split('T')[0];
    
    if (oldConfigs[i]) {
      newConfigs.push({ ...oldConfigs[i], date: dateStr });
    } else {
      newConfigs.push({
        index: i + 1,
        date: dateStr,
        type: "full", 
        timeMin: t.dayTimeMin || "09:00",
        timeMax: t.dayTimeMax || "22:00"
      });
    }
  }
  t.dayConfigs = newConfigs;
}

// --- LOCAL STORAGE ---
const LS_KEY = "fixture-planner-tournaments";
function loadTournamentsFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) appState.tournaments = JSON.parse(raw);
  } catch (e) { console.error(e); }
}
function saveTournamentsToLocalStorage() {
  localStorage.setItem(LS_KEY, JSON.stringify(appState.tournaments));
}
function upsertCurrentTournament() {
  if (!appState.currentTournament) return;
  const t = appState.currentTournament;
  const idx = appState.tournaments.findIndex(x => x.id === t.id);
  if (idx >= 0) appState.tournaments[idx] = t;
  else appState.tournaments.push(t);
  saveTournamentsToLocalStorage();
}

// =====================================================================
// MOTORES DE GENERACIÓN DE PARTIDOS
// =====================================================================

function generarFixtureLiga(teamIds, options) {
  const { idaVuelta, zone, phase } = options;
  const equipos = teamIds.filter(x => x);
  if (equipos.length < 2) return [];

  if (equipos.length % 2 !== 0) equipos.push(null);
  const n = equipos.length;
  const rounds = n - 1;
  const matches = [];
  let arr = [...equipos];

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home && away) {
        matches.push({
          id: safeId("m"), code: null, zone: zone, phase: phase, round: r + 1,
          homeTeamId: home, awayTeamId: away, homeSeed: null, awaySeed: null,
          date: null, time: null, fieldId: null
        });
      }
    }
    arr = [arr[0], ...arr.slice(2), arr[1]];
  }

  if (idaVuelta) {
    const vueltas = matches.map(m => ({
      ...m, id: safeId("m"), homeTeamId: m.awayTeamId, awayTeamId: m.homeTeamId, round: m.round + rounds
    }));
    return [...matches, ...vueltas];
  }
  return matches;
}

function generarFixtureZonas(zonesMap, options) {
  const all = [];
  for (const z in zonesMap) {
    const ids = zonesMap[z];
    const part = generarFixtureLiga(ids, { ...options, zone: z, phase: "Fase de Zonas" });
    all.push(...part);
  }
  return all;
}

function generarLigaSeeds(seeds, options) {
  const { idaVuelta, zone, phase } = options;
  const arr = [...seeds];
  if (arr.length % 2 !== 0) arr.push(null);
  const n = arr.length;
  const rounds = n - 1;
  const matches = [];

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < n / 2; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home && away) {
        matches.push({
          id: safeId("m"), zone, phase, round: r + 1,
          homeTeamId: null, awayTeamId: null, homeSeed: home, awaySeed: away,
          date: null, time: null, fieldId: null
        });
      }
    }
    const pivot = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [pivot, ...rest]; // Rotación manual simple
  }

  if (idaVuelta) {
    const vueltas = matches.map(m => ({
      ...m, id: safeId("m"), homeSeed: m.awaySeed, awaySeed: m.homeSeed, round: m.round + rounds
    }));
    return [...matches, ...vueltas];
  }
  return matches;
}

function generarLlavesEliminacion(teamIds, options) {
    // Implementación básica de eliminación para cubrir el caso genérico
    // Nota: Para Evita usamos la función especial, esto es fallback.
    return []; 
}

// --- GENERADOR ESPECIAL EVITA 8x3 (20-24 EQ) ---
function generarEspecial8x3(t) {
  const zonesMap = {};
  t.teams.forEach(team => {
    const z = (team.zone || "").trim();
    if (z) {
      if (!zonesMap[z]) zonesMap[z] = [];
      zonesMap[z].push(team.id);
    }
  });

  const zoneNames = Object.keys(zonesMap).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const totalEquipos = t.teams.length;
  const allMatches = [];
  
  const idaVueltaGlobal = !!(t.format && t.format.liga && t.format.liga.rounds === "ida-vuelta");

  // 1. FASE ZONAS
  zoneNames.forEach(z => {
    const ids = zonesMap[z];
    const esZonaDe2 = ids.length === 2;
    const part = generarFixtureLiga(ids, { 
      idaVuelta: esZonaDe2 ? true : idaVueltaGlobal, 
      zone: z, 
      phase: "Fase 1 · Zonas" 
    });
    allMatches.push(...part);
  });

  // 2. FASE 2 (A1/A2)
  let seedsA1 = ["1°1°", "4°1°", "5°1°", "8°1°"];
  let seedsA2 = ["2°1°", "3°1°", "6°1°", "7°1°"];
  if (totalEquipos <= 21) {
    seedsA1 = ["1°1°", "4°1°", "5°1°", "1°2°"];
  }
  allMatches.push(...generarLigaSeeds(seedsA1, { idaVuelta: false, zone: "Zona A1", phase: "Fase 2 · Zona A1" }));
  allMatches.push(...generarLigaSeeds(seedsA2, { idaVuelta: false, zone: "Zona A2", phase: "Fase 2 · Zona A2" }));

  // 3. FASE 3 (FINALES 1-8)
  const finales1_8 = [
    { pos: 1, h: "1° Zona A1", a: "1° Zona A2" },
    { pos: 2, h: "2° Zona A1", a: "2° Zona A2" },
    { pos: 3, h: "3° Zona A1", a: "3° Zona A2" },
    { pos: 4, h: "4° Zona A1", a: "4° Zona A2" }
  ];
  finales1_8.forEach(f => {
    allMatches.push({
      id: safeId("m"), zone: "Puestos 1-8", phase: "Puestos 1-8", round: 1,
      homeTeamId: null, awayTeamId: null, homeSeed: f.h, awaySeed: f.a,
      date: null, time: null, fieldId: null
    });
  });

  // Helpers
  const crearMatch = (code, zone, phase, round, hSeed, aSeed, isBye = false) => ({
    id: safeId("m"), code, zone, phase, round, homeSeed: hSeed, awaySeed: aSeed, 
    homeTeamId: null, awayTeamId: null, date: null, time: null, fieldId: null, isByeMatch: isBye
  });
  const crearMatchRef = (code, zone, phase, round, refH, typeH, refA, typeA, isBye = false) => ({
    id: safeId("m"), code, zone, phase, round,
    homeSeed: `${typeH} ${refH}`, awaySeed: `${typeA} ${refA}`,
    fromHomeMatchCode: refH, fromHomeResult: typeH,
    fromAwayMatchCode: refA, fromAwayResult: typeA,
    homeTeamId: null, awayTeamId: null, date: null, time: null, fieldId: null, isByeMatch: isBye
  });

  // 4. LLAVE B (9-16)
  const zB = "Puestos 9-16"; const pB = "Puestos 9-16";
  let b_r1 = [];
  if (totalEquipos <= 21) {
    b_r1.push(crearMatch("P9_1", zB, pB, 1, "2°2°", "2°3°"));
    b_r1.push(crearMatch("P9_2", zB, pB, 1, "5°2°", "6°2°"));
    b_r1.push(crearMatch("P9_3", zB, pB, 1, "4°2°", "7°2°"));
    b_r1.push(crearMatch("P9_4", zB, pB, 1, "1°3°", "3°2°"));
  } else {
    b_r1.push(crearMatch("P9_1", zB, pB, 1, "1°2°", "8°2°"));
    b_r1.push(crearMatch("P9_2", zB, pB, 1, "4°2°", "5°2°"));
    b_r1.push(crearMatch("P9_3", zB, pB, 1, "3°2°", "6°2°"));
    b_r1.push(crearMatch("P9_4", zB, pB, 1, "2°2°", "7°2°"));
  }
  allMatches.push(...b_r1);
  
  const b_r2 = [
    crearMatchRef("P9_5", zB, pB, 2, "P9_1", "GP", "P9_2", "GP"),
    crearMatchRef("P9_6", zB, pB, 2, "P9_3", "GP", "P9_4", "GP"),
    crearMatchRef("P9_7", zB, pB, 2, "P9_1", "PP", "P9_2", "PP"),
    crearMatchRef("P9_8", zB, pB, 2, "P9_3", "PP", "P9_4", "PP")
  ];
  allMatches.push(...b_r2);

  const b_r3 = [
    crearMatchRef("P9_9", zB, pB, 3, "P9_5", "GP", "P9_6", "GP"),
    crearMatchRef("P9_10", zB, pB, 3, "P9_5", "PP", "P9_6", "PP"),
    crearMatchRef("P9_11", zB, pB, 3, "P9_7", "GP", "P9_8", "GP"),
    crearMatchRef("P9_12", zB, pB, 3, "P9_7", "PP", "P9_8", "PP")
  ];
  allMatches.push(...b_r3);

  // 5. LLAVE C (17-24)
  const zC = "Puestos 17-24"; const pC = "Puestos 17-24";
  
  if (totalEquipos === 20) {
    const c_r2 = [
      crearMatch("P17_1", zC, pC, 2, "3°3°", "6°3°"),
      crearMatch("P17_2", zC, pC, 2, "4°3°", "5°3°")
    ];
    allMatches.push(...c_r2);
    const c_r3 = [
      crearMatchRef("P17_3", zC, pC, 3, "P17_1", "GP", "P17_2", "GP"),
      crearMatchRef("P17_4", zC, pC, 3, "P17_1", "PP", "P17_2", "PP")
    ];
    allMatches.push(...c_r3);
  } else {
    let c_r1 = [];
    if (totalEquipos === 21) {
      c_r1.push(crearMatch("P17_1", zC, pC, 1, "3°3°", "BYE", true));
      c_r1.push(crearMatch("P17_2", zC, pC, 1, "6°3°", "7°3°"));
      c_r1.push(crearMatch("P17_3", zC, pC, 1, "4°3°", "BYE", true));
      c_r1.push(crearMatch("P17_4", zC, pC, 1, "BYE", "5°3°", true));
    } else if (totalEquipos === 22) {
      c_r1.push(crearMatch("P17_1", zC, pC, 1, "1°3°", "BYE", true));
      c_r1.push(crearMatch("P17_2", zC, pC, 1, "4°3°", "5°3°"));
      c_r1.push(crearMatch("P17_3", zC, pC, 1, "3°3°", "6°3°"));
      c_r1.push(crearMatch("P17_4", zC, pC, 1, "2°3°", "BYE", true));
    } else if (totalEquipos === 23) {
      c_r1.push(crearMatch("P17_1", zC, pC, 1, "1°3°", "BYE", true));
      c_r1.push(crearMatch("P17_2", zC, pC, 1, "7°3°", "4°3°"));
      c_r1.push(crearMatch("P17_3", zC, pC, 1, "3°3°", "5°3°"));
      c_r1.push(crearMatch("P17_4", zC, pC, 1, "2°3°", "6°3°"));
    } else {
      c_r1.push(crearMatch("P17_1", zC, pC, 1, "1°3°", "8°3°"));
      c_r1.push(crearMatch("P17_2", zC, pC, 1, "4°3°", "5°3°"));
      c_r1.push(crearMatch("P17_3", zC, pC, 1, "3°3°", "6°3°"));
      c_r1.push(crearMatch("P17_4", zC, pC, 1, "2°3°", "7°3°"));
    }
    allMatches.push(...c_r1);

    const c_r2 = [
      crearMatchRef("P17_5", zC, pC, 2, "P17_1", "GP", "P17_2", "GP"),
      crearMatchRef("P17_6", zC, pC, 2, "P17_3", "GP", "P17_4", "GP"),
      crearMatchRef("P17_7", zC, pC, 2, "P17_1", "PP", "P17_2", "PP", (totalEquipos===21)), 
      crearMatchRef("P17_8", zC, pC, 2, "P17_3", "PP", "P17_4", "PP", (totalEquipos===21))
    ];
    allMatches.push(...c_r2);

    const c_r3 = [
      crearMatchRef("P17_9", zC, pC, 3, "P17_5", "GP", "P17_6", "GP"),
      crearMatchRef("P17_10", zC, pC, 3, "P17_5", "PP", "P17_6", "PP"),
      crearMatchRef("P17_11", zC, pC, 3, "P17_7", "GP", "P17_8", "GP", (totalEquipos===21)),
      crearMatchRef("P17_12", zC, pC, 3, "P17_7", "PP", "P17_8", "PP", (totalEquipos===21))
    ];
    allMatches.push(...c_r3);
  }

  return allMatches;
}

// =====================================================================
// SCHEDULER Y RENUMERACIÓN
// =====================================================================

function asignarHorarios(matches, options) {
  const matchesToSchedule = [...matches];
  const dayConfigs = options.dayConfigs || [];
  const fields = options.fields.length ? options.fields : [{id:'c1', name:'Cancha 1'}];
  const duration = options.matchDurationMinutes;
  
  let slots = [];
  dayConfigs.forEach((day, dayIdx) => {
    if (day.type === 'off') return;
    const [hMin, mMin] = day.timeMin.split(':').map(Number);
    const [hMax, mMax] = day.timeMax.split(':').map(Number);
    const startMin = hMin * 60 + mMin;
    const endMin = hMax * 60 + mMax;

    for (let t = startMin; t + duration <= endMin; t += duration) {
      fields.forEach(field => {
        if (field.daysEnabled && field.daysEnabled[dayIdx] === false) return;
        slots.push({
          dayIdx: dayIdx,
          date: day.date,
          timeVal: t,
          timeStr: String(Math.floor(t/60)).padStart(2,'0') + ":" + String(t%60).padStart(2,'0'),
          fieldId: field.id
        });
      });
    }
  });

  slots.sort((a,b) => (a.dayIdx - b.dayIdx) || (a.timeVal - b.timeVal) || a.fieldId.localeCompare(b.fieldId));

  matchesToSchedule.forEach(m => {
    if (m.isByeMatch) return;
    const slotIdx = slots.findIndex(s => {
      if (s.used) return false;
      if (typeof m.preferredDayIndex !== 'undefined' && s.dayIdx !== m.preferredDayIndex) return false;
      if (typeof m.minDayIndex !== 'undefined' && s.dayIdx < m.minDayIndex) return false;
      return true;
    });

    if (slotIdx >= 0) {
      const s = slots[slotIdx];
      s.used = true;
      m.date = s.date;
      m.time = s.timeStr;
      m.fieldId = s.fieldId;
    }
  });
  return matchesToSchedule;
}

function renumerarPartidosCronologicamente(matches) {
  // 1. Ordenar por Fecha/Hora
  matches.sort((a, b) => {
    if (a.isByeMatch && !b.isByeMatch) return 1;
    if (!a.isByeMatch && b.isByeMatch) return -1;
    if (!a.date) return 1; if (!b.date) return -1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.fieldId.localeCompare(b.fieldId);
  });

  // 2. Asignar IDs nuevos
  const mapOldNew = {};
  let counter = 0;
  matches.forEach(m => {
    const oldCode = m.code;
    if (!m.isByeMatch) {
      counter++;
      m.code = String(counter);
      if (oldCode) mapOldNew[oldCode] = m.code;
    } else {
      if (oldCode) mapOldNew[oldCode] = "BYE";
    }
  });

  // 3. Traducir referencias
  const updateText = (txt) => {
    if (!txt) return txt;
    const parts = txt.split(" ");
    if (parts.length >= 2 && (parts[0] === "GP" || parts[0] === "PP")) {
      const ref = mapOldNew[parts[1]];
      if (ref) return parts[0] + " " + ref;
    }
    return txt;
  };
  matches.forEach(m => {
    m.homeSeed = updateText(m.homeSeed);
    m.awaySeed = updateText(m.awaySeed);
  });

  return matches;
}

// =====================================================================
// GESTIÓN DE PASOS Y UI
// =====================================================================

function showStep(n) {
  const stepItems = document.querySelectorAll(".step-item");
  const stepPanels = document.querySelectorAll(".step-panel");
  const stepStr = String(n);

  stepItems.forEach(li => li.classList.toggle("active", li.dataset.step === stepStr));
  stepPanels.forEach(panel => panel.classList.toggle("active", panel.id === "step-" + stepStr));
  
  if (stepStr === "6") renderExportView(currentExportMode);
}

function validateEvitaZones() {
  const t = appState.currentTournament;
  const teams = t.teams;
  if (teams.length < 20 || teams.length > 24) {
    alert(`Error: Se requieren entre 20 y 24 equipos. Hay ${teams.length}.`);
    return false;
  }
  
  const zonesMap = {};
  teams.forEach(tm => {
    const z = (tm.zone || "").trim().toUpperCase();
    if (z) {
      if (!zonesMap[z]) zonesMap[z] = [];
      zonesMap[z].push(tm);
    }
  });
  
  const zoneKeys = Object.keys(zonesMap);
  const zonesCount = zoneKeys.length;
  const expectedZones = teams.length <= 21 ? 7 : 8;

  if (zonesCount !== expectedZones) {
    alert(`Error: Para ${teams.length} equipos deben ser ${expectedZones} zonas. Hay ${zonesCount}.`);
    return false;
  }

  for (let z of zoneKeys) {
    const c = zonesMap[z].length;
    if (c !== 2 && c !== 3) {
      alert(`Error: La zona ${z} tiene ${c} equipos. Solo se permiten 2 o 3.`);
      return false;
    }
  }
  return true;
}

// =====================================================================
// INICIALIZADORES
// =====================================================================

function initNavigation() {
  document.querySelectorAll(".step-item").forEach(el => {
    el.addEventListener("click", () => showStep(el.dataset.step));
  });
  
  document.querySelectorAll("[data-next-step]").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.nextStep;
      if (next === "3" && appState.currentTournament.format.type === "especial-8x3") {
        if (!validateEvitaZones()) return;
      }
      upsertCurrentTournament();
      showStep(next);
    });
  });

  document.querySelectorAll("[data-prev-step]").forEach(btn => {
    btn.addEventListener("click", () => showStep(btn.dataset.prevStep));
  });
}

function initStep1() {
  const update = () => {
    const t = appState.currentTournament;
    if (!t) return;
    t.name = document.getElementById("t-name").value;
    t.category = document.getElementById("t-category").value;
    t.storageMode = document.getElementById("t-storage-mode").value;
    upsertCurrentTournament();
  };
  ["t-name", "t-category", "t-storage-mode"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", update);
  });
}

function initScheduleDaysUI() {
  const update = () => {
    const t = appState.currentTournament;
    if (!t) return;
    t.dateStart = document.getElementById("t-date-start").value;
    t.dateEnd = document.getElementById("t-date-end").value;
    ensureDayConfigs(t);
    upsertCurrentTournament();
    renderDayConfigs();
  };
  document.getElementById("t-date-start")?.addEventListener("change", update);
  document.getElementById("t-date-end")?.addEventListener("change", update);
}

function renderDayConfigs() {
  const tbody = document.getElementById("schedule-days-body");
  if (!tbody) return;
  const t = appState.currentTournament;
  ensureDayConfigs(t); // Asegurar que existan
  tbody.innerHTML = t.dayConfigs.map((d, i) => `
    <tr>
      <td>Día ${d.index}</td>
      <td>${d.date}</td>
      <td>
        <select onchange="window.updateDayConfig(${i}, 'type', this.value)">
          <option value="full" ${d.type==='full'?'selected':''}>Completo</option>
          <option value="off" ${d.type==='off'?'selected':''}>No se juega</option>
        </select>
      </td>
      <td>${d.timeMin}</td><td>${d.timeMax}</td>
    </tr>
  `).join("");
}
window.updateDayConfig = (idx, field, val) => {
  appState.currentTournament.dayConfigs[idx][field] = val;
  upsertCurrentTournament();
};

function initTeamsSection() {
  const addBtn = document.getElementById("btn-add-team");
  if(addBtn) addBtn.addEventListener("click", () => {
    const t = appState.currentTournament;
    const s = document.getElementById("team-short").value;
    const z = document.getElementById("team-zone").value;
    if (s) {
      t.teams.push({ id: safeId("tm"), shortName: s, zone: z });
      renderTeamsTable();
      upsertCurrentTournament();
      document.getElementById("team-short").value = "";
      document.getElementById("team-zone").value = "";
    }
  });
  // CSV Import dummy
  document.getElementById("btn-import-csv")?.addEventListener("click", () => {
     document.getElementById("teams-csv-input").click();
  });
}

function renderTeamsTable() {
  const tbody = document.querySelector("#teams-table tbody");
  if(!tbody) return;
  const t = appState.currentTournament;
  tbody.innerHTML = t.teams.map((tm, i) => 
    `<tr><td>${i+1}</td><td>${tm.zone}</td><td>${tm.shortName}</td><td></td><td></td><td></td><td><button onclick="removeTeam('${tm.id}')">X</button></td></tr>`
  ).join("");
}
window.removeTeam = (id) => {
  const t = appState.currentTournament;
  t.teams = t.teams.filter(x => x.id !== id);
  renderTeamsTable();
}

function initFieldsSection() {
  document.getElementById("btn-add-field")?.addEventListener("click", () => {
    const t = appState.currentTournament;
    const n = document.getElementById("field-name").value;
    if (n) {
      t.fields.push({ id: safeId("f"), name: n });
      renderFieldsTable();
      upsertCurrentTournament();
    }
  });
  // Listeners para configs globales
  ["day-time-min", "day-time-max", "match-duration", "rest-min"].forEach(id => {
     document.getElementById(id)?.addEventListener("change", () => upsertCurrentTournament());
  });
}
function renderFieldsTable() {
  const tbody = document.querySelector("#fields-table tbody");
  if(!tbody) return;
  tbody.innerHTML = appState.currentTournament.fields.map((f, i) => 
    `<tr><td>${i+1}</td><td>${f.name}</td><td></td><td><button onclick="removeField('${f.id}')">X</button></td></tr>`
  ).join("");
}
window.removeField = (id) => {
  appState.currentTournament.fields = appState.currentTournament.fields.filter(x => x.id !== id);
  renderFieldsTable();
}

function initFixtureGeneration() {
  const btn = document.getElementById("btn-generate-fixture");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const t = appState.currentTournament;
    if (!t.teams.length) return alert("Faltan equipos.");

    // Leer config
    t.dayTimeMin = document.getElementById("day-time-min").value;
    t.dayTimeMax = document.getElementById("day-time-max").value;
    t.matchDurationMinutes = Number(document.getElementById("match-duration").value);
    t.restMinMinutes = Number(document.getElementById("rest-min").value);
    ensureDayConfigs(t);

    // Validar dias
    const activeDays = t.dayConfigs.map((d,i) => d.type!=='off'?i:-1).filter(i=>i>=0);
    if (t.format.type === 'especial-8x3' && activeDays.length < 5) {
       alert("Atención: Se recomiendan 5 días jugables para este formato.");
    }

    // Generar
    let matches = [];
    if (t.format.type === 'especial-8x3') matches = generarEspecial8x3(t);
    else matches = generarFixtureZonas({}, {}); // Fallback dummy

    // Ordenar y Anclar
    if (matches.length > 0 && t.format.type === 'especial-8x3') {
        const fase1 = matches.filter(m => m.phase.includes("Fase 1"));
        const otros = matches.filter(m => !m.phase.includes("Fase 1"));
        
        const zonasUnicas = new Set(fase1.map(m => m.zone));
        const splitIndex = zonasUnicas.size === 7 ? 11 : 12; // 11 partidos día 1 si son 7 zonas
        
        // Ordenar F1
        fase1.sort((a,b) => {
           if (a.zone < b.zone) return -1; if (a.zone > b.zone) return 1;
           return a.round - b.round;
        });
        
        fase1.slice(0, splitIndex).forEach(m => m.preferredDayIndex = activeDays[0]);
        fase1.slice(splitIndex).forEach(m => m.preferredDayIndex = activeDays[1]);

        // Ordenar Finales
        otros.forEach(m => {
           const r = m.round || 1;
           const esFinal = m.zone === "Puestos 1-8";
           if (esFinal) m.preferredDayIndex = activeDays[4] || activeDays[activeDays.length-1];
           else if (r===1) m.preferredDayIndex = activeDays[2];
           else if (r===2) m.preferredDayIndex = activeDays[3];
           else m.preferredDayIndex = activeDays[4];
        });
        matches = [...fase1, ...otros];
    }

    // Schedule & Renumber
    const scheduled = asignarHorarios(matches, {
       dayConfigs: t.dayConfigs,
       fields: t.fields,
       matchDurationMinutes: t.matchDurationMinutes
    });
    
    t.matches = renumerarPartidosCronologicamente(scheduled);
    
    upsertCurrentTournament();
    renderFixtureResult();
    renderExportView("zone");
  });
}

function renderFixtureResult() {
  const div = document.getElementById("fixture-result");
  if (!div) return;
  const t = appState.currentTournament;
  div.innerHTML = `<table class="fixture-table"><thead><tr><th>Fecha</th><th>Hora</th><th>Cancha</th><th>Partido</th><th>ID</th></tr></thead><tbody>
    ${t.matches.filter(m=>!m.isByeMatch).map(m => 
      `<tr><td>${m.date||'-'}</td><td>${m.time||'-'}</td><td>${m.fieldId}</td><td>${m.homeSeed||'?'} vs ${m.awaySeed||'?'}</td><td>${m.code}</td></tr>`
    ).join("")}
  </tbody></table>`;
}

function renderExportView(mode) {
  renderFixtureResult(); // Simplificado para el ejemplo
}

function initFormatSection() {
    // Stub
}

// --- BOOT ---
document.addEventListener("DOMContentLoaded", () => {
  loadTournamentsFromLocalStorage();
  startNewTournament();
  
  initNavigation();
  initStep1();
  initTeamsSection();
  initFieldsSection();
  initScheduleDaysUI();
  initFormatSection();
  initFixtureGeneration();
});

function startNewTournament() {
  appState.currentTournament = createEmptyTournament();
  document.getElementById("t-name").value = "";
  renderTeamsTable();
  renderDayConfigs();
  renderFieldsTable();
  showStep(1);
}
