/* ============================================================================
   config.js · Ajustes del cancionero
   ----------------------------------------------------------------------------
   Este es el único archivo que hace falta tocar para cambiar el aspecto o el
   comportamiento de la app. Las letras van aparte, en js/data/canciones.js,
   que se regenera desde el editor y se sustituye sin tocar nada más.
   ========================================================================== */

window.CANCIONERO_CONFIG = {

  /* --- Identidad ------------------------------------------------------- */
  app: {
    /* Límites del formato. Los leen la app y el editor. */
    maxDiapositivas: 22,
    maxCanciones: 349
  },

  /* --- Origen de las letras --------------------------------------------- */
  datos: {
    /**
     * De dónde salen las canciones:
     *   'js'   → siempre de js/data/canciones.js (lo carga <script> en index.html)
     *   'json' → siempre de js/data/canciones.json, con vuelta al .js si falla
     *   'auto' → el .js si index.html lo incluye; si no, el .json  ← por defecto
     *
     * El .js funciona también con doble clic (protocolo file://), donde fetch
     * está bloqueado. Para trabajar solo con JSON: quita la línea del <script>
     * en index.html, o pon 'json' aquí y publica el archivo.
     */
    origen: 'auto',
    rutaJson: 'js/data/canciones.json'
  },

  /* --- Fondos ----------------------------------------------------------- */
  fondos: {
    /**
     * Estrategia de elección al abrir cada canción:
     *   'css'    → solo los 35 fondos animados en CSS (recomendado: 0 descargas)
     *   'imagen' → solo imágenes de media/imagenes/
     *   'video'  → solo vídeos de media/videos/
     *   'mixto'  → sortea entre los tres según `pesos`
     */
    estrategia: 'css',

    /* Probabilidad relativa de cada familia cuando estrategia = 'mixto'. */
    pesos: { css: 60, imagen: 30, video: 10 },

    /* Cuántas clases .fondo--NN hay en css/backgrounds.css. */
    totalCss: 35,

    /**
     * Evita repetir fondo en las N canciones siguientes. Con 35 fondos, un
     * valor de 10 hace que un culto de 6 canciones nunca repita ambiente.
     */
    memoriaSinRepetir: 10,

    /* Rutas de los fondos de imagen (mínimo 35, se generan más abajo). */
    imagenes: [],

    /* Rutas de los fondos de vídeo (mínimo 35, se generan más abajo). */
    videos: [],

    /**
     * Milisegundos de espera antes de dar por fallida una imagen o un vídeo.
     * Debajo siempre hay un fondo CSS ya pintado, así que agotar la espera no
     * deja la pantalla negra: simplemente se queda el fondo animado.
     */
    tiempoEsperaMedio: 2500
  },

  /* --- Comportamiento del visor ----------------------------------------- */
  visor: {
    /* Pide pantalla completa al abrir una canción. */
    pantallaCompletaAuto: true,

    /* Intenta bloquear la orientación horizontal (solo Android/Chrome). */
    bloquearHorizontal: true,

    /**
     * Diapositivas en bucle: de la última se vuelve a la primera con la flecha
     * de siguiente, y de la primera se salta a la última con la de anterior.
     * Con `false`, las flechas se apagan en los extremos.
     */
    bucle: true,

    /* Oculta flechas y barra tras este tiempo sin actividad (0 = nunca). */
    ocultarControlesTrasMs: 3500,

    /**
     * Al empezar a proyectar, las flechas parpadean este tiempo para enseñar
     * dónde se pulsa; solo cuando terminan empieza a contar la ocultación
     * automática. 0 lo desactiva.
     *
     * Cada latido dura 800 ms (está en @keyframes guiaFlecha, en css/app.css),
     * así que 2400 ms son tres latidos exactos. Si cambias uno, cambia el otro.
     */
    parpadeoInicialMs: 2400,

    /* Permite pasar diapositiva deslizando el dedo. */
    gestosTactiles: true,

    /* Tamaño de letra de proyección, en píxeles, para el autoajuste. */
    tipografia: { min: 20, max: 160 }
  },

  /* --- Índice ------------------------------------------------------------ */
  indice: {
    /* Filtro activo al cargar: 0 = todas, 1 = dominical, 2 = santa cena. */
    filtroInicial: 0,

    /**
     * Ordena la lista por título con criterio español (la ñ en su sitio y
     * "Salmo 2" antes que "Salmo 10") y la agrupa por letra inicial.
     * En false se respeta el orden del archivo de datos.
     *
     * El número que se ve a la izquierda de cada título es siempre el del
     * archivo de datos, ordene como ordene la lista: es el que usan los
     * enlaces y el editor, y por eso no es correlativo.
     */
    ordenAlfabetico: true,

    /**
     * El buscador mira el título desde la primera letra, pero dentro de las
     * letras solo a partir de este número de caracteres: con menos, media
     * lista coincidiría y el resultado no diría nada.
     */
    minCaracteresLetra: 3,

    /* Etiquetas de la columna TIPO del editor. */
    tipos: {
      1: { nombre: 'Dominical',  abrev: 'Dominical' },
      2: { nombre: 'Santa Cena', abrev: 'Santa Cena' },
      3: { nombre: 'Ambas',      abrev: 'Ambas' }
    }
  }
};

/* ----------------------------------------------------------------------------
   Rutas de medios
   ----------------------------------------------------------------------------
   Se generan 35 nombres correlativos para no escribirlos a mano. Coloca los
   archivos con estos nombres exactos y funcionarán sin tocar código:

       media/imagenes/fondo-01.jpg … fondo-35.jpg
       media/videos/fondo-01.mp4   … fondo-35.mp4

   Si prefieres otros nombres o formatos, sustituye estos bucles por tu propia
   lista de rutas.
-------------------------------------------------------------------------- */
(function generarRutasDeMedios(config) {
  'use strict';
  var TOTAL = 35;
  for (var i = 1; i <= TOTAL; i++) {
    var n = String(i).padStart(2, '0');
    config.fondos.imagenes.push('media/imagenes/fondo-' + n + '.jpg');
    config.fondos.videos.push('media/videos/fondo-' + n + '.mp4');
  }
})(window.CANCIONERO_CONFIG);
