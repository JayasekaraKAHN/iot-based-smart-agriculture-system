import argparse
import json
import math
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests
from scipy import stats
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.feature_selection import SelectKBest, f_regression, mutual_info_classif
from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score
from sklearn.model_selection import GridSearchCV, KFold, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.utils.class_weight import compute_sample_weight



DATA_PATH = Path(__file__).resolve().parent / "data" / "crops.csv"
MODEL_DIR = Path(__file__).resolve().parent / "models"

# ==============================================================================
# 1. CONSTANTS
# ==============================================================================

SENSOR_BOUNDS = {
    "temperature":     (23.0, 34.0),
    "humidity":        (60.0, 95.0),
    "soil_moisture":   (20.0, 80.0),
    "annual_rainfall": (800.0, 5000.0),
}

CLIMATE_ZONES = {
    "upcountry": {
        "name": "Upcountry",
        "regions": ["Nuwara Eliya", "Badulla", "Kandi Heights"],
        "temperature_range": (18.1, 33.8),
        "humidity_range":    (50.9, 94.3),
        "rainfall_range":    (512.7, 2976.3),
        "suitable_crops":    ["Tea", "Potato", "Carrot", "Cabbage", "Pepper", "Coffee"],
        "lon_range": (80.5057, 80.9872),
        "lat_range": (6.5138, 7.1906),
    },
    "intermediate_zone": {
        "name": "Intermediate Zone",
        "regions": ["Kurunegala", "Matale", "Badulla"],
        "temperature_range": (18.2, 33.8),
        "humidity_range":    (50.7, 94.4),
        "rainfall_range":    (566.3, 2962.1),
        "suitable_crops":    ["Potato", "Carrot", "Cabbage", "Tomato", "Maize", "Sugarcane"],
        "lon_range": (80.0163, 81.4249),
        "lat_range": (6.0275, 8.4922),
    },
    "dry_zone": {
        "name": "Dry Zone",
        "regions": ["Anuradhapura", "Polonnaruwa", "Jaffna"],
        "temperature_range": (18.1, 33.7),
        "humidity_range":    (50.7, 94.8),
        "rainfall_range":    (546.0, 2992.8),
        "suitable_crops":    ["Black Gram", "Green Gram", "Maize", "Chili", "Onion", "Mango"],
        "lon_range": (80.5503, 81.9766),
        "lat_range": (6.5393, 9.4899),
    },
    "wet_zone": {
        "name": "Wet Zone",
        "regions": ["Colombo", "Galle", "Kandy", "Low-country"],
        "temperature_range": (18.3, 33.5),
        "humidity_range":    (50.6, 94.6),
        "rainfall_range":    (555.3, 2987.3),
        "suitable_crops":    ["Banana", "Rubber", "Coconut", "Rice", "Tea", "Cinnamon"],
        "lon_range": (79.8270, 80.9653),
        "lat_range": (5.9292, 7.4502),
    },
}

ZONE_SUITABILITY_RANGES = {
    "wet_zone":          {"temperature": (23.0, 31.0), "humidity": (70.0, 95.0),  "rainfall": (2500.0, 10000.0), "soil_moisture": (50.0, 100.0)},
    "intermediate_zone": {"temperature": (25.0, 32.0), "humidity": (65.0, 80.0),  "rainfall": (1750.0, 2500.0),  "soil_moisture": (35.0, 80.0)},
    "dry_zone":          {"temperature": (28.0, 35.0), "humidity": (60.0, 79.0),  "rainfall": (0.0, 1750.0),     "soil_moisture": (20.0, 65.0)},
    "upcountry":         {"temperature": (18.0, 27.0), "humidity": (60.0, 90.0),  "rainfall": (1200.0, 5000.0),  "soil_moisture": (40.0, 90.0)},
}

ZONE_CENTROIDS = {
    "upcountry":         (80.7341, 6.8508),
    "intermediate_zone": (80.6680, 7.3351),
    "dry_zone":          (81.3772, 8.0565),
    "wet_zone":          (80.3452, 6.6146),
}

SENSOR_FEATURES = ["Temperature", "Humidity", "Soil_Moisture", "Rainfall"]
MODEL_NUMERIC_FEATURES = ["Temperature", "Humidity", "Soil_Moisture", "Rainfall", "Latitude", "Longitude"]
MODEL_CATEGORICAL_FEATURES = ["Zone"]


