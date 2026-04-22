import express from "express";
import cors from "cors";
import http from "http";
import { Server as SocketServer } from "socket.io";
import { InfluxDB } from "@influxdata/influxdb-client";

const CONFIG = {
  port: process.env.PORT || 5001,
  influxUrl: process.env.INFLUX_URL || "http://localhost:8086",
  influxToken: process.env.INFLUX_TOKEN || "kzbzHjZNsSx_HVBnNbqOK2uIaAqAW5OJvF10enT9tJ2qdZSpRDt8W43yPavEqeXU1kJWEEzNtshCMXHAIfZ2gQ==",
  influxOrg: process.env.INFLUX_ORG || "Iot2026_12",
  influxBucket: process.env.INFLUX_BUCKET || "micro-climate-data",
  measurement: process.env.INFLUX_MEASUREMENT || "mqtt_consumer",
  pollIntervalMs: 2000
};

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: "*" } });

const influx = new InfluxDB({ url: CONFIG.influxUrl, token: CONFIG.influxToken });
const queryApi = influx.getQueryApi(CONFIG.influxOrg);

const THRESHOLDS = {
  temp: { min: 9, max: 31 },
  humidity: { min: 60, max: 95 },
  soil: { min: 20, max: 80 },
  rainfall: { min: 30, max: 200 },
  ph: { min: 6.0, max: 8.0 }
};

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
  return Number((tempFactor * humidityFactor * soilFactor).toFixed(3));
}

function computeGrowthIndex(values) {
  const tempScore = values.t >= 15 && values.t <= 35 ? 1 : 0.6;
  const humScore = values.h >= 60 && values.h <= 95 ? 1 : 0.7;
  const soilScore = values.s >= 30 && values.s <= 80 ? 1 : 0.6;
  const rainScore = values.r >= 40 && values.r <= 80 ? 1 : 0.8;
  return Number(((tempScore + humScore + soilScore + rainScore) / 4).toFixed(3));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
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
  const m = mean(values);
  const variance = values.reduce((sum, val) => sum + Math.pow(val - m, 2), 0) / (values.length - 1);
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
  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < seriesA.length; i += 1) {
    const a = seriesA[i] - meanA;
    const b = seriesB[i] - meanB;
    num += a * b;
    denomA += a * a;
    denomB += b * b;
  }
  const denom = Math.sqrt(denomA * denomB);
  if (denom === 0) return 0;
  return Number((num / denom).toFixed(3));
}

function linearForecast(series, horizon = 6) {
  if (series.length < 2) return { slope: 0, intercept: series[series.length - 1] || 0, next: series[series.length - 1] || 0 };
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
  const nextX = n + horizon;
  const next = slope * nextX + intercept;
  return { slope: Number(slope.toFixed(4)), intercept: Number(intercept.toFixed(4)), next: Number(next.toFixed(2)) };
}

function kmeans(points, k = 3, iterations = 8) {
  if (points.length === 0) return { centers: [], assignments: [] };
  const dims = points[0].length;
  const centers = points.slice(0, k).map((p) => [...p]);
  const assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < points.length; i += 1) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centers.length; c += 1) {
        let dist = 0;
        for (let d = 0; d < dims; d += 1) {
          const diff = points[i][d] - centers[c][d];
          dist += diff * diff;
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = c;
        }
      }
      assignments[i] = bestIdx;
    }

    const sums = Array.from({ length: k }, () => Array(dims).fill(0));
    const counts = Array.from({ length: k }, () => 0);
    for (let i = 0; i < points.length; i += 1) {
      const cluster = assignments[i];
      counts[cluster] += 1;
      for (let d = 0; d < dims; d += 1) {
        sums[cluster][d] += points[i][d];
      }
    }
    for (let c = 0; c < k; c += 1) {
      if (counts[c] === 0) continue;
      for (let d = 0; d < dims; d += 1) {
        centers[c][d] = sums[c][d] / counts[c];
      }
    }
  }

  return { centers, assignments };
}

