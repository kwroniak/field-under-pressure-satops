"""
Wypełnia PostGIS danymi dla Lizmapa: profile glebowe pól + kalendarz 7-dniowy
(4 nawozy x 7 dni) liczony istniejącym silnikiem z soil_bonification.py.

Uruchomienie (z katalogu repo):
    python kw/load_postgis.py                          # prognoza od dziś (listopad = wszystko CZERWONE, zakaz zimowy)
    python kw/load_postgis.py --as-of 2025-04-14       # "wehikuł czasu": 7 dni od podanej daty (Open-Meteo historical)
    python kw/load_postgis.py --min-ha 1.0             # jeśli pól >= 3 ha jest za mało

Tworzy/odświeża tabele:
    public.field_profile   (1 wiersz na pole)
    public.field_calendar  (pole x dzień x nawóz)
oraz widok public.v_fields_info (fields + profil) pod popup.
"""
import argparse
import json
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

sys.path.insert(0, str(Path(__file__).resolve().parent))
from meteo import fetch_batch_daily, get_weather_for_field  # noqa: E402
from soil_bonification import (  # noqa: E402
    FieldSoilProfile,
    evaluate_field_calendar,
    prepare_all_soil_profiles,
)

FERTILIZERS = ["saletra_amonowa", "mocznik_inhibitor", "rsm_32", "saletrosan_26"]
DEFAULT_CROPS = ["pszenica", "kukurydza", "rzepak"]

DDL = """
CREATE TABLE IF NOT EXISTS public.field_profile (
    field_id          integer PRIMARY KEY,
    area_ha           double precision,
    crop              text,
    texture           text,
    sand_pct          double precision,
    silt_pct          double precision,
    clay_pct          double precision,
    ph                double precision,
    klasa_bonitacyjna text,
    bonitation_source text,
    permeability      text,
    water_retention   text,
    as_of             date,
    updated_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.field_calendar (
    id                 serial PRIMARY KEY,
    field_id           integer NOT NULL,
    day                date NOT NULL,
    fertilizer         text NOT NULL,
    crop               text,
    status             text,
    fert_reasons       text,
    irrigation_risk    text,
    irrigation_reasons text,
    temp_mean_c        double precision,
    precip_24h_mm      double precision,
    precip_72h_mm      double precision,
    sm_l1              double precision,
    sm_l2              double precision,
    sm_l3              double precision,
    ndvi               double precision,
    ndmi               double precision,
    UNIQUE (field_id, day, fertilizer)
);
CREATE INDEX IF NOT EXISTS field_calendar_field_idx ON public.field_calendar (field_id);

CREATE OR REPLACE VIEW public.v_fields_info AS
SELECT f.id,
       f.geometry,
       round((ST_Area(ST_Transform(f.geometry, 2180)) / 10000.0)::numeric, 2) AS area_ha_2180,
       p.crop, p.texture, p.ph, p.klasa_bonitacyjna, p.permeability, p.water_retention,
       (SELECT max(CASE c.status WHEN 'CZERWONY' THEN 2 WHEN 'ZOLTY' THEN 1 ELSE 0 END)
          FROM public.field_calendar c WHERE c.field_id = f.id) AS max_risk
FROM public.fields f
JOIN public.field_profile p ON p.field_id = f.id;
"""


def load_fields(conn, min_ha: float) -> gpd.GeoDataFrame:
    sql = """
        SELECT id, crop_type,
               ST_Area(ST_Transform(geometry, 2180)) / 10000.0 AS area_2180,
               ST_Transform(geometry, 4326) AS geom
        FROM public.fields
        WHERE ST_Area(ST_Transform(geometry, 2180)) / 10000.0 >= %s
    """
    gdf = gpd.read_postgis(sql, conn, geom_col="geom", params=(min_ha,))
    gdf = gdf.set_crs("EPSG:4326", allow_override=True)
    print(f"[POLA] {len(gdf)} pól >= {min_ha} ha")
    return gdf


def default_profiles(gdf: gpd.GeoDataFrame) -> pd.DataFrame:
    """Gdy brak plików SoilGrids: średnia gleba, żeby pipeline nie stał."""
    cen = gdf.to_crs("EPSG:2180").geometry.centroid.to_crs("EPSG:4326")
    return pd.DataFrame({
        "field_id": gdf["id"].astype(str),
        "area_ha": gdf["area_2180"].round(2),
        "centroid_lat": cen.y.round(6),
        "centroid_lon": cen.x.round(6),
        "h3_cells_count": 0,
        "sand_pct": np.nan, "silt_pct": np.nan, "clay_pct": np.nan,
        "soilTexture": "brak danych", "ph": np.nan,
        "bonitation_score": np.nan, "klasa_bonitacyjna": "brak",
        "bonitation_source": "Brak danych SoilGrids - profil domyślny",
        "permeability": "srednia", "water_retention": "srednia",
        "wilting_point": 0.13, "field_capacity": 0.28,
    })


def build_profiles(gdf: gpd.GeoDataFrame, soil_dir: str, min_ha: float) -> pd.DataFrame:
    if not Path(soil_dir).exists():
        print(f"[GLEBA] Brak katalogu {soil_dir} - używam profilu domyślnego.")
        return default_profiles(gdf)
    with tempfile.TemporaryDirectory() as tmp:
        gj = Path(tmp) / "fields.geojson"
        gdf[["id", "geom"]].rename_geometry("geometry").to_file(gj, driver="GeoJSON")
        try:
            return prepare_all_soil_profiles(
                geojson_path=gj, soil_dir=soil_dir,
                output_parquet=Path(tmp) / "p.parquet", output_json=Path(tmp) / "p.json",
                id_col="id", min_area_ha=min_ha,
            )
        except (FileNotFoundError, LookupError, ValueError) as e:
            print(f"[GLEBA] {e} - używam profilu domyślnego.")
            return default_profiles(gdf)


