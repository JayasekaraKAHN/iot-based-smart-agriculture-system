import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, mean_absolute_error, r2_score, classification_report
from sklearn.model_selection import train_test_split, StratifiedKFold, RandomizedSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler, LabelEncoder, OneHotEncoder
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier, IsolationForest
from sklearn.tree import DecisionTreeRegressor, DecisionTreeClassifier
from sklearn.cluster import KMeans
from scipy import stats
from sklearn.utils.class_weight import compute_sample_weight, compute_class_weight
from catboost import CatBoostClassifier


DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "crops.csv"
MODEL_DIR = Path(__file__).resolve().parents[1] / "models"


# Sri Lankan Climate Zones Definition (Based on crops.csv coordinate distribution)
# Zone Priority: Upcountry (small, specific) > Intermediate > Dry > Wet (largest)
CLIMATE_ZONES = {
    "upcountry": {
        "name": "Upcountry",
        "regions": ["Nuwara Eliya", "Badulla", "Kandi Heights"],
        "temperature_range": (18.1, 33.8),
        "humidity_range": (50.9, 94.3),
        "rainfall_range": (512.7, 2976.3),
        "suitable_crops": ["Tea", "Potato", "Carrot", "Cabbage", "Strawberry", "Avocado"],
        "lon_range": (80.5057, 80.9872),  # Exact from dataset
        "lat_range": (6.5138, 7.1906),    # Exact from dataset (small/specific zone)
        "priority": 1,  # CHECK FIRST - smallest, most specific
    },
    "intermediate_zone": {
        "name": "Intermediate Zone",
        "regions": ["Kurunegala", "Matale", "Badulla"],
        "temperature_range": (18.2, 33.8),
        "humidity_range": (50.7, 94.4),
        "rainfall_range": (566.3, 2962.1),
        "suitable_crops": ["Potato", "Carrot", "Cabbage", "Tomato", "Maize", "Tobacco"],
        "lon_range": (80.0163, 81.4249),  # Exact from dataset
        "lat_range": (6.0275, 8.4922),    # Exact from dataset
        "priority": 2,
    },
    "dry_zone": {
        "name": "Dry Zone",
        "regions": ["Anuradhapura", "Polonnaruwa", "Jaffna"],
        "temperature_range": (18.1, 33.7),
        "humidity_range": (50.7, 94.8),
        "rainfall_range": (546.0, 2992.8),
        "suitable_crops": ["Groundnut", "Maize", "Soybean", "Chilli", "Onion", "Mango"],
        "lon_range": (80.5503, 81.9766),  # Exact from dataset
        "lat_range": (6.5393, 9.4899),    # Exact from dataset
        "priority": 3,
    },
    "wet_zone": {
        "name": "Wet Zone",
        "regions": ["Colombo", "Galle", "Kandy", "Low-country"],
        "temperature_range": (18.3, 33.5),
        "humidity_range": (50.6, 94.6),
        "rainfall_range": (555.3, 2987.3),
        "suitable_crops": ["Banana", "Mango", "Coconut", "Rice", "Tea", "Cinnamon"],
        "lon_range": (79.8270, 80.9653),  # Exact from dataset
        "lat_range": (5.9292, 7.4502),    # Exact from dataset
        "priority": 4,  # CHECK LAST - largest zone, catches rest
    },
}


CROP_FAMILY_MAP = {
    "Banana": "Fruits",
    "Mango": "Fruits",
    "Papaya": "Fruits",
    "Rice": "Cereals",
    "Maize": "Cereals",
    "Black Gram": "Pulses",
    "Green Gram": "Pulses",
    "Cabbage": "Vegetables",
    "Carrot": "Vegetables",
    "Tomato": "Vegetables",
    "Potato": "Vegetables",
    "Onion": "Vegetables",
    "Chili": "Spices",
    "Pepper": "Spices",
    "Cinnamon": "Spices",
    "Tea": "Plantation",
    "Coffee": "Plantation",
    "Rubber": "Plantation",
    "Coconut": "Plantation",
    "Sugarcane": "Plantation",
}


