'use strict';
const { createHmac, randomInt, timingSafeEqual } = require('crypto');

const EXPIRACION_MINUTOS = 15;
const ESPERA_SEGUNDOS = 60;
const MAX_INTENTOS = 5;

function codigoSeguro() {
  return String(randomInt(100000, 1000000));
}

function firmaCodigo(email, tipo, codigo) {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) throw new Error('JWT_SECRET debe estar configurado');
  return createHmac('sha256', secreto)
    .update(`${email.toLowerCase()}:${tipo}:${codigo}`)
    .digest('hex');
}

async function crearCodigo(pool, usuario, tipo) {
  if (!['registro', 'recuperacion'].includes(tipo)) throw new Error('Tipo de código inválido');
  const codigo = codigoSeguro();
  const firma = firmaCodigo(usuario.email, tipo, codigo);
  const { rowCount } = await pool.query(
    `UPDATE usuarios
        SET codigo_verificacion = NULL, codigo_verificacion_hash = $1,
            codigo_verificacion_tipo = $2,
            codigo_verificacion_expira = NOW() + INTERVAL '15 minutes',
            codigo_verificacion_intentos = 0,
            codigo_verificacion_ultimo_envio = NOW()
      WHERE id = $3
        AND (codigo_verificacion_ultimo_envio IS NULL
          OR codigo_verificacion_ultimo_envio <= NOW() - INTERVAL '60 seconds')`,
    [firma, tipo, usuario.id]
  );
  if (!rowCount) {
    const error = new Error('Espera un minuto antes de pedir otro código.');
    error.status = 429;
    throw error;
  }
  return codigo;
}

async function verificarCodigo(pool, usuario, tipo, codigo) {
  if (!/^\d{6}$/.test(String(codigo ?? ''))) return false;
  if (usuario.codigo_verificacion_tipo !== tipo
      || !usuario.codigo_verificacion_hash
      || !usuario.codigo_verificacion_expira
      || new Date(usuario.codigo_verificacion_expira).getTime() <= Date.now()
      || usuario.codigo_verificacion_intentos >= MAX_INTENTOS) return false;
  const esperado = Buffer.from(usuario.codigo_verificacion_hash, 'hex');
  const recibido = Buffer.from(firmaCodigo(usuario.email, tipo, String(codigo)), 'hex');
  const valido = esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
  if (!valido) {
    await pool.query(
      `UPDATE usuarios SET codigo_verificacion_intentos = codigo_verificacion_intentos + 1
        WHERE id = $1 AND codigo_verificacion_intentos < $2`,
      [usuario.id, MAX_INTENTOS]
    );
  }
  return valido;
}

async function consumirCodigo(pool, usuarioId) {
  await pool.query(
    `UPDATE usuarios SET codigo_verificacion = NULL,
       codigo_verificacion_hash = NULL, codigo_verificacion_tipo = NULL,
       codigo_verificacion_expira = NULL, codigo_verificacion_intentos = 0
      WHERE id = $1`,
    [usuarioId]
  );
}

module.exports = {
  crearCodigo,
  verificarCodigo,
  consumirCodigo,
  EXPIRACION_MINUTOS,
  ESPERA_SEGUNDOS,
  MAX_INTENTOS
};
