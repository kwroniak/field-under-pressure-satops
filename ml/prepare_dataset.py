import argparse
from datetime import date, timedelta
import hashlib
from pathlib import Path
import re
import sys
from typing import Iterable

import duckdb
import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.transform import xy as transform_xy
from shapely.geometry import Point, box

if __package__ in (None, ""):
    _repo_root = str(Path(__file__).resolve().parent.parent)
    if _repo_root not in sys.path:
        sys.path.insert(0, _repo_root)

from ml.config import (
    DEFAULT_DATA_DIR,
    DEFAULT_PIXEL_SEED,
    DEFAULT_PIXELS_PER_FIELD,
    MVP_CROP_CODE_TO_NAME,
    WEATHER_COLS,
)


def _map_crop_name(crop_code_val) -> str:
    if pd.isna(crop_code_val):
        return "inne"
    try:
        return MVP_CROP_CODE_TO_NAME.get(int(round(float(crop_code_val))), "inne")
    except (TypeError, ValueError):
        return "inne"


def build_fields_master(
    fields_crops_geojson: str | Path = "bk/fields_crops.geojson",
    soil_profiles_parquet: str | Path = Path("data/soil/fields_soil_profiles.parquet"),
    out_path: str | Path = DEFAULT_DATA_DIR / "fields_master.parquet",
    id_col: str = "id",
    min_area_ha: float = 3.0,
    only_mvp_crops: bool = False,
) -> pd.DataFrame:
    """
    Łączy granice + kody upraw z bk/assign_crops.py (fields_crops.geojson)
    z profilami glebowymi z kw/soil.py (data/soil/fields_soil_profiles.parquet).
    """
    gdf = gpd.read_file(fields_crops_geojson)
    if id_col and id_col in gdf.columns:
        gdf["field_id"] = gdf[id_col].astype(str)
    else:
        gdf["field_id"] = [f"field_{i}" for i in range(len(gdf))]

    if "crop_code" in gdf.columns:
        crop_code = pd.to_numeric(gdf["crop_code"], errors="coerce")
    else:
        crop_code = pd.Series(np.nan, index=gdf.index, dtype="float64")

    crops_df = pd.DataFrame(
        {
            "field_id": gdf["field_id"],
            "crop_code": crop_code,
            "crop": [_map_crop_name(v) for v in crop_code],
        }
    )

    soil_df = pd.read_parquet(soil_profiles_parquet)
    soil_df["field_id"] = soil_df["field_id"].astype(str)
    soil_df = soil_df.drop(columns=[c for c in ("crop", "crop_code") if c in soil_df.columns])

    merged = soil_df.merge(crops_df, on="field_id", how="inner")
    merged = merged[merged["area_ha"] >= min_area_ha].copy()
    if only_mvp_crops:
        merged = merged[merged["crop"] != "inne"].copy()

    ordered_cols = [
        "field_id",
        "area_ha",
        "centroid_lat",
        "centroid_lon",
        "crop_code",
        "crop",
        "sand_pct",
        "silt_pct",
        "clay_pct",
        "ph",
        "om",
        "cec",
        "bulk_density",
        "band_ph",
        "band_om",
        "band_cec",
        "soil_variability",
        "permeability",
        "water_retention",
        "wilting_point",
        "field_capacity",
        "awc_mm_per_m",
        "soilTexture",
    ]
    present_cols = [c for c in ordered_cols if c in merged.columns]
    out = merged[present_cols].sort_values("field_id").reset_index(drop=True)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(out_path, index=False)
    print(f"[ML PREP] Zapisano fields_master ({len(out)} pól) -> {out_path}")
    return out


def parse_date_from_filename(path: str | Path) -> str:
    """
    Wyciąga datę YYYY-MM-DD z nazwy pliku GeoTIFF (np. scene_2024-06-24.tif
    lub S2A_33UWU_20220624_0_L2A.tif).
    """
    name = Path(path).name
    m_dash = re.search(r"(20\d{2})[-_](\d{2})[-_](\d{2})", name)
    if m_dash:
        y, m, d = map(int, m_dash.groups())
        return date(y, m, d).isoformat()

    m_compact = re.search(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)", name)
    if m_compact:
        y, m, d = map(int, m_compact.groups())
        return date(y, m, d).isoformat()

    raise ValueError(
        f"Nie udało się odczytać daty YYYY-MM-DD ani YYYYMMDD z nazwy pliku '{name}'. "
        "Przekaż listę krotek (date_str, path) lub dodaj datę do nazwy pliku."
    )


