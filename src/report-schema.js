'use strict';

// Fase 2. Esquema incremental; no borra ni altera los usuarios existentes.
async function initializeReportSchema(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tipos_emergencia (
        id SMALLSERIAL PRIMARY KEY,
        codigo VARCHAR(50) NOT NULL UNIQUE,
        nombre VARCHAR(100) NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS reportes (
        id BIGSERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        tipo_id SMALLINT NOT NULL REFERENCES tipos_emergencia(id) ON DELETE RESTRICT,
        descripcion TEXT NOT NULL CHECK (char_length(descripcion) BETWEEN 15 AND 1500),
        observaciones VARCHAR(1000),
        personas_afectadas INTEGER NOT NULL DEFAULT 0
          CHECK (personas_afectadas BETWEEN 0 AND 100000),
        latitud NUMERIC(9, 6) NOT NULL CHECK (latitud BETWEEN -90 AND 90),
        longitud NUMERIC(9, 6) NOT NULL CHECK (longitud BETWEEN -180 AND 180),
        referencia_ubicacion VARCHAR(250),
        estado VARCHAR(24) NOT NULL DEFAULT 'pendiente'
          CHECK (estado IN ('pendiente', 'informacion_solicitada', 'validado', 'rechazado')),
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reporte_fotografias (
        id BIGSERIAL PRIMARY KEY,
        reporte_id BIGINT NOT NULL REFERENCES reportes(id) ON DELETE CASCADE,
        imagen BYTEA NOT NULL,
        mime VARCHAR(40) NOT NULL DEFAULT 'image/webp',
        tamano_bytes INTEGER NOT NULL CHECK (tamano_bytes > 0),
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS emergencias (
        id BIGSERIAL PRIMARY KEY,
        reporte_id BIGINT NOT NULL UNIQUE REFERENCES reportes(id) ON DELETE RESTRICT,
        validada_por INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        prioridad VARCHAR(12) NOT NULL CHECK (prioridad IN ('baja', 'media', 'alta', 'critica')),
        estado VARCHAR(20) NOT NULL DEFAULT 'validada'
          CHECK (estado IN ('validada', 'en_atencion', 'controlada', 'cerrada')),
        creada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reporte_bitacora (
        id BIGSERIAL PRIMARY KEY,
        reporte_id BIGINT NOT NULL REFERENCES reportes(id) ON DELETE CASCADE,
        actor_usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        accion VARCHAR(60) NOT NULL,
        detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_reportes_usuario_fecha
        ON reportes (usuario_id, creado_en DESC);
      CREATE INDEX IF NOT EXISTS idx_reportes_estado_fecha
        ON reportes (estado, creado_en DESC);
      CREATE INDEX IF NOT EXISTS idx_reporte_fotos_reporte
        ON reporte_fotografias (reporte_id);
      CREATE INDEX IF NOT EXISTS idx_bitacora_reporte
        ON reporte_bitacora (reporte_id, creado_en);
      CREATE INDEX IF NOT EXISTS idx_emergencias_estado
        ON emergencias (estado, creada_en DESC);
    `);

    // Alta inicial de tipos. No modifica los tipos ya existentes ni sus estados.
    const tipos = [
      ['incendio', 'Incendio'],
      ['inundacion', 'Inundación'],
      ['deslizamiento', 'Deslizamiento'],
      ['accidente_transito', 'Accidente de tránsito'],
      ['sismo', 'Sismo / terremoto'],
      ['arbol_caido', 'Árbol caído'],
      ['animal_suelto', 'Animal suelto'],
      ['otro', 'Otro incidente']
    ];
    for (const [codigo, nombre] of tipos) {
      await client.query(
        'INSERT INTO tipos_emergencia (codigo, nombre) VALUES ($1, $2) ON CONFLICT (codigo) DO NOTHING',
        [codigo, nombre]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { initializeReportSchema };