# ==============================================================================
# 2. GEOLOCATION
# ==============================================================================

def get_coordinates_from_ip() -> dict | None:
    try:
        data = requests.get("http://ip-api.com/json/", timeout=5).json()
        if data.get("status") == "success":
            return {"latitude": float(data["lat"]), "longitude": float(data["lon"]), "source": "ip-api"}
    except Exception as e:
        print(f"[GeoIP Error] {e}")
    return None


# ==============================================================================
# 3. ZONE DETECTION
# ==============================================================================

def _closest_zone(longitude: float, latitude: float, candidates: list[str]) -> str:
    return min(
        candidates,
        key=lambda z: math.sqrt(
            (longitude - ZONE_CENTROIDS[z][0]) ** 2
            + (latitude - ZONE_CENTROIDS[z][1]) ** 2
        ),
    )


def _zone_result(zone_key: str, method: str, score: float, note: str = "") -> dict:
    info = CLIMATE_ZONES[zone_key]
    result = {
        "zone_key":          zone_key,
        "name":              info["name"],
        "regions":           info["regions"],
        "suitable_crops":    info["suitable_crops"],
        "temperature_range": info["temperature_range"],
        "humidity_range":    info["humidity_range"],
        "rainfall_range":    info["rainfall_range"],
        "match_method":      method,
        "overall_score":     score,
    }
    if note:
        result["note"] = note
    return result


def detect_zone_by_coordinates(longitude: float, latitude: float) -> dict:
    matches = [
        k for k, v in CLIMATE_ZONES.items()
        if v["lon_range"][0] <= longitude <= v["lon_range"][1]
        and v["lat_range"][0] <= latitude <= v["lat_range"][1]
    ]
    if len(matches) == 1:
        return _zone_result(matches[0], "geolocation (exact)", 1.0)
    if len(matches) > 1:
        return _zone_result(_closest_zone(longitude, latitude, matches), "geolocation (closest match)", 1.0)
    nearest = _closest_zone(longitude, latitude, list(ZONE_CENTROIDS))
    return _zone_result(nearest, "geolocation (nearest zone)", 0.5,
                        note="Coordinates outside known zones, using nearest centroid")


def detect_zone_by_climate(temperature: float, humidity: float, rainfall_annual: float) -> dict:
    def score(info: dict) -> float:
        t = float(info["temperature_range"][0] <= temperature <= info["temperature_range"][1])
        h = float(info["humidity_range"][0]    <= humidity       <= info["humidity_range"][1])
        r = float(info["rainfall_range"][0]    <= rainfall_annual <= info["rainfall_range"][1])
        return t * 0.3 + h * 0.3 + r * 0.4

    scores = {k: score(v) for k, v in CLIMATE_ZONES.items()}
    best = max(scores, key=lambda k: scores[k])
    return {**_zone_result(best, "climate sensors", scores[best])}


def detect_zone(
    temperature: float,
    humidity: float,
    rainfall_annual: float,
    longitude: float | None = None,
    latitude: float | None = None,
) -> dict:
    if longitude is None or latitude is None:
        geo = get_coordinates_from_ip()
        if geo:
            longitude, latitude = geo["longitude"], geo["latitude"]
            print(f"[GeoIP] Auto-detected: {latitude:.4f}, {longitude:.4f}")

    if longitude is not None and latitude is not None:
        return detect_zone_by_coordinates(longitude, latitude)
    return detect_zone_by_climate(temperature, humidity, rainfall_annual)


def check_zone_suitability(
    zone_info: dict,
    temperature: float,
    humidity: float,
    annual_rainfall: float,
    soil_moisture: float,
) -> list[str]:
    ranges = ZONE_SUITABILITY_RANGES.get(zone_info.get("zone_key", ""))
    if not ranges:
        return ["Climate zone could not be identified reliably"]
    issues = []
    for key, value, unit in [
        ("temperature",   temperature,    "°C"),
        ("humidity",      humidity,        "%"),
        ("rainfall",      annual_rainfall, "mm"),
        ("soil_moisture", soil_moisture,   "%"),
    ]:
        lo, hi = ranges[key]
        if not (lo <= value <= hi):
            issues.append(f"{key.replace('_',' ').title()} {value}{unit} outside zone range ({lo}–{hi}{unit})")
    return issues


