'use strict';
// Esta sección complementa al login existente; no crea privilegios desde el navegador.
let institucionesActuales = [];

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('institucionSelect').addEventListener('change', mostrarInstitucionSeleccionada);
  document.getElementById('formNuevaInstitucion').addEventListener('submit', crearInstitucion);
  document.getElementById('formAgregarMiembro').addEventListener('submit', agregarMiembro);
  document.getElementById('instToggleActive').addEventListener('click', alternarInstitucion);
});

async function apiInstitucional(ruta, metodo = 'GET', body) {
  const response = await fetch(API_URL + ruta, {
    method: metodo,
    headers: {
      Authorization: 'Bearer ' + localStorage.getItem('token'),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const datos = await response.json();
  if (!response.ok) throw new Error(datos.mensaje || 'No se pudo completar la operación.');
  return datos;
}

function mostrarMensajeInstitucional(mensaje) {
  document.getElementById('instMensaje').textContent = mensaje || '';
}

async function cargarInstituciones() {
  if (!usuarioActual) return;
  const esSuper = usuarioActual.rol_global === 'superadministrador';
  document.getElementById('etiquetaRol').textContent = esSuper ? 'Superadministrador' : 'Ciudadano';
  document.getElementById('superAdminPanel').classList.toggle('hidden', !esSuper);
  const selector = document.getElementById('institucionSelect');
  const seleccionPrevia = selector.value;
  const { instituciones } = await apiInstitucional('/api/instituciones/mis');
  institucionesActuales = instituciones;
  selector.replaceChildren();
  for (const institucion of instituciones) {
    const opcion = document.createElement('option');
    opcion.value = String(institucion.institucion_id);
    opcion.textContent = institucion.institucion;
    selector.appendChild(opcion);
  }
  if (instituciones.some(i => String(i.institucion_id) === seleccionPrevia)) {
    selector.value = seleccionPrevia;
  }
  document.getElementById('instResumen').textContent = instituciones.length
    ? 'Puedes participar con diferentes permisos en cada institución.'
    : 'Por ahora participas como ciudadano. Podrás reportar y consultar emergencias.';
  selector.disabled = !instituciones.length;
  await mostrarInstitucionSeleccionada();
}

async function mostrarInstitucionSeleccionada() {
  const id = Number(document.getElementById('institucionSelect').value);
  const seleccionada = institucionesActuales.find(i => i.institucion_id === id);
  const esSuper = usuarioActual?.rol_global === 'superadministrador';
  const puedeAdministrar = seleccionada &&
    (esSuper || seleccionada.rol === 'administrador') && seleccionada.activo !== false;
  document.getElementById('gestionMiembros').classList.toggle('hidden', !puedeAdministrar);
  const botonEstado = document.getElementById('instToggleActive');
  botonEstado.disabled = !seleccionada;
  botonEstado.textContent = seleccionada?.activo === false
    ? 'Reactivar institución'
    : 'Desactivar institución seleccionada';
  document.getElementById('instRolSeleccionado').textContent = seleccionada
    ? 'Tu función: ' + seleccionada.rol +
      (seleccionada.activo === false ? ' (institución inactiva)' : '')
    : 'No tienes instituciones vinculadas.';
  document.getElementById('listaMiembros').replaceChildren();
  if (puedeAdministrar) {
    try { await cargarMiembros(id); }
    catch (error) { mostrarMensajeInstitucional(error.message); }
  }
}

async function crearInstitucion(evento) {
  evento.preventDefault();
  try {
    const datos = await apiInstitucional('/api/admin/instituciones', 'POST', {
      nombre: document.getElementById('nuevaInstNombre').value,
      tipo: document.getElementById('nuevaInstTipo').value,
      descripcion: document.getElementById('nuevaInstDescripcion').value
    });
    document.getElementById('formNuevaInstitucion').reset();
    await cargarInstituciones();
    document.getElementById('institucionSelect').value = String(datos.institucion.id);
    await mostrarInstitucionSeleccionada();
    mostrarMensajeInstitucional('Institución creada correctamente.');
  } catch (error) {
    mostrarMensajeInstitucional(error.message);
  }
}

async function alternarInstitucion() {
  const id = Number(document.getElementById('institucionSelect').value);
  const seleccionada = institucionesActuales.find(i => i.institucion_id === id);
  if (!seleccionada || usuarioActual?.rol_global !== 'superadministrador') return;
  const activo = seleccionada.activo === false;
  try {
    await apiInstitucional('/api/admin/instituciones/' + id, 'PATCH', { activo });
    await cargarInstituciones();
    mostrarMensajeInstitucional(activo ? 'Institución reactivada.' : 'Institución desactivada.');
  } catch (error) {
    mostrarMensajeInstitucional(error.message);
  }
}

async function agregarMiembro(evento) {
  evento.preventDefault();
  const id = Number(document.getElementById('institucionSelect').value);
  if (!id) return;
  try {
    await apiInstitucional('/api/instituciones/' + id + '/miembros', 'POST', {
      email: document.getElementById('miembroEmail').value,
      rol: document.getElementById('miembroRol').value
    });
    document.getElementById('formAgregarMiembro').reset();
    await cargarMiembros(id);
    mostrarMensajeInstitucional('Usuario vinculado correctamente.');
  } catch (error) {
    mostrarMensajeInstitucional(error.message);
  }
}

async function cargarMiembros(id) {
  const { miembros } = await apiInstitucional('/api/instituciones/' + id + '/miembros');
  const lista = document.getElementById('listaMiembros');
  lista.replaceChildren();
  if (!miembros.length) {
    const texto = document.createElement('p');
    texto.textContent = 'Todavía no hay personal asignado.';
    lista.appendChild(texto);
  }
  for (const miembro of miembros) {
    const fila = document.createElement('div');
    fila.className = 'inst-row';
    const datos = document.createElement('div');
    const nombre = document.createElement('strong');
    nombre.textContent = [miembro.nombre, miembro.apellido].filter(Boolean).join(' ');
    const correo = document.createElement('p');
    correo.textContent = miembro.email;
    datos.append(nombre, correo);

    const rol = document.createElement('select');
    rol.setAttribute('aria-label', 'Rol de ' + miembro.email);
    for (const [valor, etiqueta] of [['operador','Operador'],['administrador','Administrador']]) {
      const opcion = document.createElement('option');
      opcion.value = valor;
      opcion.textContent = etiqueta;
      rol.appendChild(opcion);
    }
    rol.value = miembro.rol;
    rol.style.width = 'auto';
    rol.addEventListener('change', async () => {
      try {
        await apiInstitucional('/api/instituciones/' + id + '/miembros/' +
          miembro.usuario_id, 'PATCH', { rol: rol.value });
        miembro.rol = rol.value;
        mostrarMensajeInstitucional('Rol actualizado.');
        await cargarInstituciones();
      } catch (error) {
        rol.value = miembro.rol;
        mostrarMensajeInstitucional(error.message);
      }
    });

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'secondary';
    boton.textContent = miembro.activo ? 'Desactivar' : 'Activar';
    boton.addEventListener('click', async () => {
      try {
        await apiInstitucional('/api/instituciones/' + id + '/miembros/' +
          miembro.usuario_id, 'PATCH', { activo: !miembro.activo });
        await cargarInstituciones();
        mostrarMensajeInstitucional('Estado actualizado.');
      } catch (error) {
        mostrarMensajeInstitucional(error.message);
      }
    });
    fila.append(datos, rol, boton);
    lista.appendChild(fila);
  }
}
