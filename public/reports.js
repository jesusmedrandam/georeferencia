'use strict';

// GeoAlerta - reportes ciudadanos. No se publica ningún reporte pendiente en el mapa común.
let mapaReportes = null;
let marcadorNuevo = null;
let capaPropios = null;
let capaConfirmadas = null;
let paginaReportes = 1;
let fotosTemporales = [];
let secuenciaReportes = 0;
let mapaIniciado = false;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('formReporte').addEventListener('submit', enviarReporteCiudadano);
  document.getElementById('reporteFotos').addEventListener('change', mostrarArchivosSeleccionados);
  document.getElementById('botonMiUbicacion').addEventListener('click', usarMiUbicacion);
  document.getElementById('botonLimpiarUbicacion').addEventListener('click', quitarUbicacion);
  document.getElementById('botonActualizarReportes').addEventListener('click',
    () => refrescarReportes().catch(mostrarErrorReportes));
  document.getElementById('reporteAnterior').addEventListener('click', () => cambiarPagina(-1));
  document.getElementById('reporteSiguiente').addEventListener('click', () => cambiarPagina(1));
  for (const id of ['reporteLatitud', 'reporteLongitud']) {
    document.getElementById(id).addEventListener('change', actualizarMarcadorDesdeCoordenadas);
  }
});

async function apiReportes(ruta, opciones = {}) {
  const res = await fetch(API_URL + ruta, {
    ...opciones,
    headers: {
      ...(opciones.headers || {}),
      Authorization: 'Bearer ' + localStorage.getItem('token')
    }
  });
  if (!res.ok) {
    let mensaje = 'No se pudo completar la operación.';
    try { mensaje = (await res.json()).mensaje || mensaje; } catch (_error) {}
    throw new Error(mensaje);
  }
  return res;
}

function mensajeReporte(mensaje, error = false) {
  const nodo = document.getElementById('reporteMensaje');
  nodo.textContent = mensaje;
  nodo.dataset.error = String(error);
}

function mostrarErrorReportes(error) {
  document.getElementById('mapaEstado').textContent = error.message || 'Error de conexión.';
}

function iniciarMapaReportes() {
  if (mapaIniciado) {
    if (mapaReportes) mapaReportes.invalidateSize();
    return;
  }
  mapaIniciado = true;
  if (typeof L === 'undefined') {
    document.getElementById('mapaEstado').textContent =
      'No se pudo cargar el mapa. Puedes escribir la latitud y longitud manualmente.';
    return;
  }
  // Vista inicial de Ecuador. No marca ni presupone la posición del usuario.
  mapaReportes = L.map('reporteMapa', { scrollWheelZoom: false })
    .setView([-1.83, -78.18], 6);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(mapaReportes);
  capaPropios = L.layerGroup().addTo(mapaReportes);
  capaConfirmadas = L.layerGroup().addTo(mapaReportes);
  mapaReportes.on('click', evento => establecerUbicacion(evento.latlng.lat, evento.latlng.lng, true));
  document.getElementById('mapaEstado').textContent =
    'Selecciona un punto en el mapa. Los reportes pendientes solo los ves tú.';
  setTimeout(() => mapaReportes?.invalidateSize(), 100);
}

function activarMapaReportes() {
  iniciarMapaReportes();
  if (!mapaReportes) return;
  setTimeout(() => {
    mapaReportes?.invalidateSize();
    refrescarReportes().catch(mostrarErrorReportes);
  }, 100);
}

function establecerUbicacion(lat, lng, centrar = false) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng < -180 || lng > 180) return;
  const nuevaLat = Math.round(lat * 1e6) / 1e6;
  const nuevaLng = Math.round(lng * 1e6) / 1e6;
  document.getElementById('reporteLatitud').value = String(nuevaLat);
  document.getElementById('reporteLongitud').value = String(nuevaLng);
  if (mapaReportes) {
    if (!marcadorNuevo) marcadorNuevo = L.marker([nuevaLat, nuevaLng], { draggable: true })
      .addTo(mapaReportes).bindPopup('Ubicación elegida para el nuevo reporte');
    else marcadorNuevo.setLatLng([nuevaLat, nuevaLng]);
    marcadorNuevo.off('dragend');
    marcadorNuevo.on('dragend', () => {
      const pos = marcadorNuevo.getLatLng();
      establecerUbicacion(pos.lat, pos.lng);
    });
    if (centrar) mapaReportes.setView([nuevaLat, nuevaLng], Math.max(mapaReportes.getZoom(), 14));
  }
}

