import express from "express";
import cors from "cors";
import http from "http";
import { Server as SocketServer } from "socket.io";
import { InfluxDB } from "@influxdata/influxdb-client";

const CONFIG = {
  port: process.env.PORT || 5001,
  influxUrl: process.env.INFLUX_URL || "http://localhost:8086",
  influxToken:
    process.env.INFLUX_TOKEN ||
    "kzbzHjZNsSx_HVBnNbqOK2uIaAqAW5OJvF10enT9tJ2qdZSpRDt8W43yPavEqeXU1kJWEEzNtshCMXHAIfZ2gQ==",
  influxOrg: process.env.INFLUX_ORG || "Iot2026_12",
  influxBucket: process.env.INFLUX_BUCKET || "micro-climate-data",
  measurement: process.env.INFLUX_MEASUREMENT || "mqtt_consumer",
  pollIntervalMs: 2000,
  modelWindowHours: 24,
  aggregateWindowMinutes: 10,
  forecastSteps: 6
};

const METRIC_META = {
  t: { label: "Temperature", unit: "°C" },
  h: { label: "Humidity", unit: "%" },
  s: { label: "Soil Moisture", unit: "%" },
  r: { label: "Rainfall", unit: "mm/h" },
  ph: { label: "Soil pH", unit: "" }
};

const THRESHOLDS = {
  temp: { min: 9, max: 31 },
  humidity: { min: 60, max: 95 },
  soil: { min: 20, max: 80 },
  rainfall: { min: 30, max: 200 },
  ph: { min: 6.0, max: 8.0 }
};

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

const influx = new InfluxDB({ url: CONFIG.influxUrl, token: CONFIG.influxToken });
const queryApi = influx.getQueryApi(CONFIG.influxOrg);

