'use strict';

const multer = require('multer');
const sharp = require('sharp');

const MAX_FOTOS = 3;
const MAX_ARCHIVO = 3 * 1024 * 1024;
const mimePermitidos = new Set(['image/jpeg', 'image/png', 'image/webp']);
const mensajesEstado = new Set(['pendiente', 'informacion_solicitada', 'validado', 'rechazado']);

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
      // Sharp decodifica el archivo real, limita píxeles, corrige orientación
      // y elimina metadatos EXIF (incluida posible ubicación GPS).
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

  app.post('/api/reportes', verificarToken, parsearCarga, async (req, res) => {
    const datos = validarReporte(req.body);
    if (datos.error) return res.status(400).json({ mensaje: datos.error });
    const archivos = req.files || [];
    let fotografias;
    try {
      fotografias = await convertirFotografias(archivos);
    } catch (error) {
      return res.status(error.status || 422).json({ mensaje: error.message });
    }
    let cliente;
    try {
      cliente = await pool.connect();
      await cliente.query('BEGIN');
      // Evita envíos simultáneos que burlen el límite de cinco reportes por hora.
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
      await cliente.query(
        'INSERT INTO reporte_bitacora (reporte_id, actor_usuario_id, accion) VALUES ($1,$2,$3)',
        [reporte.id, req.usuarioId, 'creado']
      );
      await cliente.query('COMMIT');
      res.status(201).json({
        mensaje: 'Reporte registrado. Está pendiente de revisión institucional.',
        reporte
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
                COALESCE(f.fotos, '[]'::json) AS fotografias
           FROM reportes r
           JOIN tipos_emergencia t ON t.id = r.tipo_id
           LEFT JOIN LATERAL (
             SELECT json_agg(json_build_object('id', rf.id) ORDER BY rf.id) AS fotos
               FROM reporte_fotografias rf WHERE rf.reporte_id = r.id
           ) f ON TRUE
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

  app.get('/api/reportes/:id/fotos/:fotoId', verificarToken, async (req, res) => {
    const id = Number(req.params.id);
    const fotoId = Number(req.params.fotoId);
    if (![id, fotoId].every(v => Number.isSafeInteger(v) && v > 0)) {
      return res.status(400).json({ mensaje: 'Identificador inválido.' });
    }
    try {
      const { rows } = await pool.query(
        `SELECT rf.imagen, rf.mime
           FROM reporte_fotografias rf
           JOIN reportes r ON r.id = rf.reporte_id
          WHERE rf.id = $1 AND rf.reporte_id = $2 AND r.usuario_id = $3`,
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

  // Solo emergencias verificadas por una institución; reportes pendientes
  // nunca aparecen en el mapa público.
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

module.exports = { MAX_FOTOS, MAX_ARCHIVO, leerCoordenada, validarReporte, convertirFotografias, mountReportRoutes };
