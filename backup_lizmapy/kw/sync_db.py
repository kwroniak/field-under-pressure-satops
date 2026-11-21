import json
from pathlib import Path
import sqlite3

from meteo import fetch_poland_weather_daily, get_weather_for_field
from soil_bonification import (
    evaluate_field_calendar,
    load_field_profile,
    prepare_all_soil_profiles,
)

# Ścieżki
GEOJSON_PATH = "kw/fields.geojson"          # zmień na "bk/fields_crops.geojson", jeśli macie wspólny plik z uprawami
SOIL_DIR = "soil_data"
PROFILES_PARQUET = "fields_soil_profiles.parquet"
PROFILES_JSON = "fields_soil_profiles.json"
SQLITE_DB = "app_database.db"               # gotowa baza SQLite (jeśli nie używacie Postgresa)
FRONTEND_DUMP_JSON = "synced_data.json"     # gotowy JSON dla API / frontendu

FERTILIZERS = ["saletra_amonowa", "mocznik_inhibitor", "rsm_32", "saletrosan_26"]
DEFAULT_CROPS = ["pszenica", "kukurydza", "rzepak"]


def run_sync():
    # 1. ETAP 1: Profile glebowe (liczy tylko jeśli jeszcze nie ma pliku parquet)
    if not Path(PROFILES_PARQUET).exists():
        print("=== 1/3 Generowanie profili glebowych ===")
        df_profiles = prepare_all_soil_profiles(
            geojson_path=GEOJSON_PATH,
            soil_dir=SOIL_DIR,
            output_parquet=PROFILES_PARQUET,
            output_json=PROFILES_JSON,
            id_col="id",
        )
    else:
        print("=== 1/3 Wczytuję istniejące profile glebowe ===")
        import pandas as pd
        df_profiles = pd.read_parquet(PROFILES_PARQUET)

    # 2. POGODA: Pobranie lub wczytanie z dzisiejszego cache Open-Meteo
    print("=== 2/3 Pobieranie / wczytywanie pogody Open-Meteo ===")
    weather_pl = fetch_poland_weather_daily()

    # 3. PRZELICZENIE WSZYSTKICH PÓL I NAWOZÓW
    print("=== 3/3 Przeliczanie kalendarzy 7-dniowych dla wszystkich pól ===")
    all_fields_payload = []

    for idx, row in df_profiles.iterrows():
        field_id = str(row["field_id"])
        soil = load_field_profile(field_id, PROFILES_PARQUET)

        # Jeśli w GeoJSON/profilu nie ma przypisanej uprawy, rotujemy 3 uprawy do demo
        crop = row["crop"] if "crop" in row and row["crop"] else DEFAULT_CROPS[idx % len(DEFAULT_CROPS)]

        # Pogoda 7-dniowa dla centroidu pola
        weather_7d = get_weather_for_field(
            soil.centroid_lat, soil.centroid_lon, weather_pl, forecast_only=True
        )

        # Liczymy kalendarz dla wszystkich 4 nawozów naraz (frontend przełącza je w 0 ms!)
        calendars_by_fertilizer = {}
        for fert in FERTILIZERS:
            calendars_by_fertilizer[fert] = evaluate_field_calendar(
                soil=soil,
                field_weather_df=weather_7d,
                fertilizer=fert,
                crop=crop,
                # Tutaj możesz wpiąć predykcje LSTM kolegi:
                # ndmi_by_date=lstm_ndmi.get(field_id),
                # ndvi_by_date=lstm_ndvi.get(field_id),
            )

        all_fields_payload.append({
            "field_id": field_id,
            "area_ha": soil.area_ha,
            "centroid": {"lat": soil.centroid_lat, "lon": soil.centroid_lon},
            "crop": crop,
            "soil": {
                "texture": soil.soilTexture,
                "sand_pct": soil.sand_pct,
                "silt_pct": soil.silt_pct,
                "clay_pct": soil.clay_pct,
                "ph": soil.ph,
                "klasa_bonitacyjna": soil.klasa_bonitacyjna,
                "bonitation_source": soil.bonitation_source,
                "permeability": soil.permeability,
                "water_retention": soil.water_retention,
            },
            "calendars": calendars_by_fertilizer,
        })

    # Zapis do JSON (idealne pod FastAPI / Flask / statyczny import na froncie)
    with open(FRONTEND_DUMP_JSON, "w", encoding="utf-8") as f:
        json.dump(all_fields_payload, f, ensure_ascii=False, indent=2)

    # Opcjonalny zapis do SQLite (gotowa relacyjna baza bez stawiania Dockera)
    conn = sqlite3.connect(SQLITE_DB)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS field_evaluations (
            field_id TEXT PRIMARY KEY,
            area_ha REAL,
            crop TEXT,
            payload_json TEXT
        )
    """)
    for item in all_fields_payload:
        cur.execute(
            "INSERT OR REPLACE INTO field_evaluations VALUES (?, ?, ?, ?)",
            (item["field_id"], item["area_ha"], item["crop"], json.dumps(item, ensure_ascii=False)),
        )
    conn.commit()
    conn.close()

    print(f"[SUKCES] Zsynchronizowano {len(all_fields_payload)} pól -> {FRONTEND_DUMP_JSON} oraz {SQLITE_DB}")


if __name__ == "__main__":
    run_sync()