def _normalize_tiff_inputs(
    tiff_inputs: str | Path | Iterable[str | Path | tuple[str, str | Path]],
) -> list[tuple[str, Path]]:
    if isinstance(tiff_inputs, (str, Path)):
        tdir = Path(tiff_inputs)
        paths = sorted(list(tdir.glob("*.tif")) + list(tdir.glob("*.tiff")))
        return [(parse_date_from_filename(p), p) for p in paths]

    normalized: list[tuple[str, Path]] = []
    for item in tiff_inputs:
        if isinstance(item, (tuple, list)) and len(item) == 2:
            d_str = date.fromisoformat(str(item[0]).strip()).isoformat()
            normalized.append((d_str, Path(item[1])))
        else:
            p = Path(item)
            normalized.append((parse_date_from_filename(p), p))
    return normalized


def _band_index_map(src: rasterio.DatasetReader) -> dict[str, int]:
    return {
        (src.descriptions[i] or "").strip().lower(): i + 1
        for i in range(src.count)
        if src.descriptions[i]
    }


def _ndvi_ndmi_from_sample(vals: np.ndarray, has_precomputed: bool) -> tuple[float, float]:
    """Zwraca (ndvi, ndmi) z wektora sample(); NaN gdy brak danych."""
    v = np.asarray(vals, dtype=np.float64).ravel()
    if has_precomputed:
        if v.size < 2 or not np.all(np.isfinite(v[:2])):
            return float("nan"), float("nan")
        return float(np.clip(v[0], -1.0, 1.0)), float(np.clip(v[1], -1.0, 1.0))

    if v.size < 3:
        return float("nan"), float("nan")
    red, nir, swir = v[0], v[1], v[2]
    if red == 0 or nir == 0 or swir == 0:
        return float("nan"), float("nan")
    if not (np.isfinite(red) and np.isfinite(nir) and np.isfinite(swir)):
        return float("nan"), float("nan")
    d_ndvi = nir + red
    d_ndmi = nir + swir
    ndvi = (nir - red) / d_ndvi if d_ndvi != 0 else float("nan")
    ndmi = (nir - swir) / d_ndmi if d_ndmi != 0 else float("nan")
    if not (np.isfinite(ndvi) and np.isfinite(ndmi)):
        return float("nan"), float("nan")
    return float(np.clip(ndvi, -1.0, 1.0)), float(np.clip(ndmi, -1.0, 1.0))


def _sample_points_in_polygon(
    geom,
    n_points: int,
    rng: np.random.Generator,
    max_tries_factor: int = 80,
) -> list[tuple[float, float]]:
    """Losuje punkty WGS84 wewnątrz poligonu (rejection sampling w bbox)."""
    if geom is None or geom.is_empty:
        return []
    minx, miny, maxx, maxy = geom.bounds
    if not np.isfinite([minx, miny, maxx, maxy]).all() or maxx <= minx or maxy <= miny:
        return []

    pts: list[tuple[float, float]] = []
    max_tries = max(n_points * max_tries_factor, n_points + 20)
    for _ in range(max_tries):
        if len(pts) >= n_points:
            break
        x = float(rng.uniform(minx, maxx))
        y = float(rng.uniform(miny, maxy))
        if geom.contains(Point(x, y)):
            pts.append((x, y))

    if len(pts) < n_points:
        # Fallback: centroid (+ lekkie jittery w bbox, jeśli centroid w poligonie)
        c = geom.representative_point()
        while len(pts) < n_points:
            jx = float(np.clip(c.x + rng.normal(0, (maxx - minx) * 0.05), minx, maxx))
            jy = float(np.clip(c.y + rng.normal(0, (maxy - miny) * 0.05), miny, maxy))
            p = Point(jx, jy)
            if geom.contains(p):
                pts.append((jx, jy))
            elif geom.contains(c):
                pts.append((float(c.x), float(c.y)))
            else:
                break
    return pts[:n_points]


