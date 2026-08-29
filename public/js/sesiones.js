/* ============================================================================
   sesiones.js · Sesiones compartidas con navegación sincronizada
                 + Lista de acceso rápido semanal
   ----------------------------------------------------------------------------
   Vive totalmente aparte de app.js: no toca su estado interno ni sus
   funciones. Solo observa y escribe `location.hash`, que es lo que app.js ya
   usa como única fuente de verdad para saber qué se está viendo (índice,
   canción + diapositiva, o letra completa). Así, sincronizar la navegación
   entre el director y los oyentes es sincronizar ese hash.
   ========================================================================== */

(function () {
  'use strict';

  var CLAVE_LOCAL = 'cancionero_sesion_v1';
  var INTERVALO_DIRECTOR_MS = 700;     // cada cuánto revisa si su hash cambió
  var INTERVALO_DIRECTOR_ESTADO_MS = 4000; // cada cuánto comprueba si le cerraron la sala
  var INTERVALO_OYENTE_MS = 1200;      // cada cuánto pregunta por el estado del director

  var dom = {};
  var sesion = leerSesionLocal();       // { rol: 'director'|'oyente', id, nombre } | null
  var ultimoHashEnviado = null;
  var timerDirectorHash = null;
  var timerDirectorEstado = null;
  var timerOyente = null;

  /* ------------------------------------------------------------------ *
   *  Persistencia local
   * ------------------------------------------------------------------ */
  function leerSesionLocal() {
    try {
      var crudo = window.localStorage.getItem(CLAVE_LOCAL);
      return crudo ? JSON.parse(crudo) : null;
    } catch (e) { return null; }
  }

  function guardarSesionLocal(valor) {
    sesion = valor;
    try {
      if (valor) { window.localStorage.setItem(CLAVE_LOCAL, JSON.stringify(valor)); }
      else { window.localStorage.removeItem(CLAVE_LOCAL); }
    } catch (e) { /* almacenamiento no disponible: seguimos solo en memoria */ }
  }

  /* ------------------------------------------------------------------ *
   *  Utilidades de red
   * ------------------------------------------------------------------ */
  function pedir(url, opciones) {
    opciones = opciones || {};
    opciones.headers = Object.assign({ 'Content-Type': 'application/json' }, opciones.headers || {});
    opciones.credentials = 'same-origin';
    return fetch(url, opciones).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        return { ok: res.ok, status: res.status, json: json };
      });
    });
  }

  /* ------------------------------------------------------------------ *
   *  Semana ISO + selección automática de la lista rápida (respaldo local
   *  cuando no hay una lista fijada a mano en el servidor).
   * ------------------------------------------------------------------ */
  function semanaIsoLocal(fecha) {
    var copia = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
    var dia = copia.getUTCDay() || 7;
    copia.setUTCDate(copia.getUTCDate() + 4 - dia);
    var inicioAno = new Date(Date.UTC(copia.getUTCFullYear(), 0, 1));
    var numero = Math.ceil(((copia.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7);
    return copia.getUTCFullYear() + '-W' + String(numero).padStart(2, '0');
  }

  function semillaDeTexto(txt) {
    var h = 0;
    for (var i = 0; i < txt.length; i++) { h = (Math.imul(31, h) + txt.charCodeAt(i)) | 0; }
    return h;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seleccionAutomaticaSemanal() {
    var datos = window.CANCIONERO_DATA && window.CANCIONERO_DATA.canciones;
    if (!datos || !datos.length) { return []; }
    var rnd = mulberry32(semillaDeTexto(semanaIsoLocal(new Date())));
    var copia = datos.slice();
    for (var i = copia.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = copia[i]; copia[i] = copia[j]; copia[j] = tmp;
    }
    return copia.slice(0, 10).map(function (c) { return { songId: c.id, songTitle: c.titulo }; });
  }

  /* ------------------------------------------------------------------ *
   *  Interfaz: panel desplegable
   * ------------------------------------------------------------------ */
  function abrirPanel() {
    dom.panel.hidden = false;
    dom.boton.setAttribute('aria-expanded', 'true');
    actualizarEstadoUI();
    cargarMisSesiones();
    cargarListaRapida();
  }

  function cerrarPanel() {
    dom.panel.hidden = true;
    dom.boton.setAttribute('aria-expanded', 'false');
  }

  function alternarPanel() {
    if (dom.panel.hidden) { abrirPanel(); } else { cerrarPanel(); }
  }

  function mostrarMensaje(texto, tipo) {
    dom.mensaje.textContent = texto;
    dom.mensaje.hidden = !texto;
    if (texto) { dom.mensaje.setAttribute('data-tipo', tipo || 'info'); }
  }

  function actualizarEstadoUI() {
    dom.estado.innerHTML = '';

    var texto = document.createElement('span');
    if (sesion && sesion.rol === 'director') {
      texto.textContent = 'Dirigiendo: ' + sesion.nombre;
      dom.estado.setAttribute('data-rol', 'director');
      dom.boton.setAttribute('data-activo', 'director');
    } else if (sesion && sesion.rol === 'oyente') {
      texto.textContent = 'Escuchando: ' + sesion.nombre;
      dom.estado.setAttribute('data-rol', 'oyente');
      dom.boton.setAttribute('data-activo', 'oyente');
    } else {
      texto.textContent = 'Sin sesión activa.';
      dom.estado.removeAttribute('data-rol');
      dom.boton.removeAttribute('data-activo');
    }
    dom.estado.appendChild(texto);

    if (sesion) {
      var salir = document.createElement('button');
      salir.type = 'button';
      salir.textContent = sesion.rol === 'director' ? 'Dejar de dirigir' : 'Dejar de escuchar';
      salir.style.marginLeft = '10px';
      salir.addEventListener('click', function () { salirDeSesionLocal(true); });
      dom.estado.appendChild(salir);
    }
  }

  /* ------------------------------------------------------------------ *
   *  "Tus sesiones"
   * ------------------------------------------------------------------ */
  function cargarMisSesiones() {
    pedir('/api/sessions').then(function (r) {
      if (!r.ok) { return; }
      renderMisSesiones(r.json.sessions || [], r.json.limit || 4);
    });
  }

  function renderMisSesiones(lista, limite) {
    dom.contadorSesiones.textContent = String(lista.length);
    dom.listaMisSesiones.innerHTML = '';

    if (!lista.length) {
      var vacio = document.createElement('li');
      vacio.className = 'lista-sesiones__vacio';
      vacio.textContent = 'Todavía no has creado ninguna.';
      dom.listaMisSesiones.appendChild(vacio);
      return;
    }

    lista.forEach(function (s) {
      var li = document.createElement('li');
      li.className = 'fila-mi-sesion';

      var nombre = document.createElement('span');
      nombre.className = 'fila-mi-sesion__nombre';
      nombre.textContent = s.name;
      nombre.title = s.name;
      li.appendChild(nombre);

      var esActiva = sesion && sesion.rol === 'director' && sesion.id === s.id;

      var dirigir = document.createElement('button');
      dirigir.type = 'button';
      dirigir.textContent = esActiva ? 'Dirigiendo' : 'Dirigir';
      dirigir.disabled = !!esActiva;
      dirigir.addEventListener('click', function () {
        guardarSesionLocal({ rol: 'director', id: s.id, nombre: s.name });
        ultimoHashEnviado = null;
        arrancarComoDirector();
        actualizarEstadoUI();
        renderMisSesiones(lista, limite);
        mostrarMensaje('Ahora diriges "' + s.name + '".', 'info');
      });
      li.appendChild(dirigir);

      var cerrar = document.createElement('button');
      cerrar.type = 'button';
      cerrar.textContent = 'Cerrar';
      cerrar.addEventListener('click', function () {
        pedir('/api/sessions/' + s.id, { method: 'DELETE' }).then(function (r) {
          if (r.ok && sesion && sesion.id === s.id) { salirDeSesionLocal(false); }
          cargarMisSesiones();
        });
      });
      li.appendChild(cerrar);

      dom.listaMisSesiones.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------ *
   *  Lista de acceso rápido semanal
   * ------------------------------------------------------------------ */
  function cargarListaRapida() {
    pedir('/api/weekly-songs').then(function (r) {
      var canciones = (r.ok && r.json.songs && r.json.songs.length) ? r.json.songs : seleccionAutomaticaSemanal();
      renderListaRapida(canciones);
    }).catch(function () {
      renderListaRapida(seleccionAutomaticaSemanal());
    });
  }

  function renderListaRapida(canciones) {
    dom.listaRapida.innerHTML = '';

    if (!canciones.length) {
      var vacio = document.createElement('li');
      vacio.className = 'lista-rapida__vacio';
      vacio.textContent = 'No hay canciones disponibles todavía.';
      dom.listaRapida.appendChild(vacio);
      return;
    }

    canciones.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = 'fila-rapida';

      var num = document.createElement('span');
      num.className = 'fila-rapida__numero';
      num.textContent = String(i + 1).padStart(2, '0');
      li.appendChild(num);

      var titulo = document.createElement('span');
      titulo.className = 'fila-rapida__titulo';
      titulo.textContent = c.songTitle;
      titulo.title = c.songTitle;
      li.appendChild(titulo);

      var abrir = document.createElement('button');
      abrir.type = 'button';
      abrir.textContent = 'Proyectar';
      abrir.addEventListener('click', function () {
        cerrarPanel();
        location.hash = '#/c/' + c.songId + '/1';
      });
      li.appendChild(abrir);

      dom.listaRapida.appendChild(li);
    });
  }

  /* ------------------------------------------------------------------ *
   *  Crear / unirse
   * ------------------------------------------------------------------ */
  function manejarCrear(ev) {
    ev.preventDefault();
    var nombre = dom.crearNombre.value.trim();
    var codigo = dom.crearCodigo.value;
    var boton = ev.target.querySelector('button');
    boton.disabled = true;

    pedir('/api/sessions', { method: 'POST', body: JSON.stringify({ name: nombre, code: codigo }) })
      .then(function (r) {
        boton.disabled = false;
        if (!r.ok) { mostrarMensaje(r.json.error || 'No se pudo crear la sesión.', 'error'); return; }
        guardarSesionLocal({ rol: 'director', id: r.json.session.id, nombre: r.json.session.name });
        ultimoHashEnviado = null;
        arrancarComoDirector();
        actualizarEstadoUI();
        cargarMisSesiones();
        dom.formCrear.reset();
        mostrarMensaje('Sesión "' + r.json.session.name + '" creada. Ya eres el director.', 'info');
      });
  }

  function manejarUnirse(ev) {
    ev.preventDefault();
    var nombre = dom.unirseNombre.value.trim();
    var codigo = dom.unirseCodigo.value;
    var boton = ev.target.querySelector('button');
    boton.disabled = true;

    pedir('/api/sessions/join', { method: 'POST', body: JSON.stringify({ name: nombre, code: codigo }) })
      .then(function (r) {
        boton.disabled = false;
        if (!r.ok) { mostrarMensaje(r.json.error || 'No se pudo unir a la sesión.', 'error'); return; }

        if (r.json.special) {
          salirDeSesionLocal(false);
          mostrarMensaje('Se cerraron todas las sesiones activas (' + r.json.closedCount + ').', 'info');
          cargarMisSesiones();
          dom.formUnirse.reset();
          return;
        }

        guardarSesionLocal({ rol: 'oyente', id: r.json.session.id, nombre: r.json.session.name });
        arrancarComoOyente();
        actualizarEstadoUI();
        dom.formUnirse.reset();
        mostrarMensaje('Sincronizando con "' + r.json.session.name + '".', 'info');
        if (r.json.session.currentHash) { location.hash = r.json.session.currentHash; }
      });
  }

  /* ------------------------------------------------------------------ *
   *  Motor de sincronización
   * ------------------------------------------------------------------ */
  function detenerTemporizadores() {
    clearInterval(timerDirectorHash); timerDirectorHash = null;
    clearInterval(timerDirectorEstado); timerDirectorEstado = null;
    clearInterval(timerOyente); timerOyente = null;
  }

  function salirDeSesionLocal(avisarServidor) {
    var previa = sesion;
    detenerTemporizadores();
    guardarSesionLocal(null);
    actualizarEstadoUI();
    if (previa && previa.rol === 'director' && avisarServidor) {
      // No cerramos la sala en el servidor: solo dejamos de dirigirla desde
      // este dispositivo. Sigue apareciendo en "Tus sesiones" para retomarla.
    }
    if (dom.panel && !dom.panel.hidden) { cargarMisSesiones(); }
  }

  function arrancarComoDirector() {
    detenerTemporizadores();

    timerDirectorHash = setInterval(function () {
      if (!sesion || sesion.rol !== 'director') { return; }
      var actual = location.hash || '#/';
      if (actual === ultimoHashEnviado) { return; }
      ultimoHashEnviado = actual;
      pedir('/api/sessions/' + sesion.id, { method: 'PATCH', body: JSON.stringify({ hash: actual }) })
        .then(function (r) {
          if (!r.ok && (r.status === 404 || r.status === 410 || r.status === 403)) {
            mostrarMensaje('Esta sesión ya no está disponible.', 'error');
            salirDeSesionLocal(false);
          }
        });
    }, INTERVALO_DIRECTOR_MS);

    timerDirectorEstado = setInterval(function () {
      if (!sesion || sesion.rol !== 'director') { return; }
      pedir('/api/sessions/' + sesion.id).then(function (r) {
        if (!r.ok || (r.json.session && r.json.session.closed)) {
          mostrarMensaje('La sesión que dirigías se cerró.', 'error');
          salirDeSesionLocal(false);
        }
      });
    }, INTERVALO_DIRECTOR_ESTADO_MS);
  }

  function arrancarComoOyente() {
    detenerTemporizadores();

    timerOyente = setInterval(function () {
      if (!sesion || sesion.rol !== 'oyente') { return; }
      pedir('/api/sessions/' + sesion.id).then(function (r) {
        if (!r.ok) {
          mostrarMensaje('La sesión ya no existe.', 'error');
          salirDeSesionLocal(false);
          return;
        }
        if (r.json.session.closed) {
          mostrarMensaje('El director cerró la sesión.', 'error');
          salirDeSesionLocal(false);
          return;
        }
        var nuevo = r.json.session.currentHash || '#/';
        if (nuevo !== (location.hash || '#/')) { location.hash = nuevo; }
      });
    }, INTERVALO_OYENTE_MS);
  }

  /* ------------------------------------------------------------------ *
   *  Arranque
   * ------------------------------------------------------------------ */
  function iniciar() {
    dom = {
      contenedor:       document.getElementById('menu-sesiones'),
      boton:            document.getElementById('btn-sesiones'),
      panel:            document.getElementById('panel-sesiones'),
      estado:           document.getElementById('sesion-estado'),
      mensaje:          document.getElementById('sesion-mensaje'),
      formCrear:        document.getElementById('form-crear-sesion'),
      crearNombre:      document.getElementById('crear-nombre'),
      crearCodigo:      document.getElementById('crear-codigo'),
      formUnirse:       document.getElementById('form-unirse-sesion'),
      unirseNombre:     document.getElementById('unirse-nombre'),
      unirseCodigo:     document.getElementById('unirse-codigo'),
      contadorSesiones: document.getElementById('contador-sesiones'),
      listaMisSesiones: document.getElementById('lista-mis-sesiones'),
      listaRapida:      document.getElementById('lista-rapida')
    };

    if (!dom.contenedor) { return; }

    dom.boton.addEventListener('click', function (ev) { ev.stopPropagation(); alternarPanel(); });
    dom.panel.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('click', function () { if (!dom.panel.hidden) { cerrarPanel(); } });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { cerrarPanel(); } });

    dom.formCrear.addEventListener('submit', manejarCrear);
    dom.formUnirse.addEventListener('submit', manejarUnirse);

    actualizarEstadoUI();

    if (sesion && sesion.rol === 'director') { arrancarComoDirector(); }
    else if (sesion && sesion.rol === 'oyente') { arrancarComoOyente(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
