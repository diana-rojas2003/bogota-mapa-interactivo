# Bitácora — Mapa interactivo de Bogotá

**Estudiante OpenCode School:** curious-crafter-5332  
**Repositorio:** https://github.com/diana-rojas2003/bogota-mapa-interactivo  
**URL prevista del mapa:** https://diana-rojas2003.github.io/bogota-mapa-interactivo/  
**Fecha:** 5-6 de noviembre de 2026 · **Entrega:** 7 de noviembre de 2026, 10:00 AM

---

## 1. Configuración de OpenCode y modelos usados

- **Proveedor:** OpenCode (proveedor `opencode`), todos los modelos con costo $0 por millón de tokens (gratis).
- **Modelo principal (arquitectura, integración, depuración):** `opencode/deepseek-v4.1-flash-free` (variante `flash`).
- **Modelos baratos (datos, formato, documentación):** `opencode/glm-5.3-flash-free` y `opencode/mimo-v2.6-flash-free`.
- **Configuración:** `gh auth` ya estaba autenticado como `diana-rojas2003` con scopes `repo`, `workflow`, `gist`, `read:org`. Identidad de git fijada dentro del repo (`diana-rojas2003 / diana-rojas2003@users.noreply.github.com`). No se usó `opencode --continue` porque la sesión ya estaba activa; ese comando pertenece al CLI de OpenCode, no a una sesión en curso.

Los subagentes se crearon como subagentes `general` con su propio prompt escrito en `.opencode/agent/` (versionados en el repo), no como tipos de agente nativos de OpenCode.

---

## 2. Agentes y skills creados

### Agentes (subagentes `general`, prompt en `.opencode/agent/`)

| Agente | Rol | Modelo | Estado |
|--------|-----|--------|--------|
| `agente-datos` | Fuentes abiertas, scripts de descarga/limpieza, GeoJSON EPSG:4326 | `glm-5.3-flash-free` | ✅ completado |
| `agente-mapa` | Front-end Leaflet con capas, popups, leyenda, responsive | `deepseek-v4.1-flash-free` | ✅ completado (orquestador, límite de modelo gratuito) |
| `agente-cicd` | Repo, workflow GitHub Actions, activación Pages | orquestador | ✅ repo y workflow creados; Pages pendiente de activación UI |
| `agente-qa` | Prueba de carga, consola, enlaces, URL pública | `mimo-v2.6-flash-free` | ✅ local (200 en todos los recursos) |
| `agente-bitacora` | Documentación en BITACORA.md | orquestador | ✅ este archivo |

### Skills (`.opencode/skills/<nombre>/SKILL.md`, reutilizables)

- `skill-descarga-geodatos`: cómo obtener y limpiar datos abiertos de Bogotá (CKAN, ArcGIS/IDECA, paginación, simplificación, CRS).
- `skill-mapa-web`: plantilla Leaflet con capas activables, popups desde manifest, markercluster, leyenda y responsive.
- `skill-deploy-pages`: configuración de GitHub Actions (`upload-pages-artifact` + `deploy-pages`) en push a `main`.

---

## 3. Prompts usados (resumen)

- **Plan inicial:** mostrado al usuario antes de ejecutar (estructura de repo, 5 capas, Leaflet, CI/CD).
- **agente-datos:** contrato de datos cerrado (manifest.json, propiedades por capa, `fetch_data.py`/`validate_data.py`, `sources.yaml`, umbrales de MB y CRS).
- **agente-mapa:** Leaflet 1.9.4 + markercluster, carga perezosa de GeoJSON, popups generados desde `manifest.layers[*].popup`, leyenda dinámica, mapa base OSM/Carto, panel móvil deslizante, `preferCanvas`.

---

## 4. Estructura del repositorio

```
bogota-mapa-interactivo/
├─ .github/workflows/deploy.yml      # build + Pages en cada push a main
├─ .opencode/agent/                  # prompts de los 5 agentes (versionados)
├─ .opencode/skills/                 # 3 skills reutilizables (SKILL.md)
├─ scripts/
│  ├─ sources.yaml                   # catálogo de fuentes oficiales
│  ├─ fetch_data.py                  # descarga, limpieza, simplificación, CRS, métricas
│  └─ validate_data.py               # esquema, CRS, conteos, bbox, pesos
├─ site/
│  ├─ index.html, css/styles.css, js/app.js, favicon.svg
│  └─ data/*.geojson + manifest.json (5 capas, ~5 MB, versionados)
├─ tests/
├─ README.md, LICENSE, .gitignore
└─ BITACORA.md
```

---

## 5. Fuentes de datos (verificadas, sin API key)

Todas las capas se descargan por script y se versionan en `site/data/`, por lo que el sitio funciona aunque una fuente externa no esté disponible.

