// ==========================================================
// FUNCIÓN PRINCIPAL PARA INICIAR LA GENERACIÓN DEL FIXTURE
// ==========================================================
function iniciarConfiguracion() {
    // 1. Obtener los valores ingresados por el usuario
    const nombreEvento = document.getElementById('nombreEvento').value;
    const deporte = document.getElementById('deporte').value;
    const numParticipantes = parseInt(document.getElementById('numParticipantes').value);

    // 2. Validar que la información sea correcta
    if (deporte === "" || numParticipantes < 2 || isNaN(numParticipantes)) {
        alert("Por favor, complete todos los campos correctamente. El número de participantes debe ser un número mayor a 1.");
        return; // Detiene la ejecución si hay un error
    }

    // 3. Imprimir en consola la información (útil para el desarrollador)
    console.log(`--- INICIANDO GENERACIÓN DE FIXTURE ---`);
    console.log(`Evento: ${nombreEvento}`);
    console.log(`Deporte Seleccionado: ${deporte}`);
    console.log(`Participantes: ${numParticipantes}`);

    // LLAMAR A LA FUNCIÓN QUE DIBUJA EL FIXTURE
    generarEliminacionSimple(numParticipantes);
}


// ==========================================================
// FUNCIÓN QUE DIBUJA EL CUADRO DE ELIMINACIÓN SIMPLE
// ==========================================================
function generarEliminacionSimple(numEquipos) {
    const container = document.getElementById('fixtureContainer');
    container.innerHTML = ''; // Limpiamos cualquier contenido anterior

    // Calculamos el número de rondas necesarias
    const numRondas = Math.ceil(Math.log2(numEquipos));

    // Calculamos la potencia de 2 más cercana (ej: si son 10 equipos, usamos 16)
    let participantesReales = Math.pow(2, numRondas);
    
    // --- Creación de las Rondas (Columnas) ---
    for (let r = 1; r <= numRondas; r++) {
        
        // 1. Crear el contenedor para la ronda (columna)
        const rondaDiv = document.createElement('div');
        rondaDiv.className = 'ronda';
        rondaDiv.id = `ronda-${r}`;

        // 2. Título de la Ronda
        const tituloRonda = document.createElement('h4');
        let nombreRonda;
        
        // Asignamos nombres comunes a las rondas finales
        if (r === numRondas) {
            nombreRonda = 'FINAL';
        } else if (r === numRondas - 1) {
            nombreRonda = 'Semifinales';
        } else if (r === numRondas - 2 && numRondas > 2) {
            nombreRonda = 'Cuartos de Final';
        } else {
            nombreRonda = `Ronda ${r}`;
        }
        tituloRonda.textContent = nombreRonda;
        rondaDiv.appendChild(tituloRonda);

        // 3. Calcular la cantidad de partidos en esta ronda
        // El número de partidos es la mitad de los participantes que juegan en esa ronda
        let numPartidos = Math.floor(participantesReales / Math.pow(2, r));

        // 4. Crear los partidos (Matchups)
        for (let p = 1; p <= numPartidos; p++) {
            const partidoDiv = document.createElement('div');
            partidoDiv.className = 'partido';
            partidoDiv.id = `r${r}-p${p}`;
            
            // Estructura básica de un partido con dos equipos placeholder (marcadores de posición)
            partidoDiv.innerHTML = `
                <div class="equipo equipo-arriba">Participante ${p*2 - 1}</div>
                <div class="equipo equipo-abajo">Participante ${p*2}</div>
            `;
            
            rondaDiv.appendChild(partidoDiv);
        }

        // 5. Añadir la ronda completa al contenedor principal
        container.appendChild(rondaDiv);
    }
}
