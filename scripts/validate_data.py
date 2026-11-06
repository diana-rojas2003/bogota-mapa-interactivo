#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Validación de los datos del Mapa Interactivo de Bogotá.

Comprueba que site/data/ contenga los 5 GeoJSON y manifest.json, con
conteos, cajas de coordenadas, propiedades y tamaños dentro de lo esperado.

Uso:
    python scripts/validate_data.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "site" / "data"

# Rangos de features por capa: (min, max) — None significa valor exacto.
EXPECTED_FEATURES = {
    "localidades.geojson": (19, 21),
    "estaciones_tm.geojson": (100, 300),
    "paraderos_sitp.geojson": (5000, 9000),
    "parques.geojson": (500, 1200),
    "ciclorrutas.geojson": (4000, 8000),
}

REQUIRED_PROPS = {
    "localidades.geojson": ["nombre", "codigo", "area_ha", "n_parques", "km_ciclorruta"],
    "ciclorrutas.geojson": ["codigo", "civ", "largo_km"],
    "estaciones_tm.geojson": ["nombre", "codigo", "troncal", "ubicacion", "tipo",
                              "biciestacion", "capacidad_bicis"],
    "paraderos_sitp.geojson": ["nombre", "cenefa", "direccion", "localidad", "zona"],
    "parques.geojson": ["nombre", "categoria", "elemento", "componente", "subzona",
                        "area_ha"],
}

# Caja de Bogotá
LON_MIN, LON_MAX = -74.6, -73.7
LAT_MIN, LAT_MAX = 3.5, 5.1

MAX_FILE_MB = 6.0
MAX_TOTAL_MB = 15.0

FILES = ["localidades.geojson", "ciclorrutas.geojson", "estaciones_tm.geojson",
         "paraderos_sitp.geojson", "parques.geojson", "manifest.json"]

failures = []


def check(condition, message):
    """Registra [OK] o [FALLA]; devuelve True si pasó."""
    if condition:
        print(f"  [OK] {message}")
        return True
    print(f"  [FALLA] {message}")
    failures.append(message)
    return False


def iter_coords(obj):
    """Itera sobre todos los pares (lon, lat) de una geometría GeoJSON."""
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            yield float(obj[0]), float(obj[1])
        else:
            for item in obj:
                yield from iter_coords(item)


