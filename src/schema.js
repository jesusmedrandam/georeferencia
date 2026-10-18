'use strict';

// Migración incremental: conserva los usuarios ya registrados.
async function initializeDatabase(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100),
        apellido VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        fecha_nacimiento DATE,
        password VARCHAR(255),
        verificado BOOLEAN DEFAULT FALSE,
        codigo_verificacion VARCHAR(6),
        telefono VARCHAR(20),
        foto_perfil BYTEA
      );
    `);
    for (const definition of [
      'foto_perfil BYTEA',
      'foto_perfil_mime VARCHAR(50)',
      'activo BOOLEAN NOT NULL DEFAULT TRUE',
      'es_superadmin BOOLEAN NOT NULL DEFAULT FALSE',
      'codigo_verificacion_hash VARCHAR(64)',
      'codigo_verificacion_tipo VARCHAR(12)',
      'codigo_verificacion_expira TIMESTAMPTZ',
      'codigo_verificacion_intentos INTEGER NOT NULL DEFAULT 0',
      'codigo_verificacion_ultimo_envio TIMESTAMPTZ',
      'password_version INTEGER NOT NULL DEFAULT 0',
      'intentos_login INTEGER NOT NULL DEFAULT 0',
      'bloqueado_hasta TIMESTAMPTZ'
    ]) {
      await client.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ${definition}`);
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS instituciones (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(160) NOT NULL UNIQUE,
        tipo VARCHAR(80) NOT NULL,
        descripcion TEXT,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS institucion_usuarios (
        id SERIAL PRIMARY KEY,
        institucion_id INTEGER NOT NULL REFERENCES instituciones(id) ON DELETE RESTRICT,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        rol VARCHAR(20) NOT NULL CHECK (rol IN ('administrador', 'operador')),
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (institucion_id, usuario_id)
      );
      CREATE INDEX IF NOT EXISTS idx_institucion_usuarios_usuario
        ON institucion_usuarios (usuario_id) WHERE activo = TRUE;
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { initializeDatabase };