# ==============================================================================
# 4. DATA LOADING
# ==============================================================================

def load_data(path: Path = DATA_PATH) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [str(col).strip() for col in df.columns]

    rename_map = {
        "temperature": "Temperature",
        "humidity": "Humidity",
        "rainfall": "Rainfall",
        "ph": "Soil_pH",
        "crop": "Crop",
        "soil_moisture": "Soil_Moisture",
        "latitude": "Latitude",
        "longitude": "Longitude",
        "zone": "Zone",
    }
    for source, target in rename_map.items():
        if source in df.columns and target not in df.columns:
            df[target] = df[source]

    if "Soil_Moisture" not in df.columns:
        if "Humidity" in df.columns and "Rainfall" in df.columns:
            rain_span = max(float(df["Rainfall"].max() - df["Rainfall"].min()), 1e-6)
            rain_norm = (df["Rainfall"] - df["Rainfall"].min()) / rain_span
            df["Soil_Moisture"] = np.clip(0.65 * df["Humidity"] + 0.35 * (rain_norm * 100), 0, 100)
        else:
            df["Soil_Moisture"] = 50.0

    if "Latitude" not in df.columns:
        df["Latitude"] = 7.2
    if "Longitude" not in df.columns:
        df["Longitude"] = 80.7
    if "Zone" not in df.columns:
        df["Zone"] = np.where(
            df["Rainfall"] >= 2500,
            "Wet Zone",
            np.where(df["Rainfall"] >= 1750, "Intermediate Zone", "Dry Zone"),
        )

    df = df.drop(columns=["Category"], errors="ignore")
    return df[
        df["Temperature"].between(0, 50)
        & df["Humidity"].between(0, 100)
        & (df["Soil_Moisture"] >= 0)
        & (df["Rainfall"] >= 0)
    ].dropna()


def _clip_outliers(df: pd.DataFrame, columns: list[str], factor: float = 1.5) -> pd.DataFrame:
    df = df.copy()
    for column in columns:
        if column not in df.columns:
            continue
        q1 = df[column].quantile(0.25)
        q3 = df[column].quantile(0.75)
        iqr = q3 - q1
        lower = q1 - factor * iqr
        upper = q3 + factor * iqr
        df[column] = df[column].clip(lower, upper)
    return df


def _build_preprocessor() -> ColumnTransformer:
    numeric_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])
    categorical_pipeline = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])
    return ColumnTransformer([
        ("num", numeric_pipeline, MODEL_NUMERIC_FEATURES),
        ("cat", categorical_pipeline, MODEL_CATEGORICAL_FEATURES),
    ])


# ==============================================================================
# 5. ANOMALY DETECTION
# ==============================================================================

def detect_anomalies(df: pd.DataFrame, z_thresh: float = 3.0) -> tuple[pd.DataFrame, dict]:
    stats_map: dict[str, tuple[float, float]] = {}
    mask = pd.Series(False, index=df.index)
    for col in SENSOR_FEATURES:
        if col not in df.columns:
            continue
        mu, sigma = df[col].mean(), df[col].std()
        stats_map[col] = (float(mu), float(sigma) or 1.0)
        mask |= ((df[col] - mu).abs() > z_thresh * sigma)
    df_out = df.copy()
    df_out["anomaly"] = mask.astype(int)
    return df_out, stats_map


def flag_sensor_anomaly(reading: dict, anomaly_stats: dict, z_thresh: float = 3.0) -> list[str]:
    flags = []
    for col, (mu, sigma) in anomaly_stats.items():
        val = reading.get(col)
        if val is not None and abs(val - mu) > z_thresh * sigma:
            flags.append(f"{col} value {val} is a statistical outlier (z > {z_thresh})")
    return flags


# ==============================================================================
# 6. DYNAMIC THRESHOLDS & TREND ANALYSIS
# ==============================================================================

def learn_dynamic_thresholds(df: pd.DataFrame, percentile_bounds: tuple = (5, 95)) -> dict:
    lo_p, hi_p = percentile_bounds
    return {
        feat: {
            "lower_bound": float(df[feat].quantile(lo_p / 100)),
            "upper_bound": float(df[feat].quantile(hi_p / 100)),
            "mean": float(df[feat].mean()),
            "std":  float(df[feat].std()),
        }
        for feat in SENSOR_FEATURES if feat in df.columns
    }