def _build_pixel_catalog(
    gdf_wgs84: gpd.GeoDataFrame,
    pixels_per_field: int,
    seed: int,
) -> pd.DataFrame:
    """Stały katalog pikseli (lon/lat) per pole — te same punkty we wszystkich scenach."""
    rows: list[dict] = []
    for field_row in gdf_wgs84.itertuples():
        fid = str(field_row.field_id)
        # Deterministyczny RNG per pole → powtarzalne piksele między uruchomieniami
        digest = hashlib.md5(f"{fid}:{int(seed)}".encode("utf-8")).hexdigest()
        field_seed = int(digest[:8], 16)
        rng = np.random.default_rng(field_seed)
        pts = _sample_points_in_polygon(field_row.geometry, pixels_per_field, rng)
        for i, (lon, lat) in enumerate(pts):
            rows.append(
                {
                    "pixel_id": f"{fid}__px{i}",
                    "field_id": fid,
                    "pixel_idx": i,
                    "lon": round(float(lon), 7),
                    "lat": round(float(lat), 7),
                }
            )
    return pd.DataFrame(rows)


def extract_satellite_indices_from_tiffs(
    fields_geojson: str | Path,
    tiff_inputs: str | Path | Iterable[str | Path | tuple[str, str | Path]],
    out_path: str | Path = DEFAULT_DATA_DIR / "satellite_indices.parquet",
    id_col: str = "id",
    pixels_per_field: int = DEFAULT_PIXELS_PER_FIELD,
    pixel_seed: int = DEFAULT_PIXEL_SEED,
    min_valid_ratio: float = 0.5,
) -> pd.DataFrame:
    """
    Wyciąga NDVI i NDMI **per piksel** (próbka stałych punktów w każdym polu)
    z GeoTIFF-ów Sentinel-2 (pasma NDVI/NDMI albo raw red/nir/swir16).

    Schemat wyjścia: pixel_id, field_id, lon, lat, date, ndvi, ndmi.
    Zachmurzony / nodata piksel w danej dacie jest pomijany (brak wiersza).
    `min_valid_ratio` dotyczy udziału poprawnych próbek pikseli w polu w danej scenie
    — poniżej progu cały dzień dla pola jest odrzucany.
    """
    gdf = gpd.read_file(fields_geojson)
    if id_col and id_col in gdf.columns:
        gdf["field_id"] = gdf[id_col].astype(str)
    else:
        gdf["field_id"] = [f"field_{i}" for i in range(len(gdf))]
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    gdf_wgs = gdf.to_crs("EPSG:4326")

    pixels_per_field = max(1, int(pixels_per_field))
    catalog = _build_pixel_catalog(gdf_wgs, pixels_per_field, pixel_seed)
    if catalog.empty:
        raise ValueError("Nie udało się wylosować żadnego piksela w poligonach pól.")

    items = _normalize_tiff_inputs(tiff_inputs)
    rows: list[dict] = []

    for obs_date, tif_path in items:
        with rasterio.open(tif_path) as src:
            desc_map = _band_index_map(src)
            has_precomputed = "ndvi" in desc_map and "ndmi" in desc_map
            has_raw = {"red", "nir", "swir16"}.issubset(desc_map)
            if not has_precomputed and not has_raw:
                raise ValueError(
                    f"Plik {tif_path} musi zawierać opisane pasma ('NDVI', 'NDMI') "
                    "lub ('red', 'nir', 'swir16')."
                )
            band_indexes = (
                [desc_map["ndvi"], desc_map["ndmi"]]
                if has_precomputed
                else [desc_map["red"], desc_map["nir"], desc_map["swir16"]]
            )

            # Punkty katalogu → CRS rastra
            pts_wgs = gpd.GeoDataFrame(
                catalog,
                geometry=[Point(xy) for xy in zip(catalog["lon"], catalog["lat"])],
                crs="EPSG:4326",
            ).to_crs(src.crs)
            coords = [(float(g.x), float(g.y)) for g in pts_wgs.geometry]
            raster_box = box(*src.bounds)

            samples = list(src.sample(coords, indexes=band_indexes))
            day_rows: list[dict] = []
            valid_by_field: dict[str, list[bool]] = {}

            for meta, geom_pt, vals in zip(catalog.itertuples(index=False), pts_wgs.geometry, samples):
                fid = str(meta.field_id)
                valid_by_field.setdefault(fid, [])
                if geom_pt is None or geom_pt.is_empty or not raster_box.contains(geom_pt):
                    valid_by_field[fid].append(False)
                    continue
                ndvi_val, ndmi_val = _ndvi_ndmi_from_sample(vals, has_precomputed)
                ok = bool(np.isfinite(ndvi_val) and np.isfinite(ndmi_val))
                valid_by_field[fid].append(ok)
                if not ok:
                    continue
                day_rows.append(
                    {
                        "pixel_id": meta.pixel_id,
                        "field_id": fid,
                        "lon": float(meta.lon),
                        "lat": float(meta.lat),
                        "date": obs_date,
                        "ndvi": round(ndvi_val, 4),
                        "ndmi": round(ndmi_val, 4),
                    }
                )

            # Odrzuć dni, w których pole jest mocno zachmurzone
            accepted_fields = {
                fid
                for fid, flags in valid_by_field.items()
                if flags and (sum(flags) / len(flags)) >= float(min_valid_ratio)
            }
            rows.extend(r for r in day_rows if r["field_id"] in accepted_fields)

    cols = ["pixel_id", "field_id", "lon", "lat", "date", "ndvi", "ndmi"]
    out = pd.DataFrame(rows, columns=cols)
    if not out.empty:
        out = (
            out.sort_values(["pixel_id", "date"])
            .drop_duplicates(subset=["pixel_id", "date"], keep="last")
            .reset_index(drop=True)
        )

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(out_path, index=False)
    n_px = out["pixel_id"].nunique() if not out.empty else 0
    print(
        f"[ML PREP] Zapisano satellite_indices per-piksel "
        f"({len(out)} obserwacji, {n_px} pikseli, {pixels_per_field}/pole) -> {out_path}"
    )
    return out