def main():
    print(f"Validando datos en: {DATA_DIR}\n")

    # ------------------------------------------------------------------
    # 1. Existencia de archivos
    # ------------------------------------------------------------------
    print("1. Existencia de archivos")
    files = {}
    for name in FILES:
        path = DATA_DIR / name
        files[name] = path
        check(path.is_file(), f"{name} existe")

    if failures:
        print("\nFaltan archivos base; no se puede continuar.")
        return 1
    print()

    sizes = {}
    data = {}
    # ------------------------------------------------------------------
    # 2. GeoJSON: estructura
    # ------------------------------------------------------------------
    print("2. JSON válido y FeatureCollection")
    geojsons = [f for f in FILES if f != "manifest.json"]
    for name in geojsons:
        path = files[name]
        try:
            content = path.read_text(encoding="utf-8")
            doc = json.loads(content)
        except Exception as exc:  # noqa: BLE001
            check(False, f"{name}: JSON inválido ({exc})")
            continue
        valid_json = True
        is_fc = isinstance(doc, dict) and doc.get("type") == "FeatureCollection"
        if not check(is_fc, f"{name}: type == FeatureCollection"):
            valid_json = False
        if valid_json:
            sizes[name] = path.stat().st_size
            data[name] = doc
    print()

    # ------------------------------------------------------------------
    # 3. Conteos de features
    # ------------------------------------------------------------------
    print("3. Conteo de features")
    counts = {}
    for name, (lo, hi) in EXPECTED_FEATURES.items():
        if name not in data:
            continue
        n = len(data[name]["features"])
        counts[name] = n
        if name == "localidades.geojson":
            check(n == 20, f"localidades: {n} features (esperados: 20)")
        else:
            check(lo <= n <= hi, f"{name}: {n} features (rango {lo}-{hi})")
    print()

    # ------------------------------------------------------------------
    # 4. Caja de coordenadas
    # ------------------------------------------------------------------
    print("4. Coordenadas dentro de Bogotá")
    for name in geojsons:
        if name not in data:
            continue
        out_of_bounds = 0
        feats_wo_geom = 0
        for feat in data[name]["features"]:
            geom = feat.get("geometry")
            if not geom or not geom.get("coordinates"):
                feats_wo_geom += 1
                continue
            for lon, lat in iter_coords(geom["coordinates"]):
                if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
                    out_of_bounds += 1
                    break
        ok_msg = f"{name}: todas las coordenadas dentro de la caja"
        detail = f" ({out_of_bounds} fuera, {feats_wo_geom} sin geometría)"
        check(out_of_bounds == 0, ok_msg + detail)
    print()

    # ------------------------------------------------------------------
    # 5. Propiedades obligatorias (>= 90%)
    # ------------------------------------------------------------------
    print("5. Propiedades obligatorias")
    for name, req in REQUIRED_PROPS.items():
        if name not in data:
            continue
        feats = data[name]["features"]
        n = len(feats)
        for prop in req:
            present = sum(1 for f in feats
                          if f.get("properties") and prop in f["properties"])
            pct = 100.0 * present / n if n else 0.0
            check(pct >= 90.0,
                  f"{name}.{prop}: presente en {present}/{n} ({pct:.1f}% >= 90%)")
    print()

    # ------------------------------------------------------------------
    # 6. Tamaños de archivo
    # ------------------------------------------------------------------
    print("6. Tamaños de archivo")
    total_bytes = 0
    for name in FILES:
        size = files[name].stat().st_size
        total_bytes += size
        check(size <= MAX_FILE_MB * 1024 * 1024,
              f"{name}: {size/1024/1024:.2f} MB <= {MAX_FILE_MB} MB")
    total_mb = total_bytes / 1024 / 1024
    check(total_mb <= MAX_TOTAL_MB,
          f"total: {total_mb:.2f} MB <= {MAX_TOTAL_MB} MB")
    print()

    # ------------------------------------------------------------------
    # 7. Coherencia del manifest
    # ------------------------------------------------------------------
    print("7. Coherencia del manifest.json")
    try:
        manifest = json.loads(files["manifest.json"].read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        check(False, f"manifest.json: JSON inválido ({exc})")
        return 1

    ok_manifest = isinstance(manifest, dict)
    check(ok_manifest, "manifest.json es un objeto JSON")
    if not ok_manifest:
        return 1

    check(manifest.get("crs") == "EPSG:4326",
          "manifest.crs == EPSG:4326")
    created_at = manifest.get("generated_at", "")
    check(isinstance(created_at, str) and created_at.endswith("+00:00"),
          "manifest.generated_at es ISO-8601 UTC")

    layers = manifest.get("layers")
    check(isinstance(layers, dict) and layers,
          "manifest.layers es un diccionario no vacío")
    if not isinstance(layers, dict):
        return 1

    for layer, info in layers.items():
        name = info.get("archivo", f"{layer}.geojson")
        path = files.get(name)
        if not path or not path.is_file():
            check(False, f"{layer}: archivo '{name}' no existe")
            continue
        size = path.stat().st_size
        check(info.get("bytes") == size,
              f"{layer}.bytes = {info.get('bytes')} == {size} (real)")
        if name in counts and name in data:
            real_n = counts[name]
            check(info.get("features") == real_n,
                  f"{layer}.features = {info.get('features')} == {real_n} (real)")
        has_popup = isinstance(info.get("popup"), list) and info["popup"]
        check(has_popup, f"{layer}: popup definido")
        has_color = isinstance(info.get("color"), str) and info["color"].startswith("#")
        check(has_color, f"{layer}: color definido")

    tot = manifest.get("totals", {})
    total_feats_manifest = sum(info.get("features", 0) for info in layers.values()
                               if isinstance(info, dict))
    check(tot.get("features") == total_feats_manifest,
          f"totals.features = {tot.get('features')} == suma {total_feats_manifest}")
    total_bytes_manifest = sum(info.get("bytes", 0) for info in layers.values()
                               if isinstance(info, dict))
    check(tot.get("bytes") == total_bytes_manifest,
          f"totals.bytes = {tot.get('bytes')} == suma {total_bytes_manifest}")
    print()

    # ------------------------------------------------------------------
    # Resultado final
    # ------------------------------------------------------------------
    if failures:
        print(f"VALIDACIÓN: [FALLA] {len(failures)} comprobaciones fallidas")
        for msg in failures:
            print(f"  - {msg}")
        return 1
    print("VALIDACIÓN: [OK] todos los comprobantes pasaron")
    return 0


if __name__ == "__main__":
    sys.exit(main())
