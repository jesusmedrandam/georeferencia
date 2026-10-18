'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { leerCoordenada, validarReporte, convertirFotografias, mountReportRoutes } = require('../src/reports');
const { initializeReportSchema } = require('../src/report-schema');

const datosBase = {
  tipo_id: '1',
  descripcion: 'Un árbol bloquea por completo la vía principal.',
  personas_afectadas: '0',
  latitud: '-1.234567',
  longitud: '-80.123456',
  observaciones: '',
  referencia_ubicacion: ''
};

test('valida ubicaciones y campos obligatorios sin convertir vacío en 0,0', () => {
  assert.equal(leerCoordenada('', -90, 90), null);
  assert.equal(leerCoordenada('91', -90, 90), null);
  assert.equal(leerCoordenada('-1.23456789', -90, 90), -1.234568);
  assert.equal(validarReporte(datosBase).error, undefined);
  assert.equal(validarReporte({ ...datosBase, latitud: '' }).error !== undefined, true);
  assert.equal(validarReporte({ ...datosBase, longitud: 'NaN' }).error !== undefined, true);
  assert.equal(validarReporte({ ...datosBase, personas_afectadas: '-2' }).error !== undefined, true);
  assert.equal(validarReporte({ ...datosBase, descripcion: 'Corto' }).error !== undefined, true);
  assert.equal(validarReporte({ ...datosBase, tipo_id: '0' }).error !== undefined, true);
  assert.equal(validarReporte({ ...datosBase, observaciones: 'x'.repeat(1001) }).error !== undefined, true);
});

test('normaliza una imagen subida y la convierte a WebP sin EXIF', async () => {
  const jpeg = await sharp({ create: {
    width: 16, height: 12, channels: 3, background: '#2277aa'
  }}).jpeg().withExif({ IFD0: { Copyright: 'Prueba sin metadatos privados' } }).toBuffer();
  const fotos = await convertirFotografias([{ buffer: jpeg, mimetype: 'image/jpeg', size: jpeg.length }]);
  assert.equal(fotos.length, 1);
  const metadata = await sharp(fotos[0]).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 16);
  assert.equal(metadata.height, 12);
});

test('rechaza archivos falsos o formatos no permitidos', async () => {
  await assert.rejects(
    () => convertirFotografias([{ buffer: Buffer.from('no soy una foto'), mimetype: 'image/jpeg', size: 14 }]),
    error => error.status === 422
  );
  await assert.rejects(
    () => convertirFotografias([{ buffer: Buffer.from('PDF'), mimetype: 'application/pdf', size: 3 }]),
    error => error.status === 415
  );
});

test('el esquema crea reportes y emergencias separadamente en una transacción', async () => {
  const sentencias = [];
  const cliente = {
    async query(sql) { sentencias.push(sql); return { rows: [] }; },
    release() { sentencias.push('RELEASE'); }
  };
  await initializeReportSchema({ connect: async () => cliente });
  const conjunto = sentencias.join('\n');
  for (const nombre of ['tipos_emergencia', 'reportes', 'reporte_fotografias', 'emergencias', 'reporte_bitacora']) {
    assert.ok(conjunto.includes('CREATE TABLE IF NOT EXISTS ' + nombre));
  }
  assert.ok(sentencias.includes('BEGIN'));
  assert.ok(sentencias.includes('COMMIT'));
  assert.ok(!sentencias.includes('ROLLBACK'));
});

test('la consulta del historial requiere que los reportes pertenezcan al usuario', async () => {
  const rutas = {};
  const app = {
    get(path, ...fn) { rutas['GET ' + path] = fn.at(-1); },
    post(path, ...fn) { rutas['POST ' + path] = fn.at(-1); }
  };
  const consultas = [];
  const pool = {
    async query(sql, params) {
      consultas.push({ sql, params });
      return { rows: [], rowCount: 0 };
    }
  };
  mountReportRoutes(app, pool, (_req, _res, next) => next());
  const salida = { json(value) { this.data = value; return this; } };
  await rutas['GET /api/reportes/mios'](
    { usuarioId: 42, query: { pagina: '1' } }, salida
  );
  assert.equal(salida.data.pagina, 1);
  assert.ok(consultas[0].sql.includes('WHERE r.usuario_id = $1'));
  assert.deepEqual(consultas[0].params, [42, 0]);
  consultas.length = 0;
  await rutas['GET /api/mapa/emergencias']({}, salida);
  assert.ok(consultas[0].sql.includes("WHERE e.estado <> 'cerrada'"));
  assert.ok(!consultas[0].sql.includes('FROM reportes r WHERE'));
});