function actualizarMarcadorDesdeCoordenadas() {
  const latCampo = document.getElementById('reporteLatitud');
  const lngCampo = document.getElementById('reporteLongitud');
  if (!latCampo.value.trim() || !lngCampo.value.trim()) return;
  const lat = Number(latCampo.value), lng = Number(lngCampo.value);
  establecerUbicacion(lat, lng, true);
}

function quitarUbicacion() {
  document.getElementById('reporteLatitud').value = '';
  document.getElementById('reporteLongitud').value = '';
  if (mapaReportes && marcadorNuevo) {
    mapaReportes.removeLayer(marcadorNuevo);
    marcadorNuevo = null;
  }
}

function usarMiUbicacion() {
  if (!navigator.geolocation) {
    mensajeReporte('Tu navegador no permite obtener la ubicación. Selecciónala en el mapa.', true);
    return;
  }
  const boton = document.getElementById('botonMiUbicacion');
  boton.disabled = true;
  navigator.geolocation.getCurrentPosition(posicion => {
    establecerUbicacion(posicion.coords.latitude, posicion.coords.longitude, true);
    boton.disabled = false;
    mensajeReporte('Ubicación obtenida. Puedes mover el marcador a la ubicación del incidente.');
  }, _error => {
    boton.disabled = false;
    mensajeReporte('No se obtuvo tu ubicación. Puedes tocar el mapa o escribir coordenadas.', true);
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

async function cargarTiposReporte() {
  const res = await apiReportes('/api/tipos-emergencia');
  const { tipos } = await res.json();
  const selector = document.getElementById('reporteTipo');
  const previo = selector.value;
  selector.replaceChildren();
  const encabezado = document.createElement('option');
  encabezado.value = '';
  encabezado.textContent = 'Selecciona una categoría';
  selector.appendChild(encabezado);
  for (const tipo of tipos) {
    const option = document.createElement('option');
    option.value = tipo.id;
    option.textContent = tipo.nombre;
    selector.appendChild(option);
  }
  if (tipos.some(tipo => String(tipo.id) === previo)) selector.value = previo;
}

async function cargarReportes() {
  if (!usuarioActual) return;
  const generacion = ++secuenciaReportes;
  try {
    await cargarTiposReporte();
    if (generacion !== secuenciaReportes) return;
    await refrescarReportes(generacion);
  } catch (error) {
    if (generacion === secuenciaReportes) {
      mensajeReporte('No se pudieron cargar los reportes: ' + error.message, true);
    }
  }
}

async function refrescarReportes(generacion = secuenciaReportes) {
  const pagina = paginaReportes;
  const [mis, publicas] = await Promise.all([
    apiReportes('/api/reportes/mios?pagina=' + pagina).then(res => res.json()),
    apiReportes('/api/mapa/emergencias').then(res => res.json())
  ]);
  if (generacion !== secuenciaReportes || pagina !== paginaReportes) return;
  mostrarListadoReportes(mis.reportes);
  document.getElementById('reportePagina').textContent = 'Página ' + pagina;
  document.getElementById('reporteAnterior').disabled = pagina === 1;
  document.getElementById('reporteSiguiente').disabled = !mis.hay_mas;
  actualizarCapasMapa(mis.reportes, publicas.emergencias);
}

async function cambiarPagina(diferencia) {
  paginaReportes = Math.max(1, paginaReportes + diferencia);
  try { await refrescarReportes(); }
  catch (error) { mostrarErrorReportes(error); }
}

function actualizarCapasMapa(misReportes, emergencias) {
  if (!mapaReportes) return;
  capaPropios.clearLayers();
  capaConfirmadas.clearLayers();
  for (const reporte of misReportes) {
    const lat = Number(reporte.latitud), lng = Number(reporte.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const marcador = L.circleMarker([lat, lng], {
      radius: 8, color: '#9bc9ff', weight: 2, fillColor: '#2476db', fillOpacity: 0.9
    }).addTo(capaPropios);
    const contenido = document.createElement('div');
    contenido.textContent = 'Tu reporte #' + reporte.id + ' · ' + reporte.tipo + ' · ' + reporte.estado;
    marcador.bindPopup(contenido);
  }
  for (const emergencia of emergencias) {
    const lat = Number(emergencia.latitud), lng = Number(emergencia.longitud);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const marcador = L.circleMarker([lat, lng], {
      radius: 9, color: '#ffc3c3', weight: 2, fillColor: '#c92331', fillOpacity: 0.9
    }).addTo(capaConfirmadas);
    const contenido = document.createElement('div');
    contenido.textContent = 'Emergencia confirmada · ' + emergencia.tipo +
      ' · Prioridad: ' + emergencia.prioridad;
    marcador.bindPopup(contenido);
  }
  document.getElementById('mapaEstado').textContent =
    emergencias.length + ' emergencias verificadas en el mapa. ' +
    misReportes.length + ' reportes tuyos en esta página.';
}

function texto(tag, contenido, clase) {
  const nodo = document.createElement(tag);
  nodo.textContent = contenido;
  if (clase) nodo.className = clase;
  return nodo;
}

function liberarFotos() {
  for (const url of fotosTemporales) URL.revokeObjectURL(url);
  fotosTemporales = [];
}

function resolverEstadoVisibleReporte(reporte) {
  const instituciones = Array.isArray(reporte.instituciones) ? reporte.instituciones : [];
  const estadosInstitucionales = instituciones.map(item => item.estado).filter(Boolean);
  const estadoEmergencia = reporte.estado_emergencia;

  if (reporte.estado === 'rechazado') {
    return {
      codigo: 'rechazado',
      etiqueta: 'Rechazado',
      detalle: 'El reporte fue rechazado. Puedes consultar el historial para conocer la observación registrada.'
    };
  }
  if (reporte.estado === 'informacion_solicitada' ||
      estadosInstitucionales.includes('informacion_solicitada')) {
    return {
      codigo: 'informacion_solicitada',
      etiqueta: 'Información solicitada',
      detalle: 'La institución necesita información adicional para continuar con la revisión.'
    };
  }

  const estadosEmergencia = {
    validada: {
      codigo: 'validado',
      etiqueta: 'Validado · pendiente de atención',
      detalle: 'La institución confirmó el reporte y asignó una prioridad. La atención todavía no figura como iniciada.'
    },
    en_atencion: {
      codigo: 'en_atencion',
      etiqueta: 'En seguimiento',
      detalle: 'La institución ya inició la atención y está dando seguimiento a la emergencia.'
    },
    controlada: {
      codigo: 'controlada',
      etiqueta: 'Emergencia controlada',
      detalle: 'La institución informó que la emergencia está controlada. El caso aún puede requerir cierre.'
    },
    cerrada: {
      codigo: 'cerrada',
      etiqueta: 'Atendida y cerrada',
      detalle: 'La institución registró la atención y cerró el caso.'
    }
  };
  if (estadoEmergencia && estadosEmergencia[estadoEmergencia]) {
    return estadosEmergencia[estadoEmergencia];
  }

  if (estadosInstitucionales.includes('en_atencion')) {
    return {
      codigo: 'en_atencion',
      etiqueta: 'En seguimiento',
      detalle: 'Al menos una institución ya inició la atención del reporte.'
    };
  }
  if (estadosInstitucionales.includes('controlada')) {
    return {
      codigo: 'controlada',
      etiqueta: 'Emergencia controlada',
      detalle: 'Una institución informó que la emergencia está controlada.'
    };
  }
  if (estadosInstitucionales.length &&
      estadosInstitucionales.every(estado => estado === 'cerrada')) {
    return {
      codigo: 'cerrada',
      etiqueta: 'Atendida y cerrada',
      detalle: 'Todas las instituciones asignadas registraron el cierre del caso.'
    };
  }
  if (estadosInstitucionales.includes('validado') || reporte.estado === 'validado') {
    return {
      codigo: 'validado',
      etiqueta: 'Validado · pendiente de atención',
      detalle: 'El reporte fue confirmado. La atención todavía no figura como iniciada.'
    };
  }
  if (estadosInstitucionales.includes('en_revision')) {
    return {
      codigo: 'en_revision',
      etiqueta: 'En revisión',
      detalle: 'La institución recibió el reporte y está verificando la información.'
    };
  }
  if (estadosInstitucionales.includes('recibido')) {
    return {
      codigo: 'recibido',
      etiqueta: 'Recibido por institución',
      detalle: 'El reporte fue enviado a la institución responsable y está pendiente de revisión.'
    };
  }
  if (estadosInstitucionales.includes('derivado')) {
    return {
      codigo: 'derivado',
      etiqueta: 'Derivado',
      detalle: 'El reporte figura como derivado. Consulta el historial para ver las actuaciones registradas.'
    };
  }
  if (instituciones.length) {
    return {
      codigo: 'pendiente',
      etiqueta: 'Pendiente de revisión',
      detalle: 'El reporte está asignado y espera una actualización de la institución.'
    };
  }
  return {
    codigo: 'pendiente_asignacion',
    etiqueta: 'Pendiente de asignación',
    detalle: 'Tu reporte fue registrado y todavía no se ha asignado a una institución responsable.'
  };
}

function etiquetaEstadoInstitucion(estado) {
  const etiquetas = {
    recibido: 'Recibido',
    en_revision: 'En revisión',
    validado: 'Validado',
    en_atencion: 'En atención',
    controlada: 'Emergencia controlada',
    cerrada: 'Atendida y cerrada',
    informacion_solicitada: 'Información solicitada',
    rechazado: 'Rechazado',
    derivado: 'Derivado'
  };
  return etiquetas[estado] || estado || 'Sin actualización';
}

function mostrarListadoReportes(reportes) {
  liberarFotos();
  const lista = document.getElementById('listaReportes');
  lista.replaceChildren();
  if (!reportes.length) {
    lista.appendChild(texto('p', 'Todavía no has registrado reportes.', 'reporte-meta'));
    return;
  }

  for (const reporte of reportes) {
    const item = document.createElement('article');
    item.className = 'reporte-item';
    const head = texto('div', '', 'reporte-item-head');
    const titulo = texto('strong', '#' + reporte.id + ' · ' + reporte.tipo);
    const resumenEstado = resolverEstadoVisibleReporte(reporte);
    const estado = texto('span', resumenEstado.etiqueta, 'reporte-estado');
    estado.dataset.estado = resumenEstado.codigo;
    head.append(titulo, estado);
    item.append(head, texto('p', reporte.descripcion));
    item.append(texto('p', resumenEstado.detalle, 'reporte-meta'));

    if (reporte.prioridad) {
      const prioridad = reporte.prioridad.charAt(0).toUpperCase() + reporte.prioridad.slice(1);
      item.append(texto('p', 'Prioridad asignada: ' + prioridad, 'reporte-prioridad'));
    }

    const fecha = new Date(reporte.creado_en);
    item.append(texto('p', 'Registrado: ' + (Number.isNaN(fecha.valueOf())
      ? 'Sin fecha' : fecha.toLocaleString('es-EC')), 'reporte-meta'));
    if (reporte.referencia_ubicacion) {
      item.append(texto('p', 'Referencia: ' + reporte.referencia_ubicacion, 'reporte-meta'));
    }

    const instituciones = Array.isArray(reporte.instituciones) ? reporte.instituciones : [];
    if (instituciones.length) {
      const bloqueInstituciones = texto('div', '', 'reporte-instituciones');
      bloqueInstituciones.appendChild(
        texto('p', 'Instituciones responsables', 'reporte-meta reporte-instituciones-titulo')
      );
      for (const institucion of instituciones) {
        const fila = texto('div', '', 'reporte-institucion-fila');
        fila.appendChild(texto('span', institucion.institucion || 'Institución'));
        const estadoInstitucion = texto(
          'span',
          etiquetaEstadoInstitucion(institucion.estado),
          'reporte-institucion-estado'
        );
        estadoInstitucion.dataset.estado = institucion.estado || 'pendiente';
        fila.appendChild(estadoInstitucion);
        bloqueInstituciones.appendChild(fila);
      }
      item.appendChild(bloqueInstituciones);
    } else if (resumenEstado.codigo === 'pendiente_asignacion') {
      item.appendChild(texto(
        'p',
        'Aún no hay una institución responsable asignada.',
        'reporte-meta'
      ));
    }

    const acciones = texto('div', '', 'reporte-map-actions');
    const ubicar = texto('button', 'Ubicar en mapa');
    ubicar.type = 'button';
    ubicar.addEventListener('click', () => {
      if (!mapaReportes && typeof cambiarVistaDashboard === 'function') {
        cambiarVistaDashboard('reportar');
      }
      if (!mapaReportes) return mensajeReporte('El mapa no está disponible.', true);
      mapaReportes.setView([Number(reporte.latitud), Number(reporte.longitud)], 15);
      mapaReportes.invalidateSize();
    });
    acciones.append(ubicar);
    if (reporte.fotografias?.length) {
      const verFotos = texto('button', 'Ver ' + reporte.fotografias.length + ' fotografía(s)');
      verFotos.type = 'button';
      const contenedor = texto('div', '', 'reporte-fotos');
      verFotos.addEventListener('click', async () => {
        if (contenedor.children.length) {
          contenedor.replaceChildren();
          return;
        }
        verFotos.disabled = true;
        try {
          for (const foto of reporte.fotografias) {
            const res = await apiReportes('/api/reportes/' + reporte.id + '/fotos/' + foto.id);
            const url = URL.createObjectURL(await res.blob());
            fotosTemporales.push(url);
            const imagen = document.createElement('img');
            imagen.src = url;
            imagen.alt = 'Fotografía adjunta al reporte ' + reporte.id;
            imagen.loading = 'lazy';
            contenedor.appendChild(imagen);
          }
        } catch (error) { mensajeReporte('No se pudieron cargar las fotografías: ' + error.message, true); }
        finally { verFotos.disabled = false; }
      });
      acciones.append(verFotos);
      item.append(acciones, contenedor);
    } else {
      item.append(acciones);
    }
    lista.appendChild(item);
  }
}

function mostrarArchivosSeleccionados() {
  const entrada = document.getElementById('reporteFotos');
  const contenedor = document.getElementById('reporteArchivosPreview');
  const titulo = document.querySelector('.reporte-upload-target strong');
  const archivos = Array.from(entrada.files || []);
  contenedor.replaceChildren();

  if (archivos.length > 3 || archivos.some(archivo => archivo.size > 3 * 1024 * 1024)) {
    entrada.value = '';
    if (titulo) titulo.textContent = 'Seleccionar fotografías';
    mensajeReporte('Selecciona hasta 3 fotografías, con un tamaño máximo de 3 MB por archivo.', true);
    return;
  }

  if (titulo) titulo.textContent = archivos.length
    ? archivos.length === 1 ? '1 fotografía seleccionada' : archivos.length + ' fotografías seleccionadas'
    : 'Seleccionar fotografías';

  for (const archivo of archivos) {
    const chip = document.createElement('span');
    chip.className = 'reporte-archivo-chip';
    const icono = document.createElement('i');
    icono.className = 'fa-regular fa-image';
    icono.setAttribute('aria-hidden', 'true');
    const nombre = document.createElement('span');
    nombre.textContent = archivo.name + ' (' + (archivo.size / (1024 * 1024)).toFixed(2) + ' MB)';
    chip.append(icono, nombre);
    contenedor.appendChild(chip);
  }
}

async function enviarReporteCiudadano(evento) {
  evento.preventDefault();
  const formulario = document.getElementById('formReporte');
  const archivoInput = document.getElementById('reporteFotos');
  const archivos = [...archivoInput.files];
  if (archivos.length > 3 || archivos.some(file => file.size > 3 * 1024 * 1024)) {
    mensajeReporte('Selecciona hasta 3 fotografías de máximo 3 MB cada una.', true);
    return;
  }
  const contenido = new FormData(formulario);
  const boton = document.getElementById('enviarReporte');
  boton.disabled = true;
  mensajeReporte('Guardando reporte...');
  try {
    const res = await apiReportes('/api/reportes', { method: 'POST', body: contenido });
    const { mensaje } = await res.json();
    formulario.reset();
    mostrarArchivosSeleccionados();
    quitarUbicacion();
    paginaReportes = 1;
    await refrescarReportes();
    mensajeReporte(mensaje);
  } catch (error) {
    mensajeReporte(error.message, true);
  } finally {
    boton.disabled = false;
  }
}

function limpiarModuloReportes() {
  secuenciaReportes++;
  paginaReportes = 1;
  liberarFotos();
  document.getElementById('listaReportes').replaceChildren();
  document.getElementById('formReporte').reset();
  mostrarArchivosSeleccionados();
  quitarUbicacion();
  if (capaPropios) capaPropios.clearLayers();
  if (capaConfirmadas) capaConfirmadas.clearLayers();
  mensajeReporte('');
}