const runtimeState = {
  connected: true,
  lastSuccessAt: null,
  lastError: null
};

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function stddev(values) {
  if (values.length < 2) return 0;
  const valuesMean = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - valuesMean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeSlope(points) {
  if (points.length < 2) return 0;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    const x = i + 1;
    const y = points[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;
  return (n * sumXY - sumX * sumY) / denominator;
}

function computeCorrelation(seriesA, seriesB) {
  if (seriesA.length < 2 || seriesA.length !== seriesB.length) return 0;
  const meanA = mean(seriesA);
  const meanB = mean(seriesB);
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < seriesA.length; i += 1) {
    const deltaA = seriesA[i] - meanA;
    const deltaB = seriesB[i] - meanB;
    numerator += deltaA * deltaB;
    denomA += deltaA * deltaA;
    denomB += deltaB * deltaB;
  }
  const denominator = Math.sqrt(denomA * denomB);
  if (denominator === 0) return 0;
  return round(numerator / denominator, 3);
}

function linearForecast(series, horizon = CONFIG.forecastSteps) {
  if (!series.length) {
    return { slope: 0, intercept: 0, next: 0, preview: [] };
  }

  if (series.length === 1) {
    const base = series[0];
    return {
      slope: 0,
      intercept: round(base, 4),
      next: round(base, 2),
      preview: Array.from({ length: horizon }, (_, index) => ({
        step: index + 1,
        value: round(base, 2)
      }))
    };
  }

  const n = series.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i += 1) {
    const x = i + 1;
    const y = series[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const preview = Array.from({ length: horizon }, (_, index) => {
    const step = n + index + 1;
    return {
      step: index + 1,
      value: round(slope * step + intercept, 2)
    };
  });

  return {
    slope: round(slope, 4),
    intercept: round(intercept, 4),
    next: preview[preview.length - 1]?.value ?? round(series[series.length - 1], 2),
    preview
  };
}

function euclideanDistance(pointA, pointB) {
  let sum = 0;
  for (let index = 0; index < pointA.length; index += 1) {
    const delta = pointA[index] - pointB[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function kmeans(points, requestedK = 3, iterations = 12) {
  if (!points.length) {
    return { centers: [], assignments: [] };
  }

  const k = Math.min(requestedK, points.length);
  const dims = points[0].length;
  const centers = points.slice(0, k).map((point) => [...point]);
  const assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < points.length; i += 1) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let centerIndex = 0; centerIndex < centers.length; centerIndex += 1) {
        const distance = euclideanDistance(points[i], centers[centerIndex]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = centerIndex;
        }
      }
      assignments[i] = bestIndex;
    }

    const sums = Array.from({ length: k }, () => Array(dims).fill(0));
    const counts = Array.from({ length: k }, () => 0);

    for (let i = 0; i < points.length; i += 1) {
      const clusterIndex = assignments[i];
      counts[clusterIndex] += 1;
      for (let dim = 0; dim < dims; dim += 1) {
        sums[clusterIndex][dim] += points[i][dim];
      }
    }

    for (let centerIndex = 0; centerIndex < k; centerIndex += 1) {
      if (counts[centerIndex] === 0) continue;
      for (let dim = 0; dim < dims; dim += 1) {
        centers[centerIndex][dim] = sums[centerIndex][dim] / counts[centerIndex];
      }
    }
  }

  return { centers, assignments };
}

function describePattern(center, globalMeans) {
  const [t, h, s, r] = center;
  const tags = [];
  tags.push(t >= globalMeans[0] ? "Warm" : "Cooler");
  tags.push(h >= globalMeans[1] ? "Humid-air" : "Dry-air");
  tags.push(s >= globalMeans[2] ? "Moist-soil" : "Dry-soil");
  tags.push(r >= globalMeans[3] ? "Rain-active" : "Low-rain");
  return tags.join(" · ");
}

function computeSuitability(values) {
  const tempOk = values.t >= THRESHOLDS.temp.min && values.t <= THRESHOLDS.temp.max;
  const humOk = values.h >= THRESHOLDS.humidity.min && values.h <= THRESHOLDS.humidity.max;
  const soilOk = values.s >= THRESHOLDS.soil.min && values.s <= THRESHOLDS.soil.max;
  const rainOk = values.r >= THRESHOLDS.rainfall.min && values.r <= THRESHOLDS.rainfall.max;
  const phOk = values.ph >= THRESHOLDS.ph.min && values.ph <= THRESHOLDS.ph.max;

  return {
    isSuitable: tempOk && humOk && soilOk && rainOk && phOk,
    checks: { tempOk, humOk, soilOk, rainOk, phOk }
  };
}

function computeWaterStress(values) {
  const tempFactor = Math.min(values.t / 40, 1);
  const humidityFactor = 1 - Math.min(values.h / 100, 1);
  const soilFactor = 1 - Math.min(values.s / 100, 1);
  return round(tempFactor * humidityFactor * soilFactor, 3);
}

function computeGrowthIndex(values) {
  const tempScore = values.t >= 15 && values.t <= 35 ? 1 : 0.6;
  const humScore = values.h >= 60 && values.h <= 95 ? 1 : 0.7;
  const soilScore = values.s >= 30 && values.s <= 80 ? 1 : 0.6;
  const rainScore = values.r >= 40 && values.r <= 80 ? 1 : 0.8;
  return round((tempScore + humScore + soilScore + rainScore) / 4, 3);
}

function normalizeRow(row) {
  const t = Number(row.t ?? row.T ?? 0);
  const h = Number(row.h ?? row.H ?? 0);
  const s = Number(row.s ?? row.S ?? 0);
  const r = Number(row.r ?? row.R ?? row.rain_mm ?? row.Rain_mm ?? 0);
  const ph = Number(row.ph ?? row.pH ?? row.PH ?? 0);
  const crop = row.crop ?? "Not Suitable";
  const zone = row.zone ?? "Unknown";
  const id = row.id ?? row.device ?? "ESP32";
  const time = row._time ?? row._stop ?? new Date().toISOString();

  return { t, h, s, r, ph, crop, zone, id, time };
}

function buildRecommendations(values, suitability, analytics) {
  const notes = [];

  if (analytics?.useCases?.irrigation?.priority === "high") {
    notes.push("Schedule irrigation early because the trained forecast shows soil moisture dropping.");
  }
  if (analytics?.useCases?.drainage?.priority === "high") {
    notes.push("Inspect field drainage because rainfall behaviour is outside the learned safe band.");
  }
  if (analytics?.useCases?.soilChemistry?.priority === "high") {
    notes.push("Adjust soil chemistry before the pH drift reduces crop suitability.");
  }

  if (!suitability.checks.tempOk) notes.push("Temperature is outside the crop comfort range.");
  if (!suitability.checks.humOk) notes.push("Humidity is outside the crop comfort range.");
  if (!suitability.checks.soilOk) notes.push("Soil moisture is outside the crop comfort range.");
  if (!suitability.checks.rainOk) notes.push("Rainfall is outside the crop comfort range.");
  if (!suitability.checks.phOk) notes.push("Soil pH is outside the crop comfort range.");
  if (notes.length === 0) notes.push("Current field conditions are stable for cultivation.");

  return notes.slice(0, 5);
}

function trainLinearRegressionModel(rows, latest, targetKey, featureKeys) {
  const samples = rows.filter((row) =>
    featureKeys.every((key) => Number.isFinite(row[key])) && Number.isFinite(row[targetKey])
  );

  if (samples.length < featureKeys.length + 2) {
    return null;
  }

  const featureMeans = featureKeys.map((key) => mean(samples.map((row) => row[key])));
  const featureScales = featureKeys.map((key) => stddev(samples.map((row) => row[key])) || 1);
  const targetMean = mean(samples.map((row) => row[targetKey]));
  const targetScale = stddev(samples.map((row) => row[targetKey])) || 1;

  const standardizedSamples = samples.map((row) => ({
    x: featureKeys.map((key, index) => (row[key] - featureMeans[index]) / featureScales[index]),
    y: (row[targetKey] - targetMean) / targetScale
  }));

  const weights = new Array(featureKeys.length).fill(0);
  let bias = 0;
  const learningRate = 0.05;
  const iterations = 500;

  for (let iter = 0; iter < iterations; iter += 1) {
    const weightGradients = new Array(featureKeys.length).fill(0);
    let biasGradient = 0;

    for (const sample of standardizedSamples) {
      const prediction =
        sample.x.reduce((sum, value, index) => sum + value * weights[index], bias);
      const error = prediction - sample.y;
      for (let index = 0; index < weights.length; index += 1) {
        weightGradients[index] += error * sample.x[index];
      }
      biasGradient += error;
    }

    for (let index = 0; index < weights.length; index += 1) {
      weights[index] -=
        (learningRate * weightGradients[index]) / standardizedSamples.length;
    }
    bias -= (learningRate * biasGradient) / standardizedSamples.length;
  }

  function predict(row) {
    const standardizedRow = featureKeys.map(
      (key, index) => (row[key] - featureMeans[index]) / featureScales[index]
    );
    const normalizedPrediction = standardizedRow.reduce(
      (sum, value, index) => sum + value * weights[index],
      bias
    );
    return normalizedPrediction * targetScale + targetMean;
  }

  const targets = samples.map((row) => row[targetKey]);
  const predictions = samples.map((row) => predict(row));
  const targetBaseline = mean(targets);
  const residual = targets.reduce(
    (sum, value, index) => sum + (value - predictions[index]) ** 2,
    0
  );
  const total = targets.reduce((sum, value) => sum + (value - targetBaseline) ** 2, 0);
  const rawR2 = total === 0 ? 0 : 1 - residual / total;
  const latestPrediction = latest ? predict(latest) : null;

  const totalImportance = weights.reduce((sum, value) => sum + Math.abs(value), 0) || 1;
  const importances = featureKeys
    .map((key, index) => ({
      feature: key,
      label: METRIC_META[key].label,
      weight: round((Math.abs(weights[index]) / totalImportance) * 100, 1),
      direction: weights[index] >= 0 ? "positive" : "negative"
    }))
    .sort((a, b) => b.weight - a.weight);

  return {
    target: METRIC_META[targetKey].label,
    sampleCount: samples.length,
    r2: round(rawR2, 3),
    prediction: round(latestPrediction ?? 0, 2),
    actual: round(latest?.[targetKey] ?? 0, 2),
    error: round((latestPrediction ?? 0) - (latest?.[targetKey] ?? 0), 2),
    importances
  };
}

function buildEmptyAnalytics() {
  return {
    training: {
      sampleCount: 0,
      windowHours: CONFIG.modelWindowHours,
      pollIntervalMs: CONFIG.pollIntervalMs
    },
    models: [],
    trend: {},
    forecast: { horizonMinutes: CONFIG.aggregateWindowMinutes * CONFIG.forecastSteps, metrics: {}, preview: [] },
    thresholdsML: {},
    correlations: { coefficients: {}, soilMoistureModel: null },
    anomalies: { items: [], healthScore: 100, latestDistance: 0, distanceThreshold: 0, dominantMetrics: [] },
    patterns: { cluster: 0, label: "--", centers: [], clusterCounts: [] },
    useCases: {},
    alertsML: [],
    summary: []
  };
}

function computeAnalytics(trends, latest) {
  if (!trends.length || !latest) {
    return buildEmptyAnalytics();
  }

  const series = {
    t: trends.map((point) => point.t),
    h: trends.map((point) => point.h),
    s: trends.map((point) => point.s),
    r: trends.map((point) => point.r),
    ph: trends.map((point) => point.ph)
  };

  const trend = Object.fromEntries(
    Object.entries(series).map(([key, values]) => {
      const slope = computeSlope(values);
      const direction = slope > 0.02 ? "rising" : slope < -0.02 ? "falling" : "stable";
      return [
        key,
        {
          slope: round(slope, 3),
          direction
        }
      ];
    })
  );

  const forecastMetrics = Object.fromEntries(
    Object.entries(series).map(([key, values]) => {
      const projection = linearForecast(values, CONFIG.forecastSteps);
      return [
        key,
        {
          ...projection,
          current: round(values[values.length - 1] ?? 0, 2),
          delta: round(projection.next - (values[values.length - 1] ?? 0), 2)
        }
      ];
    })
  );

  const baseTime = new Date(trends[trends.length - 1]?.time ?? latest.time ?? Date.now());
  const forecastPreview = Array.from({ length: CONFIG.forecastSteps }, (_, index) => {
    const time = new Date(baseTime.getTime() + (index + 1) * CONFIG.aggregateWindowMinutes * 60000);
    return {
      time: time.toISOString(),
      label: time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      t: forecastMetrics.t.preview[index]?.value ?? 0,
      h: forecastMetrics.h.preview[index]?.value ?? 0,
      s: forecastMetrics.s.preview[index]?.value ?? 0,
      r: forecastMetrics.r.preview[index]?.value ?? 0,
      ph: forecastMetrics.ph.preview[index]?.value ?? 0
    };
  });

  const thresholdsML = Object.fromEntries(
    Object.entries(series).map(([key, values]) => {
      const low = quantile(values, 0.15);
      const high = quantile(values, 0.85);
      const value = latest[key];
      return [
        key,
        {
          low: round(low, 2),
          high: round(high, 2),
          current: round(value, 2),
          breach: value < low || value > high
        }
      ];
    })
  );

  const coefficients = {
    t_h: computeCorrelation(series.t, series.h),
    t_s: computeCorrelation(series.t, series.s),
    h_s: computeCorrelation(series.h, series.s),
    s_r: computeCorrelation(series.s, series.r),
    t_r: computeCorrelation(series.t, series.r)
  };

  const soilMoistureModel = trainLinearRegressionModel(trends, latest, "s", ["t", "h", "r", "ph"]);

  const featureKeys = ["t", "h", "s", "r", "ph"];
  const featureMeans = featureKeys.map((key) => mean(series[key]));
  const featureScales = featureKeys.map((key) => stddev(series[key]) || 1);
  const standardizedPoints = trends.map((row) =>
    featureKeys.map((key, index) => (row[key] - featureMeans[index]) / featureScales[index])
  );
  const { centers, assignments } = kmeans(standardizedPoints, 3, 14);
  const distances = standardizedPoints.map((point, index) => {
    const assignedCenter = centers[assignments[index]];
    return assignedCenter ? euclideanDistance(point, assignedCenter) : 0;
  });

  const latestDistance = distances[distances.length - 1] ?? 0;
  const distanceThreshold = quantile(distances, 0.9) || 1;
  const latestMetricScores = featureKeys
    .map((key, index) => ({
      metric: key,
      label: METRIC_META[key].label,
      zScore: round((latest[key] - featureMeans[index]) / featureScales[index], 2)
    }))
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));

  const anomalyItems = [];
  if (latestDistance > distanceThreshold) {
    anomalyItems.push({
      type: "cluster-distance",
      severity: latestDistance > distanceThreshold * 1.35 ? "critical" : "warning",
      score: round(latestDistance, 3),
      threshold: round(distanceThreshold, 3),
      message: "Current sensor behaviour is outside the learned operating clusters.",
      drivers: latestMetricScores.slice(0, 2)
    });
  }

  latestMetricScores
    .filter((item) => Math.abs(item.zScore) >= 2.2)
    .slice(0, 2)
    .forEach((item) => {
      anomalyItems.push({
        type: "metric-zscore",
        severity: Math.abs(item.zScore) >= 3 ? "critical" : "warning",
        score: item.zScore,
        threshold: 2.2,
        message: `${item.label} is behaving abnormally compared with the trained baseline.`,
        drivers: [item]
      });
    });

  const clusterCounts = centers.map((_, centerIndex) => assignments.filter((value) => value === centerIndex).length);
  const rawCenters = centers.map((center) =>
    center.map((value, index) => value * featureScales[index] + featureMeans[index])
  );
  const globalMeans = [mean(series.t), mean(series.h), mean(series.s), mean(series.r)];
  const currentCluster = assignments[assignments.length - 1] ?? 0;
  const patterns = {
    cluster: currentCluster,
    label: rawCenters[currentCluster]
      ? describePattern(rawCenters[currentCluster], globalMeans)
      : "--",
    centers: rawCenters.map((center, index) => ({
      cluster: index,
      label: describePattern(center, globalMeans),
      size: clusterCounts[index] ?? 0,
      t: round(center[0], 2),
      h: round(center[1], 2),
      s: round(center[2], 2),
      r: round(center[3], 2),
      ph: round(center[4], 2)
    })),
    clusterCounts
  };

  const useCases = {
    irrigation: {
      title: "Irrigation planning",
      priority:
        forecastMetrics.s.next < thresholdsML.s.low || trend.s.direction === "falling"
          ? "high"
          : "medium",
      insight:
        forecastMetrics.s.next < thresholdsML.s.low
          ? `Predicted soil moisture will fall to ${forecastMetrics.s.next}${METRIC_META.s.unit} within the next hour.`
          : "Soil moisture remains inside the learned operating range."
    },
    drainage: {
      title: "Field drainage risk",
      priority:
        thresholdsML.r.breach || anomalyItems.some((item) => item.type === "cluster-distance")
          ? "high"
          : "medium",
      insight:
        thresholdsML.r.breach
          ? `Rainfall is outside the learned safe band of ${thresholdsML.r.low}-${thresholdsML.r.high}${METRIC_META.r.unit}.`
          : "Drainage conditions match the normal field pattern."
    },
    soilChemistry: {
      title: "Soil chemistry stability",
      priority: thresholdsML.ph.breach ? "high" : "medium",
      insight: thresholdsML.ph.breach
        ? "The pH reading has moved outside the trained band and may affect nutrient availability."
        : "pH remains close to the learned stable chemistry band."
    }
  };

  const alertsML = [];
  Object.entries(thresholdsML).forEach(([key, bounds]) => {
    if (!bounds.breach) return;
    alertsML.push({
      type: "learned-threshold",
      severity:
        bounds.current < bounds.low * 0.9 || bounds.current > bounds.high * 1.1
          ? "critical"
          : "warning",
      message: `${METRIC_META[key].label} moved outside its learned operating range.`
    });
  });

  anomalyItems.forEach((item) => {
    alertsML.push({
      type: item.type,
      severity: item.severity,
      message: item.message
    });
  });

  if (soilMoistureModel && Math.abs(soilMoistureModel.error) > 8) {
    alertsML.push({
      type: "model-drift",
      severity: "warning",
      message: "The soil moisture regression model is seeing behaviour that differs from its trained relationships."
    });
  }

  const models = [
    {
      id: "temporal-trend",
      category: "Temporal trend analysis",
      technique: "Linear regression forecasting",
      trainedOn: trends.length,
      outcome: `Soil moisture is ${trend.s.direction}; next-hour forecast ${forecastMetrics.s.next}${METRIC_META.s.unit}.`,
      problemLink: "Supports early irrigation planning before raw readings become critical."
    },
    {
      id: "learned-thresholds",
      category: "Threshold-based alerts",
      technique: "Quantile-learned thresholds",
      trainedOn: trends.length,
      outcome: `${alertsML.filter((alert) => alert.type === "learned-threshold").length} active learned-threshold alerts.`,
      problemLink: "Adapts alert sensitivity to the actual field history instead of fixed constants."
    },
    {
      id: "correlation-model",
      category: "Correlation between sensor readings",
      technique: "Multivariate regression and correlation",
      trainedOn: soilMoistureModel?.sampleCount ?? trends.length,
      outcome: soilMoistureModel
        ? `Best drivers of soil moisture: ${soilMoistureModel.importances
            .slice(0, 2)
            .map((item) => item.label)
            .join(" and ")}.`
        : "Not enough samples for the regression model.",
      problemLink: "Explains which environmental variables are most useful for predicting crop stress."
    },
    {
      id: "anomaly-detection",
      category: "Anomaly / outlier detection",
      technique: "Cluster-distance anomaly scoring",
      trainedOn: trends.length,
      outcome: anomalyItems.length
        ? `${anomalyItems.length} unusual behaviours detected in the latest sensor window.`
        : "No outlier behaviour detected in the current window.",
      problemLink: "Highlights unusual conditions that may indicate device issues or sudden field risk."
    },
    {
      id: "pattern-mining",
      category: "Usage / behaviour pattern analysis",
      technique: "K-means clustering",
      trainedOn: trends.length,
      outcome: `Current behaviour cluster: ${patterns.label}.`,
      problemLink: "Groups recurring field states so the dashboard can explain normal versus unusual operating modes."
    }
  ];

  const summary = [
    `The dashboard trained its live models on ${trends.length} aggregated samples from the last ${CONFIG.modelWindowHours} hours.`,
    useCases.irrigation.insight,
    soilMoistureModel
      ? `Regression explains soil moisture with R² ${soilMoistureModel.r2}.`
      : "Regression model is waiting for more samples.",
    anomalyItems.length
      ? "Anomaly detection found a behaviour pattern that does not match the usual field clusters."
      : "Current behaviour matches a known operating pattern."
  ];

  const healthPenalty =
    (latestDistance / distanceThreshold) * 18 + anomalyItems.length * 12 + alertsML.length * 5;

  return {
    training: {
      sampleCount: trends.length,
      windowHours: CONFIG.modelWindowHours,
      pollIntervalMs: CONFIG.pollIntervalMs
    },
    models,
    trend,
    forecast: {
      horizonMinutes: CONFIG.aggregateWindowMinutes * CONFIG.forecastSteps,
      metrics: forecastMetrics,
      preview: forecastPreview
    },
    thresholdsML,
    correlations: {
      coefficients,
      soilMoistureModel
    },
    anomalies: {
      items: anomalyItems,
      healthScore: Math.max(0, Math.min(100, round(100 - healthPenalty, 0))),
      latestDistance: round(latestDistance, 3),
      distanceThreshold: round(distanceThreshold, 3),
      dominantMetrics: latestMetricScores.slice(0, 3)
    },
    patterns,
    useCases,
    alertsML,
    summary
  };
}