def pixel_coords_from_raster(
    transform,
    row: int,
    col: int,
) -> tuple[float, float]:
    """Środek piksela (x, y) w CRS rastra — helper do debugowania."""
    xs, ys = transform_xy(transform, [row], [col], offset="center")
    return float(xs[0]), float(ys[0])


def _map_fields_to_nearest_grid(
    fields_df: pd.DataFrame,
    grid_df: pd.DataFrame,
    grid_key_cols: list[str],
) -> pd.DataFrame:
    cols = list(dict.fromkeys([*grid_key_cols, "lat", "lon"]))
    g_pts = grid_df[cols].drop_duplicates().reset_index(drop=True)
    g_lats = g_pts["lat"].to_numpy(dtype=np.float64)
    g_lons = g_pts["lon"].to_numpy(dtype=np.float64)

    mapped_rows = []
    for row in fields_df.itertuples():
        cos_lat = float(np.cos(np.radians(row.centroid_lat)))
        dist2 = (g_lats - row.centroid_lat) ** 2 + ((g_lons - row.centroid_lon) * cos_lat) ** 2
        best = g_pts.iloc[int(np.argmin(dist2))]
        rec = {"field_id": row.field_id}
        for col in grid_key_cols:
            val = best[col]
            rec[col] = val.item() if hasattr(val, "item") else val
        mapped_rows.append(rec)
    return pd.DataFrame(mapped_rows)