def add_crop_family(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["Crop_Family"] = df["Crop"].map(CROP_FAMILY_MAP).fillna("Other")
    return df


def identify_climate_zone(temperature: float, humidity: float, rainfall_annual: float) -> dict:
    """
    Identify which Sri Lankan climate zone the sensor readings belong to.
    
    Args:
        temperature: Average temperature in °C
        humidity: Average humidity in %
        rainfall_annual: Annual rainfall in mm
    
    Returns:
        Dictionary with zone info, match score, and suitable crops
    """
    zone_scores = {}
    
    for zone_key, zone_info in CLIMATE_ZONES.items():
        temp_score = 1.0 if zone_info["temperature_range"][0] <= temperature <= zone_info["temperature_range"][1] else 0.0
        humidity_score = 1.0 if zone_info["humidity_range"][0] <= humidity <= zone_info["humidity_range"][1] else 0.0
        rainfall_score = 1.0 if zone_info["rainfall_range"][0] <= rainfall_annual <= zone_info["rainfall_range"][1] else 0.0
        
        # Weighted average (rainfall has more weight as it's most distinctive)
        zone_scores[zone_key] = {
            "name": zone_info["name"],
            "temp_match": temp_score,
            "humidity_match": humidity_score,
            "rainfall_match": rainfall_score,
            "overall_score": (temp_score * 0.3 + humidity_score * 0.3 + rainfall_score * 0.4),
            "suitable_crops": zone_info["suitable_crops"],
            "ranges": {
                "temperature": zone_info["temperature_range"],
                "humidity": zone_info["humidity_range"],
                "rainfall": zone_info["rainfall_range"],
            }
        }
    
    # Find best matching zone
    best_zone_key = max(zone_scores, key=lambda k: zone_scores[k]["overall_score"])
    best_zone = zone_scores[best_zone_key]
    best_zone["zone_key"] = best_zone_key
    
    return best_zone


def identify_climate_zone_by_coordinates(longitude: float, latitude: float) -> dict:
    """
    Identify which Sri Lankan climate zone the device is in using geolocation coordinates.
    Uses strict geographic boundaries derived from actual crop dataset.
    
    Strategy: 
    1. Check exact matches in priority order (Upcountry > Intermediate > Dry > Wet)
    2. If multiple zones match (overlap), use closest centroid
    
    Args:
        longitude: Device longitude in decimal degrees
        latitude: Device latitude in decimal degrees
    
    Returns:
        Dictionary with zone info and suitable crops
    """
    import math
    
    # Define zone centroids for distance-based matching
    zone_centroids = {
        "upcountry": (80.7341, 6.8508),
        "intermediate_zone": (80.6680, 7.3351),
        "dry_zone": (81.3772, 8.0565),
        "wet_zone": (80.3452, 6.6146),
    }
    
    # First, find all matching zones (exact boundary match)
    matching_zones = []
    
    for zone_key, zone_info in CLIMATE_ZONES.items():
        lon_range = zone_info.get("lon_range", (None, None))
        lat_range = zone_info.get("lat_range", (None, None))
        
        if lon_range[0] is not None and lat_range[0] is not None:
            if lon_range[0] <= longitude <= lon_range[1] and lat_range[0] <= latitude <= lat_range[1]:
                matching_zones.append(zone_key)
    
    # If exactly one zone matches, return it
    if len(matching_zones) == 1:
        zone_key = matching_zones[0]
        zone_info = CLIMATE_ZONES[zone_key]
        return {
            "zone_key": zone_key,
            "name": zone_info["name"],
            "regions": zone_info["regions"],
            "suitable_crops": zone_info["suitable_crops"],
            "temperature_range": zone_info["temperature_range"],
            "humidity_range": zone_info["humidity_range"],
            "rainfall_range": zone_info["rainfall_range"],
            "match_method": "geolocation (exact)",
            "overall_score": 1.0,
        }
    
    # If multiple zones match, find closest centroid
    if len(matching_zones) > 1:
        closest_zone = min(matching_zones, key=lambda z: 
            math.sqrt((longitude - zone_centroids[z][0])**2 + (latitude - zone_centroids[z][1])**2)
        )
        zone_info = CLIMATE_ZONES[closest_zone]
        return {
            "zone_key": closest_zone,
            "name": zone_info["name"],
            "regions": zone_info["regions"],
            "suitable_crops": zone_info["suitable_crops"],
            "temperature_range": zone_info["temperature_range"],
            "humidity_range": zone_info["humidity_range"],
            "rainfall_range": zone_info["rainfall_range"],
            "match_method": "geolocation (closest match)",
            "overall_score": 1.0,
        }
    
    # If no exact match, find closest zone by centroid distance
    if not matching_zones:
        closest_zone = min(zone_centroids.keys(), key=lambda z: 
            math.sqrt((longitude - zone_centroids[z][0])**2 + (latitude - zone_centroids[z][1])**2)
        )
        zone_info = CLIMATE_ZONES[closest_zone]
        return {
            "zone_key": closest_zone,
            "name": zone_info["name"],
            "regions": zone_info["regions"],
            "suitable_crops": zone_info["suitable_crops"],
            "temperature_range": zone_info["temperature_range"],
            "humidity_range": zone_info["humidity_range"],
            "rainfall_range": zone_info["rainfall_range"],
            "match_method": "geolocation (nearest zone)",
            "overall_score": 0.5,
            "note": f"Coordinates slightly outside known zones, using nearest match",
        }
    
    # Fallback (should not reach here)
    return {
        "zone_key": "unknown",
        "name": "Unknown Zone",
        "regions": [],
        "suitable_crops": [],
        "match_method": "none",
        "overall_score": 0.0,
        "note": f"Coordinates ({longitude:.4f}, {latitude:.4f}) could not be matched to any zone",
    }


def get_zone_suitability_ranges(zone_key: str) -> dict:
    zone_ranges = {
        "wet_zone": {
            "temperature": (23.0, 31.0),
            "humidity": (70.0, 95.0),
            "rainfall": (2500.0, 10000.0),
            "soil_moisture": (50.0, 100.0),
        },
        "intermediate_zone": {
            "temperature": (25.0, 32.0),
            "humidity": (65.0, 80.0),
            "rainfall": (1750.0, 2500.0),
            "soil_moisture": (35.0, 80.0),
        },
        "dry_zone": {
            "temperature": (28.0, 35.0),
            "humidity": (60.0, 79.0),
            "rainfall": (0.0, 1750.0),
            "soil_moisture": (20.0, 65.0),
        },
        "upcountry": {
            "temperature": (18.0, 27.0),
            "humidity": (60.0, 90.0),
            "rainfall": (1200.0, 5000.0),
            "soil_moisture": (40.0, 90.0),
        },
    }
    return zone_ranges.get(zone_key, {})


def check_zone_suitability(zone_info: dict, temperature: float, humidity: float, annual_rainfall: float, soil_moisture: float) -> list[str]:
    issues = []
    zone_key = zone_info.get("zone_key", "unknown")
    zone_ranges = get_zone_suitability_ranges(zone_key)

    if not zone_ranges:
        issues.append("Climate zone could not be identified reliably")
        return issues

    temp_low, temp_high = zone_ranges["temperature"]
    hum_low, hum_high = zone_ranges["humidity"]
    rain_low, rain_high = zone_ranges["rainfall"]
    soil_low, soil_high = zone_ranges["soil_moisture"]

    if not (temp_low <= temperature <= temp_high):
        issues.append(
            f"Temperature {temperature}°C outside detected zone range ({temp_low}-{temp_high}°C)"
        )
    if not (hum_low <= humidity <= hum_high):
        issues.append(
            f"Humidity {humidity}% outside detected zone range ({hum_low}-{hum_high}%)"
        )
    if not (rain_low <= annual_rainfall <= rain_high):
        issues.append(
            f"Annual rainfall {annual_rainfall:.1f}mm outside detected zone range ({rain_low}-{rain_high}mm)"
        )
    if not (soil_low <= soil_moisture <= soil_high):
        issues.append(
            f"Soil moisture {soil_moisture}% outside detected zone range ({soil_low}-{soil_high}%)"
        )

    return issues


def load_data(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    if "Category" in df.columns:
        df = df.drop(columns=["Category"])
    
    # Data cleaning: remove unrealistic values
    df = df[(df["Temperature"] > 0) & (df["Temperature"] < 50)]
    df = df[(df["Humidity"] >= 0) & (df["Humidity"] <= 100)]
    df = df[(df["Soil_Moisture"] >= 0)]
    df = df[(df["Rainfall"] >= 0)]
    df = df.dropna()
    
    return df


def create_engineered_features(df: pd.DataFrame) -> pd.DataFrame:
    """Create interaction, nonlinear, and proxy features."""
    df = df.copy()
    
    # Interaction features
    df["temp_humidity"] = df["Temperature"] * df["Humidity"]
    df["water_index"] = df["Rainfall"] * df["Soil_Moisture"]
    df["dryness_index"] = df["Temperature"] / (df["Humidity"] + 1)
    
    # Nonlinear transformations
    df["temp_squared"] = df["Temperature"] ** 2
    df["humidity_log"] = np.log1p(df["Humidity"])
    
    # Soil type proxy using clustering
    soil_kmeans = KMeans(n_clusters=3, random_state=42)
    df["soil_type_proxy"] = soil_kmeans.fit_predict(df[["Soil_Moisture", "Rainfall"]])
    
    # Fertility index (approximation of NPK effect)
    df["fertility_index"] = df["Soil_Moisture"] - 0.3 * df["Rainfall"]
    
    return df, soil_kmeans


def detect_anomalies(df: pd.DataFrame, contamination: float = 0.05) -> tuple:
    """
    Detect sensor anomalies using Isolation Forest.
    
    Returns:
        - df with 'anomaly' column (1 = anomaly, 0 = normal)
        - isolation_forest model (for on-device detection)
    """
    base_features = ["Temperature", "Humidity", "Soil_Moisture", "Rainfall"]
    X = df[base_features].values
    
    # Train Isolation Forest
    iso_forest = IsolationForest(contamination=contamination, random_state=42)
    anomaly_labels = iso_forest.fit_predict(X)
    df_copy = df.copy()
    df_copy["anomaly"] = (anomaly_labels == -1).astype(int)
    
    return df_copy, iso_forest


def learn_dynamic_thresholds(df: pd.DataFrame, percentile_bounds: tuple = (5, 95)) -> dict:
    """
    Learn dynamic sensor thresholds from data (ML-based, not hard-coded).
    Uses percentile-based bounds to define acceptable ranges.
    
    Args:
        percentile_bounds: (lower_percentile, upper_percentile) for range definition
    
    Returns:
        Dictionary with learned thresholds for each sensor
    """
    base_features = ["Temperature", "Humidity", "Soil_Moisture", "Rainfall"]
    thresholds = {}
    
    for feature in base_features:
        lower = df[feature].quantile(percentile_bounds[0] / 100)
        upper = df[feature].quantile(percentile_bounds[1] / 100)
        thresholds[feature] = {
            "lower_bound": float(lower),
            "upper_bound": float(upper),
            "mean": float(df[feature].mean()),
            "std": float(df[feature].std()),
        }
    
    return thresholds


def analyze_temporal_trends(df: pd.DataFrame, window_size: int = 10) -> dict:
    """
    Analyze temporal trends using rolling statistics and autocorrelation.
    Detects patterns and trend direction in sensor data.
    
    Args:
        window_size: rolling window size for trend calculation
    
    Returns:
        Dictionary with trend analysis metrics
    """
    base_features = ["Temperature", "Humidity", "Soil_Moisture", "Rainfall"]
    trends = {}
    
    for feature in base_features:
        data = df[feature].values
        
        # Rolling statistics
        rolling_mean = pd.Series(data).rolling(window=window_size).mean()
        rolling_std = pd.Series(data).rolling(window=window_size).std()
        
        # Trend direction (linear regression slope)
        x = np.arange(len(data))
        slope, intercept, r_value, p_value, std_err = stats.linregress(x, data)
        
        # Autocorrelation at lag 1 (persistence)
        autocorr = pd.Series(data).autocorr(lag=1)
        
        # Volatility (coefficient of variation)
        volatility = np.std(data) / (np.mean(data) + 1e-8)
        
        trends[feature] = {
            "trend_slope": float(slope),
            "trend_direction": "increasing" if slope > 0 else "decreasing",
            "r_squared": float(r_value ** 2),
            "persistence": float(autocorr) if not np.isnan(autocorr) else 0.0,
            "volatility": float(volatility),
            "mean": float(np.mean(data)),
            "std": float(np.std(data)),
        }
    
    return trends


def build_preprocessor(numeric_columns: list[str], categorical_columns: list[str]) -> ColumnTransformer:
    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    categorical_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]
    )
    transformers = [("num", numeric_pipeline, numeric_columns)]
    if categorical_columns:
        transformers.append(("cat", categorical_pipeline, categorical_columns))
    return ColumnTransformer(transformers=transformers, remainder="drop")


