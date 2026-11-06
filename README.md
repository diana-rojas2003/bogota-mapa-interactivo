# Mapa interactivo de Bogotá

Mapa web interactivo de Bogotá D.C. construido con Leaflet y datos abiertos oficiales.
El sitio es estático, se genera desde el repositorio y se publica automáticamente en
GitHub Pages con cada push a `main`.

**Sitio publicado:** https://diana-rojas2003.github.io/bogota-mapa-interactivo/

## Capas

| Capa | Geometría | Fuente |
|------|-----------|--------|
| Localidades | Polígonos | Servicios GIS Catastro Bogotá (IDECA) |
| Ciclorrutas | Polígonos | Servicios GIS Catastro Bogotá (IDECA) |
| Estaciones TransMilenio | Puntos | GIS TransMilenio |
| Paraderos SITP | Puntos | GIS TransMilenio |
| Parques | Polígonos | Datos Abiertos Bogotá (POT) |

Cada capa se puede activar desde el panel de capas, tiene popups con atributos,
leyenda dinámica y contador de elementos. Los paraderos del SITP se agrupan con
clustering para mantener el rendimiento en móvil.

## Requisitos

- Python 3.10 o superior

```bash
pip install -r requirements.txt
```

## Regenerar los datos

```bash
python scripts/fetch_data.py
python scripts/validate_data.py
```

Los GeoJSON resultantes se escriben en `site/data/` y quedan versionados para que
el sitio funcione aunque una fuente externa no esté disponible.

## Ejecutar el mapa en local

```bash
python -m http.server 8000 --directory site
```

Abrir http://localhost:8000

## Estructura

```
scripts/   pipeline de descarga, limpieza y validación
site/      sitio estático (HTML, CSS, JS y datos)
tests/     verificaciones automáticas del sitio
.github/   workflow de despliegue a GitHub Pages
```

## Despliegue

El workflow `.github/workflows/deploy.yml` se ejecuta en cada push a `main`:

1. Instala dependencias y regenera los datos (con respaldo en los GeoJSON versionados).
2. Valida esquema, CRS y tamaños.
3. Publica `site/` en GitHub Pages.

## Licencia

MIT. Los datos pertenecen a sus fuentes originales y conservan sus condiciones de uso.