def build_weather_table_from_bayer(
    fields_master_parquet: str | Path,
    bayer_weather_parquets: str | Path | list[str | Path],
    weather_grids_parquet: str | Path,
    imerg_daily_parquet: str | Path | None = None,
    out_path: str | Path = DEFAULT_DATA_DIR / "weather_daily.parquet",
    start_date: str | None = None,
    end_date: str | None = None,
) -> pd.DataFrame:
    """
    Buduje kanoniczną tabelę pogody dziennej dla pól na bazie historycznych
    plików Bayer (2020-2025). Obsługuje przypadek braku kolumny total_precipitation
    w plikach Bayera, podpinając wtedy opady satelitarne IMERG (imerg_precipitation_daily).
    """
    fields_df = pd.read_parquet(fields_master_parquet)
    grids_df = pd.read_parquet(weather_grids_parquet)
    field_grid_df = _map_fields_to_nearest_grid(fields_df, grids_df, ["grid_id"])

    if isinstance(bayer_weather_parquets, (str, Path)):
        p = Path(bayer_weather_parquets)
        parquet_list = [str(f) for f in sorted(p.rglob("*.parquet"))] if p.is_dir() else [str(p)]
    else:
        parquet_list = [str(Path(f)) for f in bayer_weather_parquets]

    if not parquet_list:
        raise FileNotFoundError("Brak plików Parquet z danymi pogodowymi Bayera.")

    con = duckdb.connect()
    con.register("field_grid_map", field_grid_df)

    bayer_cols = set(
        con.execute("DESCRIBE SELECT * FROM read_parquet($1)", [parquet_list[0]])
        .df()["column_name"]
        .tolist()
    )
    has_bayer_precip = "total_precipitation" in bayer_cols

    imerg_join = ""
    if imerg_daily_parquet is not None:
        imerg_p = Path(imerg_daily_parquet).as_posix()
        imerg_join = (
            f"LEFT JOIN read_parquet('{imerg_p}') AS i "
            "ON b.grid_id = i.grid_id AND CAST(b.date AS DATE) = CAST(i.date AS DATE)"
        )
        if has_bayer_precip:
            precip_expr = "COALESCE(CAST(b.total_precipitation AS DOUBLE), CAST(i.total_precipitation AS DOUBLE), 0.0)"
        else:
            precip_expr = "COALESCE(CAST(i.total_precipitation AS DOUBLE), 0.0)"
    else:
        if has_bayer_precip:
            precip_expr = "COALESCE(CAST(b.total_precipitation AS DOUBLE), 0.0)"
        else:
            print(
                "[UWAGA] W plikach Bayera brakuje kolumny total_precipitation i nie podano "
                "imerg_daily_parquet — wypełniam precip_sum_mm zerami."
            )
            precip_expr = "0.0"

    where_clauses = []
    params: list = [parquet_list]
    if start_date is not None:
        where_clauses.append("CAST(b.date AS DATE) >= CAST($2 AS DATE)")
        params.append(start_date)
    if end_date is not None:
        idx = len(params) + 1
        where_clauses.append(f"CAST(b.date AS DATE) <= CAST(${idx} AS DATE)")
        params.append(end_date)
    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    sql = f"""
        SELECT
            m.field_id,
            strftime(CAST(b.date AS DATE), '%Y-%m-%d') AS date,
            CAST(b.avg_temperature AS DOUBLE) AS temp_mean_c,
            CAST(b.min_temperature AS DOUBLE) AS temp_min_c,
            CAST(b.max_temperature AS DOUBLE) AS temp_max_c,
            {precip_expr} AS precip_sum_mm,
            CAST(b.avg_soil_moisture_level_1 AS DOUBLE) AS sm_l1,
            CAST(b.avg_soil_moisture_level_2 AS DOUBLE) AS sm_l2,
            CAST(b.avg_soil_moisture_level_3 AS DOUBLE) AS sm_l3
        FROM field_grid_map AS m
        JOIN read_parquet($1) AS b
          ON m.grid_id = b.grid_id
        {imerg_join}
        {where_sql}
        ORDER BY m.field_id, date
    """
    out = con.execute(sql, params).df()
    out = out[["field_id", "date", *WEATHER_COLS]]

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(out_path, index=False)
    print(f"[ML PREP] Zapisano weather_daily z Bayera ({len(out)} wierszy) -> {out_path}")
    return out


def build_weather_table_from_open_meteo(
    fields_master_parquet: str | Path,
    open_meteo_parquet: str | Path,
    out_path: str | Path = DEFAULT_DATA_DIR / "weather_daily_open_meteo.parquet",
) -> pd.DataFrame:
    """
    Mapuje dzienne dane Open-Meteo (z kw/meteo.py) na najbliższe punkty siatki
    dla każdego pola i zapisuje w tym samym schemacie co Bayer.
    """
    fields_df = pd.read_parquet(fields_master_parquet)
    om_df = pd.read_parquet(open_meteo_parquet)
    if "sm_l3" not in om_df.columns and "sm_l2" in om_df.columns:
        print("[INFO] Brak kolumny sm_l3 w danych Open-Meteo — podstawiam sm_l2 jako przybliżenie głębszej warstwy.")
        om_df = om_df.copy()
        om_df["sm_l3"] = om_df["sm_l2"]
    field_pt_df = _map_fields_to_nearest_grid(fields_df, om_df, ["lat", "lon"])

    merged = field_pt_df.merge(om_df, on=["lat", "lon"], how="inner")
    out = merged[["field_id", "date", *WEATHER_COLS]].sort_values(["field_id", "date"]).reset_index(drop=True)

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_parquet(out_path, index=False)
    print(f"[ML PREP] Zapisano weather_daily z Open-Meteo ({len(out)} wierszy) -> {out_path}")
    return out


