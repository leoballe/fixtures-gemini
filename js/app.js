// =====================================================================
// APP.JS - VERSIÓN DEFINITIVA (REESCRITURA TOTAL)
// Soporte: 20 a 24 Equipos (Evita 8x3) + Scheduling Estricto 5 Días
// =====================================================================

// --- ESTADO GLOBAL ---
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
      type: "especial-8x3", // Por defecto para tu uso
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

// --- MANEJO DE FECHAS Y DÍAS ---
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
    
    // Preservar config si ya existía para ese índice
    if (oldConfigs[i]) {
      newConfigs.push({ ...oldConfigs[i], date: dateStr });
    } else {
      newConfigs.push({
        index: i + 1,
        date: dateStr,
        type: "full", // full | half | off
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
// MOTOR DE GENERACIÓN DE PARTIDOS (LOGICA DE NEGOCIO)
// =====================================================================

// Generador genérico de Liga/Zona
function generarFixtureLiga(teamIds, options) {
  const { idaVuelta, zone, phase } = options;
  const equipos = teamIds.filter(x => x); // filtrar nulos
  if (equipos.length < 2) return [];

  // Algoritmo Round Robin
  if (equipos.length % 2 !== 0) equipos.push(null); // Dummy para impares
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
          id: safeId("m"),
          code: null, // Se asignará al final
          zone: zone,
          phase: phase,
          round: r + 1,
          homeTeamId: home,
          awayTeamId: away,
          homeSeed: null, awaySeed: null,
          date: null, time: null, fieldId: null
        });
      }
    }
    // Rotación
    arr = [arr[0], ...arr.slice(2), arr[1]];
  }

  if (idaVuelta) {
    const vueltas = matches.map(m => ({
      ...m,
      id: safeId("m"),
      homeTeamId: m.awayTeamId,
      awayTeamId: m.homeTeamId,
      round: m.round + rounds
    }));
    return [...matches, ...vueltas];
  }
  return matches;
}

// Generador de cruces con Seeds (ej: 1°A vs 2°B)
function generarLigaSeeds(seeds, options) {
  // Misma lógica que arriba pero usando seeds de texto en vez de IDs
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
          homeTeamId: null, awayTeamId: null,
          homeSeed: home, awaySeed: away,
          date: null, time: null, fieldId: null
        });
      }
    }
    const pivot = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [pivot, ...rest]; // Corrección en rotación array
  }
  
  // Corrección rotación manual simple si la de arriba falla en JS:
  // La rotación estándar es dejar el 0 fijo y rotar el resto.

  if (idaVuelta) {
    const vueltas = matches.map(m => ({
      ...m, id: safeId("m"), homeSeed: m.awaySeed, awaySeed: m.homeSeed, round: m.round + rounds
    }));
    return [...matches, ...vueltas];
  }
  return matches;
}

