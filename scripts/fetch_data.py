#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Pipeline de datos para el Mapa Interactivo de Bogotá.

Descarga las capas definidas en scripts/sources.yaml, las limpia, simplifica,
calcula métricas geoespaciales y las publica en site/data/ junto con manifest.json.

Uso:
    python scripts/fetch_data.py [--layer nombre ...] [--out-dir site/data] [--no-cache]
"""

import argparse
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests
import yaml
from shapely import make_valid
from shapely.geometry import box, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union
from pyproj import Geod, Transformer

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[1]
SOURCES_PATH = ROOT / "scripts" / "sources.yaml"

USER_AGENT = "bogota-mapa-interactivo/1.0"

COLORS = {
    "localidades": "#6a51a3",
    "ciclorrutas": "#1a9850",
    "estaciones_tm": "#d73027",
    "paraderos_sitp": "#4575b4",
    "parques": "#66bd63",
}

GEOM_SHAPELY = {"polygon": "Polygon", "point": "Point"}

GEOD = Geod(ellps="WGS84")

ARCGIS_PAGE_SIZE = 1000


# ---------------------------------------------------------------------------
# Descarga
# ---------------------------------------------------------------------------

def http_get(url, params=None, timeout=60, retries=3):
    """GET con User-Agent propio y reintentos con backoff exponencial."""
    headers = {"User-Agent": USER_AGENT}
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, params=params, headers=headers,
                                timeout=timeout)
            resp.raise_for_status()
            return resp
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < retries:
                wait = 2 ** attempt  # 2s, 4s, ...
                print(f"    intento {attempt}/{retries} falló ({exc}); reintentando en {wait}s")
                time.sleep(wait)
    raise RuntimeError(f"Descarga falló tras {retries} intentos: {url} ({last_exc})")


def fetch_geojson_direct(layer, cfg, settings, raw_dir):
    """Fuentes tipo geojson: descarga directa a un FeatureCollection."""
    filename = f"{layer}.geojson"
    cache_file = raw_dir / filename
    if cache_file.exists():
        with open(cache_file, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and data.get("type") == "FeatureCollection":
            return data, True
        print(f"    aviso: cache inválida para {layer}, se vuelve a descargar")

    resp = http_get(cfg["url"], timeout=settings["timeout"],
                    retries=settings["retries"])
    data = resp.json()
    if not (isinstance(data, dict) and data.get("type") == "FeatureCollection"):
        raise ValueError(f"{layer}: respuesta no es una FeatureCollection")

    raw_dir.mkdir(parents=True, exist_ok=True)
    with open(cache_file, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    return data, False


def fetch_arcgis(layer, cfg, settings, raw_dir):
    """Fuentes tipo arcgis: query paginada con resultOffset/resultRecordCount."""
    filename = f"{layer}.geojson"
    cache_file = raw_dir / filename
    if cache_file.exists():
        with open(cache_file, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and data.get("type") == "FeatureCollection":
            return data, True
        print(f"    aviso: cache inválida para {layer}, se vuelve a descargar")

    params = {
        "where": "1=1",
        "outFields": "*",
        "outSR": "4326",
        "f": "geojson",
        "resultOffset": 0,
        "resultRecordCount": ARCGIS_PAGE_SIZE,
    }
    features = []
    offset = 0
    while True:
        params["resultOffset"] = offset
        resp = http_get(cfg["url"], params=params,
                        timeout=settings["timeout"],
                        retries=settings["retries"])
        page = resp.json()
        if not (isinstance(page, dict) and page.get("type") == "FeatureCollection"):
            raise ValueError(
                f"{layer}: página en offset={offset} no es una FeatureCollection"
            )
        page_feats = page.get("features") or []
        if not page_feats:
            break
        features.extend(page_feats)
        if "exceededTransferLimit" in page:
            if not page["exceededTransferLimit"]:
                break
        elif len(page_feats) < ARCGIS_PAGE_SIZE:
            break
        offset += len(page_feats)
        if offset > 500000:  # guardia de seguridad
            break

    data = {"type": "FeatureCollection", "features": features}
    raw_dir.mkdir(parents=True, exist_ok=True)
    with open(cache_file, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    return data, False


def download_layer(layer, cfg, settings, raw_dir, use_cache):
    """Descarga (o lee cache) y devuelve (features crudos, from_cache)."""
    if not use_cache:
        # --no-cache: forza re-descarga pero mantiene el archivo de crudos al día
        cache_file = raw_dir / f"{layer}.geojson"
        if cache_file.exists():
            cache_file.unlink()
    if cfg["tipo"] == "arcgis":
        return fetch_arcgis(layer, cfg, settings, raw_dir)
    if cfg["tipo"] == "geojson":
        return fetch_geojson_direct(layer, cfg, settings, raw_dir)
    raise ValueError(f"{layer}: tipo de fuente desconocido '{cfg['tipo']}'")


# ---------------------------------------------------------------------------
# Limpieza y transformación
# ---------------------------------------------------------------------------

def fix_geometry(geom, expected_type):
    """make_valid + filtro por tipo esperado. Devuelve geometría o None."""
    if geom is None or geom.is_empty:
        return None
    if not geom.is_valid:
        geom = make_valid(geom)
    if geom.is_empty:
        return None
    want_polys = expected_type == "Polygon"
    want_points = expected_type == "Point"

    # GeometryCollection: conservar solo las partes del tipo esperado
    if geom.geom_type == "GeometryCollection":
        parts = []
        for sub in geom.geoms:
            if geom_matches(sub, expected_type):
                parts.append(sub)
        if not parts:
            return None
        geom = unary_union(parts) if want_polys else parts[0]
        if geom.is_empty:
            return None
    if not geom_matches(geom, expected_type):
        return None
    return geom


def geom_matches(geom, expected_type):
    gt = geom.geom_type
    if expected_type == "Polygon":
        return gt in ("Polygon", "MultiPolygon")
    if expected_type == "Point":
        return gt in ("Point", "MultiPoint")
    return False


def round_coords(obj, ndigits):
    """Redondeo recursivo de coordenadas en la estructura GeoJSON."""
    if isinstance(obj, (list, tuple)):
        return [round_coords(item, ndigits) for item in obj]
    if isinstance(obj, float):
        return round(obj, ndigits)
    return obj


def clean_value(value):
    """Limpieza de tipos: strings recortados, vacíos/NaN -> None, números intactos."""
    if isinstance(value, str):
        value = value.strip()
        if value == "":
            return None
        return value
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    # cualquier otro tipo (dict, list) se serializa tal cual
    return value


def clean_properties(raw_props, campos):
    """Renombra según el mapa `campos` y descarta el resto."""
    props = {}
    for src, dst in campos.items():
        if src in raw_props:
            props[dst] = clean_value(raw_props[src])
        else:
            props[dst] = None
    return props


def transform_layer(layer, cfg, settings, raw_features):
    """Convierte features crudos en features limpios (props renombradas)."""
    expected_shapely = GEOM_SHAPELY[cfg["geometry"]]
    ndigits = int(settings["coordinate_precision"])
    tolerance = float(cfg.get("simplify") or 0)
    campos = cfg.get("campos") or {}

    # Transformación de CRS origen -> EPSG:4326 si la fuente lo requiere
    transformer = None
    source_crs = cfg.get("source_crs")
    if source_crs and str(source_crs).upper() not in ("EPSG:4326", "AUTO"):
        transformer = Transformer.from_crs(source_crs, "EPSG:4326",
                                           always_xy=True)

    out = []
    dropped = 0
    for feat in raw_features:
        props_raw = feat.get("properties") or {}
        geom_raw = feat.get("geometry")
        if not geom_raw:
            dropped += 1
            continue
        try:
            geom = shape(geom_raw)
        except Exception:  # noqa: BLE001
            dropped += 1
            continue
        if transformer is not None:
            try:
                geom = shapely_transform(transformer.transform, geom)
            except Exception:  # noqa: BLE001
                dropped += 1
                continue
        geom = fix_geometry(geom, expected_shapely)
        if geom is None or geom.is_empty:
            dropped += 1
            continue
        if tolerance > 0:
            simplified = geom.simplify(tolerance, preserve_topology=True)
            if not simplified.is_empty:
                geom = simplified
        # Recorte opcional a la caja de Bogotá (contrato de validación)
        clip_bbox = cfg.get("clip_bbox")
        if clip_bbox:
            bbox_geom = box(min(clip_bbox[0], clip_bbox[2]),
                            min(clip_bbox[1], clip_bbox[3]),
                            max(clip_bbox[0], clip_bbox[2]),
                            max(clip_bbox[1], clip_bbox[3]))
            try:
                clipped = geom.intersection(bbox_geom)
            except Exception:  # noqa: BLE001
                clipped = None
            if clipped is None or clipped.is_empty:
                dropped += 1
                continue
            if not geom_matches(clipped, expected_shapely):
                clipped = fix_geometry(clipped, expected_shapely)
                if clipped is None or clipped.is_empty:
                    dropped += 1
                    continue
            geom = clipped
        props = clean_properties(props_raw, campos)

        geom_json = round_coords(mapping(geom), ndigits)
        out.append({"type": "Feature", "properties": props,
                    "geometry": geom_json})
    if dropped:
        print(f"    {layer}: {dropped} features descartados (geometría nula/vacía)")
    return out


# ---------------------------------------------------------------------------
# Métricas geoespaciales
# ---------------------------------------------------------------------------

def area_ha(geom: BaseGeometry):
    try:
        area_m2, _ = GEOD.geometry_area_perimeter(geom)
        area = abs(area_m2) / 10000.0
        if math.isnan(area) or math.isinf(area):
            return None
        return round(area, 1)
    except Exception:  # noqa: BLE001
        return None


def length_km(geom: BaseGeometry):
    try:
        km = GEOD.geometry_length(geom) / 1000.0
        if math.isnan(km) or math.isinf(km):
            return None
        return round(km, 2)
    except Exception:  # noqa: BLE001
        return None


def add_computed_props(layer, features, ctx):
    """Añade métricas calculadas según la capa."""
    if layer == "localidades":
        # cruce: n_parques y km_ciclorruta + area_ha
        loc_geoms = [(shape(f["geometry"]), f["properties"]) for f in features]
        for loc_geom, props in loc_geoms:
            props["area_ha"] = area_ha(loc_geom)
        parks_pts = [shape(f["geometry"]).representative_point()
                     for f in ctx.get("parques", [])]
        for loc_geom, props in loc_geoms:
            props["n_parques"] = sum(1 for pt in parks_pts if loc_geom.contains(pt))
        bike_lens = []
        bike_geoms = []
        for f in ctx.get("ciclorrutas", []):
            geom = shape(f["geometry"])
            bike_geoms.append(geom)
            bike_lens.append(length_km(geom))
        for loc_geom, props in loc_geoms:
            km = 0.0
            for geom, km_len in zip(bike_geoms, bike_lens):
                if km_len is None:
                    continue
                try:
                    if loc_geom.intersects(geom):
                        # suma una única vez por feature de ciclorruta
                        km += km_len
                except Exception:  # noqa: BLE001
                    continue
            props["km_ciclorruta"] = round(km, 2)
    elif layer == "parques":
        for feat in features:
            geom = shape(feat["geometry"])
            feat["properties"]["area_ha"] = area_ha(geom)
    elif layer == "ciclorrutas":
        for feat in features:
            geom = shape(feat["geometry"])
            feat["properties"]["largo_km"] = length_km(geom)
    return features

def write_minified(path: Path, obj):
    payload = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    data = payload.encode("utf-8")
    path.write_bytes(data)
    return len(data)


def build_manifest(generated, out_dir, sources):
    layers = {}
    total_features = 0
    total_bytes = 0
    for layer in generated:
        cfg = sources["layers"][layer]
        file_path = out_dir / f"{layer}.geojson"
        n = len(file_path and json.loads(file_path.read_text(encoding="utf-8"))["features"])
        size = file_path.stat().st_size
        layers[layer] = {
            "titulo": cfg["titulo"],
            "descripcion": cfg["descripcion"],
            "fuente": cfg["fuente"],
            "archivo": f"{layer}.geojson",
            "geometry": cfg["geometry"],
            "features": n,
            "bytes": size,
            "color": COLORS[layer],
            "popup": cfg["popup"],
        }
        total_features += n
        total_bytes += size

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "crs": "EPSG:4326",
        "layers": layers,
        "totals": {"features": total_features, "bytes": total_bytes},
    }
    return manifest


# ---------------------------------------------------------------------------
# Principal
# ---------------------------------------------------------------------------

def parse_args(argv):
    parser = argparse.ArgumentParser(description="Pipeline de datos del Mapa de Bogotá")
    parser.add_argument("--layer", action="append", dest="layers", metavar="NOMBRE",
                        help="capa a generar (repetible); por defecto todas")
    parser.add_argument("--out-dir", default=None,
                        help="directorio de salida (default: site/data)")
    parser.add_argument("--no-cache", action="store_true",
                        help="fuerza re-descarga ignorando la caché local")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    settings = yaml.safe_load(SOURCES_PATH.read_text(encoding="utf-8"))
    sources = settings
    all_settings = sources["settings"]

    out_dir = Path(args.out_dir) if args.out_dir else ROOT / all_settings["out_dir"]
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    raw_dir = ROOT / all_settings["raw_dir"]

    layer_names = list(sources["layers"].keys())
    requested = args.layers or layer_names
    unknown = [l for l in requested if l not in layer_names]
    if unknown:
        print(f"[FALLA] Capas desconocidas: {', '.join(unknown)}")
        print(f"        Disponibles: {', '.join(layer_names)}")
        return 2

    ok = True
    generated = []
    print(f"Raíz del repo: {ROOT}")
    print(f"Salida: {out_dir}\n")

    # ---------------------------------------------------------------
    # Paso 1: descargar y transformar; las capas base (localidades,
    # ciclorrutas, parques) SIEMPRE se procesan porque alimentan los
    # cruces de localidades.
    # ---------------------------------------------------------------
    ctx = {}
    for layer in layer_names:
        cfg = sources["layers"][layer]
        needed = layer in requested or layer in ("localidades", "ciclorrutas", "parques")
        if not needed:
            continue
        print(f"[{layer}] descargando ({cfg['tipo']})...")
        try:
            raw, from_cache = download_layer(layer, cfg, all_settings, raw_dir,
                                             use_cache=not args.no_cache)
        except Exception as exc:  # noqa: BLE001
            print(f"    [FALLA] descarga: {exc}")
            if layer in requested:
                ok = False
            continue
        print(f"    {'cache' if from_cache else 'red'}: {len(raw['features'])} features")
        feats = transform_layer(layer, cfg, all_settings, raw["features"])
        print(f"    limpios: {len(feats)} features")
        ctx[layer] = feats

    # ---------------------------------------------------------------
    # Paso 2: métricas calculadas (con el contexto ya completo) y salida
    # ---------------------------------------------------------------
    for layer in requested:
        if layer not in ctx:
            continue
        feats = add_computed_props(layer, ctx[layer], ctx)
        target = out_dir / f"{layer}.geojson"
        out_dir.mkdir(parents=True, exist_ok=True)
        size = write_minified(target, {"type": "FeatureCollection",
                                       "features": feats})
        generated.append(layer)
        print(f"[{layer}] escrito: {target} ({size/1024:.1f} KB)")

    # ---------------------------------------------------------------
    # Paso 2: manifest
    # ---------------------------------------------------------------
    if generated:
        manifest = build_manifest(generated, out_dir, sources)
        mpath = out_dir / "manifest.json"
        write_minified(mpath, manifest)
        print(f"\nmanifest: {mpath}")

    print("\n== RESUMEN ==")
    for layer in generated:
        p = out_dir / f"{layer}.geojson"
        n = len(json.loads(p.read_text(encoding="utf-8"))["features"])
        print(f"  [OK] {layer}: {n} features, {p.stat().st_size/1024:.1f} KB")
    missing = [l for l in requested if l not in generated]
    for layer in missing:
        print(f"  [FALLA] {layer}: no se pudo generar")
        ok = False

    return 0 if (ok and generated) else 1


if __name__ == "__main__":
    sys.exit(main())
