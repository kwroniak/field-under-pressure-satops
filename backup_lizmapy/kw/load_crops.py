"""
Prawdziwe uprawy dla pól: mapa CLMS Crop Types (10 m) -> public.fields.crop_type.
Korzysta z bk/assign_crops.py (CropDetector kolegi): dla każdego pola klasa dominująca (> 50% pikseli).

Uruchomienie (z katalogu repo):
    python kw/load_crops.py --dsn "host=localhost port=8093 dbname=geoai user=postgres password=postgres"
    python kw/load_crops.py --year 2024 --min-ha 3

Potem ponownie:  python kw/load_postgis.py ... --as-of 2025-04-14
(load_postgis.py bierze uprawę z fields.crop_type, jeśli jest wypełniona).
"""
import argparse
import sys
import tempfile
from pathlib import Path

import geopandas as gpd
import psycopg2
from psycopg2.extras import execute_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "bk"))
from assign_crops import CropDetector  # noqa: E402

# Nazwy klas CLMS -> nazwy używane w kalendarzu i popupie
CROP_NAMES_PL = {
    1110: "pszenica", 1120: "jęczmień", 1130: "kukurydza", 1140: "ryż",
    1310: "ziemniak", 1320: "burak cukrowy", 1410: "słonecznik", 1420: "soja",
    1430: "rzepak", 1440: "len/konopie", 2100: "winorośl", 2200: "oliwki",
    2310: "sad", 2320: "orzechy",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default="service=hackathon")
    ap.add_argument("--year", type=int, default=2024, help="rocznik mapy CLMS (2020-2024)")
    ap.add_argument("--min-ha", type=float, default=3.0)
    args = ap.parse_args()

    conn = psycopg2.connect(args.dsn)
    sql = """SELECT id, ST_Area(ST_Transform(geometry, 2180)) / 10000.0 AS area_ha,
                    ST_Transform(geometry, 4326) AS geom
             FROM public.fields
             WHERE ST_Area(ST_Transform(geometry, 2180)) / 10000.0 >= %s"""
    fields = gpd.read_postgis(sql, conn, geom_col="geom", params=(args.min_ha,)).set_crs("EPSG:4326", allow_override=True)
    print(f"[POLA] {len(fields)} pól >= {args.min_ha} ha")

    detector = CropDetector(year=args.year, data_dir=ROOT / "bk" / "data")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "fields.geojson"
        fields.rename_geometry("geometry").to_file(path, driver="GeoJSON")
        result = detector.detect(path)

    rows = []
    for field_id, code, share in zip(fields["id"], result["crop_code"], result["crop_share"]):
        name = CROP_NAMES_PL.get(int(code)) if code is not None and code == code else None
        rows.append((int(field_id), name, float(share) if share is not None and share == share else None))

    with conn, conn.cursor() as cur:
        cur.execute("ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS crop_share double precision")
        execute_values(cur, """
            UPDATE public.fields f SET crop_type = v.crop, crop_share = v.share
            FROM (VALUES %s) AS v(id, crop, share) WHERE f.id = v.id""", rows)
    conn.close()

    known = [r for r in rows if r[1]]
    print(f"[OK] uprawa rozpoznana dla {len(known)} z {len(rows)} pól (rocznik {args.year})")
    counts = {}
    for _, crop, _ in known:
        counts[crop] = counts.get(crop, 0) + 1
    for crop, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"   {crop}: {n}")


if __name__ == "__main__":
    main()
