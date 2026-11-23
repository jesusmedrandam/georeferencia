'use strict';

// Módulos de recepción, despacho y seguimiento de reportes.
let configuracionDespacho = null;
let cargaBandejaEnCurso = false;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refreshCitizenTracking')?.addEventListener('click', cargarSeguimientoCiudadano);
  document.getElementById('refreshAuthorityInbox')?.addEventListener('click', cargarBandejaInstitucional);
  document.getElementById('operatingInstitutionSelect')?.addEventListener('change', cargarBandejaInstitucional);
  document.getElementById('authorityStatusFilter')?.addEventListener('change', cargarBandejaInstitucional);
  document.getElementById('refreshDispatch')?.addEventListener('click', cargarPanelDespacho);
  document.getElementById('distributionTypeSelect')?.addEventListener('change', renderizarChecksDistribucion);
  document.getElementById('saveDistribution')?.addEventListener('click', guardarDistribucion);
});

async function apiOperaciones(ruta, opciones = {}) {
  const respuesta = await fetch(API_URL + ruta, {
    ...opciones,
    headers: {
      ...(opciones.headers || {}),
      ...(opciones.body && !(opciones.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      Authorization: 'Bearer ' + localStorage.getItem('token')
    }
  });
  if (!respuesta.ok) {
    let mensaje = 'No se pudo completar la operación.';
    try { mensaje = (await respuesta.json()).mensaje || mensaje; } catch (_error) {}
    throw new Error(mensaje);
  }
  return respuesta;
}

function prepararModulosOperativos() {
  const esSuper = usuarioActual?.rol_global === 'superadministrador';
  const vinculaciones = Array.isArray(institucionesActuales) ? institucionesActuales : [];
  const puedeOperar = !esSuper && vinculaciones.length > 0;
  document.getElementById('navAuthorityInbox').classList.toggle('hidden', !puedeOperar);
  document.getElementById('homeAuthorityCard').classList.toggle('hidden', !puedeOperar);
  document.getElementById('navDispatch').classList.toggle('hidden', !esSuper);
  document.getElementById('homeDispatchCard').classList.toggle('hidden', !esSuper);

  const selector = document.getElementById('operatingInstitutionSelect');
  selector.replaceChildren();
  for (const institucion of vinculaciones) {
    if (institucion.activo === false) continue;
    const option = document.createElement('option');
    option.value = String(institucion.institucion_id);
    option.textContent = institucion.institucion;
    selector.appendChild(option);
  }
}

function estadoLegible(estado) {
  const etiquetas = {
    pendiente: 'Pendiente de revisión',
    recibido: 'Recibido por la institución',
    en_revision: 'En revisión',
    validado: 'Validado',
    validada: 'Validado',
    informacion_solicitada: 'Información solicitada',
    en_atencion: 'En atención',
    controlada: 'Emergencia controlada',
    cerrada: 'Caso cerrado',
    rechazado: 'Rechazado',
    derivado: 'Derivado'
  };
  return etiquetas[estado] || estado || 'Sin estado';
}

function nodoTexto(tag, texto, clase) {
  const nodo = document.createElement(tag);
  nodo.textContent = texto || '';
  if (clase) nodo.className = clase;
  return nodo;
}

function crearBoton(texto, clase, accion) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.textContent = texto;
  boton.className = clase || 'operations-button';
  boton.addEventListener('click', accion);
  return boton;
}

async function cargarSeguimientoCiudadano() {
  const contenedor = document.getElementById('listaSeguimientoCiudadano');
  contenedor.replaceChildren(nodoTexto('p', 'Cargando tus reportes...', 'operations-empty'));
  try {
    const { reportes } = await (await apiOperaciones('/api/reportes/mios?pagina=1')).json();
    contenedor.replaceChildren();
    if (!reportes.length) {
      contenedor.appendChild(nodoTexto('p', 'Todavía no has registrado reportes.', 'operations-empty'));
      return;
    }
    for (const reporte of reportes) {
      const tarjeta = nodoTexto('article', '', 'operations-card');
      const encabezado = nodoTexto('div', '', 'operations-card-head');
      encabezado.append(
        nodoTexto('strong', '#' + reporte.id + ' · ' + reporte.tipo),
        nodoTexto('span', estadoLegible(reporte.estado_emergencia || reporte.estado), 'operations-status')
      );
      tarjeta.append(encabezado);
      tarjeta.appendChild(nodoTexto('p', reporte.descripcion, 'operations-description'));
      const fecha = new Date(reporte.creado_en);
      tarjeta.appendChild(nodoTexto('p',
        'Registrado: ' + (Number.isNaN(fecha.valueOf()) ? 'Fecha no disponible' : fecha.toLocaleString('es-EC')),
        'operations-meta'));

      const destinos = Array.isArray(reporte.instituciones) ? reporte.instituciones : [];
      tarjeta.appendChild(nodoTexto('p', destinos.length
        ? 'Institución(es): ' + destinos.map(item => item.institucion + ' (' + estadoLegible(item.estado) + ')').join(' · ')
        : 'Todavía no tiene una institución asignada. Está pendiente de distribución.',
      'operations-meta'));

      const historial = nodoTexto('div', '', 'operations-timeline hidden');
      const boton = crearBoton('Ver historial de seguimiento', 'operations-button', async () => {
        if (!historial.classList.contains('hidden')) {
          historial.classList.add('hidden');
          return;
        }
        historial.classList.remove('hidden');
        if (historial.dataset.loaded === 'true') return;
        historial.textContent = 'Cargando historial...';
        try {
          const datos = await (await apiOperaciones('/api/reportes/' + reporte.id + '/seguimiento')).json();
          historial.replaceChildren();
          historial.appendChild(nodoTexto('h4', 'Instituciones responsables'));
          if (!datos.instituciones.length) {
            historial.appendChild(nodoTexto('p', 'Sin asignación institucional todavía.', 'operations-meta'));
          } else {
            for (const item of datos.instituciones) {
              historial.appendChild(nodoTexto('p', item.institucion + ' · ' + estadoLegible(item.estado), 'operations-meta'));
            }
          }
          historial.appendChild(nodoTexto('h4', 'Actuaciones'));
          if (!datos.seguimiento.length) {
            historial.appendChild(nodoTexto('p', 'No hay actuaciones registradas.', 'operations-meta'));
          }
          for (const evento of datos.seguimiento) {
            const linea = nodoTexto('div', '', 'operations-timeline-item');
            const fechaEvento = new Date(evento.creado_en);
            linea.append(
              nodoTexto('strong', evento.accion.replaceAll('_', ' ')),
              nodoTexto('span', (Number.isNaN(fechaEvento.valueOf()) ? '' : fechaEvento.toLocaleString('es-EC')) + ' · ' + evento.actor, 'operations-meta')
            );
            const detalle = evento.detalle || {};
            const descripcion = detalle.nota || detalle.institucion || detalle.estado;
            if (descripcion) linea.appendChild(nodoTexto('p', descripcion, 'operations-meta'));
            historial.appendChild(linea);
          }
          historial.dataset.loaded = 'true';
        } catch (error) {
          historial.textContent = error.message;
        }
      });
      tarjeta.append(boton, historial);
      contenedor.appendChild(tarjeta);
    }
  } catch (error) {
    contenedor.replaceChildren(nodoTexto('p', error.message, 'operations-error'));
  }
}

async function cargarBandejaInstitucional() {
  if (cargaBandejaEnCurso) return;
  const institucionId = document.getElementById('operatingInstitutionSelect').value;
  const estado = document.getElementById('authorityStatusFilter').value;
  const contenedor = document.getElementById('listaBandejaInstitucional');
  if (!institucionId) {
    contenedor.replaceChildren(nodoTexto('p', 'No tienes una institución activa vinculada a tu cuenta.', 'operations-empty'));
    return;
  }
  cargaBandejaEnCurso = true;
  contenedor.replaceChildren(nodoTexto('p', 'Consultando reportes asignados...', 'operations-empty'));
  try {
    const query = estado ? '?estado=' + encodeURIComponent(estado) : '';
    const datos = await (await apiOperaciones('/api/instituciones/' + institucionId + '/reportes' + query)).json();
    contenedor.replaceChildren();
    if (!datos.reportes.length) {
      contenedor.appendChild(nodoTexto('p', 'No hay reportes para este filtro. Pulsa Actualizar para consultar nuevamente.', 'operations-empty'));
      return;
    }
    for (const reporte of datos.reportes) contenedor.appendChild(crearTarjetaInstitucional(reporte, institucionId));
  } catch (error) {
    contenedor.replaceChildren(nodoTexto('p', error.message, 'operations-error'));
  } finally {
    cargaBandejaEnCurso = false;
  }
}

function crearTarjetaInstitucional(reporte, institucionId) {
  const tarjeta = nodoTexto('article', '', 'operations-card');
  const encabezado = nodoTexto('div', '', 'operations-card-head');
  encabezado.append(
    nodoTexto('strong', '#' + reporte.id + ' · ' + reporte.tipo),
    nodoTexto('span', estadoLegible(reporte.estado_emergencia || reporte.estado_asignacion), 'operations-status')
  );
  tarjeta.append(encabezado);
  tarjeta.appendChild(nodoTexto('p', reporte.descripcion, 'operations-description'));
  tarjeta.appendChild(nodoTexto('p',
    'Reportado por: ' + [reporte.ciudadano_nombre, reporte.ciudadano_apellido].filter(Boolean).join(' ') +
    (reporte.ciudadano_telefono ? ' · Teléfono: ' + reporte.ciudadano_telefono : '') +
    (reporte.ciudadano_email ? ' · Correo: ' + reporte.ciudadano_email : ''),
    'operations-meta'));
  tarjeta.appendChild(nodoTexto('p',
    'Personas afectadas: ' + reporte.personas_afectadas +
    ' · Ubicación: ' + reporte.latitud + ', ' + reporte.longitud +
    (reporte.referencia_ubicacion ? ' · ' + reporte.referencia_ubicacion : ''),
    'operations-meta'));

  const acciones = nodoTexto('div', '', 'operations-actions');
  const estado = reporte.estado_asignacion;
  const tieneValidacion = Boolean(reporte.estado_emergencia);
  if (estado === 'recibido') {
    acciones.appendChild(crearBoton('Iniciar revisión', 'operations-button', () =>
      cambiarEstadoInstitucional(institucionId, reporte.id, 'en_revision')));
  }
  if (estado === 'en_revision' && !tieneValidacion) {
    const prioridad = document.createElement('select');
    prioridad.className = 'operations-priority';
    for (const [valor, etiqueta] of [['baja','Prioridad baja'],['media','Prioridad media'],['alta','Prioridad alta'],['critica','Prioridad crítica']]) {
      const option = document.createElement('option');
      option.value = valor;
      option.textContent = etiqueta;
      prioridad.appendChild(option);
    }
    acciones.appendChild(prioridad);
    acciones.appendChild(crearBoton('Validar reporte', 'operations-button operations-button--primary', async () => {
      await ejecutarAccionInstitucional(
        '/api/instituciones/' + institucionId + '/reportes/' + reporte.id + '/validar',
        'POST', { prioridad: prioridad.value }
      );
    }));
    acciones.appendChild(crearBoton('Rechazar', 'operations-button operations-button--danger', () =>
      cambiarEstadoInstitucional(institucionId, reporte.id, 'rechazado')));
  }
  if (estado === 'validado') {
    acciones.appendChild(crearBoton('Iniciar atención', 'operations-button operations-button--primary', () =>
      cambiarEstadoInstitucional(institucionId, reporte.id, 'en_atencion')));
  }
  if (estado === 'en_atencion') {
    acciones.appendChild(crearBoton('Marcar controlada', 'operations-button', () =>
      cambiarEstadoInstitucional(institucionId, reporte.id, 'controlada')));
    acciones.appendChild(crearBoton('Cerrar caso', 'operations-button operations-button--danger', () =>
      cambiarEstadoInstitucional(institucionId, reporte.id, 'cerrada')));
  }
  if (estado === 'controlada') {
    acciones.appendChild(crearBoton('Reabrir atención', 'operations-button', () =>
      cambiarEstadoInstitucional(institucionId, reporte.id, 'en_atencion')));
    acciones.appendChild(crearBoton('Cerrar caso', 'operations-button operations-button--danger', () =>
      cambiarEstadoInstitucional(institucionId, reporte.id, 'cerrada')));
  }
  if (estado === 'recibido' && tieneValidacion) {
    acciones.appendChild(nodoTexto('span', 'Otra institución ya validó este reporte. Coordina la atención con ella.', 'operations-meta'));
  }
  if (acciones.children.length) tarjeta.appendChild(acciones);

  if (Array.isArray(reporte.fotografias) && reporte.fotografias.length) {
    const fotos = nodoTexto('div', '', 'operations-photos');
    tarjeta.appendChild(crearBoton('Ver fotografías (' + reporte.fotografias.length + ')', 'operations-button', async () => {
      if (fotos.children.length) {
        fotos.replaceChildren();
        return;
      }
      for (const foto of reporte.fotografias) {
        try {
          const response = await apiOperaciones('/api/reportes/' + reporte.id + '/fotos/' + foto.id);
          const img = document.createElement('img');
          img.src = URL.createObjectURL(await response.blob());
          img.alt = 'Evidencia del reporte ' + reporte.id;
          fotos.appendChild(img);
        } catch (error) {
          fotos.appendChild(nodoTexto('span', error.message, 'operations-error'));
        }
      }
    }));
    tarjeta.appendChild(fotos);
  }

  const historial = nodoTexto('div', '', 'operations-timeline hidden');
  tarjeta.appendChild(crearBoton('Historial de actuaciones', 'operations-button', async () => {
    historial.classList.toggle('hidden');
    if (historial.dataset.loaded === 'true' || historial.classList.contains('hidden')) return;
    historial.textContent = 'Cargando historial...';
    try {
      const datos = await (await apiOperaciones('/api/instituciones/' + institucionId + '/reportes/' + reporte.id + '/seguimiento')).json();
      historial.replaceChildren();
      for (const evento of datos.seguimiento) {
        const fecha = new Date(evento.creado_en);
        const linea = nodoTexto('div', '', 'operations-timeline-item');
        linea.append(
          nodoTexto('strong', evento.accion.replaceAll('_', ' ')),
          nodoTexto('span', (Number.isNaN(fecha.valueOf()) ? '' : fecha.toLocaleString('es-EC')) + ' · ' + evento.actor, 'operations-meta')
        );
        const detalle = evento.detalle || {};
        if (detalle.nota) linea.appendChild(nodoTexto('p', detalle.nota, 'operations-meta'));
        historial.appendChild(linea);
      }
      historial.dataset.loaded = 'true';
    } catch (error) {
      historial.textContent = error.message;
    }
  }));
  return tarjeta;
}

async function cambiarEstadoInstitucional(institucionId, reporteId, estado) {
  const nota = '';
  return ejecutarAccionInstitucional(
    '/api/instituciones/' + institucionId + '/reportes/' + reporteId + '/estado',
    'PATCH', { estado, nota }
  );
}

async function ejecutarAccionInstitucional(ruta, metodo, cuerpo) {
  try {
    const datos = await (await apiOperaciones(ruta, {
      method: metodo,
      body: JSON.stringify(cuerpo)
    })).json();
    await cargarBandejaInstitucional();
    return datos;
  } catch (error) {
    alert(error.message);
  }
}

async function cargarPanelDespacho() {
  try {
    const datos = await (await apiOperaciones('/api/admin/distribucion')).json();
    configuracionDespacho = datos;
    const selector = document.getElementById('distributionTypeSelect');
    const previo = selector.value;
    selector.replaceChildren();
    for (const tipo of datos.tipos) {
      const option = document.createElement('option');
      option.value = String(tipo.id);
      option.textContent = tipo.nombre;
      selector.appendChild(option);
    }
    if (datos.tipos.some(item => String(item.id) === previo)) selector.value = previo;
    renderizarChecksDistribucion();
    await cargarReportesSinAsignar();
  } catch (error) {
    document.getElementById('distributionMessage').textContent = error.message;
  }
}

function renderizarChecksDistribucion() {
  const contenedor = document.getElementById('distributionInstitutionChecks');
  contenedor.replaceChildren();
  if (!configuracionDespacho) return;
  const tipoId = Number(document.getElementById('distributionTypeSelect').value);
  const asignadas = new Set(configuracionDespacho.reglas
    .filter(regla => Number(regla.tipo_id) === tipoId)
    .map(regla => Number(regla.institucion_id)));
  for (const institucion of configuracionDespacho.instituciones) {
    const etiqueta = document.createElement('label');
    etiqueta.className = 'operations-check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(institucion.id);
    checkbox.checked = asignadas.has(Number(institucion.id));
    const texto = nodoTexto('span', institucion.nombre + ' · ' + institucion.tipo);
    etiqueta.append(checkbox, texto);
    contenedor.appendChild(etiqueta);
  }
  if (!configuracionDespacho.instituciones.length) {
    contenedor.appendChild(nodoTexto('p', 'Primero registra una institución activa.', 'operations-empty'));
  }
}

async function guardarDistribucion() {
  const tipoId = document.getElementById('distributionTypeSelect').value;
  if (!tipoId) return;
  const ids = [...document.querySelectorAll('#distributionInstitutionChecks input:checked')].map(item => Number(item.value));
  const mensaje = document.getElementById('distributionMessage');
  mensaje.textContent = 'Guardando...';
  try {
    await apiOperaciones('/api/admin/distribucion/' + tipoId, {
      method: 'PUT',
      body: JSON.stringify({ institucion_ids: ids })
    });
    mensaje.textContent = 'Distribución guardada. Los próximos reportes de esta categoría se enviarán a ' + ids.length + ' institución(es).';
    await cargarPanelDespacho();
  } catch (error) {
    mensaje.textContent = error.message;
  }
}

async function cargarReportesSinAsignar() {
  const contenedor = document.getElementById('listaReportesSinAsignar');
  contenedor.replaceChildren(nodoTexto('p', 'Consultando reportes...', 'operations-empty'));
  try {
    const datos = await (await apiOperaciones('/api/admin/reportes/sin-asignar')).json();
    contenedor.replaceChildren();
    if (!datos.reportes.length) {
      contenedor.appendChild(nodoTexto('p', 'No hay reportes pendientes de asignación.', 'operations-empty'));
      return;
    }
    for (const reporte of datos.reportes) {
      const tarjeta = nodoTexto('article', '', 'operations-card');
      tarjeta.append(
        nodoTexto('strong', '#' + reporte.id + ' · ' + reporte.tipo),
        nodoTexto('p', reporte.descripcion, 'operations-description'),
        nodoTexto('p', 'Ciudadano: ' + [reporte.ciudadano_nombre, reporte.ciudadano_apellido].filter(Boolean).join(' ') +
          ' · Personas afectadas: ' + reporte.personas_afectadas, 'operations-meta')
      );
      const checks = nodoTexto('div', '', 'operations-check-grid');
      for (const inst of configuracionDespacho?.instituciones || []) {
        const label = document.createElement('label');
        label.className = 'operations-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = String(inst.id);
        label.append(input, nodoTexto('span', inst.nombre));
        checks.appendChild(label);
      }
      tarjeta.appendChild(checks);
      tarjeta.appendChild(crearBoton('Asignar instituciones seleccionadas', 'operations-button operations-button--primary', async () => {
        const ids = [...checks.querySelectorAll('input:checked')].map(input => Number(input.value));
        if (!ids.length) return alert('Selecciona al menos una institución.');
        try {
          await apiOperaciones('/api/admin/reportes/' + reporte.id + '/asignar', {
            method: 'POST', body: JSON.stringify({ institucion_ids: ids })
          });
          await cargarReportesSinAsignar();
        } catch (error) {
          alert(error.message);
        }
      }));
      contenedor.appendChild(tarjeta);
    }
  } catch (error) {
    contenedor.replaceChildren(nodoTexto('p', error.message, 'operations-error'));
  }
}
