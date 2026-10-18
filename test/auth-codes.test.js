'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'test-only-secret-with-more-than-thirty-two-chars-long';
const { crearCodigo, verificarCodigo, consumirCodigo } = require('../src/auth-codes');

test('un código de registro se genera con seis dígitos y se guarda como firma', async () => {
  const llamadas = [];
  const pool = {
    async query(sql, args) {
      llamadas.push({ sql, args });
      return { rowCount: 1 };
    }
  };
  const usuario = { id: 7, email: 'persona@example.com' };
  const codigo = await crearCodigo(pool, usuario, 'registro');
  assert.match(codigo, /^\d{6}$/);
  assert.match(llamadas[0].args[0], /^[a-f0-9]{64}$/);
  assert.notEqual(llamadas[0].args[0], codigo);
  const pendiente = {
    ...usuario,
    codigo_verificacion_hash: llamadas[0].args[0],
    codigo_verificacion_tipo: 'registro',
    codigo_verificacion_expira: new Date(Date.now() + 60_000),
    codigo_verificacion_intentos: 0
  };
  assert.equal(await verificarCodigo(pool, pendiente, 'registro', codigo), true);
  assert.equal(await verificarCodigo(pool, pendiente, 'recuperacion', codigo), false);
});

test('un código incorrecto cuenta como intento fallido', async () => {
  let intentos = 0;
  const pool = {
    async query(sql) {
      if (sql.includes('codigo_verificacion_intentos + 1')) intentos++;
      return { rowCount: 1 };
    }
  };
  const usuario = {
    id: 1, email: 'persona@example.com',
    codigo_verificacion_tipo: 'registro',
    codigo_verificacion_hash: 'a'.repeat(64),
    codigo_verificacion_expira: new Date(Date.now() + 60_000),
    codigo_verificacion_intentos: 0
  };
  assert.equal(await verificarCodigo(pool, usuario, 'registro', '000001'), false);
  assert.equal(intentos, 1);
  usuario.codigo_verificacion_intentos = 5;
  assert.equal(await verificarCodigo(pool, usuario, 'registro', '000001'), false);
  assert.equal(intentos, 1);
});

test('no acepta un código vencido', async () => {
  const pool = { query: async () => { throw Error('No debe consultar la BD'); } };
  const usuario = {
    id: 1, email: 'persona@example.com', codigo_verificacion_tipo: 'registro',
    codigo_verificacion_hash: 'a'.repeat(64),
    codigo_verificacion_expira: new Date(Date.now() - 1000),
    codigo_verificacion_intentos: 0
  };
  assert.equal(await verificarCodigo(pool, usuario, 'registro', '123456'), false);
});

test('el reenvío tiene espera y el consumo limpia el código', async () => {
  const consultas = [];
  const pool = {
    async query(sql, args) {
      consultas.push({ sql, args });
      return { rowCount: sql.includes('UPDATE usuarios') && sql.includes('60 seconds') ? 0 : 1 };
    }
  };
  await assert.rejects(() => crearCodigo(pool, { id: 1, email: 'persona@example.com' }, 'registro'),
    error => error.status === 429);
  await consumirCodigo(pool, 1);
  assert.match(consultas.at(-1).sql, /codigo_verificacion_hash = NULL/);
});