function describePattern(center, globalMeans) {
  const [t, h, s, r] = center;
  const labelParts = [];
  if (t > globalMeans[0]) labelParts.push("Warmer");
  else labelParts.push("Cooler");
  if (h > globalMeans[1]) labelParts.push("Humid");
  else labelParts.push("Dry-air");
  if (s > globalMeans[2]) labelParts.push("Moist-soil");
  else labelParts.push("Dry-soil");
  if (r > globalMeans[3]) labelParts.push("Rainy");
  else labelParts.push("Low-rain");
  return labelParts.join(" · ");
}

function computeAnalytics(trends, latest) {
  if (!trends.length || !latest) {
    return { trend: {}, correlations: {}, anomalies: [], alertsML: [], thresholdsML: {}, forecast: {}, patterns: {} };
  }

  const series = {
    t: trends.map((p) => p.t),
    h: trends.map((p) => p.h),
    s: trends.map((p) => p.s),
    r: trends.map((p) => p.r),
    ph: trends.map((p) => p.ph)
  };

  const trend = Object.fromEntries(Object.entries(series).map(([key, values]) => {
    const slope = computeSlope(values);
    const direction = slope > 0.02 ? "rising" : slope < -0.02 ? "falling" : "stable";
    return [key, { slope: Number(slope.toFixed(3)), direction }];
  }));

  const forecast = Object.fromEntries(Object.entries(series).map(([key, values]) => {
    const projection = linearForecast(values, 6);
    return [key, projection];
  }));

  const correlations = {
    t_h: computeCorrelation(series.t, series.h),
    t_s: computeCorrelation(series.t, series.s),
    h_s: computeCorrelation(series.h, series.s),
    s_r: computeCorrelation(series.s, series.r),
    t_r: computeCorrelation(series.t, series.r)
  };

  const anomalies = [];
  const alertsML = [];
  Object.keys(series).forEach((key) => {
    const values = series[key];
    const m = mean(values);
    const sd = stddev(values);
    if (sd === 0) return;
    const z = (latest[key] - m) / sd;
    if (Math.abs(z) >= 2.5) {
      anomalies.push({ metric: key, value: Number(latest[key].toFixed(2)), z: Number(z.toFixed(2)) });
      alertsML.push({
        type: "anomaly",
        severity: Math.abs(z) >= 3.2 ? "critical" : "warning",
        message: `${key.toUpperCase()} deviates from normal pattern (z=${z.toFixed(2)})`
      });
    }
  });

  const thresholdsML = Object.fromEntries(Object.entries(series).map(([key, values]) => {
    return [key, { low: Number(quantile(values, 0.1).toFixed(2)), high: Number(quantile(values, 0.9).toFixed(2)) }];
  }));

  Object.entries(thresholdsML).forEach(([key, bounds]) => {
    const value = latest[key];
    if (value < bounds.low || value > bounds.high) {
      alertsML.push({
        type: "threshold",
        severity: value < bounds.low * 0.9 || value > bounds.high * 1.1 ? "critical" : "warning",
        message: `${key.toUpperCase()} outside learned range (${bounds.low}–${bounds.high})`
      });
    }
  });

  const points = trends.map((p) => [p.t, p.h, p.s, p.r]);
  const globalMeans = [mean(series.t), mean(series.h), mean(series.s), mean(series.r)];
  const { centers, assignments } = kmeans(points, 3, 10);
  const latestCluster = assignments[assignments.length - 1] ?? 0;
  const patterns = {
    cluster: latestCluster,
    label: centers[latestCluster] ? describePattern(centers[latestCluster], globalMeans) : "--",
    centers: centers.map((center) => ({
      t: Number(center[0]?.toFixed(2) ?? 0),
      h: Number(center[1]?.toFixed(2) ?? 0),
      s: Number(center[2]?.toFixed(2) ?? 0),
      r: Number(center[3]?.toFixed(2) ?? 0),
      label: describePattern(center, globalMeans)
    }))
  };

  return { trend, correlations, anomalies, alertsML, thresholdsML, forecast, patterns };
}

