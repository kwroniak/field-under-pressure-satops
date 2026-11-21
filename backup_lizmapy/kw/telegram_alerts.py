"""
Powiadomienia Telegram dla rolnika: najlepsze okno nawożenia + ostrzeżenia na najbliższe dni,
na podstawie tabeli public.field_calendar (wypełnianej przez kw/load_postgis.py).

Jednorazowa konfiguracja:
  1. W Telegramie napisz do @BotFather -> /newbot -> skopiuj token.
  2. Napisz cokolwiek do swojego nowego bota (żeby mógł do Ciebie pisać).
  3. PowerShell:
       $env:TELEGRAM_BOT_TOKEN = "123456:ABC..."
       python kw/telegram_alerts.py --get-chat-id          # wypisze chat_id
       $env:TELEGRAM_CHAT_ID = "<chat_id>"

Użycie:
  python kw/telegram_alerts.py --field 33 --dry-run       # podgląd treści bez wysyłania
  python kw/telegram_alerts.py --field 33                 # wysyłka (np. na żywo podczas demo)
  python kw/telegram_alerts.py --top 3                    # 3 pola z największym ryzykiem
"""
import argparse
import os
import sys

import psycopg2
import requests

# Publiczny adres Lizmapa (np. z Cloudflare Tunnel): $env:HC_LIZMAP_URL = "https://xxxx.trycloudflare.com"
LIZMAP_BASE = os.environ.get("HC_LIZMAP_URL", "http://localhost:8090").rstrip("/")
LIZMAP_URL = f"{LIZMAP_BASE}/index.php/view/map?repository=holycrop&project=satops_project"
FERT_LABELS = {
    "saletra_amonowa": "Saletra amonowa",
    "mocznik_inhibitor": "Mocznik z inhibitorem",
    "rsm_32": "RSM 32",
    "saletrosan_26": "Saletrosan 26",
}
STATUS_ICON = {"ZIELONY": "🟢", "ZOLTY": "🟡", "CZERWONY": "🔴"}
WEEKDAYS = ["pon", "wt", "śr", "czw", "pt", "sob", "nd"]


def api(token: str, method: str, **params) -> dict:
    resp = requests.post(f"https://api.telegram.org/bot{token}/{method}", json=params, timeout=30)
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Telegram {method}: {data.get('description')}")
    return data["result"]


def field_rows(cur, field_id: int, fertilizer: str):
    cur.execute(
        """SELECT c.day, c.status, c.fert_reasons, c.irrigation_risk, c.temp_mean_c, c.precip_24h_mm,
                  p.crop, p.area_ha
           FROM public.field_calendar c JOIN public.field_profile p USING (field_id)
           WHERE c.field_id = %s AND c.fertilizer = %s ORDER BY c.day""",
        (field_id, fertilizer),
    )
    return cur.fetchall()


def field_extent(cur, field_id: int):
    cur.execute(
        "SELECT ST_XMin(g), ST_YMin(g), ST_XMax(g), ST_YMax(g) "
        "FROM (SELECT ST_Expand(geometry, 150) g FROM public.fields WHERE id = %s) s",
        (field_id,),
    )
    return cur.fetchone()


def compose(cur, field_id: int, fertilizer: str) -> str | None:
    rows = field_rows(cur, field_id, fertilizer)
    if not rows:
        return None
    crop, area_ha = rows[0][6], rows[0][7]
    best = next((r for r in rows if r[1] == "ZIELONY"), None)
    lines = [f"🌾 <b>Pole {field_id}</b> · {crop} · {area_ha:.2f} ha", f"Nawóz: {FERT_LABELS.get(fertilizer, fertilizer)}", ""]
    if best:
        d = best[0]
        lines.append(f"✅ <b>Najlepszy termin: {WEEKDAYS[d.weekday()]} {d:%d.%m}</b> "
                     f"({best[4]:.0f}°C, opad {best[5]:.1f} mm)")
    else:
        lines.append("⛔ <b>Brak korzystnego terminu w najbliższych 7 dniach</b>")
    lines.append("")
    for day, status, reasons, irrigation, temp, precip, *_ in rows:
        first_reason = (reasons or "").split(" | ")[0]
        lines.append(f"{STATUS_ICON.get(status, '⚪')} {WEEKDAYS[day.weekday()]} {day:%d.%m} · "
                     f"{temp:.0f}°C · {precip:.1f} mm" + (f" — {first_reason}" if status != "ZIELONY" else ""))
    if any(r[3] == "WYSOKIE" for r in rows):
        lines += ["", "💧 Uwaga: wysokie ryzyko niedoboru wody w strefie korzeniowej."]
    ext = field_extent(cur, field_id)
    if ext:
        lines += ["", f'<a href="{LIZMAP_URL}&bbox={",".join(f"{v:.0f}" for v in ext)}&crs=EPSG:3857">Otwórz pole na mapie</a>']
    return "\n".join(lines)


def top_fields(cur, n: int, fertilizer: str) -> list[int]:
    cur.execute(
        """SELECT field_id FROM public.field_calendar WHERE fertilizer = %s
           GROUP BY field_id
           ORDER BY sum(CASE status WHEN 'CZERWONY' THEN 2 WHEN 'ZOLTY' THEN 1 ELSE 0 END) DESC, field_id
           LIMIT %s""",
        (fertilizer, n),
    )
    return [r[0] for r in cur.fetchall()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default="host=localhost port=8093 dbname=geoai user=postgres password=postgres")
    ap.add_argument("--field", type=int, action="append", help="id pola (można podać kilka razy)")
    ap.add_argument("--top", type=int, default=0, help="wyślij N pól z największym ryzykiem")
    ap.add_argument("--fertilizer", default="saletra_amonowa", choices=list(FERT_LABELS))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--get-chat-id", action="store_true")
    args = ap.parse_args()

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if args.get_chat_id:
        if not token:
            sys.exit("Ustaw TELEGRAM_BOT_TOKEN")
        for upd in api(token, "getUpdates"):
            chat = (upd.get("message") or {}).get("chat", {})
            print(f"chat_id={chat.get('id')}  ({chat.get('first_name', '')} {chat.get('username', '')})")
        return

    with psycopg2.connect(args.dsn) as conn, conn.cursor() as cur:
        ids = list(args.field or []) + top_fields(cur, args.top, args.fertilizer)
        if not ids:
            sys.exit("Podaj --field <id> albo --top N")
        messages = [m for m in (compose(cur, i, args.fertilizer) for i in ids) if m]

    if not messages:
        sys.exit("Brak danych w field_calendar dla podanych pól (pole < 3 ha albo nie uruchomiono load_postgis.py).")
    for text in messages:
        if args.dry_run:
            print(text, "\n" + "-" * 40)
            continue
        chat_id = os.environ.get("TELEGRAM_CHAT_ID")
        if not token or not chat_id:
            sys.exit("Ustaw TELEGRAM_BOT_TOKEN i TELEGRAM_CHAT_ID (patrz nagłówek pliku)")
        api(token, "sendMessage", chat_id=chat_id, text=text, parse_mode="HTML", disable_web_page_preview=True)
        print("Wysłano.")


if __name__ == "__main__":
    main()