def train_models(df: pd.DataFrame, random_state: int = 42) -> dict:
    if "Crop" not in df.columns:
        raise ValueError("Missing required column: Crop")

    if "Soil_pH" not in df.columns:
        raise ValueError("Missing required column: Soil_pH")

    # 1. ANOMALY DETECTION (ML-driven outlier detection)
    df_clean, iso_forest = detect_anomalies(df, contamination=0.05)
    df_clean = df_clean[df_clean["anomaly"] == 0].drop(columns=["anomaly"])
    
    # 2. DYNAMIC THRESHOLDS (ML-learned, not hard-coded)
    dynamic_thresholds = learn_dynamic_thresholds(df_clean)
    
    # 3. TEMPORAL TREND ANALYSIS (pattern learning)
    temporal_trends = analyze_temporal_trends(df_clean, window_size=10)
    
    # Create engineered features
    df_eng, soil_kmeans = create_engineered_features(df_clean)
    df_eng = add_crop_family(df_eng)
    
    # Base + engineered features
    base_features = [
        "Temperature",
        "Humidity",
        "Soil_Moisture",
        "Rainfall",
        "Latitude",
        "Longitude",
    ]
    categorical_features = ["Zone"]
    engineered_features = [
        "temp_humidity",
        "water_index",
        "dryness_index",
        "temp_squared",
        "humidity_log",
        "soil_type_proxy",
        "fertility_index",
    ]
    feature_columns = base_features + engineered_features + categorical_features

    X = df_eng[feature_columns]
    y_ph = df_eng["Soil_pH"]
    y_crop = df_eng["Crop_Family"]
    label_encoder = LabelEncoder()
    y_crop_encoded = label_encoder.fit_transform(y_crop)

    X_train, X_test, y_ph_train, y_ph_test, y_crop_train, y_crop_test = train_test_split(
        X,
        y_ph,
        y_crop_encoded,
        test_size=0.2,
        random_state=random_state,
        stratify=y_crop_encoded,
    )

    preprocessor = build_preprocessor(base_features + engineered_features, categorical_features)

    ph_regressor = RandomForestRegressor(
        n_estimators=400,
        random_state=random_state,
        n_jobs=-1,
    )

    ph_model = Pipeline(
        steps=[
            ("preprocess", preprocessor),
            ("model", ph_regressor),
        ]
    )

    ph_model.fit(X_train, y_ph_train)

    y_ph_pred_train = ph_model.predict(X_train)
    y_ph_pred_test = ph_model.predict(X_test)

    crop_features_train = pd.concat(
        [
            X_train.reset_index(drop=True),
            pd.DataFrame(y_ph_pred_train, columns=["pred_pH"]),
        ],
        axis=1,
    )
    crop_features_test = pd.concat(
        [
            X_test.reset_index(drop=True),
            pd.DataFrame(y_ph_pred_test, columns=["pred_pH"]),
        ],
        axis=1,
    )

    crop_feature_columns = list(crop_features_train.columns)
    crop_numeric_features = [c for c in crop_feature_columns if c not in categorical_features]
    crop_preprocessor = build_preprocessor(crop_numeric_features, categorical_features)

    class_weights = compute_class_weight(
        class_weight="balanced",
        classes=np.unique(y_crop_train),
        y=y_crop_train,
    )
    crop_classifier = CatBoostClassifier(
        loss_function="MultiClass",
        eval_metric="Accuracy",
        verbose=False,
        random_state=random_state,
    )

    # Hyperparameter tuning with stratified CV
    tuning_pipeline = Pipeline(
        steps=[
            ("preprocess", crop_preprocessor),
            ("model", crop_classifier),
        ]
    )
    param_dist = {
        "model__iterations": [300, 500, 800, 1000],
        "model__depth": [4, 6, 8, 10],
        "model__learning_rate": [0.03, 0.05, 0.08, 0.1],
        "model__l2_leaf_reg": [1, 3, 5, 7],
    }
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=random_state)
    tuner = RandomizedSearchCV(
        tuning_pipeline,
        param_distributions=param_dist,
        n_iter=12,
        scoring="accuracy",
        cv=cv,
        random_state=random_state,
        n_jobs=-1,
    )
    tuner.fit(crop_features_train, y_crop_train)
    best_params = tuner.best_params_

    # Final training with class-weighted boosting
    crop_classifier.set_params(
        iterations=best_params.get("model__iterations", 500),
        depth=best_params.get("model__depth", 6),
        learning_rate=best_params.get("model__learning_rate", 0.05),
        l2_leaf_reg=best_params.get("model__l2_leaf_reg", 3),
        class_weights=class_weights.tolist(),
    )
    X_train_processed = crop_preprocessor.fit_transform(crop_features_train)
    sample_weights = compute_sample_weight(class_weight="balanced", y=y_crop_train)
    crop_classifier.fit(X_train_processed, y_crop_train, sample_weight=sample_weights)

    crop_model = Pipeline(
        steps=[
            ("preprocess", crop_preprocessor),
            ("model", crop_classifier),
        ]
    )

    # CV scores using tuned pipeline
    cv_scores = tuner.cv_results_["mean_test_score"].tolist()

    metrics = {
        "ph_mae": mean_absolute_error(y_ph_test, y_ph_pred_test),
        "ph_r2": r2_score(y_ph_test, y_ph_pred_test),
        "crop_accuracy": accuracy_score(y_crop_test, crop_model.predict(crop_features_test)),
        "crop_cv_scores": cv_scores,
        "crop_cv_mean": float(np.mean(cv_scores)),
        "crop_best_params": best_params,
        "feature_columns": feature_columns,
        "base_features": base_features,
        "engineered_features": engineered_features,
        "crop_feature_columns": crop_feature_columns,
        "crop_families": label_encoder.classes_.tolist(),
    }

    return {
        "ph_model": ph_model,
        "crop_model": crop_model,
        "soil_kmeans": soil_kmeans,
        "iso_forest": iso_forest,
        "dynamic_thresholds": dynamic_thresholds,
        "temporal_trends": temporal_trends,
        "label_encoder": label_encoder,
        "metrics": metrics,
    }