function buildRecommendations(values, suitability) {
  const notes = [];
  if (!suitability.checks.tempOk) notes.push("Temperature out of optimal range");
  if (!suitability.checks.humOk) notes.push("Humidity out of optimal range");
  if (!suitability.checks.soilOk) notes.push("Soil moisture out of optimal range");
  if (!suitability.checks.rainOk) notes.push("Rainfall out of optimal range");
  if (!suitability.checks.phOk) notes.push("Soil pH out of optimal range");
  if (notes.length === 0) notes.push("Conditions are good for cultivation");

  return notes;
}

function normalizeRow(row) {
  const t = Number(row.t ?? row.T ?? 0);
  const h = Number(row.h ?? row.H ?? 0);
  const s = Number(row.s ?? row.S ?? 0);
  const r = Number(row.r ?? row.R ?? 0);
  const ph = Number(row.ph ?? row.pH ?? row.PH ?? 0);
  const crop = row.crop ?? "Not Suitable";
  const zone = row.zone ?? "Unknown";
  const id = row.id ?? row.device ?? "ESP32";
  const time = row._time ?? row._stop ?? new Date().toISOString();

  return { t, h, s, r, ph, crop, zone, id, time };
}

async function fetchLatest() {
  const flux = `from(bucket: "${CONFIG.influxBucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "${CONFIG.measurement}")
  |> filter(fn: (r) => r._field == "t" or r._field == "h" or r._field == "s" or r._field == "r" or r._field == "ph" or r._field == "T" or r._field == "H" or r._field == "S" or r._field == "R" or r._field == "pH" or r._field == "crop" or r._field == "zone" or r._field == "id")
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
      error(err) {
        reject(err);
      },
      complete() {
        resolve();
      }
    });
  });

  if (!resultRow) return null;

  const values = normalizeRow(resultRow);
  const suitability = computeSuitability(values);
  const growthIndex = computeGrowthIndex(values);
  const waterStress = computeWaterStress(values);

  return {
    ...values,
    fit: suitability.isSuitable,
    checks: suitability.checks,
    growthIndex,
    waterStress,
    recommendations: buildRecommendations(values, suitability)
  };
}

async function fetchTrends(hours = 24) {
  const flux = `from(bucket: "${CONFIG.influxBucket}")
  |> range(start: -${hours}h)
  |> filter(fn: (r) => r._measurement == "${CONFIG.measurement}")
  |> filter(fn: (r) => r._field == "t" or r._field == "h" or r._field == "s" or r._field == "r" or r._field == "ph" or r._field == "T" or r._field == "H" or r._field == "S" or r._field == "R" or r._field == "pH")
  |> aggregateWindow(every: 10m, fn: mean, createEmpty: false)
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])`;

  const points = [];

  await new Promise((resolve, reject) => {
    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        points.push({
          time: obj._time,
          t: Number(obj.t ?? obj.T ?? 0),
          h: Number(obj.h ?? obj.H ?? 0),
          s: Number(obj.s ?? obj.S ?? 0),
          r: Number(obj.r ?? obj.R ?? 0),
          ph: Number(obj.ph ?? obj.pH ?? 0)
        });
      },
      error(err) {
        reject(err);
      },
      complete() {
        resolve();
      }
    });
  });

  return points;
}

app.get("/api/latest", async (req, res) => {
  try {
    const data = await fetchLatest();
    const trends = await fetchTrends(6);
    const analytics = computeAnalytics(trends, data);
    res.json({ data: { ...data, analytics } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/trends", async (req, res) => {
  try {
    const hours = Number(req.query.hours || 24);
    const data = await fetchTrends(hours);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on("connection", (socket) => {
  socket.emit("status", { connected: true });
});

setInterval(async () => {
  try {
    const latest = await fetchLatest();
    if (latest) {
      const trends = await fetchTrends(6);
      const analytics = computeAnalytics(trends, latest);
      io.emit("latest", { ...latest, analytics });
    }
  } catch (err) {
    io.emit("status", { connected: false, error: err.message });
  }
}, CONFIG.pollIntervalMs);

server.listen(CONFIG.port, () => {
  console.log(`Agri dashboard API running on http://localhost:${CONFIG.port}`);
});
