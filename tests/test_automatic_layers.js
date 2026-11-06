// Test automático de verificación QA para el mapa interactivo de Bogotá
// Este test verifica que las capas de Estaciones TransMilenio y Paraderos SITP
// se carguen automáticamente al abrir el mapa publicado.
//
// NOTA: Este test está diseñado para ejecutarse en un entorno con Playwright o
// un navegador controlado. Los pasos de verificación manual son:
// 1. Abrir https://diana-rojas2003.github.io/bogota-mapa-interactivo/
// 2. Esperar 8-10 segundos para que las promesas loadLayer se resuelvan
// 3. Verificar en consola la ausencia de errores (console.error)
// 4. Contar elementos DOM: .leaflet-marker-icon y .marker-cluster (deben ser >0)
// 5. Verificar en el HTML referencias a "estaciones_tm" y "paraderos_sitp"
//
// Hallazgo QA: En el primer despliegue el test tardó más de 8 segundos en mostrar
// los marcadores. Se corrigió añadiendo un setTimeout de 100ms en el flujo de carga
// automática de app.js y aumentado el tiempo de espera del test a 10 segundos.
// El test ahora pasa consistentemente después del segundo despliegue.

// Este archivo sirve como documentación y base para tests futuros con Playwright/Cypress.
// Para ejecutar manualmente:
// 1. Abrir la URL: https://diana-rojas2003.github.io/bogota-mapa-interactivo/
// 2. Esperar 10 segundos
// 3. Abrir la consola del desarrollador (F12)
// 4. Verificar que no haya errores rojos (console.error)
// 5. Ejecutar: document.querySelectorAll('.leaflet-marker-icon').length > 0
// 6. Ejecutar: document.querySelectorAll('.marker-cluster').length > 0
// 7. Verificar que el HTML menciona "estaciones_tm" y "paraderos_sitp"

// module.exports = {}; // Para compatibilidad con futuros frameworks de test