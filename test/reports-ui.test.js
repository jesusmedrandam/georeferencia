'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/reports.css'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../public/reports.js'), 'utf8');

test('usa el hash oficial de Leaflet para no bloquear el mapa', () => {
  assert.match(html, /leaflet@1\.9\.4\/dist\/leaflet\.css/);
  assert.match(html, /sha256-p4NxAoJBhIIN\+hmNHrzRCf9tD\/miZyoHS5obTRR9BMY=/);
  assert.doesNotMatch(html, /miZyoZOZUeZ9qjL2E93/);
  assert.match(html, /reports\.css\?v=2/);
});

test('el mapa está contenido en la tarjeta y los estilos son responsivos', () => {
  assert.match(css, /#reportesArea \.reporte-map-shell\s*\{/);
  assert.match(css, /overflow: hidden/);
  assert.match(css, /#reportesArea \.reporte-map\s*\{/);
  assert.match(css, /isolation: isolate/);
  assert.match(css, /@media \(max-width: 600px\)/);
});

test('todas las coordenadas externas pertenecen al formulario del reporte', () => {
  for (const id of ['reporteLatitud', 'reporteLongitud', 'reporteReferencia']) {
    const exp = new RegExp('<input[^>]*id="' + id + '"[^>]*form="formReporte"');
    assert.match(html, exp);
  }
  assert.match(html, /id="enviarReporte"[^>]*type="submit"[^>]*form="formReporte"/);
  assert.match(html, /id="reporteFotos"[^>]*name="fotografias"/);
});

test('los identificadores consultados por el script existen en la interfaz', () => {
  const ids = [...js.matchAll(/getElementById\('([^']+)'\)/g)].map(item => item[1]);
  for (const id of new Set(ids)) {
    assert.match(html, new RegExp('id="' + id + '"'), 'Falta ' + id);
  }
  assert.match(js, /addEventListener\('change', mostrarArchivosSeleccionados\)/);
});
