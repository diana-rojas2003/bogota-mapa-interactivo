#!/usr/bin/env node
/**
 * Test automatizado para verificar la presencia de marcadores y clustering
 * de TransMilenio y SITP en el Mapa Interactivo de Bogotá.
 *
 * Puede probarse contra localhost o la URL pública de GitHub Pages:
 *   node tests/test_markers.js http://127.0.0.1:8000/index.html
 *   node tests/test_markers.js https://diana-rojas2003.github.io/bogota-mapa-interactivo/
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const targetUrl = process.argv[2] || 'http://127.0.0.1:8000/index.html';

console.log(`[TEST] Verificando marcadores en: ${targetUrl}`);

// 1. Verificación estática de los datos GeoJSON en site/data
const dataDir = path.join(__dirname, '..', 'site', 'data');
const tmPath = path.join(dataDir, 'estaciones_tm.geojson');
const sitpPath = path.join(dataDir, 'paraderos_sitp.geojson');

if (!fs.existsSync(tmPath)) {
  console.error(`[FAIL] No existe ${tmPath}`);
  process.exit(1);
}
if (!fs.existsSync(sitpPath)) {
  console.error(`[FAIL] No existe ${sitpPath}`);
  process.exit(1);
}

const tmGeoJson = JSON.parse(fs.readFileSync(tmPath, 'utf8'));
const sitpGeoJson = JSON.parse(fs.readFileSync(sitpPath, 'utf8'));

console.log(`[PASS] GeoJSON estaciones_tm: ${tmGeoJson.features.length} features (esperado: 152)`);
console.log(`[PASS] GeoJSON paraderos_sitp: ${sitpGeoJson.features.length} features (esperado: 7604)`);

if (tmGeoJson.features.length !== 152) {
  console.error(`[FAIL] Conteo de estaciones TM inesperado: ${tmGeoJson.features.length}`);
  process.exit(1);
}
if (sitpGeoJson.features.length !== 7604) {
  console.error(`[FAIL] Conteo de paraderos SITP inesperado: ${sitpGeoJson.features.length}`);
  process.exit(1);
}

// 2. Verificación de renderizado en navegador headless (Edge o Chrome)
let browserExe = null;
const possibleBrowsers = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
];

for (const p of possibleBrowsers) {
  if (fs.existsSync(p)) {
    browserExe = p;
    break;
  }
}

if (!browserExe) {
  console.warn('[WARN] No se encontró Edge o Chrome para la prueba en navegador headless. Validación estática OK.');
  process.exit(0);
}

console.log(`[TEST] Ejecutando navegador headless (${path.basename(browserExe)})...`);

try {
  let stdout = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    stdout = execFileSync(browserExe, [
      '--headless',
      '--virtual-time-budget=6000',
      '--dump-dom',
      targetUrl
    ], {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000
    });

    if (stdout.includes('7.756') || stdout.includes('7756')) {
      break;
    }
    // Breve pausa para permitir que el servidor local despache archivos concurrentes
    execFileSync('powershell', ['-Command', 'Start-Sleep -Milliseconds 800']);
  }

  // Validaciones en el DOM renderizado
  const errors = [];

  // Chip de total
  const chipMatch = stdout.match(/id="chip-total"[^>]*>([^<]+)<\/span>/);
  const chipText = chipMatch ? chipMatch[1].trim() : '';
  console.log(`[DOM] Chip total: "${chipText}"`);
  if (!chipText.includes('7.756') && !chipText.includes('7756')) {
    errors.push(`El chip total ("${chipText}") no muestra los 7.756 elementos sumados.`);
  }

  // Leyenda de TransMilenio
  if (!stdout.includes('Estaciones TransMilenio') || !stdout.includes('152')) {
    errors.push('La leyenda no muestra "Estaciones TransMilenio" con conteo 152.');
  } else {
    console.log('[PASS] Leyenda contiene Estaciones TransMilenio (152).');
  }

  // Leyenda de SITP
  if (!stdout.includes('Paraderos SITP') || (!stdout.includes('7.604') && !stdout.includes('7604'))) {
    errors.push('La leyenda no muestra "Paraderos SITP" con conteo 7.604.');
  } else {
    console.log('[PASS] Leyenda contiene Paraderos SITP (7.604).');
  }

  // Clusters de marcadores en el DOM
  const clusterMatches = stdout.match(/class="[^"]*marker-cluster[^"]*"/g) || [];
  console.log(`[DOM] Nodos .marker-cluster detectados: ${clusterMatches.length}`);
  if (clusterMatches.length === 0) {
    errors.push('No se detectaron nodos .marker-cluster en el mapa.');
  } else {
    console.log(`[PASS] Clustering de paraderos SITP activo (${clusterMatches.length} clusters visibles).`);
  }

  // Capa Canvas o marcadores vectoriales para estaciones TM
  const hasCanvas = stdout.includes('<canvas class="leaflet-zoom-animated"');
  const hasInteractive = stdout.includes('leaflet-interactive');
  if (!hasCanvas && !hasInteractive) {
    errors.push('No se detectó capa de renderizado canvas ni elementos interactivos para las estaciones TM.');
  } else {
    console.log('[PASS] Capa de renderizado de estaciones TransMilenio detectada.');
  }

  // Estado estructurado de depuración
  const debugMatch = stdout.match(/id="debug-state"[^>]*>([\s\S]*?)<\/div>/);
  if (debugMatch) {
    try {
      const debugState = JSON.parse(debugMatch[1]);
      if (!debugState.summary.estaciones_tm.onMap) {
        errors.push('Estaciones TransMilenio no está marcada como activa en el mapa.');
      }
      if (!debugState.summary.paraderos_sitp.onMap) {
        errors.push('Paraderos SITP no está marcada como activa en el mapa.');
      }
      console.log(`[PASS] Estado de capas verificado en el mapa: TM onMap=${debugState.summary.estaciones_tm.onMap}, SITP onMap=${debugState.summary.paraderos_sitp.onMap}`);
    } catch (e) {}
  }

  // Verificar que no haya mensajes de error en la UI
  if (stdout.includes('Error cargando') || stdout.includes('No se pudo cargar')) {
    errors.push('Se detectó mensaje de error de carga en la interfaz.');
  }

  if (errors.length > 0) {
    console.error('\n[FAIL] Errores encontrados durante la prueba en navegador:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log('\n[SUCCESS] Todas las aserciones pasaron exitosamente. Marcadores y clusters verificados.');
  process.exit(0);

} catch (err) {
  console.error('[FAIL] Error ejecutando la prueba en navegador:', err.message);
  process.exit(1);
}