def analyze_temporal_trends(df: pd.DataFrame) -> dict:
    trends = {}
    for feat in SENSOR_FEATURES:
        if feat not in df.columns:
            continue
        data = df[feat].values
        slope, _, r_value, _, _ = stats.linregress(np.arange(len(data)), data)
        autocorr = pd.Series(data).autocorr(lag=1)
        trends[feat] = {
            "trend_slope":     float(slope),
            "trend_direction": "increasing" if slope > 0 else "decreasing",
            "r_squared":       float(r_value ** 2),
            "persistence":     float(autocorr) if not np.isnan(autocorr) else 0.0,
            "volatility":      float(np.std(data) / (np.mean(data) + 1e-8)),
            "mean":            float(np.mean(data)),
            "std":             float(np.std(data)),
        }
    return trends


# ==============================================================================
# 7. TRAINING PIPELINE
# ==============================================================================

MODEL_INPUT_FEATURES = MODEL_NUMERIC_FEATURES + MODEL_CATEGORICAL_FEATURES
CROP_FEATURES        = MODEL_INPUT_FEATURES

_RAINFALL_TO_HOURLY = 1.0 / (365.0 * 24.0)


def train(df: pd.DataFrame, random_state: int = 42) -> dict:
    """
    Two-stage TinyML pipeline.

        Stage 1  –  pH regressor  (RandomForestRegressor)
            Uses scaled numeric features plus zone/location context to capture
            non-linear soil pH behaviour without needing a large dataset.

        Stage 2  –  Crop classifier  (RandomForestClassifier)
            Uses the same cleaned feature set and cross-validated tree tuning
            for a stable small-data baseline.
    """

    if "Crop" not in df.columns or "Soil_pH" not in df.columns:
        raise ValueError("Dataset must contain 'Crop' and 'Soil_pH' columns.")

    # --- 1. Anomaly removal ---
    df_flagged, anomaly_stats = detect_anomalies(df)
    df_clean = (df_flagged[df_flagged["anomaly"] == 0]
                .drop(columns=["anomaly"])
                .reset_index(drop=True))
    df_clean = _clip_outliers(df_clean, MODEL_NUMERIC_FEATURES)

    dynamic_thresholds = learn_dynamic_thresholds(df_clean)
    temporal_trends    = analyze_temporal_trends(df_clean)

    # --- 2. Feature set ---
    feature_frame = df_clean[MODEL_INPUT_FEATURES].copy()
    y_ph   = df_clean["Soil_pH"].values
    y_crop = df_clean["Crop"].values

    # --- 4. Stratified train / test split ---
    X_tr, X_te, yph_tr, yph_te, yc_tr, yc_te = train_test_split(
        feature_frame, y_ph, y_crop,
        test_size=0.2, random_state=random_state, stratify=y_crop,
    )

    # --- 5a. pH regressor (scaled + selected features + RF) ---
    ph_pipeline = Pipeline([
        ("preprocess", _build_preprocessor()),
        ("select", SelectKBest(score_func=f_regression)),
        ("model", RandomForestRegressor(random_state=random_state, n_jobs=-1)),
    ])
    ph_grid = GridSearchCV(
        ph_pipeline,
        param_grid={
            "select__k": [5, 7, 9, "all"],
            "model__n_estimators": [200, 400, 600],
            "model__max_depth": [4, 6, 8, None],
            "model__min_samples_leaf": [1, 2, 4],
            "model__max_features": ["sqrt", 0.7, 1.0],
        },
        scoring="r2",
        cv=KFold(n_splits=min(5, len(X_tr)), shuffle=True, random_state=random_state),
        n_jobs=-1,
    )
    ph_grid.fit(X_tr, yph_tr)
    ph_model = ph_grid.best_estimator_

    # --- 5b. Crop classifier (scaled + selected features + RF) ---
    crop_pipeline = Pipeline([
        ("preprocess", _build_preprocessor()),
        ("select", SelectKBest(score_func=mutual_info_classif)),
        ("model", RandomForestClassifier(random_state=random_state, n_jobs=-1)),
    ])
    crop_grid = GridSearchCV(
        crop_pipeline,
        param_grid={
            "select__k": [5, 7, 9, "all"],
            "model__n_estimators": [200, 400, 600],
            "model__max_depth": [4, 6, 8, None],
            "model__min_samples_leaf": [1, 2, 4],
            "model__max_features": ["sqrt", 0.7, 1.0],
            "model__class_weight": ["balanced", "balanced_subsample"],
        },
        scoring="accuracy",
        cv=StratifiedKFold(
            n_splits=min(5, pd.Series(yc_tr).value_counts().min()),
            shuffle=True,
            random_state=random_state,
        ),
        n_jobs=-1,
    )
    crop_grid.fit(X_tr, yc_tr)
    crop_model = crop_grid.best_estimator_

    # --- 6. Metrics ---
    metrics = {
        "ph_mae":        mean_absolute_error(yph_te, ph_model.predict(X_te)),
        "ph_r2":         r2_score(yph_te, ph_model.predict(X_te)),
        "crop_accuracy": accuracy_score(yc_te, crop_model.predict(X_te)),
        "ph_cv_score":   float(ph_grid.best_score_),
        "crop_cv_score": float(crop_grid.best_score_),
        "ph_best_params": ph_grid.best_params_,
        "crop_best_params": crop_grid.best_params_,
        "n_train":       len(X_tr),
        "n_test":        len(X_te),
        "crop_labels":   crop_model.named_steps["model"].classes_.tolist(),
    }

    return {
        "ph_model":           ph_model,
        "crop_model":         crop_model,
        "anomaly_stats":      anomaly_stats,
        "dynamic_thresholds": dynamic_thresholds,
        "temporal_trends":    temporal_trends,
        "metrics":            metrics,
    }


