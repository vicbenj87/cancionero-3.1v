/* ============================================================================
   app.js · Cancionero digital — índice, diapositivas y pantalla de letra
   ----------------------------------------------------------------------------
   Decisiones que explican el resto del archivo:

   · Solo hay una diapositiva en el DOM. Da igual que el repertorio tenga 7 o
     349 canciones de 22 estrofas: nunca se construyen 7.678 nodos, se cambia
     el texto de uno.

   · El índice se ordena alfabéticamente al cargar, no en el archivo de datos.
     Así el editor puede seguir trabajando por números de fila y quien busca
     una canción la encuentra donde espera. El número que se ve al lado del
     título es su número de ficha, el mismo del editor: por eso no es
     correlativo dentro de la lista.

   · La búsqueda mira el título y también la letra. Cuando la coincidencia está
     dentro de una estrofa, se muestra la línea encontrada con la parte que
     coincide resaltada, porque si no el resultado parece un error.

   · Las diapositivas son un circuito cerrado: de la última se vuelve a la
     primera. En un culto se repite el estribillo más de una vez y volver atrás
     22 pulsaciones no es opción.

   · La letra completa NO es una diapositiva. Es su propia pantalla, sale de
     pantalla completa y se recorre con scroll, como cualquier página.

   · La navegación vive en el hash (#/c/12/3, #/letra/12). Se puede recargar,
     compartir un enlace o dejar algo preparado en un marcador.
   ========================================================================== */

