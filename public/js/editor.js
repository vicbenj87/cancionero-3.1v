/* ============================================================================
   editor.js · Editor local del repertorio
   ----------------------------------------------------------------------------
   Qué hace
   --------
   Mantiene una tabla de 350 filas (fila 1 = cabecera, filas 2–350 = las 349
   canciones) con 24 columnas: A "Título", B–W "Diapositiva 1…22" y X "TIPO".
   Al terminar, exporta js/data/canciones.js, que es el único archivo que hay
   que subir a GitHub para actualizar la web.

   Por qué la cuadrícula está virtualizada
   ---------------------------------------
   349 × 24 son 8.376 celdas. Si todas fueran campos de texto reales, el
   navegador tardaría segundos en abrir la página y el desplazamiento iría a
   tirones. Aquí solo existen en el DOM las ~20 filas visibles: se crean al
   entrar en pantalla y se destruyen al salir. Los datos viven siempre en el
   array `filas`, nunca en el HTML.

   La columna TIPO no se edita
   ---------------------------
   Llega del archivo de datos y se conserva tal cual, para que una corrección
   de letras no cambie por accidente en qué culto se canta algo. El
   interruptor "Editar TIPO" de la barra la desbloquea si de verdad hace falta.
   ========================================================================== */

(function () {
  'use strict';

  var CFG = window.CANCIONERO_CONFIG;
  var MAX_DIAPOS = CFG.app.maxDiapositivas;   // 22
  var MAX_FILAS = CFG.app.maxCanciones;       // 349
  var CLAVE_BORRADOR = 'cancionero.editor.v1';
  var MARGEN_FILAS = 6;                       // filas de más que se pintan fuera de vista

  /* ======================================================================
     Almacenamiento tolerante a fallos
     ----------------------------------------------------------------------
     Hay navegadores y modos (privado, file:// con restricciones, vistas
     previas embebidas) donde localStorage lanza excepción al tocarlo. En vez
     de romper el editor, se guarda en memoria y se avisa de que el borrador
     no sobrevivirá al cierre de la pestaña.
     ====================================================================== */
  var almacen = (function () {
    var disponible = true;
    try {
      window.localStorage.setItem('__prueba__', '1');
      window.localStorage.removeItem('__prueba__');
    } catch (e) { disponible = false; }

    var memoria = {};
    return {
      disponible: disponible,
      leer: function (clave) {
        try { return disponible ? window.localStorage.getItem(clave) : (memoria[clave] || null); }
        catch (e) { return null; }
      },
      escribir: function (clave, valor) {
        try {
          if (disponible) { window.localStorage.setItem(clave, valor); } else { memoria[clave] = valor; }
          return true;
        } catch (e) { return false; }
      },
      borrar: function (clave) {
        try {
          if (disponible) { window.localStorage.removeItem(clave); } else { delete memoria[clave]; }
        } catch (e) {}
      }
    };
  })();

  /* ======================================================================
     Modelo
     ====================================================================== */

  var filas = [];
  var editarTipo = false;
  var filaAbierta = -1;
  var altoFila = 46;

  var dom = {};
  var filasEnDom = {};        // índice de fila → elemento
  var guardadoDiferido = null;

  function filaVacia() {
    return { titulo: '', diapositivas: new Array(MAX_DIAPOS).fill(''), tipo: 1 };
  }

  function crearModelo() {
    filas = [];
    for (var i = 0; i < MAX_FILAS; i++) { filas.push(filaVacia()); }
  }

  function filaTieneContenido(f) {
    if (f.titulo.trim()) { return true; }
    for (var i = 0; i < f.diapositivas.length; i++) {
      if (f.diapositivas[i].trim()) { return true; }
    }
    return false;
  }

  function contarCanciones() {
    return filas.filter(filaTieneContenido).length;
  }

  /* ======================================================================
     Utilidades
     ====================================================================== */

  function $(sel) { return document.querySelector(sel); }

  /** A para Título, B–W para las 22 diapositivas, X para TIPO. */
  function letraColumna(indice) { return String.fromCharCode(65 + indice); }

  function retardar(fn, ms) {
    var id;
    return function () {
      var args = arguments;
      clearTimeout(id);
      id = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  function normalizar(txt) {
    return String(txt).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function descargar(nombre, contenido, tipoMime) {
    var blob = new Blob([contenido], { type: tipoMime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ======================================================================
     Cuadrícula virtualizada
     ====================================================================== */

  function construirCabecera() {
    var frag = document.createDocumentFragment();

    frag.appendChild(celdaCabecera('', 'Nº', 'celda-cabecera--fija pegada-0'));
    frag.appendChild(celdaCabecera('A', 'Título', 'celda-cabecera--fija pegada-1'));

    for (var i = 0; i < MAX_DIAPOS; i++) {
      frag.appendChild(celdaCabecera(letraColumna(i + 1), 'Diapositiva ' + (i + 1)));
    }
    frag.appendChild(celdaCabecera(letraColumna(MAX_DIAPOS + 1), 'TIPO'));

    dom.cabecera.appendChild(frag);
  }

  function celdaCabecera(letra, texto, clase) {
    var celda = document.createElement('div');
    celda.className = 'celda-cabecera' + (clase ? ' ' + clase : '');
    if (letra) {
      var b = document.createElement('b');
      b.textContent = letra;
      celda.appendChild(b);
    }
    celda.appendChild(document.createTextNode(texto));
    celda.title = (letra ? 'Columna ' + letra + ' · ' : '') + texto;
    return celda;
  }

  function crearFila(indice) {
    var datos = filas[indice];
    var fila = document.createElement('div');
    fila.className = 'fila';
    fila.style.top = (indice * altoFila) + 'px';
    fila.dataset.fila = indice;
    fila.dataset.par = String(indice % 2 === 1);

    /* Columna del número + acceso al cajón de edición cómoda. */
    var num = document.createElement('div');
    num.className = 'celda celda--fija pegada-0 celda-num';
    var etiqueta = document.createElement('span');
    etiqueta.textContent = indice + 1;
    var abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'abrir-fila';
    abrir.dataset.accion = 'abrir-cajon';
    abrir.title = 'Abrir la canción ' + (indice + 1) + ' en el panel de edición';
    abrir.textContent = '⋯';
    num.appendChild(etiqueta);
    num.appendChild(abrir);
    fila.appendChild(num);

    /* A · Título */
    var celdaTitulo = document.createElement('div');
    celdaTitulo.className = 'celda celda--fija pegada-1';
    var entradaTitulo = document.createElement('input');
    entradaTitulo.type = 'text';
    entradaTitulo.className = 'entrada entrada--titulo';
    entradaTitulo.value = datos.titulo;
    entradaTitulo.dataset.col = '0';
    entradaTitulo.setAttribute('aria-label', 'Título de la canción ' + (indice + 1));
    celdaTitulo.appendChild(entradaTitulo);
    fila.appendChild(celdaTitulo);

    /* B–W · Diapositivas */
    for (var j = 0; j < MAX_DIAPOS; j++) {
      var celda = document.createElement('div');
      celda.className = 'celda';
      var area = document.createElement('textarea');
      area.className = 'entrada-multilinea';
      area.rows = 1;
      area.spellcheck = false;
      area.value = datos.diapositivas[j];
      area.dataset.col = String(j + 1);
      area.setAttribute('aria-label', 'Diapositiva ' + (j + 1) + ' de la canción ' + (indice + 1));
      celda.appendChild(area);
      fila.appendChild(celda);
    }

    /* X · TIPO */
    fila.appendChild(crearCeldaTipo(indice, datos.tipo));

    fila.dataset.conContenido = String(filaTieneContenido(datos));
    return fila;
  }

  function crearCeldaTipo(indice, tipo) {
    var celda = document.createElement('div');
    celda.className = 'celda celda-tipo';
    celda.dataset.tipo = tipo;

    if (editarTipo) {
      var select = document.createElement('select');
      select.dataset.col = String(MAX_DIAPOS + 1);
      select.setAttribute('aria-label', 'Tipo de la canción ' + (indice + 1));
      [1, 2, 3].forEach(function (valor) {
        var op = document.createElement('option');
        op.value = valor;
        op.textContent = valor + ' · ' + CFG.indice.tipos[valor].nombre;
        if (valor === tipo) { op.selected = true; }
        select.appendChild(op);
      });
      celda.appendChild(select);
    } else {
      celda.textContent = CFG.indice.tipos[tipo].abrev;
      celda.title = 'TIPO ' + tipo + ' · ' + CFG.indice.tipos[tipo].nombre +
                    ' (se conserva tal cual; actívalo en «Editar TIPO» para cambiarlo)';
    }
    return celda;
  }

  function pintarVentana() {
    var arriba = dom.rejilla.scrollTop;
    var alto = dom.rejilla.clientHeight;
    var inicio = Math.max(0, Math.floor(arriba / altoFila) - MARGEN_FILAS);
    var fin = Math.min(MAX_FILAS - 1, Math.ceil((arriba + alto) / altoFila) + MARGEN_FILAS);

    Object.keys(filasEnDom).forEach(function (clave) {
      var i = parseInt(clave, 10);
      if (i < inicio || i > fin) {
        filasEnDom[clave].remove();
        delete filasEnDom[clave];
      }
    });

    var frag = document.createDocumentFragment();
    for (var i = inicio; i <= fin; i++) {
      if (!filasEnDom[i]) {
        var el = crearFila(i);
        filasEnDom[i] = el;
        frag.appendChild(el);
      }
    }
    dom.cuerpo.appendChild(frag);
  }

  /** Redibuja las filas visibles conservando la posición del scroll. */
  function repintar() {
    Object.keys(filasEnDom).forEach(function (clave) {
      filasEnDom[clave].remove();
      delete filasEnDom[clave];
    });
    pintarVentana();
  }

  function refrescarFila(indice) {
    if (!filasEnDom[indice]) { return; }
    var nueva = crearFila(indice);
    dom.cuerpo.replaceChild(nueva, filasEnDom[indice]);
    filasEnDom[indice] = nueva;
  }

  /* ======================================================================
     Escritura en el modelo
     ====================================================================== */

  function asignarCelda(indiceFila, columna, valor) {
    if (indiceFila < 0 || indiceFila >= MAX_FILAS) { return; }
    var f = filas[indiceFila];

    if (columna === 0) {
      f.titulo = String(valor).replace(/\s*\n\s*/g, ' ').trim();
    } else if (columna >= 1 && columna <= MAX_DIAPOS) {
      f.diapositivas[columna - 1] = String(valor);
    } else if (columna === MAX_DIAPOS + 1 && editarTipo) {
      var t = parseInt(valor, 10);
      f.tipo = (t === 1 || t === 2 || t === 3) ? t : 1;
    }
  }

  function marcarCambio() {
    actualizarEstado();
    guardarBorradorDiferido();
  }

  /* ======================================================================
     Borrador automático
     ====================================================================== */

  var guardarBorradorDiferido = retardar(function () {
    var carga = JSON.stringify({ guardado: new Date().toISOString(), filas: filas });
    var ok = almacen.escribir(CLAVE_BORRADOR, carga);
    dom.guardado.textContent = ok
      ? 'Borrador guardado ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      : 'No se pudo guardar el borrador';
  }, 800);

  function restaurarBorrador() {
    var crudo = almacen.leer(CLAVE_BORRADOR);
    if (!crudo) { return false; }
    try {
      var datos = JSON.parse(crudo);
      if (!datos || !Array.isArray(datos.filas)) { return false; }
      crearModelo();
      datos.filas.slice(0, MAX_FILAS).forEach(function (f, i) {
        filas[i].titulo = String(f.titulo || '');
        filas[i].tipo = [1, 2, 3].indexOf(f.tipo) !== -1 ? f.tipo : 1;
        (f.diapositivas || []).slice(0, MAX_DIAPOS).forEach(function (d, j) {
          filas[i].diapositivas[j] = String(d || '');
        });
      });
      var fecha = new Date(datos.guardado);
      dom.avisoBorradorTexto.textContent =
        'Se ha recuperado el borrador guardado el ' +
        fecha.toLocaleDateString('es-ES') + ' a las ' +
        fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + '.';
      dom.avisoBorrador.setAttribute('data-visible', 'true');
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ======================================================================
     Importar
     ====================================================================== */

  /**
   * Acepta el .json exportado o el propio canciones.js.
   * El .js se ejecuta con un `window` de mentira del que solo se lee
   * CANCIONERO_DATA: así funciona igual aunque el archivo lleve comentarios
   * o el bloque de ejemplo al final.
   */
  function interpretarArchivo(texto) {
    var t = String(texto).trim();
    if (!t) { throw new Error('El archivo está vacío.'); }

    var datos;
    if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      datos = JSON.parse(t);
    } else {
      var ventanaFalsa = {};
      /* eslint-disable no-new-func */
      var ejecutar = new Function('window', t + '\n;return window.CANCIONERO_DATA;');
      /* eslint-enable no-new-func */
      datos = ejecutar(ventanaFalsa);
    }

    var canciones = Array.isArray(datos) ? datos : (datos && datos.canciones);
    if (!Array.isArray(canciones)) {
      throw new Error('No se ha encontrado la lista de canciones dentro del archivo.');
    }
    return canciones;
  }

  /**
   * Vuelca canciones importadas en la tabla.
   *
   * modo 'reemplazar' → borra todo y respeta los números originales.
   * modo 'anadir'     → conserva lo que hay. Si un título ya está y llega con
   *                     otro TIPO, pasa a 3 (Ambas): es exactamente lo que
   *                     ocurre al juntar el cancionero dominical con el de
   *                     Santa Cena, donde muchas canciones salen en los dos.
   *                     La letra que ya estaba no se toca; manda la del editor.
   */
  function volcarCanciones(canciones, opciones) {
    var op = opciones || {};
    var fusionar = op.modo === 'anadir';
    var marcarAmbas = op.marcarAmbas !== false;

    if (!fusionar) { crearModelo(); }

    var resumen = { nuevas: 0, fusionadas: 0, descartadas: 0 };
    var siguienteLibre = 0;

    /* Índice de lo que ya hay, para no recorrer 349 filas por cada canción. */
    var porTitulo = {};
    if (fusionar) {
      filas.forEach(function (f, i) {
        var clave = normalizar(f.titulo);
        if (clave && porTitulo[clave] === undefined) { porTitulo[clave] = i; }
      });
    }

    canciones.forEach(function (c) {
      if (!c) { return; }
      var titulo = String(c.titulo || '').trim();
      if (!titulo) { return; }

      var tipo = parseInt(c.tipo, 10);
      if (tipo !== 1 && tipo !== 2 && tipo !== 3) { tipo = 1; }

      var diapos = (Array.isArray(c.diapositivas) ? c.diapositivas : []).slice(0, MAX_DIAPOS);
      var destino;

      if (fusionar) {
        var existente = porTitulo[normalizar(titulo)];
        if (existente !== undefined) {
          var f0 = filas[existente];
          if (marcarAmbas && f0.tipo !== tipo) { f0.tipo = 3; }
          resumen.fusionadas++;
          return;                                  // la letra que ya estaba manda
        }
      } else {
        var id = parseInt(c.id, 10);
        if (id >= 1 && id <= MAX_FILAS && !filaTieneContenido(filas[id - 1])) {
          destino = id - 1;                        // respeta la numeración original
        }
      }

      if (destino === undefined) {
        while (siguienteLibre < MAX_FILAS && filaTieneContenido(filas[siguienteLibre])) {
          siguienteLibre++;
        }
        if (siguienteLibre >= MAX_FILAS) { resumen.descartadas++; return; }
        destino = siguienteLibre;
      }

      var f = filas[destino];
      f.titulo = titulo;
      f.tipo = tipo;
      diapos.forEach(function (d, j) { f.diapositivas[j] = String(d == null ? '' : d); });
      if (fusionar) { porTitulo[normalizar(titulo)] = destino; }
      resumen.nuevas++;
    });

    repintar();
    marcarCambio();
    return resumen;
  }

  /* ======================================================================
     Extractor del cancionero web
     ----------------------------------------------------------------------
     El código vive en editor.html, en un bloque de texto plano. Aquí solo se
     le cambian las dos constantes de cabecera según lo que elija el usuario y
     se deja listo para copiar. No se ejecuta nunca en esta página: su sitio es
     la consola del navegador, estando en el cancionero web.
     ====================================================================== */

  function prepararExtractor() {
    var plantilla = document.getElementById('codigo-extractor').textContent.trim();
    var tipo = dom.tipoExtractor.value;
    var pagina = tipo === '2' ? 'Santa Cena' : 'Dominical';

    var codigo = plantilla
      .replace(/var TIPO = \d;.*/,
               'var TIPO = ' + tipo + ';                  // ' + pagina)
      .replace(/var QUITAR_MARCAS = (?:true|false);.*/,
               'var QUITAR_MARCAS = ' + (dom.quitarMarcas.checked ? 'true' : 'false') + ';');

    dom.codigoListo.textContent = codigo;
  }

  function copiarExtractor() {
    var texto = dom.codigoListo.textContent;

    function avisar(ok) {
      dom.copiarCodigo.textContent = ok ? '✓ Copiado' : 'Selecciónalo y copia a mano';
      setTimeout(function () { dom.copiarCodigo.textContent = 'Copiar el código'; }, 2500);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () { avisar(true); },
                                               function () { seleccionarCodigo(); avisar(false); });
      return;
    }
    seleccionarCodigo();
    avisar(false);
  }

  /* Sin permiso de portapapeles al menos se deja el texto seleccionado. */
  function seleccionarCodigo() {
    try {
      var rango = document.createRange();
      rango.selectNodeContents(dom.codigoListo);
      var seleccion = window.getSelection();
      seleccion.removeAllRanges();
      seleccion.addRange(rango);
    } catch (e) {}
  }

  /* ======================================================================
     Exportar
     ====================================================================== */

  function construirDatos() {
    var canciones = [];

    filas.forEach(function (f, i) {
      var titulo = f.titulo.trim();
      var diapos = f.diapositivas
        .map(function (d) { return String(d).replace(/\r\n/g, '\n').trim(); })
        .filter(function (d) { return d.length > 0; });

      if (!titulo && !diapos.length) { return; }   // fila en blanco: no se exporta

      canciones.push({
        id: i + 1,
        titulo: titulo,
        tipo: f.tipo,
        diapositivas: diapos
      });
    });

    return {
      version: 1,
      generado: new Date().toISOString().slice(0, 10),
      canciones: canciones
    };
  }

  function exportarJs() {
    var datos = construirDatos();
    var cabecera =
      '/* ============================================================================\n' +
      '   canciones.js · generado por editor.html el ' + new Date().toLocaleString('es-ES') + '\n' +
      '   ' + datos.canciones.length + ' canciones · hasta ' + MAX_DIAPOS + ' diapositivas cada una\n' +
      '   ----------------------------------------------------------------------------\n' +
      '   Sube este archivo a GitHub sobre js/data/canciones.js. Es lo único que hay\n' +
      '   que cambiar para actualizar el repertorio de la web.\n' +
      '   ========================================================================== */\n\n';

    descargar('canciones.js',
      cabecera + 'window.CANCIONERO_DATA = ' + JSON.stringify(datos, null, 2) + ';\n',
      'text/javascript');
  }

  function exportarJson() {
    descargar('canciones.json', JSON.stringify(construirDatos(), null, 2), 'application/json');
  }

  /* ======================================================================
     Revisión antes de publicar
     ====================================================================== */

  function revisar() {
    var avisos = [];
    var vistos = {};
    var conLetra = 0;

    filas.forEach(function (f, i) {
      var titulo = f.titulo.trim();
      var llenas = f.diapositivas.filter(function (d) { return d.trim(); }).length;
      if (!titulo && !llenas) { return; }
      if (llenas) { conLetra++; }

      if (!titulo) {
        avisos.push({ nivel: 'error', texto: 'Canción ' + (i + 1) + ': tiene letra pero no tiene título, así que no se publicará.' });
      }
      if (titulo && !llenas) {
        avisos.push({ nivel: 'aviso', texto: 'Canción ' + (i + 1) + ' («' + titulo + '»): título sin ninguna diapositiva.' });
      }

      var clave = normalizar(titulo);
      if (clave) {
        if (vistos[clave]) {
          avisos.push({ nivel: 'aviso', texto: 'Canción ' + (i + 1) + ': el título repite el de la canción ' + vistos[clave] + '.' });
        } else {
          vistos[clave] = i + 1;
        }
      }

      // Huecos intermedios: se compactan al exportar, conviene saberlo.
      var ultimaLlena = -1;
      for (var j = 0; j < MAX_DIAPOS; j++) { if (f.diapositivas[j].trim()) { ultimaLlena = j; } }
      for (var k = 0; k < ultimaLlena; k++) {
        if (!f.diapositivas[k].trim()) {
          avisos.push({ nivel: 'aviso', texto: 'Canción ' + (i + 1) + ': la diapositiva ' + (k + 1) + ' está vacía entre dos con texto; al exportar se compactan.' });
          break;
        }
      }

      // Estrofas demasiado largas para leerse desde el fondo del salón.
      f.diapositivas.forEach(function (d, j) {
        var lineas = d.trim().split('\n').length;
        if (d.trim().length > 220 || lineas > 8) {
          avisos.push({ nivel: 'aviso', texto: 'Canción ' + (i + 1) + ', diapositiva ' + (j + 1) + ': ' + lineas + ' líneas. Se verá muy pequeña; considera partirla.' });
        }
      });
    });

    dom.informe.innerHTML = '';
    var resumen = document.createElement('li');
    resumen.textContent = contarCanciones() + ' canciones ocupadas · ' + conLetra + ' con letra · ' +
                          (MAX_FILAS - contarCanciones()) + ' filas libres.';
    dom.informe.appendChild(resumen);

    if (!avisos.length) {
      var ok = document.createElement('li');
      ok.textContent = 'Sin problemas. Todo listo para exportar.';
      dom.informe.appendChild(ok);
    } else {
      avisos.slice(0, 120).forEach(function (a) {
        var li = document.createElement('li');
        li.dataset.nivel = a.nivel;
        li.textContent = a.texto;
        dom.informe.appendChild(li);
      });
      if (avisos.length > 120) {
        var mas = document.createElement('li');
        mas.textContent = 'Y ' + (avisos.length - 120) + ' avisos más.';
        dom.informe.appendChild(mas);
      }
    }

    abrirDialogo(dom.dlgRevision);
  }

  /* ======================================================================
     Cajón de edición de una fila
     ====================================================================== */

  function abrirCajon(indice) {
    filaAbierta = indice;
    var f = filas[indice];

    dom.cajonTitulo.textContent = 'Canción ' + (indice + 1) + ' · fila ' + (indice + 2) + ' de la tabla';
    dom.cajonCuerpo.innerHTML = '';

    dom.cajonCuerpo.appendChild(bloqueCampo('A · Título', function () {
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'campo';
      input.style.width = '100%';
      input.value = f.titulo;
      input.addEventListener('input', function () {
        f.titulo = input.value.trim();
        refrescarFila(indice);
        marcarCambio();
      });
      return input;
    }));

    dom.cajonCuerpo.appendChild(bloqueCampo(
      letraColumna(MAX_DIAPOS + 1) + ' · TIPO' + (editarTipo ? '' : ' (bloqueado)'),
      function () {
        var select = document.createElement('select');
        select.className = 'campo';
        select.disabled = !editarTipo;
        [1, 2, 3].forEach(function (v) {
          var op = document.createElement('option');
          op.value = v;
          op.textContent = v + ' · ' + CFG.indice.tipos[v].nombre;
          if (v === f.tipo) { op.selected = true; }
          select.appendChild(op);
        });
        select.addEventListener('change', function () {
          f.tipo = parseInt(select.value, 10);
          refrescarFila(indice);
          marcarCambio();
        });
        return select;
      }));

    for (var j = 0; j < MAX_DIAPOS; j++) {
      dom.cajonCuerpo.appendChild(bloqueDiapositiva(indice, j));
    }

    dom.fondoCajon.setAttribute('data-visible', 'true');
    dom.cajon.setAttribute('data-abierto', 'true');
  }

  function bloqueCampo(etiqueta, construir) {
    var div = document.createElement('div');
    div.className = 'bloque-diapo';
    var lab = document.createElement('label');
    lab.textContent = etiqueta;
    div.appendChild(lab);
    div.appendChild(construir());
    return div;
  }

  function bloqueDiapositiva(indiceFila, j) {
    var div = document.createElement('div');
    div.className = 'bloque-diapo';

    var lab = document.createElement('label');
    lab.textContent = letraColumna(j + 1) + ' · Diapositiva ' + (j + 1);
    div.appendChild(lab);

    var area = document.createElement('textarea');
    area.value = filas[indiceFila].diapositivas[j];
    area.addEventListener('input', function () {
      filas[indiceFila].diapositivas[j] = area.value;
      refrescarFila(indiceFila);
      marcarCambio();
    });
    div.appendChild(area);
    return div;
  }

  function cerrarCajon() {
    dom.cajon.setAttribute('data-abierto', 'false');
    dom.fondoCajon.setAttribute('data-visible', 'false');
    filaAbierta = -1;
  }

  function vaciarFila() {
    if (filaAbierta < 0) { return; }
    if (!window.confirm('Se borrará el título y las 22 diapositivas de la canción ' + (filaAbierta + 1) + '. El TIPO se conserva.')) { return; }
    var tipo = filas[filaAbierta].tipo;
    filas[filaAbierta] = filaVacia();
    filas[filaAbierta].tipo = tipo;
    refrescarFila(filaAbierta);
    abrirCajon(filaAbierta);
    marcarCambio();
  }

  /* ======================================================================
     Repartir una letra pegada entre las diapositivas
     ====================================================================== */

  /** Trocea sin mirar el límite: hace falta saber cuántos bloques salen de verdad. */
  function trocear(texto, modo, lineasPorBloque) {
    var t = String(texto).replace(/\r\n/g, '\n').trim();
    if (!t) { return []; }

    var bloques;
    if (modo === 'marca') {
      bloques = t.split(/^[ \t]*-{3,}[ \t]*$/m);
    } else if (modo === 'lineas') {
      var lineas = t.split('\n');
      bloques = [];
      for (var i = 0; i < lineas.length; i += lineasPorBloque) {
        bloques.push(lineas.slice(i, i + lineasPorBloque).join('\n'));
      }
    } else {
      bloques = t.split(/\n[ \t]*\n+/);        // línea en blanco
    }

    return bloques
      .map(function (b) { return b.replace(/^\n+|\n+$/g, '').trim(); })
      .filter(function (b) { return b.length > 0; });
  }

  /** Encaja los bloques en las 22 diapositivas: unir el sobrante o descartarlo. */
  function ajustarAlLimite(bloques, unirSobrante) {
    if (bloques.length <= MAX_DIAPOS) { return bloques.slice(); }
    if (!unirSobrante) { return bloques.slice(0, MAX_DIAPOS); }
    var recortados = bloques.slice(0, MAX_DIAPOS - 1);
    recortados.push(bloques.slice(MAX_DIAPOS - 1).join('\n\n'));
    return recortados;
  }

  function leerOpcionesReparto() {
    var modo = (dom.dlgReparto.querySelector('input[name="modo"]:checked') || {}).value || 'blanco';
    return {
      modo: modo,
      lineas: Math.max(1, parseInt(dom.lineasPorBloque.value, 10) || 4),
      unir: dom.unirSobrante.checked
    };
  }

  function previsualizarReparto() {
    var op = leerOpcionesReparto();
    var brutos = trocear(dom.letraPegada.value, op.modo, op.lineas);
    var bloques = ajustarAlLimite(brutos, op.unir);
    var crudos = brutos.length;

    dom.lineasPorBloque.disabled = op.modo !== 'lineas';

    if (!bloques.length) {
      dom.previsualizacion.textContent = 'Pega la letra para ver en cuántas diapositivas se reparte.';
      dom.previsualizacion.removeAttribute('data-error');
      dom.aplicarReparto.disabled = true;
      return;
    }

    var mensaje = bloques.length + ' de ' + MAX_DIAPOS + ' diapositivas.';
    if (crudos > MAX_DIAPOS) {
      mensaje = 'La letra da para ' + crudos + ' bloques y el máximo es ' + MAX_DIAPOS + '. ' +
        (op.unir ? 'El sobrante se unirá en la última.' : 'Se descartarán los últimos ' + (crudos - MAX_DIAPOS) + '.');
      dom.previsualizacion.setAttribute('data-error', 'true');
    } else {
      dom.previsualizacion.removeAttribute('data-error');
    }

    dom.previsualizacion.textContent = mensaje;
    dom.aplicarReparto.disabled = false;
  }

  function aplicarReparto() {
    if (filaAbierta < 0) { return; }
    var op = leerOpcionesReparto();
    var bloques = ajustarAlLimite(trocear(dom.letraPegada.value, op.modo, op.lineas), op.unir);
    if (!bloques.length) { return; }

    var f = filas[filaAbierta];
    for (var j = 0; j < MAX_DIAPOS; j++) {
      f.diapositivas[j] = bloques[j] || '';
    }
    refrescarFila(filaAbierta);
    var indice = filaAbierta;
    cerrarDialogo(dom.dlgReparto);
    abrirCajon(indice);
    marcarCambio();
  }

  /* ======================================================================
     Diálogos
     ====================================================================== */

  function abrirDialogo(dlg) { dlg.setAttribute('data-abierto', 'true'); }
  function cerrarDialogo(dlg) { dlg.setAttribute('data-abierto', 'false'); }

  /* ======================================================================
     Barra de estado y navegación
     ====================================================================== */

  function actualizarEstado() {
    var ocupadas = contarCanciones();
    dom.estado.innerHTML = '<strong>' + ocupadas + '</strong> de ' + MAX_FILAS +
      ' canciones · tabla de ' + (MAX_FILAS + 1) + ' filas (1 cabecera) × ' + (MAX_DIAPOS + 2) + ' columnas';
  }

  function irAFila(numero) {
    var i = Math.min(Math.max(parseInt(numero, 10) || 1, 1), MAX_FILAS) - 1;
    dom.rejilla.scrollTop = Math.max(0, i * altoFila - 120);
    pintarVentana();
    if (filasEnDom[i]) {
      filasEnDom[i].dataset.resaltada = 'true';
      setTimeout(function () {
        if (filasEnDom[i]) { delete filasEnDom[i].dataset.resaltada; }
      }, 1600);
    }
  }

  function buscarSiguiente(texto, desde) {
    var q = normalizar(texto);
    if (!q) { return -1; }
    for (var paso = 1; paso <= MAX_FILAS; paso++) {
      var i = (desde + paso) % MAX_FILAS;
      var f = filas[i];
      if (normalizar(f.titulo).indexOf(q) !== -1) { return i; }
      for (var j = 0; j < MAX_DIAPOS; j++) {
        if (normalizar(f.diapositivas[j]).indexOf(q) !== -1) { return i; }
      }
    }
    return -1;
  }

  /* ======================================================================
     Eventos
     ====================================================================== */

  function conectarEventos() {

    /* --- Cuadrícula ----------------------------------------------------- */
    dom.rejilla.addEventListener('scroll', pintarVentana, { passive: true });
    window.addEventListener('resize', retardar(pintarVentana, 100));

    dom.cuerpo.addEventListener('input', function (ev) {
      var campo = ev.target;
      if (!campo.dataset || campo.dataset.col === undefined) { return; }
      var fila = campo.closest('.fila');
      if (!fila) { return; }
      var indice = parseInt(fila.dataset.fila, 10);
      asignarCelda(indice, parseInt(campo.dataset.col, 10), campo.value);
      fila.dataset.conContenido = String(filaTieneContenido(filas[indice]));
      marcarCambio();
    });

    dom.cuerpo.addEventListener('change', function (ev) {
      if (ev.target.tagName !== 'SELECT') { return; }
      var fila = ev.target.closest('.fila');
      var indice = parseInt(fila.dataset.fila, 10);
      asignarCelda(indice, parseInt(ev.target.dataset.col, 10), ev.target.value);
      fila.querySelector('.celda-tipo').dataset.tipo = filas[indice].tipo;
      marcarCambio();
    });

    dom.cuerpo.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-accion="abrir-cajon"]');
      if (!btn) { return; }
      abrirCajon(parseInt(btn.closest('.fila').dataset.fila, 10));
    });

    /* Pegado tipo hoja de cálculo.
       Regla: si el texto trae tabuladores, viene de Excel o Sheets y se
       reparte por celdas. Si no, es una letra y entra entera en la celda. */
    dom.cuerpo.addEventListener('paste', function (ev) {
      var campo = ev.target;
      if (!campo.dataset || campo.dataset.col === undefined) { return; }
      var texto = (ev.clipboardData || window.clipboardData).getData('text');
      if (texto.indexOf('\t') === -1) { return; }

      ev.preventDefault();
      var filaInicio = parseInt(campo.closest('.fila').dataset.fila, 10);
      var colInicio = parseInt(campo.dataset.col, 10);

      texto.replace(/\r/g, '').split('\n').forEach(function (linea, df) {
        if (!linea && df > 0) { return; }
        linea.split('\t').forEach(function (valor, dc) {
          asignarCelda(filaInicio + df, colInicio + dc, valor);
        });
      });

      repintar();
      marcarCambio();
    });

    /* Escape suelta el foco de una celda sin cerrar nada más. */
    dom.cuerpo.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { ev.target.blur(); }
    });

    /* --- Barra superior -------------------------------------------------- */
    dom.btnImportar.addEventListener('click', function () {
      dom.textoImportado.value = '';
      dom.errorImportar.textContent = '';
      abrirDialogo(dom.dlgImportar);
    });

    dom.archivo.addEventListener('change', function (ev) {
      var fichero = ev.target.files && ev.target.files[0];
      if (!fichero) { return; }
      var lector = new FileReader();
      lector.onload = function () { dom.textoImportado.value = String(lector.result); };
      lector.readAsText(fichero, 'utf-8');
      ev.target.value = '';
    });

    dom.confirmarImportar.addEventListener('click', function () {
      try {
        var canciones = interpretarArchivo(dom.textoImportado.value);
        var modo = (dom.dlgImportar.querySelector('input[name="modo-import"]:checked') || {}).value;
        var r = volcarCanciones(canciones, {
          modo: modo,
          marcarAmbas: dom.marcarAmbas.checked
        });

        cerrarDialogo(dom.dlgImportar);

        /* «1 canciones cargadas» delata que nadie leyó su propia interfaz. */
        function cuantas(n, singular, plural) {
          return n + ' ' + (n === 1 ? singular : plural);
        }

        var partes = [cuantas(r.nuevas, 'canción cargada', 'canciones cargadas')];
        if (r.fusionadas) {
          partes.push(cuantas(r.fusionadas, 'ya estaba', 'ya estaban') +
                      ' y ahora figura' + (r.fusionadas === 1 ? '' : 'n') + ' como Ambas');
        }
        if (r.descartadas) {
          partes.push(cuantas(r.descartadas, 'no cupo', 'no cupieron') +
                      ' en las ' + MAX_FILAS + ' filas');
        }
        dom.avisoBorradorTexto.textContent = partes.join(' · ') + '.';
        dom.avisoBorrador.setAttribute('data-visible', 'true');
      } catch (e) {
        dom.errorImportar.textContent = 'No se ha podido leer: ' + e.message;
      }
    });

    /* --- Extractor del cancionero web ------------------------------------ */
    dom.btnWeb.addEventListener('click', function () {
      prepararExtractor();
      abrirDialogo(dom.dlgWeb);
    });
    dom.tipoExtractor.addEventListener('change', prepararExtractor);
    dom.quitarMarcas.addEventListener('change', prepararExtractor);
    dom.copiarCodigo.addEventListener('click', copiarExtractor);

    dom.btnExportarJs.addEventListener('click', exportarJs);
    dom.btnExportarJson.addEventListener('click', exportarJson);
    dom.btnRevisar.addEventListener('click', revisar);

    dom.btnVaciarTodo.addEventListener('click', function () {
      if (!window.confirm('Se borrará todo el contenido de la tabla y el borrador guardado. ¿Continuar?')) { return; }
      almacen.borrar(CLAVE_BORRADOR);
      crearModelo();
      repintar();
      marcarCambio();
      dom.avisoBorrador.setAttribute('data-visible', 'false');
    });

    dom.editarTipo.addEventListener('change', function () {
      editarTipo = dom.editarTipo.checked;
      repintar();
      if (filaAbierta >= 0) { abrirCajon(filaAbierta); }
    });

    dom.irFila.addEventListener('change', function () { irAFila(dom.irFila.value); });

    var ultimaBusqueda = -1;
    dom.buscar.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') { return; }
      var encontrado = buscarSiguiente(dom.buscar.value, ultimaBusqueda);
      if (encontrado === -1) {
        dom.guardado.textContent = 'Sin coincidencias';
        return;
      }
      ultimaBusqueda = encontrado;
      irAFila(encontrado + 1);
      dom.guardado.textContent = 'Coincidencia en la canción ' + (encontrado + 1);
    });

    /* --- Cajón ----------------------------------------------------------- */
    dom.cerrarCajon.addEventListener('click', cerrarCajon);
    dom.fondoCajon.addEventListener('click', cerrarCajon);
    dom.btnVaciarFila.addEventListener('click', vaciarFila);

    dom.btnRepartir.addEventListener('click', function () {
      dom.letraPegada.value = '';
      previsualizarReparto();
      abrirDialogo(dom.dlgReparto);
      dom.letraPegada.focus();
    });

    /* --- Diálogo de reparto ---------------------------------------------- */
    ['input', 'change'].forEach(function (evt) {
      dom.dlgReparto.addEventListener(evt, previsualizarReparto);
    });
    dom.aplicarReparto.addEventListener('click', aplicarReparto);

    /* --- Cierre genérico de diálogos ------------------------------------- */
    document.addEventListener('click', function (ev) {
      var cerrar = ev.target.closest('[data-cerrar]');
      if (cerrar) { cerrarDialogo(document.getElementById(cerrar.dataset.cerrar)); }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') { return; }
      var abierto = document.querySelector('.dialogo[data-abierto="true"]');
      if (abierto) { cerrarDialogo(abierto); }
      else if (dom.cajon.getAttribute('data-abierto') === 'true') { cerrarCajon(); }
    });

    /* Evita cerrar la pestaña con cambios sin exportar. */
    window.addEventListener('beforeunload', function (ev) {
      if (contarCanciones() > 0) { ev.preventDefault(); ev.returnValue = ''; }
    });
  }

  /* ======================================================================
     Arranque
     ====================================================================== */

  function iniciar() {
    dom = {
      rejilla: $('#rejilla'),
      cabecera: $('#rejilla-cabecera'),
      cuerpo: $('#rejilla-cuerpo'),
      estado: $('#estado'),
      guardado: $('#guardado'),

      btnImportar: $('#btn-importar'),
      btnWeb: $('#btn-web'),
      dlgWeb: $('#dlg-web'),
      tipoExtractor: $('#tipo-extractor'),
      quitarMarcas: $('#quitar-marcas'),
      codigoListo: $('#codigo-listo'),
      copiarCodigo: $('#copiar-codigo'),
      marcarAmbas: $('#marcar-ambas'),
      btnExportarJs: $('#btn-exportar-js'),
      btnExportarJson: $('#btn-exportar-json'),
      btnRevisar: $('#btn-revisar'),
      btnVaciarTodo: $('#btn-vaciar-todo'),
      editarTipo: $('#editar-tipo'),
      irFila: $('#ir-fila'),
      buscar: $('#buscar'),

      avisoBorrador: $('#aviso-borrador'),
      avisoBorradorTexto: $('#aviso-borrador-texto'),

      cajon: $('#cajon'),
      fondoCajon: $('#fondo-cajon'),
      cajonTitulo: $('#cajon-titulo'),
      cajonCuerpo: $('#cajon-cuerpo'),
      cerrarCajon: $('#cerrar-cajon'),
      btnVaciarFila: $('#btn-vaciar-fila'),
      btnRepartir: $('#btn-repartir'),

      dlgImportar: $('#dlg-importar'),
      archivo: $('#archivo'),
      textoImportado: $('#texto-importado'),
      confirmarImportar: $('#confirmar-importar'),
      errorImportar: $('#error-importar'),

      dlgReparto: $('#dlg-reparto'),
      letraPegada: $('#letra-pegada'),
      lineasPorBloque: $('#lineas-por-bloque'),
      unirSobrante: $('#unir-sobrante'),
      previsualizacion: $('#previsualizacion'),
      aplicarReparto: $('#aplicar-reparto'),

      dlgRevision: $('#dlg-revision'),
      informe: $('#informe')
    };

    // La plantilla de columnas se arma aquí para que MAX_DIAPOS mande.
    document.documentElement.style.setProperty('--plantilla-cols',
      'var(--w-num) var(--w-titulo) repeat(' + MAX_DIAPOS + ', var(--w-diapo)) var(--w-tipo)');

    altoFila = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--alto-fila'), 10) || 46;

    crearModelo();
    construirCabecera();
    dom.cuerpo.style.height = (MAX_FILAS * altoFila) + 'px';

    restaurarBorrador();

    if (!almacen.disponible) {
      dom.guardado.textContent = 'Sin guardado automático en este navegador: exporta antes de cerrar';
    }

    pintarVentana();
    actualizarEstado();
    conectarEventos();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