# ==============================================================================
# 8. MODEL I/O
# ==============================================================================

_ARTEFACTS = {
    "ph_model":           "ph_regressor.joblib",
    "crop_model":         "crop_classifier.joblib",
    "anomaly_stats":      "anomaly_stats.joblib",
    "dynamic_thresholds": "dynamic_thresholds.joblib",
    "temporal_trends":    "temporal_trends.joblib",
}


def save_models(artefacts: dict) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for key, filename in _ARTEFACTS.items():
        joblib.dump(artefacts[key], MODEL_DIR / filename)
    (MODEL_DIR / "metrics.json").write_text(json.dumps(artefacts["metrics"], indent=2))


def load_models() -> dict:
    return {key: joblib.load(MODEL_DIR / filename) for key, filename in _ARTEFACTS.items()}


# =======================================================================
# 9. C++ EXPORT  (Arduino / ESP32)
# ==============================================================================

def export_cpp_headers(artefacts: dict, output_dir: Path | None = None) -> Path:
    try:
        from micromlgen import port
    except ImportError as exc:
        raise ImportError("Install micromlgen: pip install micromlgen") from exc

    out = output_dir or (MODEL_DIR / "tinyml")
    out.mkdir(parents=True, exist_ok=True)

    (out / "ph_regressor.h").write_text(
        port(artefacts["ph_model"], classname="PhRegressor")
    )
    (out / "crop_classifier.h").write_text(
        port(artefacts["crop_model"], classname="CropClassifier")
    )

    labels = artefacts["metrics"]["crop_labels"]
    (out / "crop_labels.h").write_text(
        "#pragma once\n"
        f"static const int kCropLabelCount = {len(labels)};\n"
        "static const char *kCropLabels[] = {\n"
        + "".join(f'  "{lbl}",\n' for lbl in labels)
        + "};\n"
    )

    (out / "metadata.json").write_text(json.dumps({
        "sensor_features": MODEL_INPUT_FEATURES,
        "crop_features":   CROP_FEATURES,
        "rainfall_unit":   "annual_mm",
        "rainfall_scale":  1.0,
        "ph_model":        "RandomForestRegressor",
        "crop_model":      "RandomForestClassifier",
    }, indent=2))

    return out


# ==============================================================================
# 10. INFERENCE
# ==============================================================================