async function fetchLatest() {
  const flux = `from(bucket: "${CONFIG.influxBucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "${CONFIG.measurement}")
  |> filter(fn: (r) => r._field == "t" or r._field == "h" or r._field == "s" or r._field == "r" or r._field == "rain_mm" or r._field == "ph" or r._field == "T" or r._field == "H" or r._field == "S" or r._field == "R" or r._field == "pH" or r._field == "crop" or r._field == "zone" or r._field == "id")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> group()
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 1)`;

  let resultRow;

  await new Promise((resolve, reject) => {
    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        resultRow = tableMeta.toObject(row);
      },
      error(error) {
        reject(error);
      },
      complete() {
        resolve();
      }
    });
  });

  if (!resultRow) return null;

  const values = normalizeRow(resultRow);
  const suitability = computeSuitability(values);

  return {
    ...values,
    fit: suitability.isSuitable,
    checks: suitability.checks,
    growthIndex: computeGrowthIndex(values),
    waterStress: computeWaterStress(values)
  };
}

async function fetchTrends(hours = CONFIG.modelWindowHours) {
  const flux = `from(bucket: "${CONFIG.influxBucket}")
  |> range(start: -${hours}h)
  |> filter(fn: (r) => r._measurement == "${CONFIG.measurement}")
  |> filter(fn: (r) => r._field == "t" or r._field == "h" or r._field == "s" or r._field == "r" or r._field == "rain_mm" or r._field == "ph" or r._field == "T" or r._field == "H" or r._field == "S" or r._field == "R" or r._field == "pH")
  |> aggregateWindow(every: ${CONFIG.aggregateWindowMinutes}m, fn: mean, createEmpty: false)
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])`;

  const points = [];

  await new Promise((resolve, reject) => {
    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        const objectRow = tableMeta.toObject(row);
        points.push({
          time: objectRow._time,
          t: Number(objectRow.t ?? objectRow.T ?? 0),
          h: Number(objectRow.h ?? objectRow.H ?? 0),
          s: Number(objectRow.s ?? objectRow.S ?? 0),
          r: Number(objectRow.r ?? objectRow.R ?? objectRow.rain_mm ?? objectRow.Rain_mm ?? 0),
          ph: Number(objectRow.ph ?? objectRow.pH ?? 0)
        });
      },
      error(error) {
        reject(error);
      },
      complete() {
        resolve();
      }
    });
  });

  return points;
}