def generate_synthetic_demo_dataset(
    out_dir: str | Path = DEFAULT_DATA_DIR / "demo",
    n_fields: int = 12,
    n_days: int = 140,
    pixels_per_field: int = DEFAULT_PIXELS_PER_FIELD,
    seed: int = 42,
) -> Path:
    """
    Generuje kompletny syntetyczny zbiór treningowy (fields_master, weather_daily,
    satellite_indices per-piksel) zgodny ze schematem produkcyjnym do testów end-to-end.
    """
    rng = np.random.default_rng(seed)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    pixels_per_field = max(1, int(pixels_per_field))

    crops = ["pszenica", "kukurydza", "rzepak"]
    crop_codes = {"pszenica": 1110, "kukurydza": 1130, "rzepak": 1430}

    field_rows = []
    for i in range(n_fields):
        crop = crops[i % len(crops)]
        sand = float(rng.uniform(35.0, 75.0))
        clay = float(rng.uniform(8.0, 25.0))
        silt = round(100.0 - sand - clay, 1)
        is_sandy = sand >= 65.0
        field_rows.append(
            {
                "field_id": f"demo_field_{i}",
                "area_ha": round(float(rng.uniform(4.0, 25.0)), 2),
                "centroid_lat": round(52.6 + float(rng.uniform(-0.04, 0.04)), 6),
                "centroid_lon": round(20.8 + float(rng.uniform(-0.08, 0.08)), 6),
                "crop_code": crop_codes[crop],
                "crop": crop,
                "sand_pct": round(sand, 1),
                "silt_pct": silt,
                "clay_pct": round(clay, 1),
                "ph": round(float(rng.uniform(5.4, 7.1)), 2),
                "om": round(float(rng.uniform(2.5, 5.5)), 2),
                "cec": round(float(rng.uniform(12.0, 22.0)), 2),
                "bulk_density": round(float(rng.uniform(1.25, 1.48)), 2),
                "band_ph": "moderate",
                "band_om": "high",
                "band_cec": "moderate",
                "permeability": "wysoka" if is_sandy else "srednia",
                "water_retention": "niska" if is_sandy else "srednia",
                "wilting_point": 0.08 if is_sandy else 0.13,
                "field_capacity": 0.18 if is_sandy else 0.28,
                "awc_mm_per_m": 100.0 if is_sandy else 150.0,
                "soilTexture": "Sandy Loam" if is_sandy else "Loam",
            }
        )
    fields_df = pd.DataFrame(field_rows)
    fields_df.to_parquet(out_dir / "fields_master.parquet", index=False)

    start_d = date(2024, 3, 15)
    weather_rows = []
    sat_rows = []

    for f_row in field_rows:
        fid = f_row["field_id"]
        crop = f_row["crop"]
        wp, fc = f_row["wilting_point"], f_row["field_capacity"]
        sm1 = 0.5 * (wp + fc)
        sm2 = 0.55 * (wp + fc)
        sm3 = 0.6 * (wp + fc)
        phase = 0.0 if crop == "pszenica" else (15.0 if crop == "kukurydza" else -10.0)
        clon, clat = f_row["centroid_lon"], f_row["centroid_lat"]

        # Stałe piksele wokół centroidu (syntetyczna „siatka” w polu)
        pixel_meta = []
        for px_i in range(pixels_per_field):
            dlon = float(rng.uniform(-0.0015, 0.0015))
            dlat = float(rng.uniform(-0.0010, 0.0010))
            bias_ndvi = float(rng.normal(0.0, 0.04))
            bias_ndmi = float(rng.normal(0.0, 0.03))
            pixel_meta.append(
                {
                    "pixel_id": f"{fid}__px{px_i}",
                    "lon": round(clon + dlon, 7),
                    "lat": round(clat + dlat, 7),
                    "bias_ndvi": bias_ndvi,
                    "bias_ndmi": bias_ndmi,
                }
            )

        for d_idx in range(n_days):
            cur_d = start_d + timedelta(days=d_idx)
            doy = cur_d.timetuple().tm_yday
            temp_mean = 12.0 + 8.0 * np.sin(2 * np.pi * (doy - 95) / 365.0) + float(rng.normal(0, 1.8))
            temp_min = temp_mean - float(rng.uniform(3.0, 6.0))
            temp_max = temp_mean + float(rng.uniform(3.5, 7.0))
            precip = float(rng.exponential(3.5)) if rng.random() < 0.25 else 0.0

            sm1 = float(np.clip(sm1 + 0.008 * precip - 0.0025 * max(temp_mean, 0.0), wp * 0.85, fc * 1.1))
            sm2 = float(np.clip(0.92 * sm2 + 0.08 * sm1 + 0.002 * precip, wp * 0.9, fc * 1.05))
            sm3 = float(np.clip(0.96 * sm3 + 0.04 * sm2, wp, fc))

            weather_rows.append(
                {
                    "field_id": fid,
                    "date": cur_d.isoformat(),
                    "temp_mean_c": round(temp_mean, 2),
                    "temp_min_c": round(temp_min, 2),
                    "temp_max_c": round(temp_max, 2),
                    "precip_sum_mm": round(precip, 2),
                    "sm_l1": round(sm1, 3),
                    "sm_l2": round(sm2, 3),
                    "sm_l3": round(sm3, 3),
                }
            )

            # Nieregularne obserwacje Sentinel-2 co ~5 dni z losowym zachmurzeniem
            if d_idx % 5 == 0 and rng.random() > 0.22:
                moisture_norm = (sm2 - wp) / max(fc - wp, 0.05)
                base_ndvi = float(
                    np.clip(
                        0.30 + 0.45 * np.exp(-((d_idx - 75 - phase) / 42.0) ** 2) + 0.08 * (moisture_norm - 0.5),
                        0.05,
                        0.92,
                    )
                )
                base_ndmi = float(
                    np.clip(
                        -0.05 + 0.35 * np.exp(-((d_idx - 70 - phase) / 40.0) ** 2) + 0.16 * (moisture_norm - 0.5),
                        -0.4,
                        0.65,
                    )
                )
                for pm in pixel_meta:
                    # Lekkie zachmurzenie per piksel
                    if rng.random() < 0.08:
                        continue
                    ndvi = float(np.clip(base_ndvi + pm["bias_ndvi"] + rng.normal(0, 0.012), 0.05, 0.92))
                    ndmi = float(np.clip(base_ndmi + pm["bias_ndmi"] + rng.normal(0, 0.012), -0.4, 0.65))
                    sat_rows.append(
                        {
                            "pixel_id": pm["pixel_id"],
                            "field_id": fid,
                            "lon": pm["lon"],
                            "lat": pm["lat"],
                            "date": cur_d.isoformat(),
                            "ndvi": round(ndvi, 4),
                            "ndmi": round(ndmi, 4),
                        }
                    )

    pd.DataFrame(weather_rows).to_parquet(out_dir / "weather_daily.parquet", index=False)
    pd.DataFrame(sat_rows).to_parquet(out_dir / "satellite_indices.parquet", index=False)
    n_px = len({r["pixel_id"] for r in sat_rows})
    print(
        f"[ML DEMO] Wygenerowano dane demo ({n_fields} pól x {pixels_per_field} px "
        f"= {n_px} pikseli, {n_days} dni) -> {out_dir}"
    )
    return out_dir


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Przygotowanie tabeli fields_master lub syntetycznych danych --demo dla ML."
    )
    parser.add_argument("--demo", action="store_true", help="Wygeneruj syntetyczny zestaw demo w data/ml/demo.")
    parser.add_argument("--out-dir", type=Path, default=None, help="Katalog wyjściowy (dla --demo lub build).")
    args = parser.parse_args()

    if args.demo:
        target_dir = args.out_dir or (DEFAULT_DATA_DIR / "demo")
        generate_synthetic_demo_dataset(out_dir=target_dir)
    else:
        crops_geojson = Path("bk/fields_crops.geojson")
        soil_parquet = Path("data/soil/fields_soil_profiles.parquet")
        if crops_geojson.exists() and soil_parquet.exists():
            out_master = (args.out_dir or DEFAULT_DATA_DIR) / "fields_master.parquet"
            fm = build_fields_master(
                fields_crops_geojson=crops_geojson,
                soil_profiles_parquet=soil_parquet,
                out_path=out_master,
            )
            print("Kształt fields_master:", fm.shape)
            print("Uprawy:", fm["crop"].value_counts(dropna=False).to_dict())
        else:
            print(
                "[INFO] Brak wymaganych plików (bk/fields_crops.geojson i/lub data/soil/fields_soil_profiles.parquet).\n"
                "Najpierw uruchom `.venv/bin/python kw/soil.py` "
                "albo użyj `--demo`: `.venv/bin/python ml/prepare_dataset.py --demo`."
            )