// ---------------------------------------------------------------------
// GENERADOR ESPECIAL EVITA (20 a 24 Equipos)
// ---------------------------------------------------------------------
function generarEspecial8x3(t) {
  const zonesMap = {};
  t.teams.forEach(team => {
    const z = (team.zone || "").trim();
    if (z) {
      if (!zonesMap[z]) zonesMap[z] = [];
      zonesMap[z].push(team.id);
    }
  });

  // Ordenar zonas alfabéticamente
  const zoneNames = Object.keys(zonesMap).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const totalEquipos = t.teams.length;
  const allMatches = [];

  // --- 1. FASE DE ZONAS ---
  zoneNames.forEach(z => {
    const ids = zonesMap[z];
    const esZonaDe2 = ids.length === 2;
    // Regla: Zonas de 2 juegan Ida y Vuelta. Zonas de 3 juegan solo Ida.
    const part = generarFixtureLiga(ids, { 
      idaVuelta: esZonaDe2, 
      zone: z, 
      phase: "Fase 1 · Zonas" 
    });
    allMatches.push(...part);
  });

  // --- 2. FASE 2 (GRUPOS A1 y A2) ---
  let seedsA1 = ["1°1°", "4°1°", "5°1°", "8°1°"];
  let seedsA2 = ["2°1°", "3°1°", "6°1°", "7°1°"];

  // Ajuste para 20-21 equipos: No existe 8°1°, sube el 1°2°
  if (totalEquipos <= 21) {
    seedsA1 = ["1°1°", "4°1°", "5°1°", "1°2°"];
  }

  // IMPORTANTE: Estos grupos juegan 3 rondas (Ida).
  allMatches.push(...generarLigaSeeds(seedsA1, { idaVuelta: false, zone: "Zona A1", phase: "Fase 2 · Zona A1" }));
  allMatches.push(...generarLigaSeeds(seedsA2, { idaVuelta: false, zone: "Zona A2", phase: "Fase 2 · Zona A2" }));

  // --- 3. FASE FINAL (PUESTOS 1-8) ---
  // Estos son los cruces finales entre A1 y A2
  const finales1_8 = [
    { pos: 1, h: "1° Zona A1", a: "1° Zona A2" }, // Final
    { pos: 2, h: "2° Zona A1", a: "2° Zona A2" }, // 3er puesto
    { pos: 3, h: "3° Zona A1", a: "3° Zona A2" }, // 5to puesto
    { pos: 4, h: "4° Zona A1", a: "4° Zona A2" }  // 7mo puesto
  ];
  finales1_8.forEach(f => {
    allMatches.push({
      id: safeId("m"), zone: "Puestos 1-8", phase: "Puestos 1-8", round: 1, // Es una "final", conceptualmente R1 de esta fase
      homeTeamId: null, awayTeamId: null, homeSeed: f.h, awaySeed: f.a,
      date: null, time: null, fieldId: null
    });
  });

  // Helpers para llaves
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

  // --- 4. FASE 4 (LLAVE B - PUESTOS 9-16) ---
  // Seeds dependen de la cantidad de equipos
  let b_r1 = []; // Partidos Ronda 1 Llave B
  const zB = "Puestos 9-16";
  const pB = "Puestos 9-16";

  if (totalEquipos <= 21) {
    // 20-21 Equipos: 1°3° y 2°3° entran aquí
    b_r1.push(crearMatch("P9_1", zB, pB, 1, "2°2°", "2°3°"));
    b_r1.push(crearMatch("P9_2", zB, pB, 1, "5°2°", "6°2°"));
    b_r1.push(crearMatch("P9_3", zB, pB, 1, "4°2°", "7°2°"));
    b_r1.push(crearMatch("P9_4", zB, pB, 1, "1°3°", "3°2°"));
  } else {
    // 22-24 Equipos: Estándar
    b_r1.push(crearMatch("P9_1", zB, pB, 1, "1°2°", "8°2°"));
    b_r1.push(crearMatch("P9_2", zB, pB, 1, "4°2°", "5°2°"));
    b_r1.push(crearMatch("P9_3", zB, pB, 1, "3°2°", "6°2°"));
    b_r1.push(crearMatch("P9_4", zB, pB, 1, "2°2°", "7°2°"));
  }
  allMatches.push(...b_r1);

  // Rondas siguientes Llave B (Igual para todos)
  // Semis Ganadores
  const b_r2_w = [
    crearMatchRef("P9_5", zB, pB, 2, "P9_1", "GP", "P9_2", "GP"),
    crearMatchRef("P9_6", zB, pB, 2, "P9_3", "GP", "P9_4", "GP")
  ];
  // Semis Perdedores
  const b_r2_l = [
    crearMatchRef("P9_7", zB, pB, 2, "P9_1", "PP", "P9_2", "PP"),
    crearMatchRef("P9_8", zB, pB, 2, "P9_3", "PP", "P9_4", "PP")
  ];
  allMatches.push(...b_r2_w, ...b_r2_l);

  // Finales Llave B
  const b_r3 = [
    crearMatchRef("P9_9", zB, pB, 3, "P9_5", "GP", "P9_6", "GP"), // 9°
    crearMatchRef("P9_10", zB, pB, 3, "P9_5", "PP", "P9_6", "PP"), // 11°
    crearMatchRef("P9_11", zB, pB, 3, "P9_7", "GP", "P9_8", "GP"), // 13°
    crearMatchRef("P9_12", zB, pB, 3, "P9_7", "PP", "P9_8", "PP")  // 15°
  ];
  allMatches.push(...b_r3);

  // --- 5. FASE 5 (LLAVE C - PUESTOS 17-24) ---
  const zC = "Puestos 17-24";
  const pC = "Puestos 17-24";
  
  if (totalEquipos === 20) {
    // Solo quedan 4 equipos (3°3°, 4°3°, 5°3°, 6°3°).
    // Van directo a Semis (Ronda 2) para jugar el día 4.
    const c_r2 = [
      crearMatch("P17_1", zC, pC, 2, "3°3°", "6°3°"),
      crearMatch("P17_2", zC, pC, 2, "4°3°", "5°3°")
    ];
    allMatches.push(...c_r2);
    // Finales (Ronda 3)
    const c_r3 = [
      crearMatchRef("P17_3", zC, pC, 3, "P17_1", "GP", "P17_2", "GP"), // 17°
      crearMatchRef("P17_4", zC, pC, 3, "P17_1", "PP", "P17_2", "PP")  // 19°
    ];
    allMatches.push(...c_r3);

  } else {
    // 21 a 24 Equipos: Estructura completa de 3 rondas
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
    } else { // 24
      c_r1.push(crearMatch("P17_1", zC, pC, 1, "1°3°", "8°3°"));
      c_r1.push(crearMatch("P17_2", zC, pC, 1, "4°3°", "5°3°"));
      c_r1.push(crearMatch("P17_3", zC, pC, 1, "3°3°", "6°3°"));
      c_r1.push(crearMatch("P17_4", zC, pC, 1, "2°3°", "7°3°"));
    }
    allMatches.push(...c_r1);

    // R2 y R3 genéricos basados en códigos de R1
    const c_r2 = [
      crearMatchRef("P17_5", zC, pC, 2, "P17_1", "GP", "P17_2", "GP"),
      crearMatchRef("P17_6", zC, pC, 2, "P17_3", "GP", "P17_4", "GP"),
      crearMatchRef("P17_7", zC, pC, 2, "P17_1", "PP", "P17_2", "PP", (totalEquipos===21)), // Bye en 21eq
      crearMatchRef("P17_8", zC, pC, 2, "P17_3", "PP", "P17_4", "PP", (totalEquipos===21))  // Bye en 21eq
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
// ORDENAMIENTO Y SCHEDULING (EL CEREBRO)
// =====================================================================

function asignarHorarios(matches, options) {
  // Estrategia: Recorrer slots disponibles y asignar el primer partido que calce.
  // IMPORTANTE: Respetamos estrictamente preferredDayIndex.
  const matchesToSchedule = [...matches];
  const dayConfigs = options.dayConfigs || [];
  const fields = options.fields.length ? options.fields : [{id:'c1', name:'Cancha 1'}];
  const duration = options.matchDurationMinutes;
  
  // Generar todos los slots posibles (Día -> Cancha -> Hora)
  let slots = [];
  dayConfigs.forEach((day, dayIdx) => {
    if (day.type === 'off') return;
    
    // Convertir rangos horarios a minutos
    const [hMin, mMin] = day.timeMin.split(':').map(Number);
    const [hMax, mMax] = day.timeMax.split(':').map(Number);
    const startMin = hMin * 60 + mMin;
    const endMin = hMax * 60 + mMax;

    for (let t = startMin; t + duration <= endMin; t += duration) {
      fields.forEach(field => {
        // Verificar disponibilidad de cancha en ese día (si existe esa config)
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

  // Ordenar slots cronológicamente
  slots.sort((a,b) => (a.dayIdx - b.dayIdx) || (a.timeVal - b.timeVal));

  // Asignar
  matchesToSchedule.forEach(m => {
    if (m.isByeMatch) return; // No se programa

    // Buscar primer slot válido
    const slotIdx = slots.findIndex(s => {
      if (s.used) return false;
      // REGLA DE ORO: Si tiene día preferido, DEBE ser ese día
      if (typeof m.preferredDayIndex !== 'undefined' && s.dayIdx !== m.preferredDayIndex) return false;
      // Regla de día mínimo
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

// =====================================================================
// RENUMERACIÓN POST-SCHEDULING (LA SOLUCIÓN AL PDF)
// =====================================================================
function renumerarPartidosCronologicamente(matches) {
  // 1. Ordenar TODO por fecha -> hora -> cancha
  matches.sort((a, b) => {
    if (a.isByeMatch && !b.isByeMatch) return 1; // Byes al fondo
    if (!a.isByeMatch && b.isByeMatch) return -1;
    if (!a.date) return 1; if (!b.date) return -1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.fieldId < b.fieldId ? -1 : 1;
  });

  // 2. Asignar IDs visuales (1, 2, 3...) y crear mapa de traducción
  const mapOldNew = {};
  let counter = 0;

  matches.forEach(m => {
    const oldCode = m.code;
    if (!m.isByeMatch) {
      counter++;
      m.code = String(counter);
      if (oldCode) mapOldNew[oldCode] = m.code;
    } else {
      if (oldCode) mapOldNew[oldCode] = "BYE"; // Marca para no romper refs
    }
  });

  // 3. Actualizar textos de Seeds (GP X, PP X) usando el mapa
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
// FUNCIONES UI DE VALIDACIÓN
// =====================================================================
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

  // Verificar tamaño de zonas
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
// CONTROLADORES DE PASOS (INIT)
// =====================================================================

// PASO 1
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

// PASO 2 (Teams) - Simplificado para el ejemplo
function initTeamsSection() {
  document.getElementById("btn-add-team")?.addEventListener("click", () => {
    const t = appState.currentTournament;
    const s = document.getElementById("team-short").value;
    const z = document.getElementById("team-zone").value;
    if (s) {
      t.teams.push({ id: safeId("tm"), shortName: s, zone: z });
      renderTeamsTable();
      upsertCurrentTournament();
    }
  });
  // ... CSV logic aquí ...
}
function renderTeamsTable() {
  const tbody = document.querySelector("#teams-table tbody");
  if(!tbody) return;
  tbody.innerHTML = appState.currentTournament.teams.map((tm, i) => 
    `<tr><td>${i+1}</td><td>${tm.zone}</td><td>${tm.shortName}</td><td></td><td></td><td></td><td></td></tr>`
  ).join("");
}

// PASO 4 (Fechas/Días)
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
  tbody.innerHTML = t.dayConfigs.map((d, i) => `
    <tr>
      <td>Día ${d.index}</td>
      <td>${d.date}</td>
      <td>
        <select onchange="updateDayConfig(${i}, 'type', this.value)">
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

// PASO 5 (GENERACIÓN PRINCIPAL)
function initFixtureGeneration() {
  document.getElementById("btn-generate-fixture")?.addEventListener("click", () => {
    const t = appState.currentTournament;
    
    // Validaciones
    if (t.format.type === "especial-8x3") {
      if (!validateEvitaZones()) return;
      // Verificar días disponibles
      const diasJugables = t.dayConfigs.filter(d => d.type !== 'off').length;
      if (diasJugables < 5) {
        alert(`ADVERTENCIA: Se recomiendan 5 días para este formato. Tienes ${diasJugables}. El fixture podría quedar incompleto.`);
      }
    }

    // Generar Partidos (Objetos abstractos)
    let matches = generarEspecial8x3(t);
    
    // Ordenar y Anclar Partidos a Días (Lógica Evita)
    if (matches.length > 0) {
      const fase1 = matches.filter(m => m.phase.includes("Fase 1"));
      const otros = matches.filter(m => !m.phase.includes("Fase 1"));
      
      // A. Ordenar Fase 1 (Zonas)
      // Patrón: Si son 7 zonas, cortar en 11 partidos (Día 1). Si 8, en 12.
      const zonasUnicas = new Set(fase1.map(m => m.zone));
      const splitIndex = zonasUnicas.size === 7 ? 11 : 12;
      
      // Helper ordenamiento zona/ronda
      fase1.sort((a,b) => {
        if (a.zone < b.zone) return -1; if (a.zone > b.zone) return 1;
        return a.round - b.round;
      });
      
      // Asignar índices de día (0, 1, 2, 3, 4)
      const activeDays = t.dayConfigs.map((d,i) => d.type!=='off'?i:-1).filter(i=>i>=0);
      
      // Fase 1 -> Días 0 y 1
      fase1.slice(0, splitIndex).forEach(m => m.preferredDayIndex = activeDays[0]);
      fase1.slice(splitIndex).forEach(m => m.preferredDayIndex = activeDays[1]);

      // B. Ordenar Fase Final (Días 2, 3, 4)
      otros.forEach(m => {
        const esFinalisima = m.zone === "Puestos 1-8";
        if (esFinalisima) {
          m.preferredDayIndex = activeDays[4] || activeDays[activeDays.length-1]; // Último día
        } else {
          // R1 -> D3, R2 -> D4, R3 -> D5
          if (m.round === 1) m.preferredDayIndex = activeDays[2];
          else if (m.round === 2) m.preferredDayIndex = activeDays[3];
          else m.preferredDayIndex = activeDays[4];
        }
      });
      
      matches = [...fase1, ...otros];
    }

    // Asignar Horarios (Scheduling real)
    const scheduled = asignarHorarios(matches, {
      dayConfigs: t.dayConfigs,
      fields: t.fields,
      matchDurationMinutes: 60 // O leer del input
    });

    // RENUMERACIÓN FINAL (Esto arregla el PDF)
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
  div.innerHTML = `<table class="fixture-table"><thead><tr><th>ID</th><th>Fecha</th><th>Hora</th><th>Partido</th><th>Zona</th></tr></thead><tbody>
    ${t.matches.filter(m=>!m.isByeMatch).map(m => 
      `<tr><td>${m.code}</td><td>${m.date||'-'}</td><td>${m.time||'-'}</td><td>${m.homeSeed||m.homeTeamId} vs ${m.awaySeed||m.awayTeamId}</td><td>${m.zone}</td></tr>`
    ).join("")}
  </tbody></table>`;
}

// PASO 6 (EXPORT) - Simplificado
function renderExportView(mode) {
  // Reutilizar renderFixtureResult para preview rápida o lógica similar
  renderFixtureResult(); 
}

// --- INIT ---
document.addEventListener("DOMContentLoaded", () => {
  loadTournamentsFromLocalStorage();
  startNewTournament(); // O cargar ultimo
  
  // Inicializar secciones
  initStep1();
  initTeamsSection();
  initScheduleDaysUI();
  initFixtureGeneration();
  // ... init navigation ...
  
  // Configuración inicial navigation
  document.querySelectorAll(".step-item").forEach(el => {
    el.addEventListener("click", () => {
      document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
      document.getElementById("step-" + el.dataset.step).classList.add("active");
    });
  });
  
  // Botones next
  document.querySelectorAll("[data-next-step]").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.nextStep;
      // Validación paso 2
      if (next === "3" && appState.currentTournament.format.type === "especial-8x3") {
        if (!validateEvitaZones()) return;
      }
      document.querySelectorAll(".step-panel").forEach(p => p.classList.remove("active"));
      document.getElementById("step-" + next).classList.add("active");
    });
  });
});

function startNewTournament() {
  appState.currentTournament = createEmptyTournament();
  // Render iniciales
  renderTeamsTable();
  renderDayConfigs();
}