async function buildDashboardPayload() {
  const [latest, trends] = await Promise.all([
    fetchLatest(),
    fetchTrends(CONFIG.modelWindowHours)
  ]);

  const analytics = computeAnalytics(trends, latest);
  const suitability = latest ? computeSuitability(latest) : { checks: {}, isSuitable: false };

  return latest
    ? {
        ...latest,
        fit: suitability.isSuitable,
        checks: suitability.checks,
        growthIndex: latest.growthIndex,
        waterStress: latest.waterStress,
        analytics,
        recommendations: buildRecommendations(latest, suitability, analytics),
        meta: {
          generatedAt: new Date().toISOString(),
          trainedSamples: trends.length,
          api: [
            { route: "/api/latest", purpose: "Latest sensor values with trained analytics" },
            { route: "/api/trends?hours=24", purpose: "Historical sensor window for charts" },
            { route: "/api/health", purpose: "Runtime status and reliability checks" }
          ],
          realtime: {
            transport: "Socket.IO",
            event: "latest",
            pollIntervalMs: CONFIG.pollIntervalMs
          }
        }
      }
    : {
        analytics,
        recommendations: [],
        meta: {
          generatedAt: new Date().toISOString(),
          trainedSamples: trends.length,
          realtime: {
            transport: "Socket.IO",
            event: "latest",
            pollIntervalMs: CONFIG.pollIntervalMs
          }
        }
      };
}