(function () {
  'use strict';

  var CFG = window.CANCIONERO_CONFIG;
  var DATOS = null;

  /* ======================================================================
     Utilidades
     ====================================================================== */

  function $(sel) { return document.querySelector(sel); }

  /** Quita acentos y pasa a minúsculas: "Canción" y "cancion" buscan igual. */
  function normalizar(txt) {
    return String(txt)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Normaliza guardando de qué carácter original salió cada carácter nuevo.
   * Hace falta para resaltar la coincidencia en el texto sin acentuar sobre el
   * texto de verdad: "canción" normalizado mide distinto por la descomposición
   * Unicode, así que sin este mapa el resaltado bailaría.
   */
  function normalizarConMapa(txt) {
    var salida = '', mapa = [];
    for (var i = 0; i < txt.length; i++) {
      var trozo = txt.charAt(i).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      for (var k = 0; k < trozo.length; k++) { salida += trozo.charAt(k); mapa.push(i); }
    }
    return { texto: salida, mapa: mapa };
  }

  function dosDigitos(n) { return String(n).padStart(2, '0'); }

  function retardar(fn, ms) {
    var id;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(id);
      id = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function aleatorio(max) { return Math.floor(Math.random() * max); }

  /* Orden alfabético español: la ñ va donde debe y "Salmo 2" antes que "Salmo 10". */
  var comparador = (window.Intl && Intl.Collator)
    ? new Intl.Collator('es', { sensitivity: 'base', numeric: true, ignorePunctuation: true })
    : { compare: function (a, b) { return normalizar(a) < normalizar(b) ? -1 : 1; } };

  /* ======================================================================
     Estado
     ====================================================================== */

  var estado = {
    canciones: [],        // repertorio saneado y ordenado
    visibles: [],         // resultado del filtro + búsqueda
    filtro: CFG.indice.filtroInicial,
    busqueda: '',
    consulta: '',         // la búsqueda ya normalizada
    cancion: null,        // canción abierta en el visor
    indice: 0,            // diapositiva actual (0-based)
    idFondo: null,        // canción a la que pertenece el fondo actual
    regreso: '#/',        // a dónde vuelve la pantalla de letra
    letraId: null,        // canción que se está leyendo
    fondosRecientes: [],
    enTransicion: false
  };

  var dom = {};
  var temporizadorInactividad = null;
  var temporizadorGuia = null;
  var temporizadorMedio = null;

  /* ======================================================================
     Origen de los datos
     ----------------------------------------------------------------------
     Por defecto manda js/data/canciones.js, que se carga con <script> y por
     tanto funciona también con doble clic (protocolo file://, donde fetch está
     bloqueado). Si en index.html se quita esa etiqueta, o si se pone
     datos.origen = 'json' en la configuración, se lee js/data/canciones.json.
     Si el JSON falla, se vuelve a lo que hubiera cargado el <script>.
     ====================================================================== */

  function obtenerDatos() {
    var cfg = CFG.datos || { origen: 'auto', rutaJson: 'js/data/canciones.json' };
    var incrustados = window.CANCIONERO_DATA || null;
    var quiereJson = cfg.origen === 'json' || (cfg.origen === 'auto' && !incrustados);

    if (!quiereJson || !window.fetch) { return Promise.resolve(incrustados); }

    return fetch(cfg.rutaJson, { cache: 'no-cache' })
      .then(function (resp) {
        if (!resp.ok) { throw new Error('HTTP ' + resp.status); }
        return resp.json();
      })
      .catch(function (error) {
        if (!incrustados) {
          console.error('No se ha podido leer ' + cfg.rutaJson + ':', error.message);
        }
        return incrustados;
      });
  }

  /* ======================================================================
     Carga y saneado
     ----------------------------------------------------------------------
     El archivo de datos lo genera una persona con un editor: hay que asumir
     celdas vacías, tipos raros y estrofas de más. Se limpia una sola vez y a
     partir de ahí el resto del código confía en la estructura.
     ====================================================================== */

  function cargarCanciones() {
    var crudas = (DATOS && Array.isArray(DATOS.canciones)) ? DATOS.canciones : [];
    var limpias = [];
    var maxDiapos = CFG.app.maxDiapositivas;

    for (var i = 0; i < crudas.length && limpias.length < CFG.app.maxCanciones; i++) {
      var c = crudas[i] || {};
      var titulo = String(c.titulo || '').trim();
      if (!titulo) { continue; }                       // sin título no hay canción

      var diapos = (Array.isArray(c.diapositivas) ? c.diapositivas : [])
        .map(function (d) { return String(d == null ? '' : d).replace(/\r\n/g, '\n').trim(); })
        .slice(0, maxDiapos)
        .filter(function (d) { return d.length > 0; });

      var tipo = parseInt(c.tipo, 10);
      if (tipo !== 1 && tipo !== 2 && tipo !== 3) { tipo = 1; }

      limpias.push({
        id: parseInt(c.id, 10) || (limpias.length + 1),
        titulo: titulo,
        tipo: tipo,
        diapositivas: diapos,
        /* Claves precalculadas: buscar es comparar cadenas, no normalizar 349
           títulos y 7.678 estrofas en cada pulsación de tecla. */
        clave: normalizar(titulo),
        claveCuerpo: normalizar(diapos.join('\n'))
      });
    }

    if (CFG.indice.ordenAlfabetico) {
      limpias.sort(function (a, b) { return comparador.compare(a.titulo, b.titulo); });
    }

    estado.canciones = limpias;
  }

  function buscarPorId(id) {
    for (var i = 0; i < estado.canciones.length; i++) {
      if (estado.canciones[i].id === id) { return estado.canciones[i]; }
    }
    return null;
  }

  /* ======================================================================
     Índice
     ====================================================================== */

  function filtrarCanciones() {
    var q = normalizar(estado.busqueda);
    var f = estado.filtro;
    var minLetra = CFG.indice.minCaracteresLetra || 1;
    estado.consulta = q;

    estado.visibles = estado.canciones.filter(function (c) {
      // Tipo 3 ("Ambas") aparece en los dos filtros.
      var pasaTipo = (f === 0) || (c.tipo === f) || (c.tipo === 3);
      if (!pasaTipo) { return false; }
      if (!q) { return true; }

      // El título y el número responden desde la primera letra.
      if (c.clave.indexOf(q) !== -1 || String(c.id) === q) { return true; }

      /* Dentro de las letras hace falta algo más de texto: buscar "a" en
         7.678 estrofas devolvería el repertorio entero, que es lo mismo que
         no buscar nada. */
      return q.length >= minLetra && c.claveCuerpo.indexOf(q) !== -1;
    });
  }

  /**
   * Letra de agrupación del índice.
   *
   * Se salta los signos de apertura y las comillas antes de mirar: en un
   * cancionero español "¡Cantad al Señor!" y "¿Quién como Él?" son legión, y el
   * orden alfabético ya los coloca por su primera letra —el comparador ignora
   * la puntuación—. Si la marca dijera "#", aparecería un grupo de un solo
   * elemento en mitad del alfabeto y parecería una avería.
   */
  function inicial(titulo) {
    var limpio = normalizar(titulo).replace(/^[^a-z0-9]+/, '');
    var c = limpio.charAt(0);
    if (/[a-z]/.test(c)) { return c.toUpperCase(); }
    if (/[0-9]/.test(c)) { return '0-9'; }
    return '#';
  }

  /**
   * Tira de 22 marcas con las primeras `cantidad` llenas.
   * Es un solo nodo: el dibujo lo hace el CSS a partir de dos variables.
   */
  function crearMedidor(cantidad) {
    var PASO = 5;                              // píxeles por marca, igual que en app.css
    var medidor = document.createElement('span');
    medidor.className = 'medidor';
    medidor.setAttribute('aria-hidden', 'true');
    medidor.style.setProperty('--marcas', CFG.app.maxDiapositivas);
    medidor.style.setProperty('--llenado', (cantidad * PASO) + 'px');
    medidor.title = cantidad + ' de ' + CFG.app.maxDiapositivas + ' diapositivas';
    return medidor;
  }

  /** Primera línea de la letra que contiene la búsqueda, con posiciones. */
  function localizarEnLetra(cancion, q) {
    for (var i = 0; i < cancion.diapositivas.length; i++) {
      var lineas = cancion.diapositivas[i].split('\n');
      for (var j = 0; j < lineas.length; j++) {
        var mapa = normalizarConMapa(lineas[j]);
        var pos = mapa.texto.indexOf(q);
        if (pos === -1) { continue; }
        var ultimo = Math.min(pos + q.length - 1, mapa.mapa.length - 1);
        return {
          linea: lineas[j],
          desde: mapa.mapa[pos],
          hasta: mapa.mapa[ultimo] + 1,
          diapositiva: i + 1
        };
      }
    }
    return null;
  }

  /** Línea encontrada, recortada y con la coincidencia resaltada. */
  function crearCoincidencia(cancion, q) {
    var hallazgo = localizarEnLetra(cancion, q);
    if (!hallazgo) { return null; }

    var linea = hallazgo.linea;
    var desde = hallazgo.desde;
    var hasta = hallazgo.hasta;
    var recortado = false;

    if (desde > 34) {                          // no arrastres media estrofa
      var corte = desde - 24;
      linea = linea.slice(corte);
      desde -= corte;
      hasta -= corte;
      recortado = true;
    }
    var cola = linea.length > hasta + 46;
    if (cola) { linea = linea.slice(0, hasta + 46); }

    var envoltorio = document.createElement('span');
    envoltorio.className = 'coincidencia';
    envoltorio.appendChild(document.createTextNode(
      (recortado ? '…' : '') + linea.slice(0, desde)));

    var marca = document.createElement('mark');
    marca.textContent = linea.slice(desde, hasta);
    envoltorio.appendChild(marca);

    envoltorio.appendChild(document.createTextNode(linea.slice(hasta) + (cola ? '…' : '')));
    envoltorio.title = 'Diapositiva ' + hallazgo.diapositiva;
    return envoltorio;
  }

  /* Icono de tres líneas del botón de letra. Se construye a mano porque
     innerHTML con SVG en cada una de las 349 filas sale más caro. */
  function iconoLetra() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    [[4, 7, 20], [4, 12, 20], [4, 17, 14]].forEach(function (l) {
      var linea = document.createElementNS(NS, 'line');
      linea.setAttribute('x1', l[0]); linea.setAttribute('y1', l[1]);
      linea.setAttribute('x2', l[2]); linea.setAttribute('y2', l[1]);
      svg.appendChild(linea);
    });
    return svg;
  }

  function crearFilaCancion(c) {
    var li = document.createElement('li');
    li.className = 'fila-cancion';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cancion';
    btn.dataset.id = c.id;

    var num = document.createElement('span');
    num.className = 'cancion__numero';
    num.textContent = dosDigitos(c.id);
    num.title = 'Canción ' + c.id + ' del editor';

    var texto = document.createElement('span');
    texto.className = 'cancion__texto';

    var titulo = document.createElement('span');
    titulo.className = 'cancion__titulo';
    titulo.textContent = c.titulo;
    texto.appendChild(titulo);

    // Si lo que coincidió fue la letra y no el título, hay que enseñar dónde.
    if (estado.consulta && c.clave.indexOf(estado.consulta) === -1) {
      var coincidencia = crearCoincidencia(c, estado.consulta);
      if (coincidencia) { texto.appendChild(coincidencia); }
    }

    var tipo = document.createElement('span');
    tipo.className = 'etiqueta-tipo etiqueta-tipo--' + c.tipo;
    tipo.textContent = CFG.indice.tipos[c.tipo].abrev;

    btn.appendChild(num);
    btn.appendChild(texto);
    btn.appendChild(crearMedidor(c.diapositivas.length));
    btn.appendChild(tipo);

    btn.setAttribute('aria-label',
      c.titulo + ', canción ' + c.id + ', ' + c.diapositivas.length +
      ' diapositivas, ' + CFG.indice.tipos[c.tipo].nombre);

    /* Segundo botón: leer la letra sin proyectar. Sin él, la única puerta a la
       pantalla de letra pasaría por entrar a pantalla completa, que es justo
       lo que esa pantalla no debe hacer. */
    var letra = document.createElement('button');
    letra.type = 'button';
    letra.className = 'ver-letra';
    letra.dataset.letra = c.id;
    letra.title = 'Ver la letra completa sin proyectar';
    letra.setAttribute('aria-label', 'Ver la letra completa de ' + c.titulo);
    letra.appendChild(iconoLetra());

    li.appendChild(btn);
    li.appendChild(letra);
    return li;
  }

  function renderIndice() {
    filtrarCanciones();

    var fragmento = document.createDocumentFragment();
    var letraActual = null;

    estado.visibles.forEach(function (c) {
      // Marca de letra: sin ella, una lista alfabética de 349 títulos no se lee.
      if (CFG.indice.ordenAlfabetico) {
        var letra = inicial(c.titulo);
        if (letra !== letraActual) {
          letraActual = letra;
          var separador = document.createElement('li');
          separador.className = 'marca-letra';
          separador.setAttribute('aria-hidden', 'true');
          separador.textContent = letra;
          fragmento.appendChild(separador);
        }
      }
      fragmento.appendChild(crearFilaCancion(c));
    });

    dom.lista.innerHTML = '';
    dom.lista.appendChild(fragmento);

    var hayResultados = estado.visibles.length > 0;
    dom.vacio.hidden = hayResultados;
    dom.lista.hidden = !hayResultados;
    dom.vacioTitulo.textContent = estado.canciones.length === 0
      ? 'Todavía no hay canciones'
      : 'Ninguna canción coincide';
    dom.vacioTexto.innerHTML = estado.canciones.length === 0
      ? 'Abre <code>editor.html</code>, escribe el repertorio y exporta <code>js/data/canciones.js</code>.'
      : 'La búsqueda mira títulos y letras. Prueba con otras palabras o cambia el filtro.';

    dom.cifraTotal.textContent = estado.canciones.length;
  }

  /* ======================================================================
     Fondos
     ----------------------------------------------------------------------
     Siempre se pinta primero un fondo CSS. Si toca imagen o vídeo, se carga
     encima y solo se muestra cuando está listo: así jamás se ve una pantalla
     negra esperando un archivo que quizá ni exista.
     ====================================================================== */

  function elegirFamilia() {
    var estrategia = CFG.fondos.estrategia;
    if (estrategia !== 'mixto') { return estrategia; }

    var pesos = CFG.fondos.pesos;
    var tirada = aleatorio(pesos.css + pesos.imagen + pesos.video);
    if (tirada < pesos.css) { return 'css'; }
    if (tirada < pesos.css + pesos.imagen) { return 'imagen'; }
    return 'video';
  }

  /** Índice al azar de la familia evitando los últimos usados. */
  function elegirIndiceSinRepetir(familia, longitud) {
    if (longitud <= 0) { return -1; }
    var memoria = Math.min(CFG.fondos.memoriaSinRepetir, longitud - 1);
    for (var intento = 0; intento < 40; intento++) {
      var i = aleatorio(longitud);
      if (estado.fondosRecientes.indexOf(familia + ':' + i) === -1) {
        estado.fondosRecientes.push(familia + ':' + i);
        while (estado.fondosRecientes.length > memoria) { estado.fondosRecientes.shift(); }
        return i;
      }
    }
    return aleatorio(longitud);
  }

  /* Mientras se lee la letra el visor está oculto: dejar el vídeo corriendo
     detrás solo gastaría batería. Se pausa y se reanuda al volver, en vez de
     descargarlo otra vez y perder el fondo que le tocaba a esa canción. */
  function pausarVideoFondo() {
    try { dom.fondoVideo.pause(); } catch (e) {}
  }

  function reanudarVideoFondo() {
    if (dom.fondoVideo.getAttribute('data-activo') !== 'true') { return; }
    var promesa = dom.fondoVideo.play();
    if (promesa && promesa.catch) { promesa.catch(function () {}); }
  }

  function limpiarMedios() {
    clearTimeout(temporizadorMedio);
    dom.fondoImagen.removeAttribute('data-activo');
    dom.fondoImagen.removeAttribute('src');
    dom.fondoVideo.removeAttribute('data-activo');
    dom.fondoVideo.pause();
    dom.fondoVideo.removeAttribute('src');
    dom.fondoVideo.load();
  }

  function aplicarFondo() {
    limpiarMedios();
    dom.capaFondo.className = 'capa-fondo fondo--' +
      dosDigitos(elegirIndiceSinRepetir('css', CFG.fondos.totalCss) + 1);

    var familia = elegirFamilia();
    if (familia === 'css') { return; }

    var lista = familia === 'imagen' ? CFG.fondos.imagenes : CFG.fondos.videos;
    var i = elegirIndiceSinRepetir(familia, lista.length);
    if (i < 0) { return; }
    var ruta = lista[i];

    var caducado = false;
    temporizadorMedio = setTimeout(function () { caducado = true; }, CFG.fondos.tiempoEsperaMedio);

    if (familia === 'imagen') {
      var precarga = new Image();
      precarga.onload = function () {
        if (caducado) { return; }
        clearTimeout(temporizadorMedio);
        dom.fondoImagen.src = ruta;
        dom.fondoImagen.setAttribute('data-activo', 'true');
      };
      precarga.onerror = function () { /* se queda el fondo CSS */ };
      precarga.src = ruta;
    } else {
      dom.fondoVideo.src = ruta;
      dom.fondoVideo.addEventListener('canplay', function alListo() {
        dom.fondoVideo.removeEventListener('canplay', alListo);
        if (caducado) { return; }
        clearTimeout(temporizadorMedio);
        dom.fondoVideo.setAttribute('data-activo', 'true');
        var promesa = dom.fondoVideo.play();
        if (promesa && promesa.catch) { promesa.catch(function () {}); }
      });
      dom.fondoVideo.load();
    }
  }

  /* ======================================================================
     Ajuste tipográfico
     ----------------------------------------------------------------------
     Búsqueda binaria del mayor tamaño que cabe. Nueve pasadas bastan para
     acertar con menos de 1 px de error entre 20 y 160 px.
     ====================================================================== */

  function ajustarTipografia() {
    var el = dom.diapositiva;
    var min = CFG.visor.tipografia.min;
    var max = CFG.visor.tipografia.max;
    var mejor = min;

    for (var paso = 0; paso < 9; paso++) {
      var medio = (min + max) / 2;
      el.style.fontSize = medio + 'px';
      var cabe = (el.scrollHeight <= el.clientHeight + 1) &&
                 (el.scrollWidth <= el.clientWidth + 1);
      if (cabe) { mejor = medio; min = medio; } else { max = medio; }
    }
    el.style.fontSize = Math.floor(mejor) + 'px';
  }

  /* ======================================================================
     Visor de diapositivas
     ====================================================================== */

  function abrirCancion(id, indiceDiapositiva) {
    var cancion = buscarPorId(id);
    if (!cancion) { irAlIndice(); return; }

    estado.cancion = cancion;
    estado.indice = Math.min(Math.max(indiceDiapositiva || 0, 0),
                             Math.max(cancion.diapositivas.length - 1, 0));

    // El ambiente se sortea por canción, no por diapositiva ni por ida y vuelta
    // a la pantalla de letra.
    if (estado.idFondo !== cancion.id) {
      aplicarFondo();
      estado.idFondo = cancion.id;
    }

    cerrarPantallaLetra();
    reanudarVideoFondo();
    document.body.classList.add('sin-scroll');
    dom.visor.setAttribute('data-abierto', 'true');
    dom.visor.setAttribute('aria-hidden', 'false');
    /* Si se salió en negro y se vuelve desde la letra, hay que encender: una
       pantalla negra sin motivo parece una avería. */
    dom.visor.removeAttribute('data-negro');
    dom.visorTitulo.textContent = cancion.titulo;

    pintarDiapositiva(false);

    if (CFG.visor.pantallaCompletaAuto) { entrarPantallaCompleta(); }
    destacarFlechas();

    var destino = dom.btnSiguiente.disabled ? dom.btnSalir : dom.btnSiguiente;
    destino.focus({ preventScroll: true });
  }

  function pintarDiapositiva(conTransicion) {
    var cancion = estado.cancion;
    if (!cancion) { return; }

    var total = cancion.diapositivas.length;
    var texto = total ? cancion.diapositivas[estado.indice] : '(Esta canción todavía no tiene letra)';

    function pintar() {
      dom.diapositiva.textContent = texto;
      ajustarTipografia();
      dom.visor.removeAttribute('data-transicion');
      estado.enTransicion = false;
    }

    if (conTransicion) {
      estado.enTransicion = true;
      dom.visor.setAttribute('data-transicion', 'true');
      setTimeout(pintar, 200);
    } else {
      pintar();
    }

    dom.contador.textContent = total ? (estado.indice + 1) + ' / ' + total : '—';

    /* En bucle las flechas nunca se apagan mientras haya más de una
       diapositiva: apagarlas al final sería justo cuando hacen falta. */
    var sinSalida = CFG.visor.bucle ? total <= 1 : true;
    dom.btnAnterior.disabled = sinSalida && estado.indice <= 0;
    dom.btnSiguiente.disabled = sinSalida && estado.indice >= total - 1;
  }

  function irADiapositiva(nuevo) {
    var total = estado.cancion ? estado.cancion.diapositivas.length : 0;
    if (!total || estado.enTransicion) { return; }

    if (CFG.visor.bucle) {
      nuevo = ((nuevo % total) + total) % total;   // el resto también gira hacia atrás
    } else if (nuevo < 0 || nuevo > total - 1) {
      return;
    }

    if (nuevo === estado.indice) { return; }
    estado.indice = nuevo;
    pintarDiapositiva(true);
    actualizarHash();
  }

  function siguiente() { irADiapositiva(estado.indice + 1); }
  function anterior() { irADiapositiva(estado.indice - 1); }

  /* ======================================================================
     Pantalla de letra completa
     ----------------------------------------------------------------------
     Es una pantalla aparte, no una diapositiva más: sale de pantalla completa,
     no tiene flechas y se recorre con scroll normal (rueda, dedo, barra
     espaciadora, AvPág). El botón de volver lleva a donde se venía.
     ====================================================================== */

  function abrirPantallaLetra(id) {
    var cancion = buscarPorId(id);
    if (!cancion) { irAlIndice(); return; }

    // Requisito explícito: aquí no se fuerza la pantalla completa.
    salirPantallaCompleta();

    dom.visor.setAttribute('data-abierto', 'false');
    dom.visor.setAttribute('aria-hidden', 'true');
    pausarVideoFondo();

    estado.letraId = cancion.id;
    dom.letraTitulo.textContent = cancion.titulo;
    dom.letraFicha.textContent = 'Canción ' + cancion.id + ' · ' +
      CFG.indice.tipos[cancion.tipo].nombre + ' · ' +
      cancion.diapositivas.length + ' diapositivas';

    var cuerpo = dom.letraCuerpo;
    cuerpo.innerHTML = '';

    if (!cancion.diapositivas.length) {
      var aviso = document.createElement('p');
      aviso.className = 'estrofa';
      aviso.textContent = 'Esta canción todavía no tiene letra.';
      cuerpo.appendChild(aviso);
    }

    cancion.diapositivas.forEach(function (texto, i) {
      var bloque = document.createElement('p');
      bloque.className = 'estrofa';
      var num = document.createElement('span');
      num.className = 'estrofa__numero';
      num.textContent = dosDigitos(i + 1);
      bloque.appendChild(num);
      bloque.appendChild(document.createTextNode(texto));
      cuerpo.appendChild(bloque);
    });

    dom.volverLetra.textContent = estado.regreso.indexOf('#/c/') === 0
      ? '← Volver a las diapositivas'
      : '← Volver al índice';

    document.body.classList.add('sin-scroll');
    dom.pantallaLetra.setAttribute('data-abierto', 'true');
    dom.pantallaLetra.setAttribute('aria-hidden', 'false');
    dom.pantallaLetra.scrollTop = 0;
    // El foco va al contenedor para que las teclas de scroll funcionen ya.
    dom.pantallaLetra.focus({ preventScroll: true });
  }

  function cerrarPantallaLetra() {
    dom.pantallaLetra.setAttribute('data-abierto', 'false');
    dom.pantallaLetra.setAttribute('aria-hidden', 'true');
  }

  function letraAbierta() {
    return dom.pantallaLetra.getAttribute('data-abierto') === 'true';
  }

  function irALetra() {
    if (!estado.cancion) { return; }
    estado.regreso = '#/c/' + estado.cancion.id + '/' + (estado.indice + 1);
    location.hash = '#/letra/' + estado.cancion.id;
  }

  function volverDeLetra() { location.hash = estado.regreso || '#/'; }

  /* De la lectura a la proyección. Empieza por la primera diapositiva: quien
     lee la letra entera está preparando la canción, no continuándola. */
  function proyectarLoLeido() {
    if (!estado.letraId) { return; }
    estado.regreso = '#/';
    location.hash = '#/c/' + estado.letraId + '/1';
  }

  /* ======================================================================
     Salidas
     ====================================================================== */

  function cerrarVisor() {
    limpiarMedios();
    dom.visor.setAttribute('data-abierto', 'false');
    dom.visor.setAttribute('aria-hidden', 'true');
    dom.visor.removeAttribute('data-negro');
    dom.visor.removeAttribute('data-guia');
    clearTimeout(temporizadorGuia);
    estado.cancion = null;
    salirPantallaCompleta();
  }

  function irAlIndice() {
    if (location.hash && location.hash !== '#/') { location.hash = '#/'; }
    else { mostrarIndice(); }
  }

  function mostrarIndice() {
    cerrarVisor();
    cerrarPantallaLetra();
    document.body.classList.remove('sin-scroll');
    estado.idFondo = null;                     // al volver a entrar, ambiente nuevo
    estado.regreso = '#/';
  }

  /* ======================================================================
     Pantalla completa y orientación
     ====================================================================== */

  function entrarPantallaCompleta() {
    var el = document.documentElement;
    var pedir = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (!pedir || document.fullscreenElement) { bloquearOrientacion(); return; }
    try {
      var p = pedir.call(el);
      if (p && p.then) { p.then(bloquearOrientacion).catch(function () {}); }
      else { bloquearOrientacion(); }
    } catch (e) { /* algunos navegadores lo prohíben; seguimos en ventana */ }
  }

  function salirPantallaCompleta() {
    try { if (screen.orientation && screen.orientation.unlock) { screen.orientation.unlock(); } } catch (e) {}
    var salir = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (salir && document.fullscreenElement) {
      try { salir.call(document); } catch (e) {}
    }
  }

  function bloquearOrientacion() {
    if (!CFG.visor.bloquearHorizontal) { return; }
    try {
      if (screen.orientation && screen.orientation.lock) {
        var p = screen.orientation.lock('landscape');
        if (p && p.catch) { p.catch(function () {}); }   // iOS no lo permite: da igual
      }
    } catch (e) {}
  }

  function alternarPantallaCompleta() {
    if (document.fullscreenElement) { salirPantallaCompleta(); } else { entrarPantallaCompleta(); }
  }

  /* ======================================================================
     Guía de arranque y ocultación de los controles
     ----------------------------------------------------------------------
     Al empezar a proyectar, las flechas parpadean unas cuantas veces: dicen
     dónde hay que pulsar sin escribirlo. Cuando terminan, empieza a contar el
     tiempo de inactividad y a partir de ahí desaparece todo hasta que alguien
     mueva el ratón o toque la pantalla.
     ====================================================================== */

  function destacarFlechas() {
    clearTimeout(temporizadorGuia);
    var duracion = CFG.visor.parpadeoInicialMs;

    if (!duracion) { reiniciarInactividad(); return; }

    dom.visor.removeAttribute('data-inactivo');
    dom.visor.setAttribute('data-guia', 'true');
    clearTimeout(temporizadorInactividad);

    temporizadorGuia = setTimeout(function () {
      dom.visor.removeAttribute('data-guia');
      reiniciarInactividad();
    }, duracion);
  }

  function reiniciarInactividad() {
    // Mientras las flechas están llamando la atención, no se esconde nada.
    if (dom.visor.getAttribute('data-guia') === 'true') { return; }

    var espera = CFG.visor.ocultarControlesTrasMs;
    dom.visor.removeAttribute('data-inactivo');
    clearTimeout(temporizadorInactividad);
    if (!espera) { return; }

    temporizadorInactividad = setTimeout(function () {
      dom.visor.setAttribute('data-inactivo', 'true');
    }, espera);
  }

  /* ======================================================================
     Enrutado:  #/  ·  #/c/<id>/<diapositiva>  ·  #/letra/<id>
     ====================================================================== */

  function actualizarHash() {
    if (!estado.cancion) { return; }
    var nuevo = '#/c/' + estado.cancion.id + '/' + (estado.indice + 1);
    if (location.hash !== nuevo) {
      history.replaceState(null, '', nuevo);   // pasar estrofa no llena el historial
    }
  }

  function leerRuta() {
    var partes = (location.hash || '').replace(/^#\/?/, '').split('/');

    if (partes[0] === 'c' && partes[1]) {
      cerrarPantallaLetra();
      abrirCancion(parseInt(partes[1], 10), (parseInt(partes[2], 10) || 1) - 1);
    } else if (partes[0] === 'letra' && partes[1]) {
      abrirPantallaLetra(parseInt(partes[1], 10));
    } else {
      mostrarIndice();
    }
  }

  /* ======================================================================
     Eventos
     ====================================================================== */

  function conectarEventos() {

    /* --- Índice --------------------------------------------------------- */
    dom.lista.addEventListener('click', function (ev) {
      estado.regreso = '#/';

      /* Funciones intercambiadas a propósito: ".ver-letra" ahora proyecta la
         canción (lo que antes hacía ".cancion") y ".cancion" ahora abre la
         letra completa sin proyectar (lo que antes hacía ".ver-letra"). */
      var soloLetra = ev.target.closest('.ver-letra');
      if (soloLetra) {
        location.hash = '#/c/' + soloLetra.dataset.letra + '/1';
        return;
      }

      var btn = ev.target.closest('.cancion');
      if (!btn) { return; }
      location.hash = '#/letra/' + btn.dataset.id;
    });

    dom.busqueda.addEventListener('input', retardar(function (ev) {
      estado.busqueda = ev.target.value;
      renderIndice();
    }, 140));

    dom.filtros.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.filtro');
      if (!btn) { return; }
      estado.filtro = parseInt(btn.dataset.filtro, 10);
      Array.prototype.forEach.call(dom.filtros.querySelectorAll('.filtro'), function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      renderIndice();
    });

    /* --- Visor ---------------------------------------------------------- */
    dom.btnSiguiente.addEventListener('click', siguiente);
    dom.btnAnterior.addEventListener('click', anterior);
    dom.btnLetra.addEventListener('click', irALetra);
    dom.btnPantalla.addEventListener('click', alternarPantallaCompleta);
    dom.btnSalir.addEventListener('click', irAlIndice);
    dom.volverLetra.addEventListener('click', volverDeLetra);
    dom.proyectarLetra.addEventListener('click', proyectarLoLeido);

    ['mousemove', 'pointerdown', 'keydown', 'wheel'].forEach(function (evt) {
      dom.visor.addEventListener(evt, reiniciarInactividad, { passive: true });
    });

    /* --- Teclado -------------------------------------------------------- */
    document.addEventListener('keydown', function (ev) {

      // En la pantalla de letra solo se sale: el resto de teclas hacen scroll.
      if (letraAbierta()) {
        if (ev.key === 'Escape') { ev.preventDefault(); volverDeLetra(); }
        return;
      }

      if (dom.visor.getAttribute('data-abierto') !== 'true') {
        if (ev.key === '/' && document.activeElement !== dom.busqueda) {
          ev.preventDefault();
          dom.busqueda.focus();                // "/" enfoca el buscador
        }
        return;
      }

      switch (ev.key) {
        case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ':
          ev.preventDefault(); siguiente(); break;
        case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
          ev.preventDefault(); anterior(); break;
        case 'Home':
          ev.preventDefault(); irADiapositiva(0); break;
        case 'End':
          ev.preventDefault(); irADiapositiva(estado.cancion.diapositivas.length - 1); break;
        case 'Escape':
          irAlIndice(); break;
        case 'l': case 'L':
          ev.preventDefault(); irALetra(); break;
        case 'f': case 'F':
          ev.preventDefault(); alternarPantallaCompleta(); break;
        case 'b': case 'B': case '.':
          // Pantalla en negro: para orar o para hablar sin distracción.
          ev.preventDefault();
          dom.visor.setAttribute('data-negro',
            dom.visor.getAttribute('data-negro') === 'true' ? 'false' : 'true');
          break;
      }
    });

    /* --- Gestos táctiles ------------------------------------------------ */
    if (CFG.visor.gestosTactiles) {
      var inicioX = 0, inicioY = 0, tocando = false;

      dom.escena.addEventListener('touchstart', function (ev) {
        if (ev.touches.length !== 1) { return; }
        tocando = true;
        inicioX = ev.touches[0].clientX;
        inicioY = ev.touches[0].clientY;
      }, { passive: true });

      dom.escena.addEventListener('touchend', function (ev) {
        if (!tocando) { return; }
        tocando = false;
        var dx = ev.changedTouches[0].clientX - inicioX;
        var dy = ev.changedTouches[0].clientY - inicioY;
        // Solo cuenta como paso si el gesto es claramente horizontal.
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) { return; }
        if (dx < 0) { siguiente(); } else { anterior(); }
      }, { passive: true });
    }

    /* --- Reajustes ------------------------------------------------------ */
    var reajustar = retardar(function () {
      if (dom.visor.getAttribute('data-abierto') === 'true') { ajustarTipografia(); }
    }, 120);

    window.addEventListener('resize', reajustar);
    window.addEventListener('orientationchange', reajustar);
    document.addEventListener('fullscreenchange', reajustar);
    window.addEventListener('hashchange', leerRuta);
  }

  /* ======================================================================
     Arranque
     ====================================================================== */

  function iniciar() {
    dom = {
      lista:         $('#lista'),
      vacio:         $('#vacio'),
      vacioTitulo:   $('#vacio-titulo'),
      vacioTexto:    $('#vacio-texto'),
      busqueda:      $('#busqueda'),
      filtros:       $('#filtros'),
      cifraTotal:    $('#cifra-total'),
      cifraFondos:   $('#cifra-fondos'),

      visor:         $('#visor'),
      capaFondo:     $('#capa-fondo'),
      fondoImagen:   $('#fondo-imagen'),
      fondoVideo:    $('#fondo-video'),
      escena:        $('#escena'),
      diapositiva:   $('#diapositiva'),
      visorTitulo:   $('#visor-titulo'),
      contador:      $('#contador'),
      btnAnterior:   $('#btn-anterior'),
      btnSiguiente:  $('#btn-siguiente'),
      btnLetra:      $('#btn-letra'),
      btnPantalla:   $('#btn-pantalla'),
      btnSalir:      $('#btn-salir'),

      pantallaLetra: $('#pantalla-letra'),
      letraTitulo:   $('#letra-titulo'),
      letraFicha:    $('#letra-ficha'),
      letraCuerpo:   $('#letra-cuerpo'),
      volverLetra:   $('#volver-letra'),
      proyectarLetra:$('#proyectar-letra')
    };

    if (!CFG) { console.error('Falta js/config.js.'); return; }

    dom.cifraFondos.textContent = CFG.fondos.totalCss;

    Array.prototype.forEach.call(dom.filtros.querySelectorAll('.filtro'), function (b) {
      b.setAttribute('aria-pressed', String(parseInt(b.dataset.filtro, 10) === estado.filtro));
    });

    conectarEventos();

    obtenerDatos().then(function (datos) {
      DATOS = datos;
      if (!DATOS) { console.error('No hay datos de canciones que cargar.'); }
      cargarCanciones();
      renderIndice();
      leerRuta();                              // respeta un enlace directo
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