def train_tinyml_models(df: pd.DataFrame, random_state: int = 42) -> dict:
    if "Crop" not in df.columns:
        raise ValueError("Missing required column: Crop")

    if "Soil_pH" not in df.columns:
        raise ValueError("Missing required column: Soil_pH")

    feature_candidates = [
        "Temperature",
        "Humidity",
        "Soil_Moisture",
        "Rainfall",
    ]
    feature_columns = [c for c in feature_candidates if c in df.columns]
    if not feature_columns:
        raise ValueError("No usable feature columns found for TinyML prediction.")

    imputer = SimpleImputer(strategy="median")
    X = imputer.fit_transform(df[feature_columns])

    ph_regressor = DecisionTreeRegressor(
        max_depth=6,
        min_samples_leaf=4,
        random_state=random_state,
    )
    ph_regressor.fit(X, df["Soil_pH"])
    ph_predictions = ph_regressor.predict(X)

    crop_features = np.hstack([X, ph_predictions.reshape(-1, 1)])
    crop_feature_columns = feature_columns + ["pred_pH"]

    crop_model = DecisionTreeClassifier(
        max_depth=7,
        min_samples_leaf=4,
        random_state=random_state,
        class_weight="balanced",
    )
    crop_model.fit(crop_features, df["Crop"])

    return {
        "ph_regressor": ph_regressor,
        "crop_model": crop_model,
        "feature_columns": feature_columns,
        "crop_feature_columns": crop_feature_columns,
        "crop_labels": crop_model.classes_.tolist(),
    }