app.get("/api/latest", async (req, res) => {
  try {
    const data = await buildDashboardPayload();
    res.json({ data });
  } catch (error) {
    runtimeState.connected = false;
    runtimeState.lastError = error.message;
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/trends", async (req, res) => {
  try {
    const hours = Number(req.query.hours || CONFIG.modelWindowHours);
    const data = await fetchTrends(hours);
    res.json({
      data,
      meta: {
        hours,
        intervalMinutes: CONFIG.aggregateWindowMinutes,
        points: data.length
      }
    });
  } catch (error) {
    runtimeState.connected = false;
    runtimeState.lastError = error.message;
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/health", async (req, res) => {
  res.json({
    status: runtimeState.connected ? "ok" : "degraded",
    lastSuccessAt: runtimeState.lastSuccessAt,
    lastError: runtimeState.lastError,
    pollIntervalMs: CONFIG.pollIntervalMs,
    analysisWindowHours: CONFIG.modelWindowHours
  });
});

io.on("connection", (socket) => {
  socket.emit("status", {
    connected: runtimeState.connected,
    lastSuccessAt: runtimeState.lastSuccessAt,
    error: runtimeState.lastError
  });
});

setInterval(async () => {
  try {
    const payload = await buildDashboardPayload();
    runtimeState.connected = true;
    runtimeState.lastSuccessAt = new Date().toISOString();
    runtimeState.lastError = null;
    io.emit("status", {
      connected: true,
      lastSuccessAt: runtimeState.lastSuccessAt,
      error: null
    });
    io.emit("latest", payload);
  } catch (error) {
    runtimeState.connected = false;
    runtimeState.lastError = error.message;
    io.emit("status", {
      connected: false,
      lastSuccessAt: runtimeState.lastSuccessAt,
      error: error.message
    });
  }
}, CONFIG.pollIntervalMs);

server.listen(CONFIG.port, () => {
  console.log(`Agri dashboard API running on http://localhost:${CONFIG.port}`);
});
