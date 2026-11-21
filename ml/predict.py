import argparse
from dataclasses import asdict, is_dataclass
from datetime import date, timedelta
from pathlib import Path
import sys

import numpy as np
import pandas as pd
import torch

if __package__ in (None, ""):
    _repo_root = str(Path(__file__).resolve().parent.parent)
    if _repo_root not in sys.path:
        sys.path.insert(0, _repo_root)

from ml.config import DEFAULT_CHECKPOINT_PATH, DEFAULT_DATA_DIR, ModelConfig
from ml.dataset import FeatureScaler, build_field_daily_series
from ml.model import VegetationLSTM


def load_trained_model(
    checkpoint_path: str | Path = DEFAULT_CHECKPOINT_PATH,
    device: str | torch.device | None = None,
) -> tuple[VegetationLSTM, FeatureScaler, ModelConfig]:
    """Wczytuje wytrenowany model VegetationLSTM wraz ze skalerem i konfiguracją."""
    dev = torch.device(device) if device is not None else torch.device("cpu")
    ckpt = torch.load(checkpoint_path, map_location=dev, weights_only=True)
    model_cfg = ModelConfig.from_dict(ckpt["model_config"])
    scaler = FeatureScaler.from_dict(ckpt["scaler"])

    model = VegetationLSTM(model_cfg).to(dev)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    return model, scaler, model_cfg


def _as_field_dict(field_profile, crop: str | None) -> dict:
    if is_dataclass(field_profile):
        field_dict = asdict(field_profile)
    elif isinstance(field_profile, pd.Series):
        field_dict = field_profile.to_dict()
    else:
        field_dict = dict(field_profile)

    if crop is not None:
        field_dict["crop"] = crop
    elif "crop" not in field_dict or pd.isna(field_dict.get("crop")):
        field_dict["crop"] = "inne"
    return field_dict


def _run_forecast_window(
    model: VegetationLSTM,
    scaler: FeatureScaler,
    model_cfg: ModelConfig,
    field_dict: dict,
    sat_sub: pd.DataFrame,
    weather_sub: pd.DataFrame,
    ref_d: date,
    device: str | torch.device | None,
) -> np.ndarray:
    """Buduje okno 56+7 i zwraca macierz prognozy (7, 2)."""
    hist_start = ref_d - timedelta(days=model_cfg.history_days - 1)
    fut_end = ref_d + timedelta(days=model_cfg.forecast_days)

    if not sat_sub.empty and "date" in sat_sub.columns:
        sat_sub = sat_sub[pd.to_datetime(sat_sub["date"]).dt.date <= ref_d].copy()

    w_dates = pd.to_datetime(weather_sub["date"]).dt.date
    hist_weather_days = int(((w_dates >= hist_start) & (w_dates <= ref_d)).sum())
    if hist_weather_days < model_cfg.history_days:
        print(
            f"[INFO] Pole {field_dict.get('field_id')}: dostępnych "
            f"{hist_weather_days}/{model_cfg.history_days} dni pogody historycznej "
            "— brakujące najstarsze dni zostaną uzupełnione przez backfill."
        )

    series = build_field_daily_series(
        field_row=field_dict,
        sat_df=sat_sub,
        weather_df=weather_sub,
        date_start=hist_start.isoformat(),
        date_end=fut_end.isoformat(),
    )
    if series is None:
        raise ValueError(
            f"Nie udało się zbudować okna predykcji dla pola '{field_dict.get('field_id')}' "
            "(sprawdź obecność obserwacji Sentinel-2 oraz ciągłość pogody)."
        )

    h = model_cfg.history_days
    f = model_cfg.forecast_days
    x_hist = scaler.transform_hist(series["hist_matrix"][:h])
    x_future = scaler.transform_future(series["future_matrix"][h : h + f])
    x_static = scaler.transform_static(series["static_vec"])
    last_targets = np.asarray(
        [series["ndvi_causal"][h - 1], series["ndmi_causal"][h - 1]],
        dtype=np.float32,
    )

    dev = torch.device(device) if device is not None else next(model.parameters()).device
    with torch.inference_mode():
        pred = model(
            torch.from_numpy(x_hist).unsqueeze(0).to(dev),
            torch.from_numpy(x_future).unsqueeze(0).to(dev),
            torch.from_numpy(x_static).unsqueeze(0).to(dev),
            torch.from_numpy(last_targets).unsqueeze(0).to(dev),
        )[0].cpu().numpy()
    return pred


