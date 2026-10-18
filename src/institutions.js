'use strict';

async function getUserAccess(pool, usuarioId) {
  const result = await pool.query(
    `SELECT iu.institucion_id, i.nombre AS institucion, i.tipo,
            iu.rol
       FROM institucion_usuarios iu
       JOIN instituciones i ON i.id = iu.institucion_id
      WHERE iu.usuario_id = $1 AND iu.activo = TRUE AND i.activo = TRUE
      ORDER BY i.nombre`,
    [usuarioId]
  );
  return result.rows;
}

function positiveId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function mountInstitutionRoutes(app, pool, verificarToken) {
  const asSuperadmin = (req, res, next) => req.usuario.es_superadmin
    ? next()
    : res.status(403).json({ mensaje: 'Solo el superadministrador puede realizar esta acción.' });

  const asInstitutionAdmin = async (req, res, next) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ mensaje: 'Institución inválida.' });
    req.institucionId = id;
    if (req.usuario.es_superadmin) return next();
    try {
      const result = await pool.query(
        `SELECT 1 FROM institucion_usuarios iu
           JOIN instituciones i ON i.id = iu.institucion_id
          WHERE iu.institucion_id = $1 AND iu.usuario_id = $2
            AND iu.activo = TRUE AND iu.rol = 'administrador' AND i.activo = TRUE`,
        [id, req.usuarioId]
      );
      if (!result.rowCount) return res.status(403).json({ mensaje: 'No administras esta institución.' });
      return next();
    } catch (error) {
      console.error('Error de permisos institucionales:', error);
      return res.status(500).json({ mensaje: 'No se pudo validar el permiso.' });
    }
  };

  app.get('/api/instituciones/mis', verificarToken, async (req, res) => {
    try {
      const instituciones = req.usuario.es_superadmin
        ? (await pool.query(
            `SELECT id AS institucion_id, nombre AS institucion, tipo,
                    'superadministrador' AS rol, activo
               FROM instituciones ORDER BY nombre`
          )).rows
        : await getUserAccess(pool, req.usuarioId);
      res.json({ instituciones });
    } catch (error) {
      console.error('Error al listar instituciones:', error);
      res.status(500).json({ mensaje: 'No se pudieron consultar las instituciones.' });
    }
  });

  app.get('/api/admin/instituciones', verificarToken, asSuperadmin, async (_req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM instituciones ORDER BY nombre');
      res.json({ instituciones: rows });
    } catch (error) {
      res.status(500).json({ mensaje: 'No se pudieron consultar las instituciones.' });
    }
  });

  app.post('/api/admin/instituciones', verificarToken, asSuperadmin, async (req, res) => {
    const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim() : '';
    const tipo = typeof req.body.tipo === 'string' ? req.body.tipo.trim() : '';
    const descripcion = typeof req.body.descripcion === 'string' ? req.body.descripcion.trim() : '';
    if (!nombre || nombre.length > 160 || !tipo || tipo.length > 80 || descripcion.length > 2000) {
      return res.status(400).json({ mensaje: 'Nombre y tipo son obligatorios, con longitudes válidas.' });
    }
    try {
      const { rows } = await pool.query(
        'INSERT INTO instituciones (nombre, tipo, descripcion) VALUES ($1, $2, $3) RETURNING *',
        [nombre, tipo, descripcion || null]
      );
      res.status(201).json({ institucion: rows[0] });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ mensaje: 'La institución ya existe.' });
      console.error('Error al crear institución:', error);
      res.status(500).json({ mensaje: 'No se pudo crear la institución.' });
    }
  });

  app.patch('/api/admin/instituciones/:id', verificarToken, asSuperadmin, async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return res.status(400).json({ mensaje: 'Institución inválida.' });
    const { nombre, tipo, descripcion, activo } = req.body;
    if ((nombre !== undefined && (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 160))
        || (tipo !== undefined && (typeof tipo !== 'string' || !tipo.trim() || tipo.length > 80))
        || (descripcion !== undefined && descripcion !== null && (typeof descripcion !== 'string' || descripcion.length > 2000))
        || (activo !== undefined && typeof activo !== 'boolean')) {
      return res.status(400).json({ mensaje: 'Datos de institución inválidos.' });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE instituciones SET
           nombre = COALESCE($1, nombre),
           tipo = COALESCE($2, tipo),
           descripcion = CASE WHEN $3::boolean THEN $4 ELSE descripcion END,
           activo = COALESCE($5, activo)
         WHERE id = $6 RETURNING *`,
        [nombre?.trim() ?? null, tipo?.trim() ?? null,
         descripcion !== undefined, descripcion?.trim() || null, activo ?? null, id]
      );
      if (!rows.length) return res.status(404).json({ mensaje: 'Institución no encontrada.' });
      res.json({ institucion: rows[0] });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ mensaje: 'El nombre ya está en uso.' });
      console.error('Error al actualizar institución:', error);
      res.status(500).json({ mensaje: 'No se pudo actualizar la institución.' });
    }
  });

  app.get('/api/instituciones/:id/miembros', verificarToken, asInstitutionAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id AS usuario_id, u.nombre, u.apellido, u.email,
                iu.rol, iu.activo
           FROM institucion_usuarios iu
           JOIN usuarios u ON u.id = iu.usuario_id
          WHERE iu.institucion_id = $1 ORDER BY u.nombre, u.apellido`,
        [req.institucionId]
      );
      res.json({ miembros: rows });
    } catch (error) {
      res.status(500).json({ mensaje: 'No se pudieron consultar los miembros.' });
    }
  });

  app.post('/api/instituciones/:id/miembros', verificarToken, asInstitutionAdmin, async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const rol = req.body.rol;
    if (!email || email.length > 100 || !['administrador', 'operador'].includes(rol)) {
      return res.status(400).json({ mensaje: 'Indica un correo válido y rol (administrador u operador).' });
    }
    try {
      const usuario = await pool.query(
        'SELECT id FROM usuarios WHERE LOWER(email) = $1 AND verificado = TRUE AND activo = TRUE',
        [email]
      );
      if (!usuario.rows.length) {
        return res.status(404).json({ mensaje: 'El usuario debe existir, estar verificado y activo.' });
      }
      const institucion = await pool.query('SELECT activo FROM instituciones WHERE id = $1', [req.institucionId]);
      if (!institucion.rows.length || !institucion.rows[0].activo) {
        return res.status(409).json({ mensaje: 'La institución no existe o está desactivada.' });
      }
      const { rows } = await pool.query(
        `INSERT INTO institucion_usuarios (institucion_id, usuario_id, rol, activo)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (institucion_id, usuario_id)
         DO UPDATE SET rol = EXCLUDED.rol, activo = TRUE
         RETURNING institucion_id, usuario_id, rol, activo`,
        [req.institucionId, usuario.rows[0].id, rol]
      );
      res.status(201).json({ miembro: rows[0] });
    } catch (error) {
      console.error('Error al agregar miembro:', error);
      res.status(500).json({ mensaje: 'No se pudo agregar el miembro.' });
    }
  });

  app.patch('/api/instituciones/:id/miembros/:usuarioId', verificarToken, asInstitutionAdmin, async (req, res) => {
    const usuarioId = positiveId(req.params.usuarioId);
    if (!usuarioId) return res.status(400).json({ mensaje: 'Usuario inválido.' });
    const { rol, activo } = req.body;
    if ((rol !== undefined && !['administrador', 'operador'].includes(rol))
        || (activo !== undefined && typeof activo !== 'boolean')
        || (rol === undefined && activo === undefined)) {
      return res.status(400).json({ mensaje: 'Indica un rol o estado válido.' });
    }
    try {
      const actual = await pool.query(
        'SELECT rol, activo FROM institucion_usuarios WHERE institucion_id = $1 AND usuario_id = $2',
        [req.institucionId, usuarioId]
      );
      if (!actual.rows.length) return res.status(404).json({ mensaje: 'Miembro no encontrado.' });
      const eraAdmin = actual.rows[0].activo && actual.rows[0].rol === 'administrador';
      const seraAdmin = (activo ?? actual.rows[0].activo) && (rol ?? actual.rows[0].rol) === 'administrador';
      if (eraAdmin && !seraAdmin) {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS total FROM institucion_usuarios
            WHERE institucion_id = $1 AND usuario_id <> $2
              AND activo = TRUE AND rol = 'administrador'`,
          [req.institucionId, usuarioId]
        );
        if (!rows[0].total) {
          return res.status(409).json({ mensaje: 'No puedes quitar el último administrador activo.' });
        }
      }
      const { rows } = await pool.query(
        `UPDATE institucion_usuarios SET
           rol = COALESCE($1, rol), activo = COALESCE($2, activo)
         WHERE institucion_id = $3 AND usuario_id = $4
         RETURNING institucion_id, usuario_id, rol, activo`,
        [rol ?? null, activo ?? null, req.institucionId, usuarioId]
      );
      res.json({ miembro: rows[0] });
    } catch (error) {
      console.error('Error al modificar miembro:', error);
      res.status(500).json({ mensaje: 'No se pudo modificar el miembro.' });
    }
  });
}

module.exports = { getUserAccess, mountInstitutionRoutes };