| Capa | Tipo | Fuente | Features | Género |
|------|------|--------|----------|--------|
| Localidades | arcgis | Servicios GIS Catastro Bogotá (IDECA) | 20 | polígono |
| Ciclorrutas | arcgis | Servicios GIS Catastro Bogotá (IDECA) | 6311 | polígono |
| Estaciones TransMilenio | arcgis | GIS TransMilenio (`consulta_estaciones_troncales`) | 152 | punto |
| Paraderos SITP | arcgis | GIS TransMilenio (`consulta_paraderos_zonales`) | 7604 | punto (clustering) |
| Parques | geojson | Datos Abiertos Bogotá (POT) | 893 | polígono |

**Overpass/OSM y `servicios.ideca.gov.co` fueron descartados:** Overpass no responde (timeout en todos los mirrors) y el DNS de IDECA no resuelve. Se usaron fuentes alternativas oficiales y alcanzables.

---

## 6. Problemas encontrados y resoluciones

| Problema | Resolución |
|----------|------------|
| Overpass API no disponible (timeout) y IDECA DNS no resuelve | Se usaron CKAN de Bogotá + ArcGIS de Catastro y TransMilenio, que sí entregan GeoJSON. |
| `datos.gov.co` solo devuelve metadatos federados (403 en filas) | Se ignoró; se usaron fuentes directas de Bogotá y TransMilenio. |
| GeoJSON de "localidades" del portal era Esri JSON, no GeoJSON puro | Se consultó el servicio ArcGIS `/MapServer/0/query?f=geojson`. |
| Parques en `EPSG:6247` (coordenadas proyectadas), no 4326 | Se agregó `source_crs: EPSG:6247` y transformación con `pyproj.Transformer`. |
| Sumapaz excedía el bbox de validación contratado | Se corrigió el contrato de validación a `lat 3.5-5.1` (Sumapaz es real); se eliminó el recorte artificial que falseaba el dato. |
| 6 paraderos SITP con geometría nula | Descartados (7610 → 7604), según contrato. |
| `NaN` en atributos de parques | Sanitizado a `null` en `clean_value`. |
| Modelo gratuito de OpenCode alcanzó límite de uso durante `agente-mapa` | El orquestador construyó el front-end directamente siguiendo el contrato de datos. |
| GitHub Pages no se puede crear por API la primera vez (`PUT /pages` → 404) | GitHub requiere activar Pages una sola vez en Configuración → Páginas del repositorio (aceptar términos). El workflow de build ya sube el artefacto correctamente; al activar Pages y volver a ejecutar el workflow, se despliega automáticamente. |

---

## 7. Estimación de tokens / costo por tarea

Todos los modelos usados son gratuitos ($0 por millón de tokens). Estimación aproximada de consumo:

| Tarea | Agente | Modelo | Tokens aprox. | Costo |
|-------|--------|--------|---------------|-------|
| Plan y reconocimiento de fuentes | orquestador | deepseek-v4.1-flash-free | ~25 k | $0 |
| Pipeline de datos + validación | agente-datos | glm-5.3-flash-free | ~85 k | $0 |
| Front-end Leaflet | orquestador (agente-mapa) | deepseek-v4.1-flash-free | ~40 k | $0 |
| Workflow + repo + push | orquestador | deepseek-v4.1-flash-free | ~15 k | $0 |
| QA local + BITACORA | orquestador | mimo-v2.6-flash-free | ~20 k | $0 |
| **Total aproximado** | | | **~185 k tokens** | **$0** |

---

## 8. Estado de la entrega y próximos pasos

### ✅ Completado y empujado a `main`
- Repositorio público: https://github.com/diana-rojas2003/bogota-mapa-interactivo
- Código fuente, 5 capas de datos GeoJSON (~14 980 features, ~5 MB), manifest, pipeline reproducible.
- Workflow `.github/workflows/deploy.yml`: build + `upload-pages-artifact` en cada push a `main`.
- Ejecución del workflow: job **build = success** (artefacto subido). Job **deploy = failure** únicamente porque Pages no está activado en el repositorio.

### ⏳ Pendiente (una sola acción en GitHub, no expuesta por API)
GitHub no permite crear un sitio de Pages por API la primera vez; requiere activarlo una vez en la interfaz del repositorio:

1. Ir a https://github.com/diana-rojas2003/bogota-mapa-interactivo/settings/pages
2. En "Build and deployment" → Source: seleccionar **GitHub Actions**.
3. Guardar. Con eso queda habilitado.
4. Volver a ejecutar el workflow (Actions → "Deploy mapa de Bogotá a GitHub Pages" → Re-run jobs) o hacer un nuevo push a `main`.
5. URL pública: https://diana-rojas2003.github.io/bogota-mapa-interactivo/

Una vez activado, el mapa despliega automáticamente en cada push a `main` y cumple todos los requisitos: base conmutable, zoom, panel de 5 capas activables, popups con atributos, leyenda dinámica y diseño responsive.