def export_tinyml_models(df: pd.DataFrame, random_state: int = 42) -> Path:
    try:
        from micromlgen import port
    except ImportError as exc:
        raise ImportError("micromlgen is required for TinyML export.") from exc

    result = train_tinyml_models(df, random_state=random_state)
    output_dir = MODEL_DIR / "tinyml"
    output_dir.mkdir(parents=True, exist_ok=True)

    ph_header = port(result["ph_regressor"], classname="PhRegressor")
    (output_dir / "ph_regressor.h").write_text(ph_header)

    crop_header = port(result["crop_model"], classname="CropClassifier")
    (output_dir / "crop_classifier.h").write_text(crop_header)

    labels = result["crop_labels"]
    labels_header = "#pragma once\n"
    labels_header += f"static const int kCropLabelCount = {len(labels)};\n"
    labels_header += "static const char *kCropLabels[] = {\n"
    for label in labels:
        labels_header += f"  \"{label}\",\n"
    labels_header += "};\n"
    (output_dir / "crop_labels.h").write_text(labels_header)

    metadata = {
        "feature_columns": result["feature_columns"],
        "crop_feature_columns": result["crop_feature_columns"],
    }
    (output_dir / "metadata.json").write_text(json.dumps(metadata, indent=2))

    return output_dir