def predict_pixel_7days(
    model: VegetationLSTM,
    scaler: FeatureScaler,
    model_cfg: ModelConfig,
    field_profile,
    satellite_df: pd.DataFrame,
    weather_df: pd.DataFrame,
    pixel_id: str | None = None,
    lon: float | None = None,
    lat: float | None = None,
    reference_date: str | date | None = None,
    crop: str | None = None,
    device: str | torch.device | None = None,
) -> dict:
    """
    Prognozuje NDVI i NDMI na 7 dni w przód dla **konkretnego piksela**.

    Piksel wybierasz przez `pixel_id` albo najbliższy `(lon, lat)` w `satellite_df`.
    """
    field_dict = _as_field_dict(field_profile, crop)
    field_id = str(field_dict.get("field_id", "field_0"))

    sat = satellite_df.copy()
    if "field_id" in sat.columns:
        sat = sat[sat["field_id"].astype(str) == field_id].copy()
    if sat.empty:
        raise ValueError(f"Brak obserwacji satelitarnych dla pola '{field_id}'.")

    if "pixel_id" not in sat.columns:
        sat["pixel_id"] = sat["field_id"].astype(str) + "__field_mean"

    if pixel_id is not None:
        s_sub = sat[sat["pixel_id"].astype(str) == str(pixel_id)].copy()
        if s_sub.empty:
            raise ValueError(f"Brak piksela '{pixel_id}' w satellite_df dla pola '{field_id}'.")
        resolved_pixel_id = str(pixel_id)
    elif lon is not None and lat is not None:
        if "lon" not in sat.columns or "lat" not in sat.columns:
            raise ValueError("satellite_df nie ma kolumn lon/lat — podaj pixel_id.")
        pix_meta = sat.drop_duplicates(subset=["pixel_id"], keep="first")
        dist2 = (pix_meta["lon"].astype(float) - float(lon)) ** 2 + (
            pix_meta["lat"].astype(float) - float(lat)
        ) ** 2
        nearest = pix_meta.iloc[int(dist2.to_numpy().argmin())]
        resolved_pixel_id = str(nearest["pixel_id"])
        s_sub = sat[sat["pixel_id"].astype(str) == resolved_pixel_id].copy()
    else:
        resolved_pixel_id = str(sat["pixel_id"].iloc[0])
        s_sub = sat[sat["pixel_id"].astype(str) == resolved_pixel_id].copy()

    w_sub = (
        weather_df[weather_df["field_id"].astype(str) == field_id].copy()
        if "field_id" in weather_df.columns
        else weather_df.copy()
    )
    if w_sub.empty:
        raise ValueError(f"Brak danych pogodowych dla pola '{field_id}'.")

    if reference_date is None:
        max_w_date = pd.Timestamp(w_sub["date"].max()).date()
        ref_d = max_w_date - timedelta(days=model_cfg.forecast_days)
    elif isinstance(reference_date, date):
        ref_d = reference_date
    else:
        ref_d = date.fromisoformat(str(reference_date).strip())

    pred = _run_forecast_window(
        model=model,
        scaler=scaler,
        model_cfg=model_cfg,
        field_dict=field_dict,
        sat_sub=s_sub,
        weather_sub=w_sub,
        ref_d=ref_d,
        device=device,
    )

    future_dates = [(ref_d + timedelta(days=k)).isoformat() for k in range(1, model_cfg.forecast_days + 1)]
    out_lon = float(s_sub["lon"].iloc[0]) if "lon" in s_sub.columns else None
    out_lat = float(s_sub["lat"].iloc[0]) if "lat" in s_sub.columns else None
    return {
        "pixel_id": resolved_pixel_id,
        "field_id": field_id,
        "lon": out_lon,
        "lat": out_lat,
        "reference_date": ref_d.isoformat(),
        "dates": future_dates,
        "ndvi_by_date": {d: round(float(pred[i, 0]), 4) for i, d in enumerate(future_dates)},
        "ndmi_by_date": {d: round(float(pred[i, 1]), 4) for i, d in enumerate(future_dates)},
    }


