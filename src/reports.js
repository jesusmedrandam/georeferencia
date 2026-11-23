'use strict';

const multer = require('multer');
const sharp = require('sharp');

const MAX_FOTOS = 3;
const MAX_ARCHIVO = 3 * 1024 * 1024;
const mimePermitidos = new Set(['image/jpeg', 'image/png', 'image/webp']);
const prioridades = new Set(['baja', 'media', 'alta', 'critica']);
const estadosAsignacion = new Set([
  'recibido', 'en_revision', 'en_atencion', 'controlada',
  'cerrada', 'informacion_solicitada', 'rechazado', 'derivado'
]);

function leerCoordenada(valor, minimo, maximo) {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  if (String(valor).trim() === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= minimo && numero <= maximo
    ? Math.round(numero * 1e6) / 1e6 : null;
}

function validarReporte(datos) {
  const descripcion = typeof datos.descripcion === 'string' ? datos.descripcion.trim() : '';
  const observaciones = typeof datos.observaciones === 'string' ? datos.observaciones.trim() : '';
  const referencia = typeof datos.referencia_ubicacion === 'string'
    ? datos.referencia_ubicacion.trim() : '';
  const tipoId = Number(datos.tipo_id);
  const afectadas = Number(datos.personas_afectadas);
  const latitud = leerCoordenada(datos.latitud, -90, 90);
  const longitud = leerCoordenada(datos.longitud, -180, 180);
  if (!Number.isSafeInteger(tipoId) || tipoId <= 0 ||
      descripcion.length < 15 || descripcion.length > 1500 ||
      observaciones.length > 1000 || referencia.length > 250 ||
      datos.personas_afectadas === undefined ||
      datos.personas_afectadas === '' ||
      !Number.isSafeInteger(afectadas) || afectadas < 0 || afectadas > 100000 ||
      latitud === null || longitud === null) {
    return { error: 'Revisa el tipo, descripción (15 a 1500 caracteres), personas afectadas y ubicación.' };
  }
  return { tipoId, descripcion, observaciones, referencia, afectadas, latitud, longitud };
}

async function convertirFotografias(archivos) {
  const convertidas = [];
  for (const archivo of archivos) {
    if (!mimePermitidos.has(archivo.mimetype) || archivo.size > MAX_ARCHIVO) {
      const error = new Error('Solo se admiten fotografías JPEG, PNG o WebP de hasta 3 MB.');
      error.status = 415;
      throw error;
    }
    try {
      const transformada = await sharp(archivo.buffer, { limitInputPixels: 20_000_000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      convertidas.push(transformada);
    } catch (cause) {
      if (cause.status) throw cause;
      const error = new Error('Una fotografía no pudo procesarse. Comprueba el formato.');
      error.status = 422;
      throw error;
    }
  }
  return convertidas;
}

function idPositivo(valor) {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function esMiembroInstitucional(pool, institucionId, usuarioId, usuario) {
  if (usuario?.es_superadmin) return true;
  const { rowCount } = await pool.query(
    `SELECT 1 FROM institucion_usuarios iu
       JOIN instituciones i ON i.id = iu.institucion_id
      WHERE iu.institucion_id = $1 AND iu.usuario_id = $2
        AND iu.activo = TRUE AND i.activo = TRUE`,
    [institucionId, usuarioId]
  );
  return rowCount > 0;
}

async function registrarEvento(cliente, reporteId, actorId, accion, detalle = {}) {
  await cliente.query(
    'INSERT INTO reporte_bitacora (reporte_id, actor_usuario_id, accion, detalle) VALUES ($1,$2,$3,$4::jsonb)',
    [reporteId, actorId || null, accion, JSON.stringify(detalle)]
  );
}

function mountReportRoutes(app, pool, verificarToken) {
  const subir = multer({
    storage: multer.memoryStorage(),
    limits: { files: MAX_FOTOS, fileSize: MAX_ARCHIVO, fields: 12 },
    fileFilter(_req, archivo, callback) {
      if (!mimePermitidos.has(archivo.mimetype)) {
        const error = new Error('Formato no permitido. Usa JPEG, PNG o WebP.');
        error.status = 415;
        callback(error);
        return;
      }
      callback(null, true);
    }
  }).array('fotografias', MAX_FOTOS);

  function parsearCarga(req, res, next) {
    subir(req, res, error => {
      if (!error) return next();
      return res.status(error.status || 400).json({
        mensaje: error instanceof multer.MulterError
          ? 'Máximo tres fotografías; hasta 3 MB por imagen.' : error.message
      });
    });
  }

  const soloSuperadmin = (req, res, next) => req.usuario?.es_superadmin
    ? next()
    : res.status(403).json({ mensaje: 'Solo el superadministrador puede distribuir reportes.' });

  async function exigirMiembro(req, res, next) {
    const institucionId = idPositivo(req.params.id);
    if (!institucionId) return res.status(400).json({ mensaje: 'Institución inválida.' });
    req.institucionId = institucionId;
    try {
      if (!await esMiembroInstitucional(pool, institucionId, req.usuarioId, req.usuario)) {
        return res.status(403).json({ mensaje: 'No tienes acceso operativo a esta institución.' });
      }
      return next();
    } catch (error) {
      console.error('No se pudo comprobar el acceso institucional:', error);
      return res.status(500).json({ mensaje: 'No se pudo comprobar el permiso institucional.' });
    }
  }

  app.get('/api/tipos-emergencia', verificarToken, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, codigo, nombre FROM tipos_emergencia WHERE activo = TRUE ORDER BY nombre'
      );
      res.json({ tipos: rows });
    } catch (error) {
      console.error('No se pudieron consultar los tipos:', error);
      res.status(500).json({ mensaje: 'No se pudieron consultar las categorías.' });
    }
  });

  // El superadministrador configura qué instituciones reciben automáticamente cada categoría.
  app.get('/api/admin/distribucion', verificarToken, soloSuperadmin, async (_req, res) => {
    try {
      const [tipos, instituciones, reglas] = await Promise.all([
        pool.query('SELECT id, codigo, nombre FROM tipos_emergencia WHERE activo = TRUE ORDER BY nombre'),
        pool.query('SELECT id, nombre, tipo FROM instituciones WHERE activo = TRUE ORDER BY nombre'),
        pool.query('SELECT tipo_id, institucion_id FROM tipo_emergencia_instituciones')
      ]);
      res.json({
        tipos: tipos.rows,
        instituciones: instituciones.rows,
        reglas: reglas.rows
      });
    } catch (error) {
      console.error('No se pudo consultar la distribución:', error);
      res.status(500).json({ mensaje: 'No se pudo cargar la distribución automática.' });
    }
  });

  app.put('/api/admin/distribucion/:tipoId', verificarToken, soloSuperadmin, async (req, res) => {
    const tipoId = idPositivo(req.params.tipoId);
    const idsEntrada = req.body.institucion_ids;
    if (!tipoId || !Array.isArray(idsEntrada) || idsEntrada.length > 30) {
      return res.status(400).json({ mensaje: 'Selecciona una categoría y una lista válida de instituciones.' });
    }
    const ids = [...new Set(idsEntrada.map(idPositivo))];
    if (ids.some(id => !id)) return res.status(400).json({ mensaje: 'Hay identificadores de institución inválidos.' });
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const tipo = await cliente.query('SELECT id FROM tipos_emergencia WHERE id = $1 AND activo = TRUE', [tipoId]);
      if (!tipo.rowCount) {
        await cliente.query('ROLLBACK');
        return res.status(404).json({ mensaje: 'Categoría de emergencia no encontrada.' });
      }
      if (ids.length) {
        const activas = await cliente.query(
          'SELECT id FROM instituciones WHERE activo = TRUE AND id = ANY($1::int[])',
          [ids]
        );
        if (activas.rowCount !== ids.length) {
          await cliente.query('ROLLBACK');
          return res.status(400).json({ mensaje: 'Todas las instituciones seleccionadas deben existir y estar activas.' });
        }
      }
      await cliente.query('DELETE FROM tipo_emergencia_instituciones WHERE tipo_id = $1', [tipoId]);
      for (const institucionId of ids) {
        await cliente.query(
          'INSERT INTO tipo_emergencia_instituciones (tipo_id, institucion_id) VALUES ($1,$2)',
          [tipoId, institucionId]
        );
      }
      await cliente.query('COMMIT');
      res.json({ mensaje: 'Distribución guardada.', tipo_id: tipoId, institucion_ids: ids });
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => {});
      console.error('No se pudo guardar la distribución:', error);
      res.status(500).json({ mensaje: 'No se pudo guardar la distribución.' });
    } finally {
      cliente.release();
    }
  });

  app.get('/api/admin/reportes/sin-asignar', verificarToken, soloSuperadmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT r.id, r.descripcion, r.personas_afectadas, r.latitud, r.longitud,
                r.referencia_ubicacion, r.estado, r.creado_en,
                t.id AS tipo_id, t.nombre AS tipo,
                u.nombre AS ciudadano_nombre, u.apellido AS ciudadano_apellido,
                COALESCE(f.fotografias, '[]'::json) AS fotografias
           FROM reportes r
           JOIN tipos_emergencia t ON t.id = r.tipo_id
           JOIN usuarios u ON u.id = r.usuario_id
           LEFT JOIN LATERAL (
             SELECT json_agg(json_build_object('id', rf.id) ORDER BY rf.id) AS fotografias
               FROM reporte_fotografias rf WHERE rf.reporte_id = r.id
           ) f ON TRUE
          WHERE NOT EXISTS (
            SELECT 1 FROM reporte_asignaciones ra WHERE ra.reporte_id = r.id
          )
          ORDER BY r.creado_en ASC
          LIMIT 200`
      );
      res.json({ reportes: rows });
    } catch (error) {
      console.error('No se pudieron consultar los reportes sin asignar:', error);
      res.status(500).json({ mensaje: 'No se pudieron consultar los reportes pendientes de distribución.' });
    }
  });

  app.post('/api/admin/reportes/:id/asignar', verificarToken, soloSuperadmin, async (req, res) => {
    const reporteId = idPositivo(req.params.id);
    const entrada = req.body.institucion_ids;
    if (!reporteId || !Array.isArray(entrada) || !entrada.length || entrada.length > 10) {
      return res.status(400).json({ mensaje: 'Selecciona entre una y diez instituciones.' });
    }
    const ids = [...new Set(entrada.map(idPositivo))];
    if (ids.some(id => !id)) return res.status(400).json({ mensaje: 'Hay identificadores de institución inválidos.' });
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const reporte = await cliente.query('SELECT id, estado FROM reportes WHERE id = $1 FOR UPDATE', [reporteId]);
      if (!reporte.rowCount) {
        await cliente.query('ROLLBACK');
        return res.status(404).json({ mensaje: 'Reporte no encontrado.' });
      }
      const instituciones = await cliente.query(
        'SELECT id FROM instituciones WHERE activo = TRUE AND id = ANY($1::int[])',
        [ids]
      );
      if (instituciones.rowCount !== ids.length) {
        await cliente.query('ROLLBACK');
        return res.status(400).json({ mensaje: 'Todas las instituciones seleccionadas deben existir y estar activas.' });
      }
      const creadas = [];
      for (const institucionId of ids) {
        const resultado = await cliente.query(
          `INSERT INTO reporte_asignaciones (reporte_id, institucion_id, asignado_por)
           VALUES ($1,$2,$3)
           ON CONFLICT (reporte_id, institucion_id) DO NOTHING
           RETURNING id, institucion_id, estado`,
          [reporteId, institucionId, req.usuarioId]
        );
        if (resultado.rowCount) {
          creadas.push(resultado.rows[0]);
          await registrarEvento(cliente, reporteId, req.usuarioId, 'asignado_a_institucion', {
            institucion_id: institucionId,
            origen: 'despacho_manual'
          });
        }
      }
      await cliente.query('COMMIT');
      res.status(201).json({ mensaje: 'Reporte distribuido a las instituciones seleccionadas.', asignaciones: creadas });
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => {});
      console.error('No se pudo asignar el reporte:', error);
      res.status(500).json({ mensaje: 'No se pudo asignar el reporte.' });
    } finally {
      cliente.release();
    }
  });

  app.post('/api/reportes', verificarToken, parsearCarga, async (req, res) => {
    const datos = validarReporte(req.body);
    if (datos.error) return res.status(400).json({ mensaje: datos.error });
    let fotografias;
    try {
      fotografias = await convertirFotografias(req.files || []);
    } catch (error) {
      return res.status(error.status || 422).json({ mensaje: error.message });
    }
    let cliente;
    try {
      cliente = await pool.connect();
      await cliente.query('BEGIN');
      await cliente.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
        [71821, req.usuarioId]);
      const tasa = await cliente.query(
        "SELECT COUNT(*)::int AS total FROM reportes WHERE usuario_id = $1 AND creado_en > NOW() - INTERVAL '1 hour'",
        [req.usuarioId]
      );
      if (tasa.rows[0].total >= 5) {
        await cliente.query('ROLLBACK');
        return res.status(429).json({ mensaje: 'Has llegado al límite de 5 reportes por hora.' });
      }
      const tipo = await cliente.query(
        'SELECT id FROM tipos_emergencia WHERE id = $1 AND activo = TRUE',
        [datos.tipoId]
      );
      if (!tipo.rowCount) {
        await cliente.query('ROLLBACK');
        return res.status(400).json({ mensaje: 'El tipo de emergencia no está disponible.' });
      }
      const resultado = await cliente.query(
        `INSERT INTO reportes (
          usuario_id, tipo_id, descripcion, observaciones, personas_afectadas,
          latitud, longitud, referencia_ubicacion
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id, estado, creado_en`,
        [req.usuarioId, datos.tipoId, datos.descripcion, datos.observaciones || null,
         datos.afectadas, datos.latitud, datos.longitud, datos.referencia || null]
      );
      const reporte = resultado.rows[0];
      for (const buffer of fotografias) {
        await cliente.query(
          'INSERT INTO reporte_fotografias (reporte_id, imagen, mime, tamano_bytes) VALUES ($1,$2,$3,$4)',
          [reporte.id, buffer, 'image/webp', buffer.length]
        );
      }
      await registrarEvento(cliente, reporte.id, req.usuarioId, 'creado', {});
      const destinos = await cliente.query(
        `SELECT ti.institucion_id, i.nombre
           FROM tipo_emergencia_instituciones ti
           JOIN instituciones i ON i.id = ti.institucion_id
          WHERE ti.tipo_id = $1 AND i.activo = TRUE
          ORDER BY i.nombre`,
        [datos.tipoId]
      );
      for (const destino of destinos.rows) {
        await cliente.query(
          `INSERT INTO reporte_asignaciones (reporte_id, institucion_id, asignado_por)
           VALUES ($1,$2,NULL)
           ON CONFLICT (reporte_id, institucion_id) DO NOTHING`,
          [reporte.id, destino.institucion_id]
        );
        await registrarEvento(cliente, reporte.id, null, 'asignado_automaticamente', {
          institucion_id: destino.institucion_id,
          institucion: destino.nombre
        });
      }
      await cliente.query('COMMIT');
      const cantidad = destinos.rows.length;
      res.status(201).json({
        mensaje: cantidad
          ? 'Reporte registrado y enviado a ' + cantidad + ' institución(es) responsable(s).'
          : 'Reporte registrado. Está pendiente de distribución por el superadministrador.',
        reporte,
        instituciones_notificadas: cantidad
      });
    } catch (error) {
      if (cliente) await cliente.query('ROLLBACK').catch(() => {});
      console.error('No se pudo guardar el reporte:', error);
      res.status(500).json({ mensaje: 'No se pudo guardar el reporte. Intenta nuevamente.' });
    } finally {
      if (cliente) cliente.release();
    }
  });

  app.get('/api/reportes/mios', verificarToken, async (req, res) => {
    const pagina = Number(req.query.pagina || 1);
    if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 10000) {
      return res.status(400).json({ mensaje: 'Página inválida.' });
    }
    try {
      const { rows } = await pool.query(
        `SELECT r.id, r.descripcion, r.observaciones, r.personas_afectadas,
                r.latitud, r.longitud, r.referencia_ubicacion, r.estado, r.creado_en,
                t.nombre AS tipo, t.codigo AS tipo_codigo,
                COALESCE(f.fotos, '[]'::json) AS fotografias,
                COALESCE(a.instituciones, '[]'::json) AS instituciones,
                e.estado AS estado_emergencia, e.prioridad
           FROM reportes r
           JOIN tipos_emergencia t ON t.id = r.tipo_id
           LEFT JOIN LATERAL (
             SELECT json_agg(json_build_object('id', rf.id) ORDER BY rf.id) AS fotos
               FROM reporte_fotografias rf WHERE rf.reporte_id = r.id
           ) f ON TRUE
           LEFT JOIN LATERAL (
             SELECT json_agg(json_build_object(
               'institucion_id', i.id, 'institucion', i.nombre, 'estado', ra.estado
             ) ORDER BY i.nombre) AS instituciones
               FROM reporte_asignaciones ra
               JOIN instituciones i ON i.id = ra.institucion_id
              WHERE ra.reporte_id = r.id
           ) a ON TRUE
           LEFT JOIN emergencias e ON e.reporte_id = r.id
          WHERE r.usuario_id = $1
          ORDER BY r.creado_en DESC, r.id DESC
          LIMIT 21 OFFSET $2`,
        [req.usuarioId, (pagina - 1) * 20]
      );
      res.json({ reportes: rows.slice(0, 20), hay_mas: rows.length > 20, pagina });
    } catch (error) {
      console.error('No se pudieron consultar los reportes:', error);
      res.status(500).json({ mensaje: 'No se pudieron consultar tus reportes.' });
    }
  });

  app.get('/api/reportes/:id/seguimiento', verificarToken, async (req, res) => {
    const reporteId = idPositivo(req.params.id);
    if (!reporteId) return res.status(400).json({ mensaje: 'Reporte inválido.' });
    try {
      const reporte = await pool.query(
        `SELECT r.id, r.estado, r.creado_en, r.descripcion, r.referencia_ubicacion,
                t.nombre AS tipo, e.estado AS estado_emergencia, e.prioridad
           FROM reportes r
           JOIN tipos_emergencia t ON t.id = r.tipo_id
           LEFT JOIN emergencias e ON e.reporte_id = r.id
          WHERE r.id = $1 AND r.usuario_id = $2`,
        [reporteId, req.usuarioId]
      );
      if (!reporte.rowCount) return res.status(404).json({ mensaje: 'Reporte no encontrado.' });
      const [instituciones, eventos] = await Promise.all([
        pool.query(
          `SELECT i.nombre AS institucion, ra.estado, ra.prioridad
             FROM reporte_asignaciones ra
             JOIN instituciones i ON i.id = ra.institucion_id
            WHERE ra.reporte_id = $1 ORDER BY i.nombre`,
          [reporteId]
        ),
        pool.query(
          `SELECT b.accion, b.detalle, b.creado_en,
                  COALESCE(u.nombre || ' ' || u.apellido, 'Sistema') AS actor
             FROM reporte_bitacora b
             LEFT JOIN usuarios u ON u.id = b.actor_usuario_id
            WHERE b.reporte_id = $1 ORDER BY b.creado_en, b.id`,
          [reporteId]
        )
      ]);
      res.json({ reporte: reporte.rows[0], instituciones: instituciones.rows, seguimiento: eventos.rows });
    } catch (error) {
      console.error('No se pudo consultar el seguimiento:', error);
      res.status(500).json({ mensaje: 'No se pudo consultar el seguimiento del reporte.' });
    }
  });

  app.get('/api/instituciones/:id/reportes', verificarToken, exigirMiembro, async (req, res) => {
    const estado = typeof req.query.estado === 'string' ? req.query.estado : '';
    if (estado && !estadosAsignacion.has(estado)) {
      return res.status(400).json({ mensaje: 'Filtro de estado inválido.' });
    }
    try {
      const { rows } = await pool.query(
        `SELECT r.id, r.descripcion, r.observaciones, r.personas_afectadas,
                r.latitud, r.longitud, r.referencia_ubicacion, r.estado AS estado_reporte,
                r.creado_en, t.nombre AS tipo, t.codigo AS tipo_codigo,
                u.nombre AS ciudadano_nombre, u.apellido AS ciudadano_apellido,
                u.email AS ciudadano_email, u.telefono AS ciudadano_telefono,
                ra.id AS asignacion_id, ra.estado AS estado_asignacion,
                ra.prioridad, e.estado AS estado_emergencia,
                COALESCE(f.fotografias, '[]'::json) AS fotografias
           FROM reporte_asignaciones ra
           JOIN reportes r ON r.id = ra.reporte_id
           JOIN tipos_emergencia t ON t.id = r.tipo_id
           JOIN usuarios u ON u.id = r.usuario_id
           LEFT JOIN emergencias e ON e.reporte_id = r.id
           LEFT JOIN LATERAL (
             SELECT json_agg(json_build_object('id', rf.id) ORDER BY rf.id) AS fotografias
               FROM reporte_fotografias rf WHERE rf.reporte_id = r.id
           ) f ON TRUE
          WHERE ra.institucion_id = $1
            AND ($2 = '' OR ra.estado = $2)
          ORDER BY CASE ra.estado
            WHEN 'recibido' THEN 0 WHEN 'en_revision' THEN 1
            WHEN 'en_atencion' THEN 2 WHEN 'controlada' THEN 3 ELSE 4 END,
            r.creado_en DESC
          LIMIT 200`,
        [req.institucionId, estado]
      );
      res.json({ reportes: rows });
    } catch (error) {
      console.error('No se pudieron consultar los reportes institucionales:', error);
      res.status(500).json({ mensaje: 'No se pudo cargar la bandeja institucional.' });
    }
  });

  app.get('/api/instituciones/:id/reportes/:reporteId/seguimiento', verificarToken, exigirMiembro, async (req, res) => {
    const reporteId = idPositivo(req.params.reporteId);
    if (!reporteId) return res.status(400).json({ mensaje: 'Reporte inválido.' });
    try {
      const asignacion = await pool.query(
        'SELECT id FROM reporte_asignaciones WHERE reporte_id = $1 AND institucion_id = $2',
        [reporteId, req.institucionId]
      );
      if (!asignacion.rowCount) return res.status(404).json({ mensaje: 'El reporte no está asignado a esta institución.' });
      const { rows } = await pool.query(
        `SELECT b.accion, b.detalle, b.creado_en,
                COALESCE(u.nombre || ' ' || u.apellido, 'Sistema') AS actor
           FROM reporte_bitacora b
           LEFT JOIN usuarios u ON u.id = b.actor_usuario_id
          WHERE b.reporte_id = $1 ORDER BY b.creado_en, b.id`,
        [reporteId]
      );
      res.json({ seguimiento: rows });
    } catch (error) {
      console.error('No se pudo consultar la bitácora institucional:', error);
      res.status(500).json({ mensaje: 'No se pudo cargar el historial de actuaciones.' });
    }
  });

  app.post('/api/instituciones/:id/reportes/:reporteId/validar', verificarToken, exigirMiembro, async (req, res) => {
    const reporteId = idPositivo(req.params.reporteId);
    const prioridad = req.body.prioridad || 'media';
    const nota = typeof req.body.nota === 'string' ? req.body.nota.trim() : '';
    if (!reporteId || !prioridades.has(prioridad) || nota.length > 1000) {
      return res.status(400).json({ mensaje: 'Indica un reporte, prioridad válida y una nota de hasta 1000 caracteres.' });
    }
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const asignacion = await cliente.query(
        `SELECT ra.id, ra.estado, r.estado AS estado_reporte
           FROM reporte_asignaciones ra
           JOIN reportes r ON r.id = ra.reporte_id
          WHERE ra.reporte_id = $1 AND ra.institucion_id = $2
          FOR UPDATE OF ra, r`,
        [reporteId, req.institucionId]
      );
      if (!asignacion.rowCount) {
        await cliente.query('ROLLBACK');
        return res.status(404).json({ mensaje: 'El reporte no está asignado a esta institución.' });
      }
      if (['rechazado', 'derivado', 'cerrada'].includes(asignacion.rows[0].estado) ||
          asignacion.rows[0].estado_reporte === 'rechazado') {
        await cliente.query('ROLLBACK');
        return res.status(409).json({ mensaje: 'Este reporte ya no se puede validar.' });
      }
      const existente = await cliente.query('SELECT id FROM emergencias WHERE reporte_id = $1', [reporteId]);
      if (existente.rowCount) {
        await cliente.query('ROLLBACK');
        return res.status(409).json({ mensaje: 'El reporte ya fue validado por una institución.' });
      }
      await cliente.query(
        `INSERT INTO emergencias (reporte_id, validada_por, prioridad, estado)
         VALUES ($1,$2,$3,'validada')`,
        [reporteId, req.usuarioId, prioridad]
      );
      await cliente.query(
        `UPDATE reporte_asignaciones
            SET estado = 'en_revision', prioridad = $1, actualizado_en = NOW()
          WHERE reporte_id = $2 AND institucion_id = $3`,
        [prioridad, reporteId, req.institucionId]
      );
      await cliente.query(
        "UPDATE reportes SET estado = 'validado', actualizado_en = NOW() WHERE id = $1",
        [reporteId]
      );
      await registrarEvento(cliente, reporteId, req.usuarioId, 'validado_por_institucion', {
        institucion_id: req.institucionId, prioridad, nota
      });
      await cliente.query('COMMIT');
      res.json({ mensaje: 'Reporte validado. Ya puedes actualizar su estado de atención.' });
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => {});
      console.error('No se pudo validar el reporte:', error);
      res.status(500).json({ mensaje: 'No se pudo validar el reporte.' });
    } finally {
      cliente.release();
    }
  });

  app.patch('/api/instituciones/:id/reportes/:reporteId/estado', verificarToken, exigirMiembro, async (req, res) => {
    const reporteId = idPositivo(req.params.reporteId);
    const estado = req.body.estado;
    const nota = typeof req.body.nota === 'string' ? req.body.nota.trim() : '';
    const transiciones = {
      recibido: ['en_revision', 'informacion_solicitada', 'rechazado'],
      en_revision: ['informacion_solicitada', 'rechazado'],
      en_atencion: ['controlada', 'cerrada'],
      controlada: ['en_atencion', 'cerrada']
    };
    if (!reporteId || !['en_revision', 'en_atencion', 'controlada', 'cerrada', 'informacion_solicitada', 'rechazado'].includes(estado) ||
        nota.length > 1000) {
      return res.status(400).json({ mensaje: 'Estado o nota inválidos.' });
    }
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const { rows } = await cliente.query(
        `SELECT ra.id, ra.estado, r.estado AS estado_reporte
           FROM reporte_asignaciones ra
           JOIN reportes r ON r.id = ra.reporte_id
          WHERE ra.reporte_id = $1 AND ra.institucion_id = $2
          FOR UPDATE OF ra, r`,
        [reporteId, req.institucionId]
      );
      if (!rows.length) {
        await cliente.query('ROLLBACK');
        return res.status(404).json({ mensaje: 'El reporte no está asignado a esta institución.' });
      }
      const actual = rows[0].estado;
      if (!transiciones[actual]?.includes(estado)) {
        await cliente.query('ROLLBACK');
        return res.status(409).json({ mensaje: 'No se puede cambiar de ' + actual + ' a ' + estado + '.' });
      }
      if (estado === 'en_atencion' || estado === 'controlada' || estado === 'cerrada') {
        const emergencia = await cliente.query('SELECT estado FROM emergencias WHERE reporte_id = $1 FOR UPDATE', [reporteId]);
        if (!emergencia.rowCount) {
          await cliente.query('ROLLBACK');
          return res.status(409).json({ mensaje: 'Primero debes validar el reporte y asignarle una prioridad.' });
        }
        const estadosEmergencia = {
          en_atencion: 'en_atencion',
          controlada: 'controlada',
          cerrada: 'cerrada'
        };
        const destino = estadosEmergencia[estado];
        const actualEmergencia = emergencia.rows[0].estado;
        const permitidos = {
          validada: ['en_atencion'],
          en_atencion: ['controlada', 'cerrada'],
          controlada: ['en_atencion', 'cerrada']
        };
        if (!permitidos[actualEmergencia]?.includes(destino)) {
          await cliente.query('ROLLBACK');
          return res.status(409).json({ mensaje: 'La emergencia no permite esa transición desde ' + actualEmergencia + '.' });
        }
        await cliente.query(
          'UPDATE emergencias SET estado = $1, actualizada_en = NOW() WHERE reporte_id = $2',
          [destino, reporteId]
        );
      }
      await cliente.query(
        'UPDATE reporte_asignaciones SET estado = $1, actualizado_en = NOW() WHERE reporte_id = $2 AND institucion_id = $3',
        [estado, reporteId, req.institucionId]
      );
      if (estado === 'informacion_solicitada') {
        await cliente.query(
          "UPDATE reportes SET estado = 'informacion_solicitada', actualizado_en = NOW() WHERE id = $1",
          [reporteId]
        );
      } else if (estado === 'rechazado') {
        const restantes = await cliente.query(
          `SELECT COUNT(*)::int AS total FROM reporte_asignaciones
            WHERE reporte_id = $1 AND institucion_id <> $2
              AND estado NOT IN ('rechazado', 'derivado', 'cerrada')`,
          [reporteId, req.institucionId]
        );
        if (!restantes.rows[0].total) {
          await cliente.query(
            "UPDATE reportes SET estado = 'rechazado', actualizado_en = NOW() WHERE id = $1",
            [reporteId]
          );
        }
      }
      await registrarEvento(cliente, reporteId, req.usuarioId, 'estado_actualizado', {
        institucion_id: req.institucionId, estado, nota
      });
      await cliente.query('COMMIT');
      res.json({ mensaje: 'Seguimiento actualizado correctamente.', estado });
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => {});
      console.error('No se pudo actualizar el estado:', error);
      res.status(500).json({ mensaje: 'No se pudo actualizar el seguimiento.' });
    } finally {
      cliente.release();
    }
  });

  app.get('/api/reportes/:id/fotos/:fotoId', verificarToken, async (req, res) => {
    const id = idPositivo(req.params.id);
    const fotoId = idPositivo(req.params.fotoId);
    if (!id || !fotoId) return res.status(400).json({ mensaje: 'Identificador inválido.' });
    try {
      const { rows } = await pool.query(
        `SELECT rf.imagen, rf.mime
           FROM reporte_fotografias rf
           JOIN reportes r ON r.id = rf.reporte_id
          WHERE rf.id = $1 AND rf.reporte_id = $2
            AND (
              r.usuario_id = $3
              OR EXISTS (SELECT 1 FROM usuarios us WHERE us.id = $3 AND us.es_superadmin = TRUE)
              OR EXISTS (
                SELECT 1 FROM reporte_asignaciones ra
                JOIN institucion_usuarios iu ON iu.institucion_id = ra.institucion_id
                JOIN instituciones i ON i.id = iu.institucion_id
                WHERE ra.reporte_id = r.id AND iu.usuario_id = $3
                  AND iu.activo = TRUE AND i.activo = TRUE
              )
            )`,
        [fotoId, id, req.usuarioId]
      );
      if (!rows.length) return res.status(404).json({ mensaje: 'Fotografía no encontrada.' });
      res.set('Content-Type', rows[0].mime);
      res.set('Cache-Control', 'private, no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.send(rows[0].imagen);
    } catch (error) {
      console.error('No se pudo recuperar la fotografía:', error);
      res.status(500).json({ mensaje: 'Error al consultar la fotografía.' });
    }
  });

  app.get('/api/mapa/emergencias', verificarToken, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT e.id, r.latitud, r.longitud, t.nombre AS tipo,
                e.prioridad, e.estado, e.creada_en
           FROM emergencias e
           JOIN reportes r ON r.id = e.reporte_id
           JOIN tipos_emergencia t ON t.id = r.tipo_id
          WHERE e.estado <> 'cerrada'
          ORDER BY e.creada_en DESC LIMIT 500`
      );
      res.json({ emergencias: rows });
    } catch (error) {
      console.error('No se pudo consultar el mapa de emergencias:', error);
      res.status(500).json({ mensaje: 'No se pudieron cargar las emergencias confirmadas.' });
    }
  });
}

module.exports = {
  MAX_FOTOS, MAX_ARCHIVO, leerCoordenada, validarReporte,
  convertirFotografias, mountReportRoutes
};