def to_profile(r) -> FieldSoilProfile:
    return FieldSoilProfile(
        field_id=str(r["field_id"]), area_ha=float(r["area_ha"]),
        centroid_lat=float(r["centroid_lat"]), centroid_lon=float(r["centroid_lon"]),
        h3_cells_count=int(r["h3_cells_count"]),
        sand_pct=float(r["sand_pct"]), silt_pct=float(r["silt_pct"]), clay_pct=float(r["clay_pct"]),
        soilTexture=str(r["soilTexture"]), ph=float(r["ph"]),
        bonitation_score=float(r["bonitation_score"]), klasa_bonitacyjna=str(r["klasa_bonitacyjna"]),
        bonitation_source=str(r["bonitation_source"]), permeability=r["permeability"],
        water_retention=r["water_retention"], wilting_point=float(r["wilting_point"]),
        field_capacity=float(r["field_capacity"]),
    )


def fetch_weather(profiles: pd.DataFrame, as_of: date | None) -> pd.DataFrame:
    # Siatka 0.05 deg wokół centroidów pól zamiast całej Polski (kilka zapytań zamiast ~700 punktów)
    coords = sorted({(round(la * 20) / 20, round(lo * 20) / 20)
                     for la, lo in zip(profiles["centroid_lat"], profiles["centroid_lon"])})
    print(f"[POGODA] {len(coords)} punktów Open-Meteo, as_of={as_of or 'dziś'}")
    frames = []
    for i in range(0, len(coords), 50):
        if as_of is None:
            frames.append(fetch_batch_daily(coords[i:i + 50], past_days=1, forecast_days=10))
        else:
            frames.append(fetch_batch_daily(
                coords[i:i + 50],
                start_date=as_of.isoformat(),
                end_date=(as_of + timedelta(days=9)).isoformat(),  # +2 dni pod sumę 72 h
            ))
    return pd.concat(frames, ignore_index=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default="service=hackathon")
    ap.add_argument("--as-of", type=date.fromisoformat, default=None)
    ap.add_argument("--min-ha", type=float, default=3.0)
    ap.add_argument("--soil-dir", default="soil_data")
    args = ap.parse_args()

    conn = psycopg2.connect(args.dsn)
    gdf = load_fields(conn, args.min_ha)
    if gdf.empty:
        sys.exit("Brak pól spełniających próg powierzchni - spróbuj --min-ha 1.0")

    profiles = build_profiles(gdf, args.soil_dir, args.min_ha)
    crop_by_id = dict(zip(gdf["id"].astype(str), gdf["crop_type"]))
    weather = fetch_weather(profiles, args.as_of)
    start = args.as_of or date.today()
    days = {(start + timedelta(days=d)).isoformat() for d in range(7)}

    prof_rows, cal_rows = [], []
    for idx, r in profiles.reset_index(drop=True).iterrows():
        soil = to_profile(r)
        crop = crop_by_id.get(soil.field_id) or DEFAULT_CROPS[idx % len(DEFAULT_CROPS)]
        w = get_weather_for_field(soil.centroid_lat, soil.centroid_lon, weather, forecast_only=False)
        w = w[w["date"].astype(str).str[:10].isin(days)]

        prof_rows.append((int(soil.field_id), soil.area_ha, crop, soil.soilTexture,
                          soil.sand_pct, soil.silt_pct, soil.clay_pct, soil.ph,
                          soil.klasa_bonitacyjna, soil.bonitation_source,
                          soil.permeability, soil.water_retention, start))
        for fert in FERTILIZERS:
            for d in evaluate_field_calendar(soil=soil, field_weather_df=w, fertilizer=fert, crop=crop):
                wx = d["weather"]
                cal_rows.append((int(soil.field_id), d["date"], fert, crop, d["status"],
                                 " | ".join(d["fertilization_reasons"]), d["irrigation_risk"],
                                 " | ".join(d["irrigation_reasons"]),
                                 wx["temp_mean_c"], wx["precip_24h_mm"], wx["precip_72h_mm"],
                                 wx["sm_l1"], wx["sm_l2"], wx["sm_l3"],
                                 d["ndvi_forecast"], d["ndmi_forecast"]))

    # NaN -> NULL
    clean = lambda rows: [tuple(None if isinstance(v, float) and np.isnan(v) else v for v in t) for t in rows]
    with conn, conn.cursor() as cur:
        cur.execute(DDL)
        cur.execute("TRUNCATE public.field_profile, public.field_calendar RESTART IDENTITY")
        execute_values(cur, """INSERT INTO public.field_profile
            (field_id, area_ha, crop, texture, sand_pct, silt_pct, clay_pct, ph, klasa_bonitacyjna,
             bonitation_source, permeability, water_retention, as_of) VALUES %s""", clean(prof_rows))
        execute_values(cur, """INSERT INTO public.field_calendar
            (field_id, day, fertilizer, crop, status, fert_reasons, irrigation_risk, irrigation_reasons,
             temp_mean_c, precip_24h_mm, precip_72h_mm, sm_l1, sm_l2, sm_l3, ndvi, ndmi) VALUES %s""",
                       clean(cal_rows))
    conn.close()
    print(f"[OK] field_profile: {len(prof_rows)} pól, field_calendar: {len(cal_rows)} wierszy (od {start})")


if __name__ == "__main__":
    main()