def predict(
    temperature: float,
    humidity: float,
    soil_moisture: float,
    rainfall: float,
    models: dict | None = None,
    longitude: float | None = None,
    latitude: float | None = None,
) -> dict:
    annual_rainfall   = rainfall * 12 if rainfall <= 400 else rainfall

    bounds_issues = []
    for key, value, lo, hi, unit in [
        ("temperature",    temperature,    *SENSOR_BOUNDS["temperature"],     "°C"),
        ("humidity",       humidity,       *SENSOR_BOUNDS["humidity"],        "%"),
        ("soil_moisture",  soil_moisture,  *SENSOR_BOUNDS["soil_moisture"],   "%"),
        ("annual_rainfall",annual_rainfall,*SENSOR_BOUNDS["annual_rainfall"], "mm"),
    ]:
        if not (lo <= value <= hi):
            bounds_issues.append(f"{key} {value}{unit} outside range ({lo}–{hi}{unit})")

    if bounds_issues:
        return {"sensor_quality": "❌ NOT SUITABLE AREA", "suitability_issues": bounds_issues}

    zone       = detect_zone(temperature, humidity, annual_rainfall, longitude, latitude)
    zone_issues = check_zone_suitability(zone, temperature, humidity, annual_rainfall, soil_moisture)

    result = {
        "climate_zone":            zone.get("name"),
        "zone_key":                zone.get("zone_key"),
        "zone_match_score":        float(zone.get("overall_score", 0.0)),
        "zone_match_method":       zone.get("match_method", "auto"),
        "zone_suitability_issues": zone_issues,
        "geolocation_used":        longitude is not None or latitude is not None,
    }

    if models is None:
        return result

    reading = {
        "Temperature":  temperature,
        "Humidity":     humidity,
        "Soil_Moisture": soil_moisture,
        "Rainfall":     annual_rainfall,
    }
    anomaly_flags = flag_sensor_anomaly(reading, models["anomaly_stats"])

    ph_model   = models["ph_model"]
    crop_model = models["crop_model"]

    X_input = pd.DataFrame([{
        "Temperature": temperature,
        "Humidity": humidity,
        "Soil_Moisture": soil_moisture,
        "Rainfall": annual_rainfall,
        "Latitude": latitude if latitude is not None else 7.2,
        "Longitude": longitude if longitude is not None else 80.7,
        "Zone": zone.get("name", "Unknown"),
    }])

    pred_ph   = float(ph_model.predict(X_input)[0])
    pred_crop = str(crop_model.predict(X_input)[0])

    proba      = crop_model.predict_proba(X_input)[0]
    confidence = float(proba.max())

    result.update({
        "predicted_ph":   round(pred_ph, 2),
        "predicted_crop": pred_crop,
        "confidence":     round(confidence, 3),
        "anomaly_flags":  anomaly_flags,
    })
    return result


# ==============================================================================
# 11. CLI
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(description="TinyML Crop Recommendation Pipeline")
    sub = parser.add_subparsers(dest="command")

    tr = sub.add_parser("train", help="Train and save models")
    tr.add_argument("--data", type=Path, default=DATA_PATH)
    tr.add_argument("--export-cpp", action="store_true")

    pr = sub.add_parser("predict", help="Run inference on sensor values")
    pr.add_argument("--temperature",   type=float, required=True)
    pr.add_argument("--humidity",      type=float, required=True)
    pr.add_argument("--soil-moisture", type=float, required=True)
    pr.add_argument("--rainfall",      type=float, required=True)
    pr.add_argument("--longitude",     type=float)
    pr.add_argument("--latitude",      type=float)
    pr.add_argument("--no-model",      action="store_true")

    args = parser.parse_args()

    if args.command == "train":
        df = load_data(args.data)
        print(f"[Train] Loaded {len(df)} rows.")
        artefacts = train(df)
        save_models(artefacts)
        m = artefacts["metrics"]
        print(f"[Train] pH MAE={m['ph_mae']:.4f}  R²={m['ph_r2']:.4f}  "
              f"Crop accuracy={m['crop_accuracy']:.4f}")
        if args.export_cpp:
            out = export_cpp_headers(artefacts)
            print(f"[Export] C++ headers written to {out}")

    elif args.command == "predict":
        models = None if args.no_model else load_models()
        result = predict(
            temperature=args.temperature,
            humidity=args.humidity,
            soil_moisture=args.soil_moisture,
            rainfall=args.rainfall,
            models=models,
            longitude=args.longitude,
            latitude=args.latitude,
        )
        print(json.dumps(result, indent=2))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()