def save_models(ph_model, crop_model, soil_kmeans, iso_forest, dynamic_thresholds, temporal_trends, label_encoder) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(ph_model, MODEL_DIR / "ph_regressor.joblib")
    joblib.dump(crop_model, MODEL_DIR / "crop_classifier.joblib")
    joblib.dump(soil_kmeans, MODEL_DIR / "soil_kmeans.joblib")
    joblib.dump(iso_forest, MODEL_DIR / "anomaly_detector.joblib")
    joblib.dump(dynamic_thresholds, MODEL_DIR / "dynamic_thresholds.joblib")
    joblib.dump(temporal_trends, MODEL_DIR / "temporal_trends.joblib")
    joblib.dump(label_encoder, MODEL_DIR / "crop_label_encoder.joblib")


def predict_crop(temperature, humidity, soil_moisture, rainfall, min_confidence=0.6, longitude=None, latitude=None):
    # Sri Lankan agricultural suitability constraints based on climate zone ranges
    # Temperature: 23-34°C (Wet 23-31, Intermediate 25-32, Dry 28-34+)
    # Humidity: 60-95% (Dry 60-79, Intermediate 65-80, Wet 70-90+)
    # Soil Moisture: 20-80% (operational range for tropical crops)
    # Rainfall: Annualized 800-5000mm (Dry <1750, Intermediate 1750-2500, Wet >2500)
    
    TEMP_MIN, TEMP_MAX = 23.0, 34.0
    HUMIDITY_MIN, HUMIDITY_MAX = 60.0, 95.0
    SOIL_MOISTURE_MIN, SOIL_MOISTURE_MAX = 20.0, 80.0
    ANNUAL_RAINFALL_MIN, ANNUAL_RAINFALL_MAX = 800.0, 5000.0
    
    # Rainfall unit handling: treat values <= 400 as monthly (typical monthly range), else annual
    annual_rainfall = rainfall * 12 if rainfall <= 400 else rainfall
    
    # Check suitability for Sri Lankan crop growth
    suitability_issues = []
    
    if temperature < TEMP_MIN or temperature > TEMP_MAX:
        suitability_issues.append(f"Temperature {temperature}°C outside suitable range ({TEMP_MIN}-{TEMP_MAX}°C)")
    
    if humidity < HUMIDITY_MIN or humidity > HUMIDITY_MAX:
        suitability_issues.append(f"Humidity {humidity}% outside suitable range ({HUMIDITY_MIN}-{HUMIDITY_MAX}%)")
    
    if soil_moisture < SOIL_MOISTURE_MIN or soil_moisture > SOIL_MOISTURE_MAX:
        suitability_issues.append(f"Soil Moisture {soil_moisture}% outside suitable range ({SOIL_MOISTURE_MIN}-{SOIL_MOISTURE_MAX}%)")
    
    if annual_rainfall < ANNUAL_RAINFALL_MIN or annual_rainfall > ANNUAL_RAINFALL_MAX:
        suitability_issues.append(
            f"Annual rainfall {annual_rainfall:.1f}mm outside suitable range ({ANNUAL_RAINFALL_MIN}-{ANNUAL_RAINFALL_MAX}mm)"
        )
    
    # Return "not suitable" if conditions fail Sri Lankan agricultural standards
    if suitability_issues:
        return {
            "sensor_quality": "❌ NOT SUITABLE AREA",
            "suitability_message": "Environmental conditions not suitable for crop growth in Sri Lanka",
            "suitability_issues": suitability_issues,
            "climate_zone": None,
            "zone_match_score": None,
            "threshold_alerts": [],
            "predicted_pH": None,
            "top_crops": [],
            "zone_suitable_crops": []
        }
    
    # Identify climate zone based on geolocation (if available) or environmental data
    if longitude is not None and latitude is not None:
        # Use geolocation-based identification (more accurate)
        climate_zone_info = identify_climate_zone_by_coordinates(longitude, latitude)
    else:
        # Fall back to environmental data-based identification
        climate_zone_info = identify_climate_zone(temperature, humidity, annual_rainfall)

    zone_suitability_issues = check_zone_suitability(
        climate_zone_info,
        temperature,
        humidity,
        annual_rainfall,
        soil_moisture,
    )

    if climate_zone_info.get("zone_key") == "unknown" or climate_zone_info.get("overall_score", 0.0) < 0.5:
        return {
            "sensor_quality": "❌ NOT SUITABLE AREA",
            "suitability_message": "Climate zone could not be matched reliably for crop growth",
            "suitability_issues": ["Unable to identify a reliable Sri Lankan climate zone"],
            "climate_zone": None,
            "zone_match_score": float(climate_zone_info.get("overall_score", 0.0)),
            "threshold_alerts": [],
            "predicted_pH": None,
            "top_crops": [],
            "zone_suitable_crops": [],
        }

    if zone_suitability_issues:
        return {
            "sensor_quality": "❌ NOT SUITABLE AREA",
            "suitability_message": "Environmental conditions do not match the detected Sri Lankan climate zone",
            "suitability_issues": zone_suitability_issues,
            "climate_zone": climate_zone_info.get("name", "Unknown"),
            "zone_key": climate_zone_info.get("zone_key", "unknown"),
            "zone_match_score": float(climate_zone_info.get("overall_score", 0.0)),
            "threshold_alerts": [],
            "predicted_pH": None,
            "top_crops": [],
            "zone_suitable_crops": [],
        }
    
    ph_model_path = MODEL_DIR / "ph_regressor.joblib"
    crop_model_path = MODEL_DIR / "crop_classifier.joblib"
    soil_kmeans_path = MODEL_DIR / "soil_kmeans.joblib"
    iso_forest_path = MODEL_DIR / "anomaly_detector.joblib"
    dynamic_thresholds_path = MODEL_DIR / "dynamic_thresholds.joblib"
    temporal_trends_path = MODEL_DIR / "temporal_trends.joblib"
    label_encoder_path = MODEL_DIR / "crop_label_encoder.joblib"

    if not all([ph_model_path.exists(), crop_model_path.exists(), soil_kmeans_path.exists(),
                iso_forest_path.exists(), dynamic_thresholds_path.exists(), temporal_trends_path.exists(),
                label_encoder_path.exists()]):
        raise FileNotFoundError("Train the models first by running this script.")

    ph_model = joblib.load(ph_model_path)
    crop_model = joblib.load(crop_model_path)
    soil_kmeans = joblib.load(soil_kmeans_path)
    iso_forest = joblib.load(iso_forest_path)
    dynamic_thresholds = joblib.load(dynamic_thresholds_path)
    temporal_trends = joblib.load(temporal_trends_path)
    label_encoder = joblib.load(label_encoder_path)

    # 1. Check for anomalies using ML model
    sensor_input = np.array([[temperature, humidity, soil_moisture, rainfall]])
    is_anomaly = iso_forest.predict(sensor_input)[0] == -1
    anomaly_alert = "⚠️ ANOMALY DETECTED" if is_anomaly else "✓ Normal"

    # 2. Check against dynamic thresholds
    threshold_violations = []
    for feature, value in [("Temperature", temperature), ("Humidity", humidity),
                            ("Soil_Moisture", soil_moisture), ("Rainfall", rainfall)]:
        bounds = dynamic_thresholds[feature]
        if not (bounds["lower_bound"] <= value <= bounds["upper_bound"]):
            threshold_violations.append(f"{feature} out of learned range")

    # 3. Analyze past data trends before predicting suitability
    past_analysis_issues = []
    for feature_key, current_value in {
        "Temperature": temperature,
        "Humidity": humidity,
        "Soil_Moisture": soil_moisture,
        "Rainfall": rainfall,
    }.items():
        trend = temporal_trends.get(feature_key, {})
        mean_val = trend.get("mean")
        std_val = trend.get("std")
        volatility = trend.get("volatility")
        if mean_val is not None and std_val is not None and std_val > 0:
            z_score = abs((current_value - mean_val) / std_val)
            if z_score >= 2.5:
                past_analysis_issues.append(f"{feature_key} deviates from historical mean (z={z_score:.2f})")
        if volatility is not None and volatility > 0.5:
            past_analysis_issues.append(f"{feature_key} shows unstable historical variability")

    if past_analysis_issues:
        return {
            "sensor_quality": "❌ NOT SUITABLE AREA",
            "suitability_message": "Historical data analysis indicates unstable conditions for crop growth",
            "suitability_issues": past_analysis_issues,
            "climate_zone": None,
            "zone_match_score": None,
            "threshold_alerts": threshold_violations if threshold_violations else [],
            "predicted_pH": None,
            "top_crops": [],
            "zone_suitable_crops": [],
        }

    X_input = pd.DataFrame(
        [
            {
                "Temperature": temperature,
                "Humidity": humidity,
                "Soil_Moisture": soil_moisture,
                "Rainfall": rainfall,
                "Longitude": longitude if longitude is not None else 0.0,
                "Latitude": latitude if latitude is not None else 0.0,
                "Zone": climate_zone_info.get("name", "Unknown"),
            }
        ]
    )
    
    # Create engineered features
    X_input["temp_humidity"] = X_input["Temperature"] * X_input["Humidity"]
    X_input["water_index"] = X_input["Rainfall"] * X_input["Soil_Moisture"]
    X_input["dryness_index"] = X_input["Temperature"] / (X_input["Humidity"] + 1)
    X_input["temp_squared"] = X_input["Temperature"] ** 2
    X_input["humidity_log"] = np.log1p(X_input["Humidity"])
    X_input["soil_type_proxy"] = soil_kmeans.predict(X_input[["Soil_Moisture", "Rainfall"]])
    X_input["fertility_index"] = X_input["Soil_Moisture"] - 0.3 * X_input["Rainfall"]
    
    feature_columns = [
        "Temperature", "Humidity", "Soil_Moisture", "Rainfall", "Latitude", "Longitude", "Zone",
        "temp_humidity", "water_index", "dryness_index",
        "temp_squared", "humidity_log", "soil_type_proxy", "fertility_index"
    ]
    
    ph_pred = ph_model.predict(X_input[feature_columns])
    crop_features = pd.concat(
        [
            X_input[feature_columns].reset_index(drop=True),
            pd.DataFrame(
                ph_pred,
                columns=["pred_pH"],
            ),
        ],
        axis=1,
    )
    crop_probabilities = crop_model.predict_proba(crop_features)[0]
    crop_classes = crop_model.named_steps["model"].classes_
    if isinstance(crop_classes[0], (int, np.integer)):
        crop_classes = label_encoder.inverse_transform(crop_classes)
    ranked = sorted(
        zip(crop_classes, crop_probabilities),
        key=lambda item: item[1],
        reverse=True,
    )
    filtered = [
        (crop, prob)
        for crop, prob in ranked
        if prob >= min_confidence
    ]
    if not filtered:
        filtered = ranked[:1]
    top_k = [
        {"family": crop, "confidence": float(prob)}
        for crop, prob in filtered[: min(4, len(filtered))]
    ]
    
    # Get zone-specific crop recommendations
    zone_suitable_crops = climate_zone_info.get("suitable_crops", [])
    family_to_crops = {}
    for crop_name, family_name in CROP_FAMILY_MAP.items():
        family_to_crops.setdefault(family_name, []).append(crop_name)

    # Map top families to concrete crops (prefer zone-suitable crops)
    family_recommendations = []
    for family_info in top_k:
        family = family_info["family"]
        family_crops = family_to_crops.get(family, [])
        zone_filtered = [c for c in family_crops if c in zone_suitable_crops]
        family_recommendations.append({
            "family": family,
            "confidence": family_info["confidence"],
            "recommended_crops": zone_filtered if zone_filtered else family_crops,
        })

    zone_ranked_crops = []
    for rec in family_recommendations:
        for crop in rec["recommended_crops"]:
            if crop not in [c["crop"] for c in zone_ranked_crops]:
                zone_ranked_crops.append({"crop": crop, "confidence": rec["confidence"], "family": rec["family"]})
    
    return {
        "sensor_quality": anomaly_alert,
        "geolocation": {
            "longitude": longitude,
            "latitude": latitude,
            "has_coordinates": longitude is not None and latitude is not None,
        } if longitude is not None or latitude is not None else None,
        "climate_zone": climate_zone_info.get("name", "Unknown"),
        "zone_key": climate_zone_info.get("zone_key", "unknown"),
        "zone_match_score": float(climate_zone_info.get("overall_score", 0.0)),
        "zone_match_method": climate_zone_info.get("match_method", "environmental"),
        "zone_details": {
            "temperature_match": float(climate_zone_info.get("temp_match", 0.0)),
            "humidity_match": float(climate_zone_info.get("humidity_match", 0.0)),
            "rainfall_match": float(climate_zone_info.get("rainfall_match", 0.0)),
            "expected_ranges": climate_zone_info.get("ranges", {}),
        },
        "threshold_alerts": threshold_violations if threshold_violations else [],
        "predicted_pH": float(ph_pred[0]),
        "top_families": top_k,
        "family_recommendations": family_recommendations,
        "top_crops": zone_ranked_crops[:5],
        "zone_suitable_crops": zone_ranked_crops[:5],
    }