def predict_field_7days(
    model: VegetationLSTM,
    scaler: FeatureScaler,
    model_cfg: ModelConfig,
    field_profile,
    satellite_df: pd.DataFrame,
    weather_df: pd.DataFrame,
    reference_date: str | date | None = None,
    crop: str | None = None,
    device: str | torch.device | None = None,
) -> dict:
    """
    Prognoza 7-dniowa dla pola: uśrednia prognozy wszystkich pikseli pola
    (albo jedną średnią historyczną, gdy brak `pixel_id`).
    Zwraca słownik gotowy do `kw.soil.evaluate_field_calendar()`.
    """
    field_dict = _as_field_dict(field_profile, crop)
    field_id = str(field_dict.get("field_id", "field_0"))

    sat = satellite_df.copy()
    if "field_id" in sat.columns:
        sat = sat[sat["field_id"].astype(str) == field_id].copy()
    if sat.empty:
        raise ValueError(f"Brak obserwacji satelitarnych dla pola '{field_id}'.")

    if "pixel_id" in sat.columns:
        pixel_ids = sorted(sat["pixel_id"].astype(str).unique())
        pixel_preds = [
            predict_pixel_7days(
                model=model,
                scaler=scaler,
                model_cfg=model_cfg,
                field_profile=field_dict,
                satellite_df=sat,
                weather_df=weather_df,
                pixel_id=pid,
                reference_date=reference_date,
                crop=crop,
                device=device,
            )
            for pid in pixel_ids
        ]
        dates = pixel_preds[0]["dates"]
        ndvi_by_date = {
            d: round(float(np.mean([p["ndvi_by_date"][d] for p in pixel_preds])), 4) for d in dates
        }
        ndmi_by_date = {
            d: round(float(np.mean([p["ndmi_by_date"][d] for p in pixel_preds])), 4) for d in dates
        }
        return {
            "field_id": field_id,
            "reference_date": pixel_preds[0]["reference_date"],
            "dates": dates,
            "ndvi_by_date": ndvi_by_date,
            "ndmi_by_date": ndmi_by_date,
            "n_pixels": len(pixel_ids),
        }

    # Legacy: jeden szereg na pole
    w_sub = (
        weather_df[weather_df["field_id"].astype(str) == field_id].copy()
        if "field_id" in weather_df.columns
        else weather_df.copy()
    )
    if w_sub.empty:
        raise ValueError(f"Brak danych pogodowych dla pola '{field_id}'.")

    if reference_date is None:
        max_w_date = pd.Timestamp(w_sub["date"].max()).date()
        ref_d = max_w_date - timedelta(days=model_cfg.forecast_days)
    elif isinstance(reference_date, date):
        ref_d = reference_date
    else:
        ref_d = date.fromisoformat(str(reference_date).strip())

    pred = _run_forecast_window(
        model=model,
        scaler=scaler,
        model_cfg=model_cfg,
        field_dict=field_dict,
        sat_sub=sat,
        weather_sub=w_sub,
        ref_d=ref_d,
        device=device,
    )
    future_dates = [(ref_d + timedelta(days=k)).isoformat() for k in range(1, model_cfg.forecast_days + 1)]
    return {
        "field_id": field_id,
        "reference_date": ref_d.isoformat(),
        "dates": future_dates,
        "ndvi_by_date": {d: round(float(pred[i, 0]), 4) for i, d in enumerate(future_dates)},
        "ndmi_by_date": {d: round(float(pred[i, 1]), 4) for i, d in enumerate(future_dates)},
        "n_pixels": 1,
    }


def _build_cli() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Prognoza NDVI i NDMI na 7 dni dla piksela lub pola.")
    p.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT_PATH), help="Ścieżka do checkpointu modelu (.pt).")
    p.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR), help="Folder z fields_master/satellite_indices/weather_daily.")
    p.add_argument("--field-id", default=None, help="ID pola (domyślnie pierwsze z fields_master).")
    p.add_argument("--pixel-id", default=None, help="ID piksela (np. field_0__px3). Bez tego: pierwszy piksel pola.")
    p.add_argument("--lon", type=float, default=None, help="Lon piksela — wybór najbliższego z katalogu.")
    p.add_argument("--lat", type=float, default=None, help="Lat piksela — wybór najbliższego z katalogu.")
    p.add_argument("--field-mean", action="store_true", help="Uśrednij prognozę po wszystkich pikselach pola.")
    p.add_argument("--date", dest="reference_date", default=None, help="Data odniesienia YYYY-MM-DD.")
    return p


if __name__ == "__main__":
    args = _build_cli().parse_args()
    data_dir = Path(args.data_dir)
    fields_df = pd.read_parquet(data_dir / "fields_master.parquet")
    sat_df = pd.read_parquet(data_dir / "satellite_indices.parquet")
    weather_df = pd.read_parquet(data_dir / "weather_daily.parquet")

    if args.field_id is not None:
        row = fields_df[fields_df["field_id"].astype(str) == str(args.field_id)].iloc[0]
    else:
        row = fields_df.iloc[0]

    model, scaler, m_cfg = load_trained_model(args.checkpoint)

    if args.field_mean:
        result = predict_field_7days(
            model=model,
            scaler=scaler,
            model_cfg=m_cfg,
            field_profile=row,
            satellite_df=sat_df,
            weather_df=weather_df,
            reference_date=args.reference_date,
        )
        label = f"pola {result['field_id']} (średnia z {result.get('n_pixels', '?')} px)"
    else:
        result = predict_pixel_7days(
            model=model,
            scaler=scaler,
            model_cfg=m_cfg,
            field_profile=row,
            satellite_df=sat_df,
            weather_df=weather_df,
            pixel_id=args.pixel_id,
            lon=args.lon,
            lat=args.lat,
            reference_date=args.reference_date,
        )
        label = (
            f"piksela {result['pixel_id']} "
            f"(lon={result.get('lon')}, lat={result.get('lat')}) na polu {result['field_id']}"
        )

    out_df = pd.DataFrame(
        {
            "date": result["dates"],
            "ndvi_forecast": [result["ndvi_by_date"][d] for d in result["dates"]],
            "ndmi_forecast": [result["ndmi_by_date"][d] for d in result["dates"]],
        }
    )
    print(f"Prognoza 7-dniowa dla {label} od {result['reference_date']}:")
    print(out_df.to_string(index=False))