def main():
    parser = argparse.ArgumentParser(description="Train NPK and crop prediction models.")
    parser.add_argument("--predict", action="store_true", help="Predict crop for a new area")
    parser.add_argument(
        "--export-tinyml",
        action="store_true",
        help="Export TinyML headers for ESP32 deployment",
    )
    parser.add_argument("--temperature", type=float, help="Temperature value")
    parser.add_argument("--humidity", type=float, help="Humidity value")
    parser.add_argument("--soil-moisture", type=float, help="Soil moisture value")
    parser.add_argument("--rainfall", type=float, help="Rainfall value")
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=0.6,
        help="Minimum confidence for crop options",
    )
    parser.add_argument("--longitude", type=float, help="Device longitude (for geolocation-based zone identification)")
    parser.add_argument("--latitude", type=float, help="Device latitude (for geolocation-based zone identification)")
    args = parser.parse_args()

    if args.predict:
        missing = [
            name
            for name, value in {
                "temperature": args.temperature,
                "humidity": args.humidity,
                "soil_moisture": args.soil_moisture,
                "rainfall": args.rainfall,
            }.items()
            if value is None
        ]
        if missing:
            raise ValueError(f"Missing inputs for prediction: {', '.join(missing)}")
        result = predict_crop(
            args.temperature,
            args.humidity,
            args.soil_moisture,
            args.rainfall,
            min_confidence=args.min_confidence,
            longitude=args.longitude,
            latitude=args.latitude,
        )
        print(json.dumps(result, indent=2))
        return

    if args.export_tinyml:
        df = load_data(DATA_PATH)
        output_dir = export_tinyml_models(df)
        print(f"TinyML headers written to: {output_dir}")
        return

    df = load_data(DATA_PATH)
    result = train_models(df)
    save_models(
        result["ph_model"],
        result["crop_model"],
        result["soil_kmeans"],
        result["iso_forest"],
        result["dynamic_thresholds"],
        result["temporal_trends"],
        result["label_encoder"],
    )

    print("Training complete.")
    print(json.dumps(result["metrics"], indent=2))
    
    print("\n" + "="*60)
    print("LEARNED DYNAMIC THRESHOLDS (ML-based, not hard-coded)")
    print("="*60)
    print(json.dumps(result["dynamic_thresholds"], indent=2))
    
    print("\n" + "="*60)
    print("TEMPORAL TREND ANALYSIS (Pattern Learning)")
    print("="*60)
    print(json.dumps(result["temporal_trends"], indent=2))


if __name__ == "__main__":
    main()
