import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

const API_BASE = "http://localhost:5001";

const METRICS = [
  { key: "t", short: "Temp", label: "Temperature", unit: "°C", accent: "#f16b43" },
  { key: "h", short: "Humidity", label: "Humidity", unit: "%", accent: "#2f9d8f" },
  { key: "s", short: "Soil", label: "Soil Moisture", unit: "%", accent: "#7b9640" },
  { key: "r", short: "Rain", label: "Rainfall", unit: "mm/h", accent: "#2d6cdf" },
  { key: "ph", short: "pH", label: "Soil pH", unit: "", accent: "#9164df" }
];

const TABS = [
  { id: "farmers", label: "Farmers" },
  { id: "alerts", label: "Alerts" },
  { id: "ml", label: "Smart Insights" }
];

function formatValue(value, unit = "", digits) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  const precision = typeof digits === "number" ? digits : unit ? 1 : 2;
  return `${Number(value).toFixed(precision)}${unit}`;
}

function formatTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString();
}

function formatShortTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatTrend(direction) {
  if (direction === "rising") return "Rising";
  if (direction === "falling") return "Falling";
  return "Stable";
}

function severityLabel(severity) {
  if (severity === "critical") return "Critical";
  if (severity === "warning") return "Warning";
  return "Info";
}

function correlationStrength(value) {
  const strength = Math.abs(value || 0);
  if (strength >= 0.7) return "strong";
  if (strength >= 0.4) return "moderate";
  return "weak";
}

function shortPairLabel(label) {
  if (label === "Temperature vs Humidity") return "T ↔ H";
  if (label === "Temperature vs Soil") return "T ↔ S";
  if (label === "Humidity vs Soil") return "H ↔ S";
  if (label === "Soil vs Rainfall") return "S ↔ R";
  if (label === "Temperature vs Rainfall") return "T ↔ R";
  return label;
}

function describeRelationship(value) {
  const strength = Math.abs(value || 0);
  if (strength < 0.2) return "Very weak link";
  if (value > 0) return "Usually rise together";
  return "Usually move opposite";
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function getMetricTone(value, threshold) {
  if (!threshold || value === null || value === undefined) return "neutral";
  if (value < threshold.low || value > threshold.high) return "critical";
  const span = Math.max(threshold.high - threshold.low, 1);
  const edgePadding = span * 0.12;
  if (value < threshold.low + edgePadding || value > threshold.high - edgePadding) return "warning";
  return "good";
}

function SectionHeader({ eyebrow, title, hint }) {
  return (
    <div className="section-header">
      <span className="eyebrow">{eyebrow}</span>
      <div>
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
    </div>
  );
}

function StatusBanner({ status, sampleCount }) {
  return (
    <div className={`status-banner ${status.connected ? "online" : "offline"}`}>
      <span className="status-dot" />
      <div>
        <strong>{status.connected ? "Live updates are on" : "Live updates are paused"}</strong>
      </div>
    </div>
  );
}

function Pill({ children, tone = "neutral" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function StatCard({ label, value, hint, tone = "neutral" }) {
  return (
    <article className={`stat-card tone-${tone}`}>
      <span className="label">{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  );
}

function SensorCard({ metric }) {
  return (
    <article className={`sensor-card tone-${metric.tone}`}>
      <div className="sensor-card-head">
        <span>{metric.label}</span>
        <Pill tone={metric.tone}>{formatTrend(metric.trend?.direction)}</Pill>
      </div>
      <strong>{formatValue(metric.value, metric.unit)}</strong>
      <div className="sensor-card-meta">
        <span>
          Healthy range {metric.threshold ? `${metric.threshold.low} - ${metric.threshold.high}${metric.unit}` : "--"}
        </span>
        <span>
          Soon {metric.forecast ? formatValue(metric.forecast.next, metric.unit) : "--"}
        </span>
      </div>
    </article>
  );
}

function FarmerAlertPopup({ alerts, onClose, onOpenAlerts }) {
  if (!alerts.length) return null;

  return (
    <aside className="farmer-popup" role="alert" aria-live="assertive">
      <div className="farmer-popup-head">
        <div>
          <span className="eyebrow">Farmer Alert</span>
          <h3>Environmental warning</h3>
        </div>
        <button type="button" className="popup-close" onClick={onClose} aria-label="Close warning popup">
          x
        </button>
      </div>
      {/* <p className="farmer-popup-copy">
        {alerts.length} field warning{alerts.length > 1 ? "s" : ""} need attention now.
      </p> */}
      <div className="farmer-popup-list">
        {alerts.slice(0, 3).map((alert, index) => (
          <div key={`${alert.message}-${index}`} className={`farmer-popup-item ${alert.severity || "warning"}`}>
            <strong>{alert.title || severityLabel(alert.severity)}</strong>
            <span>{alert.message}</span>
          </div>
        ))}
      </div>
      <div className="farmer-popup-actions">
        <button type="button" className="ghost-button" onClick={onOpenAlerts}>
          Open alerts tab
        </button>
        <button type="button" className="primary-button" onClick={onClose}>
          Dismiss
        </button>
      </div>
    </aside>
  );
}

function AlertFeed({ alerts, emptyText = "No active alerts" }) {
  if (!alerts.length) {
    return <div className="empty-card">{emptyText}</div>;
  }

  return (
    <div className="alert-feed">
      {alerts.map((alert, index) => (
        <article key={`${alert.type || "alert"}-${index}`} className={`alert-card ${alert.severity || "info"}`}>
          <div className="alert-card-head">
            <strong>{severityLabel(alert.severity)}</strong>
            <Pill tone={alert.severity || "neutral"}>{alert.type || "Smart alert"}</Pill>
          </div>
          <p>{alert.message}</p>
        </article>
      ))}
    </div>
  );
}

function InsightCard({ title, value, detail }) {
  return (
    <article className="insight-card">
      <span className="label">{title}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function GraphInsightCard({ eyebrow, title, value, subtitle, progress, accent, detail, bars = [] }) {
  return (
    <article className="graph-insight-card">
      <div className="graph-insight-top">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h3>{title}</h3>
        </div>
        <div
          className="graph-ring"
          style={{
            "--progress": `${clampPercent(progress)}%`,
            "--accent": accent
          }}
        >
          <span>{Math.round(clampPercent(progress))}%</span>
        </div>
      </div>
      <strong>{value}</strong>
      <p>{subtitle}</p>
      {bars.length ? (
        <div className="mini-bar-list">
          {bars.map((item) => (
            <div key={item.label} className="mini-bar-row">
              <div className="mini-bar-head">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              <div className="mini-bar-track">
                <div
                  className="mini-bar-fill"
                  style={{
                    width: `${clampPercent(item.percent)}%`,
                    background: item.color || accent
                  }}
                />
              </div>
              {item.note ? <small>{item.note}</small> : null}
            </div>
          ))}
        </div>
      ) : null}
      <small>{detail}</small>
    </article>
  );
}

function PatternCard({ item, active }) {
  return (
    <article className={`pattern-card ${active ? "active" : ""}`}>
      <div className="pattern-card-head">
        <strong>Field mode {item.cluster + 1}</strong>
        <Pill tone={active ? "good" : "neutral"}>{item.size} samples</Pill>
      </div>
      <span>{item.label}</span>
      <p>
        {formatValue(item.t, "°C")} temp, {formatValue(item.h, "%")} humidity, {formatValue(item.s, "%")} soil,
        {" "}{formatValue(item.r, "mm/h")} rain
      </p>
    </article>
  );
}

export default function App() {
  const [latest, setLatest] = useState(null);
  const [trends, setTrends] = useState([]);
  const [status, setStatus] = useState({ connected: false, error: null, lastSuccessAt: null });
  const [activeTab, setActiveTab] = useState("farmers");
  const [hours, setHours] = useState(24);
  const [updateTimes, setUpdateTimes] = useState([]);
  const [dismissedFarmerAlertKey, setDismissedFarmerAlertKey] = useState("");

  useEffect(() => {
    let socket;
    let refreshHandle;

    async function loadInitial() {
      try {
        const [latestRes, trendsRes, healthRes] = await Promise.all([
          axios.get(`${API_BASE}/api/latest`),
          axios.get(`${API_BASE}/api/trends?hours=${hours}`),
          axios.get(`${API_BASE}/api/health`)
        ]);

        setLatest(latestRes.data.data || null);
        setTrends(trendsRes.data.data || []);
        setStatus({
          connected: healthRes.data.status === "ok",
          error: healthRes.data.lastError || null,
          lastSuccessAt: healthRes.data.lastSuccessAt || null
        });
      } catch (error) {
        setStatus((previous) => ({
          ...previous,
          connected: false,
          error: error.message
        }));
      }
    }

    async function refreshTrends() {
      try {
        const response = await axios.get(`${API_BASE}/api/trends?hours=${hours}`);
        setTrends(response.data.data || []);
      } catch (error) {
        setStatus((previous) => ({
          ...previous,
          error: error.message
        }));
      }
    }

    loadInitial();

    socket = io(API_BASE, { transports: ["websocket", "polling"] });
    socket.on("status", (payload) => {
      setStatus((previous) => ({
        ...previous,
        connected: payload.connected,
        error: payload.error || null,
        lastSuccessAt: payload.lastSuccessAt || previous.lastSuccessAt
      }));
    });

    socket.on("latest", (payload) => {
      setLatest(payload);
      setStatus((previous) => ({
        ...previous,
        connected: true,
        error: null
      }));
      setUpdateTimes((previous) => [...previous.slice(-80), Date.now()]);
    });

    refreshHandle = window.setInterval(refreshTrends, 15000);

    return () => {
      window.clearInterval(refreshHandle);
      socket?.disconnect();
    };
  }, [hours]);

  const analytics = latest?.analytics || {};
  const trend = analytics.trend || {};
  const thresholds = analytics.thresholdsML || {};
  const forecast = analytics.forecast || { metrics: {}, preview: [] };
  const anomalies = analytics.anomalies || { items: [], dominantMetrics: [], healthScore: 100 };
  const soilModel = analytics.correlations?.soilMoistureModel || null;
  const patterns = analytics.patterns || { centers: [], cluster: 0 };
  const models = analytics.models || [];
  const useCases = analytics.useCases || {};
  const coefficients = analytics.correlations?.coefficients || {};
  const pollIntervalMs = latest?.meta?.realtime?.pollIntervalMs || 0;

  const messagesPerMinute = useMemo(() => {
    if (!updateTimes.length) return 0;
    const now = Date.now();
    return updateTimes.filter((timestamp) => now - timestamp <= 60000).length;
  }, [updateTimes]);

  const chartData = useMemo(
    () =>
      trends.map((point) => ({
        ...point,
        label: formatShortTime(point.time)
      })),
    [trends]
  );

  const metricCards = useMemo(
    () =>
      METRICS.map((metric) => ({
        ...metric,
        value: latest?.[metric.key],
        trend: trend[metric.key],
        threshold: thresholds[metric.key],
        forecast: forecast.metrics?.[metric.key],
        tone: getMetricTone(latest?.[metric.key], thresholds[metric.key])
      })),
    [forecast, latest, thresholds, trend]
  );

  const allAlerts = useMemo(() => {
    const items = [...(analytics.alertsML || [])];
    if (status.error) {
      items.unshift({
        type: "runtime",
        severity: "warning",
        message: `Runtime issue: ${status.error}`
      });
    }
    return items;
  }, [analytics.alertsML, status.error]);

  const alertCounts = useMemo(
    () => ({
      total: allAlerts.length,
      critical: allAlerts.filter((item) => item.severity === "critical").length,
      warning: allAlerts.filter((item) => item.severity === "warning").length
    }),
    [allAlerts]
  );

  const forecastChartData = useMemo(() => {
    const actual = chartData.slice(-12).map((item) => ({
      label: item.label,
      actualSoil: item.s,
      forecastSoil: null,
      actualTemp: item.t,
      forecastTemp: null,
      actualHumidity: item.h,
      forecastHumidity: null,
      actualRain: item.r,
      forecastRain: null
    }));

    const predicted = (forecast.preview || []).map((item) => ({
      label: item.label,
      actualSoil: null,
      forecastSoil: item.s,
      actualTemp: null,
      forecastTemp: item.t,
      actualHumidity: null,
      forecastHumidity: item.h,
      actualRain: null,
      forecastRain: item.r
    }));

    return [...actual, ...predicted];
  }, [chartData, forecast.preview]);

  const thresholdSummary = useMemo(
    () =>
      metricCards.map((metric) => ({
        name: metric.short,
        current: Number(metric.value || 0),
        low: Number(metric.threshold?.low || 0),
        high: Number(metric.threshold?.high || 0)
      })),
    [metricCards]
  );

  const featureImportanceData = useMemo(() => soilModel?.importances || [], [soilModel]);

  const correlationPairs = [
    { key: "t_h", label: "Temperature vs Humidity", value: coefficients.t_h || 0 },
    { key: "t_s", label: "Temperature vs Soil", value: coefficients.t_s || 0 },
    { key: "h_s", label: "Humidity vs Soil", value: coefficients.h_s || 0 },
    { key: "s_r", label: "Soil vs Rainfall", value: coefficients.s_r || 0 },
    { key: "t_r", label: "Temperature vs Rainfall", value: coefficients.t_r || 0 }
  ];

  const radarData = useMemo(() => {
    const ranges = {
      t: [0, 40],
      h: [0, 100],
      s: [0, 100],
      r: [0, 20],
      ph: [0, 14]
    };

    return METRICS.map((metric) => {
      const [minRange, maxRange] = ranges[metric.key] || [0, 100];
      const value = Number(latest?.[metric.key] ?? 0);
      const normalized = ((value - minRange) / Math.max(maxRange - minRange, 1)) * 100;
      const low = Number(thresholds[metric.key]?.low ?? minRange);
      const high = Number(thresholds[metric.key]?.high ?? maxRange);
      const target = ((low + high) / 2 - minRange) / Math.max(maxRange - minRange, 1) * 100;

      return {
        metric: metric.short,
        current: clampPercent(normalized),
        target: clampPercent(target)
      };
    });
  }, [latest, thresholds]);

  const farmerStats = [
    {
      label: "Crop suitability",
    //   value: latest?.fit ? "Suitable" : "Review field",
      hint: latest?.crop || "Crop",
      tone: latest?.fit ? "good" : "warning"
    },
    {
      label: "Growth index",
      value: formatValue(latest?.growthIndex || 0, "", 2),
      hint: "Comfort score",
      tone: (latest?.growthIndex || 0) >= 0.8 ? "good" : "warning"
    },
    {
      label: "Water stress",
      value: formatValue(latest?.waterStress || 0, "", 2),
      hint: "Irrigation pressure",
      tone: (latest?.waterStress || 0) >= 0.4 ? "critical" : "good"
    },
    {
      label: "Next hour soil",
      value: formatValue(forecast.metrics?.s?.next, "%"),
      hint: "Model forecast",
      tone: forecast.metrics?.s?.next < (thresholds.s?.low || 0) ? "warning" : "good"
    }
  ];

  const farmerActions = [
    useCases.irrigation,
    useCases.drainage,
    useCases.soilChemistry
  ].filter(Boolean);

  const topDrivers = anomalies.dominantMetrics || [];
  const thresholdAlerts = (analytics.alertsML || []).filter((item) => item.type === "learned-threshold");
  const farmerEnvironmentalAlerts = useMemo(() => {
    const sensorWarnings = metricCards
      .filter((metric) => metric.threshold && (metric.tone === "warning" || metric.tone === "critical"))
      .map((metric) => {
        const direction = Number(metric.value) < Number(metric.threshold.low) ? "below" : "above";
        return {
          type: "sensor-band",
          severity: metric.tone === "critical" ? "critical" : "warning",
          title: metric.label,
          message: `${metric.label} is ${direction} the learned safe range (${metric.threshold.low}-${metric.threshold.high}${metric.unit}).`
        };
      });

    const forecastWarnings =
      forecast.metrics?.s?.next < Number(thresholds.s?.low)
        ? [
            {
              type: "forecast-soil",
              severity: "warning",
              title: "Soil moisture forecast",
              message: `Next-hour soil moisture may drop to ${formatValue(forecast.metrics?.s?.next, "%")}.`
            }
          ]
        : [];

    const learnedWarnings = allAlerts
      .filter((alert) => alert.type !== "runtime")
      .map((alert) => ({
        ...alert,
        title:
          alert.type === "learned-threshold"
            ? "Learned threshold"
            : alert.type === "cluster-distance"
              ? "Pattern deviation"
              : "Environmental risk"
      }));

    const rankedAlerts = [...sensorWarnings, ...forecastWarnings, ...learnedWarnings]
      .filter((alert, index, list) => list.findIndex((item) => item.message === alert.message) === index)
      .sort((left, right) => {
        const severityRank = { critical: 0, warning: 1, info: 2 };
        return (severityRank[left.severity] ?? 3) - (severityRank[right.severity] ?? 3);
      });

    return rankedAlerts;
  }, [allAlerts, forecast.metrics, metricCards, thresholds.s?.low]);
  const farmerAlertKey = useMemo(
    () => farmerEnvironmentalAlerts.map((alert) => `${alert.severity}:${alert.message}`).join("|"),
    [farmerEnvironmentalAlerts]
  );
  const showFarmerPopup =
    activeTab === "farmers" &&
    farmerEnvironmentalAlerts.length > 0 &&
    farmerAlertKey !== dismissedFarmerAlertKey;
  const topFeatureBars = featureImportanceData.slice(0, 2).map((item) => ({
    label: item.label,
    value: `${item.weight}%`,
    percent: item.weight,
    color: METRICS.find((metric) => metric.label === item.label)?.accent || "#2d6cdf",
    note: item.direction === "positive" ? "Positive effect" : "Negative effect"
  }));
  const strongestPair = correlationPairs.reduce((best, pair) =>
    Math.abs(pair.value) > Math.abs(best.value) ? pair : best,
  correlationPairs[0] || { label: "--", value: 0 });
  const simpleRelations = correlationPairs.slice(0, 4).map((pair) => ({
    ...pair,
    short: shortPairLabel(pair.label),
    sentence: describeRelationship(pair.value)
  }));
  const patternTotal = (patterns.centers || []).reduce((sum, item) => sum + (item.size || 0), 0);
  const activePattern = (patterns.centers || []).find((item) => item.cluster === patterns.cluster);
  const mlInsightCards = [
    {
      key: "forecast",
      eyebrow: "Trend watch",
      title: "What is likely next",
      value: formatValue(forecast.metrics?.s?.next, "%"),
      subtitle: `Soil moisture ${formatTrend(trend.s?.direction).toLowerCase()}`,
      progress: forecast.metrics?.s?.next || 0,
      accent: "#7b9640",
      detail: "Helps plan watering before moisture gets too low."
    },
    {
      key: "thresholds",
      eyebrow: "Risk limits",
      title: "Smart safe range checks",
      value: `${thresholdAlerts.length} active alerts`,
      subtitle: "Limits adapt to your field history",
      progress: (thresholdAlerts.length / Math.max(METRICS.length, 1)) * 100,
      accent: "#d18d28",
      detail: "Avoids one-size-fits-all limits."
    },
    {
      key: "correlation",
      eyebrow: "Sensor links",
      title: "Which readings affect soil",
      value: topFeatureBars.length ? topFeatureBars.map((item) => item.label).join(" and ") : "Waiting for data",
      subtitle: soilModel ? `Model fit score ${soilModel.r2}` : "Top drivers not available yet",
      progress: (soilModel?.r2 || 0) * 100,
      accent: "#2d6cdf",
      detail: "Shows what has the biggest effect on moisture.",
      bars: topFeatureBars
    },
    {
      key: "anomaly",
      eyebrow: "Unusual activity",
      title: "Unexpected reading check",
      value: anomalies.items?.length ? `${anomalies.items.length} unusual flags` : "No unusual behaviour",
      subtitle: `Health score ${anomalies.healthScore || 100}/100`,
      progress: anomalies.healthScore || 100,
      accent: "#c95f4b",
      detail: "Catches sudden changes and possible sensor issues."
    },
    {
      key: "patterns",
      eyebrow: "Field routines",
      title: "Common field conditions",
      value: patterns.label || "No pattern yet",
      subtitle: activePattern ? `Current mode has ${activePattern.size} samples` : "Current mode not available",
      progress: activePattern && patternTotal ? (activePattern.size / patternTotal) * 100 : 0,
      accent: "#9164df",
      detail: "Shows repeated condition groups for easier decisions."
    }
  ];

  const exportCsv = () => {
    if (!trends.length) return;
    const headers = ["time", "temperature", "humidity", "soil_moisture", "rainfall", "ph"];
    const rows = trends.map((row) => [row.time, row.t, row.h, row.s, row.r, row.ph]);
    const csv = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `agri-dashboard-${new Date().toISOString().split("T")[0]}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-shell">
      <div className="page-glow page-glow-left" />
      <div className="page-glow page-glow-right" />

      <header className="hero-card">
        <div className="hero-copy">
          <h1>Smart Agriculture Dashboard</h1>
          <p>Track sensors, risks, and actions.</p>
          <StatusBanner status={status} />
        </div>

        <div className="hero-side">
          <div className="hero-meta-grid">
            <div className="meta-item">
              <span className="label">Zone</span>
              <strong>{latest?.zone || "Unknown"}</strong>
            </div>
            <div className="meta-item">
              <span className="label">Device</span>
              <strong>{latest?.id || "ESP32"}</strong>
            </div>
            <div className="meta-item">
              <span className="label">Updated</span>
              <strong>{formatTime(latest?.time)}</strong>
            </div>
            <div className="meta-item">
              <span className="label">Messages/min</span>
              <strong>{messagesPerMinute}</strong>
            </div>
          </div>

          <div className="control-row">
            <label>
              Window
              <select value={hours} onChange={(event) => setHours(Number(event.target.value))}>
                <option value={3}>30m</option>
                <option value={6}>6h</option>
                <option value={12}>12h</option>
                <option value={24}>24h</option>
                <option value={48}>48h</option>
                <option value={168}>7d</option>
              </select>
            </label>

            <button className="primary-button" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
        </div>
      </header>

      <nav className="tabbar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "farmers" && (
        <main className="content-stack">
          <SectionHeader
            eyebrow="Farmers"
            title="Field status"
            hint="Live readings + next-hour view."
          />

          <section className="stats-grid">
            {farmerStats.map((item) => (
              <StatCard key={item.label} {...item} />
            ))}
          </section>

          <section className="sensor-grid">
            {metricCards.map((metric) => (
              <SensorCard key={metric.key} metric={metric} />
            ))}
          </section>

          <section className="two-column-grid">
            <article className="panel">
              <SectionHeader
                eyebrow="Live trend"
                title="Sensor trends"
                hint="Temperature, humidity, soil moisture, and rain."
              />
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f16b43" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#f16b43" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="soilFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7b9640" stopOpacity={0.24} />
                        <stop offset="95%" stopColor="#7b9640" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d5e0d7" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="t" name="Temperature" stroke="#f16b43" fill="url(#tempFill)" />
                    <Line type="monotone" dataKey="h" name="Humidity" stroke="#2f9d8f" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="s" name="Soil Moisture" stroke="#7b9640" fill="url(#soilFill)" />
                    <Line type="monotone" dataKey="r" name="Rainfall" stroke="#2d6cdf" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="panel">
              <SectionHeader
                eyebrow="Forecast"
                title="Next-hour projection"
                hint="Actual + model continuation."
              />
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={forecastChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d5e0d7" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="actualSoil" name="Actual soil" stroke="#7b9640" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="forecastSoil" name="Forecast soil" stroke="#7b9640" strokeDasharray="6 4" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="actualTemp" name="Actual temp" stroke="#f16b43" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="forecastTemp" name="Forecast temp" stroke="#f16b43" strokeDasharray="6 4" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="actualHumidity" name="Actual humidity" stroke="#2f9d8f" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="forecastHumidity" name="Forecast humidity" stroke="#2f9d8f" strokeDasharray="6 4" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="actualRain" name="Actual rain" stroke="#2d6cdf" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="forecastRain" name="Forecast rain" stroke="#2d6cdf" strokeDasharray="6 4" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="two-column-grid">
            <article className="panel">
              <SectionHeader
                eyebrow="Actions"
                title="Suggested now"
                hint="Based on trend + risk."
              />
              <div className="action-grid">
                {farmerActions.map((item) => (
                  <InsightCard
                    key={item.title}
                    title={item.title}
                    value={item.priority === "high" ? "Action needed" : "Monitor"}
                    detail={item.insight}
                  />
                ))}
                {!farmerActions.length && (
                  <div className="empty-card">Waiting for use-case recommendations from the backend.</div>
                )}
              </div>
            </article>

            <article className="panel">
              <SectionHeader
                eyebrow="Snapshot"
                title="Condition radar"
                hint="Current vs target band center."
              />
              <div className="chart-wrap compact-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#d5e0d7" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip />
                    <Radar name="Current" dataKey="current" stroke="#23402f" fill="#2f9d8f" fillOpacity={0.4} />
                    <Radar name="Target" dataKey="target" stroke="#f16b43" fill="#f16b43" fillOpacity={0.18} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>
        </main>
      )}

      {showFarmerPopup && (
        <FarmerAlertPopup
          alerts={farmerEnvironmentalAlerts}
          onClose={() => setDismissedFarmerAlertKey(farmerAlertKey)}
          onOpenAlerts={() => {
            setDismissedFarmerAlertKey(farmerAlertKey);
            setActiveTab("alerts");
          }}
        />
      )}

      {activeTab === "alerts" && (
        <main className="content-stack">
          <SectionHeader
            eyebrow="Alerts"
            title="Risk watch"
            hint="Smart limits + unusual activity."
          />

          <section className="stats-grid">
            <StatCard label="Total alerts" value={alertCounts.total} hint="Range + unusual" tone={alertCounts.total ? "warning" : "good"} />
            <StatCard label="Critical alerts" value={alertCounts.critical} hint="Needs immediate action" tone={alertCounts.critical ? "critical" : "good"} />
            <StatCard label="Health score" value={`${anomalies.healthScore || 100}/100`} hint="System stability" tone={(anomalies.healthScore || 100) >= 75 ? "good" : "warning"} />
            <StatCard label="Backend status" value={status.connected ? "Healthy" : "Check stream"} hint={`Poll every ${pollIntervalMs ? pollIntervalMs / 1000 : "--"}s`} tone={status.connected ? "good" : "critical"} />
          </section>

          <section className="two-column-grid">
            <article className="panel">
              <SectionHeader
                eyebrow="Active feed"
                title="Current alerts"
                hint="Newest first."
              />
              <AlertFeed alerts={allAlerts} emptyText="No learned alerts are active right now." />
            </article>

            <article className="panel">
              <SectionHeader
                eyebrow="Smart range"
                title="Reading vs safe range"
                hint="Low, high, and current values."
              />
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={thresholdSummary}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d5e0d7" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="low" name="Low band" fill="#d8e2db" />
                    <Bar dataKey="high" name="High band" fill="#9bb8aa" />
                    <Bar dataKey="current" name="Current" fill="#214030" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="two-column-grid">
            <article className="panel">
              <SectionHeader
                eyebrow="Top risk reasons"
                title="Main unusual readings"
                hint="Compared with normal history."
              />
              <div className="driver-list">
                {topDrivers.map((item) => (
                  <div key={item.metric} className="driver-row">
                    <div>
                      <strong>{item.label}</strong>
                      <span>deviation score {item.zScore}</span>
                    </div>
                    <Pill tone={Math.abs(item.zScore) >= 2.2 ? "warning" : "neutral"}>
                      {Math.abs(item.zScore) >= 2.2 ? "Outlier" : "Normal"}
                    </Pill>
                  </div>
                ))}
                {!topDrivers.length && <div className="empty-card">No unusual drivers right now.</div>}
              </div>
            </article>

            <article className="panel">
              <SectionHeader
                eyebrow="Reliability"
                title="System pulse"
                hint="Realtime flow health."
              />
              <div className="reliability-grid">
                <InsightCard title="Last sensor update" value={formatTime(latest?.time)} detail="Latest record pushed to the dashboard" />
                <InsightCard title="Last backend poll" value={formatTime(status.lastSuccessAt)} detail="Most recent successful API refresh" />
                <InsightCard title="Updates per minute" value={messagesPerMinute} detail="Live updates in the last minute" />
                <InsightCard title="System state" value={status.error ? "Warning" : "Healthy"} detail={status.error || "No backend issues reported"} />
              </div>
            </article>
          </section>
        </main>
      )}

      {activeTab === "ml" && (
        <main className="content-stack">
          <SectionHeader
            eyebrow="Smart insights"
            title="Easy to understand"
            hint="Simple guidance from your farm data."
          />

          <section className="insight-visual-grid">
            {mlInsightCards.map((item) => (
              <GraphInsightCard key={item.key} {...item} />
            ))}
          </section>

          <section className="two-column-grid">
            <article className="panel">
              <SectionHeader
                eyebrow="Main causes"
                title="What changes soil moisture"
                hint="Longer bar = stronger effect."
              />
              <div className="mini-bar-list">
                {featureImportanceData.slice(0, 5).map((item) => (
                  <div key={`${item.feature}-${item.label}`} className="mini-bar-row">
                    <div className="mini-bar-head">
                      <span>{item.label}</span>
                      <strong>{item.weight}%</strong>
                    </div>
                    <div className="mini-bar-track">
                      <div
                        className="mini-bar-fill"
                        style={{
                          width: `${clampPercent(item.weight)}%`,
                          background: METRICS.find((metric) => metric.label === item.label)?.accent || "#2d6cdf"
                        }}
                      />
                    </div>
                  </div>
                ))}
                {!featureImportanceData.length && <div className="empty-card">Need more data to rank causes.</div>}
              </div>
              <div className="caption-line">
                {soilModel
                  ? `Confidence ${soilModel.r2} | Expected moisture ${formatValue(soilModel.prediction, "%")}`
                  : "Collecting more data for better confidence."}
              </div>
            </article>

            <article className="panel">
              <SectionHeader
                eyebrow="Reading links"
                title="How readings move together"
                hint="Simple relationship summary."
              />
              <div className="driver-list">
                <div className="driver-row">
                  <div>
                    <strong>Strongest link: {shortPairLabel(strongestPair.label)}</strong>
                    <span>{describeRelationship(strongestPair.value)}</span>
                  </div>
                  <Pill tone={correlationStrength(strongestPair.value) === "strong" ? "good" : "warning"}>
                    {strongestPair.value.toFixed(2)}
                  </Pill>
                </div>
                {simpleRelations.map((pair) => (
                  <div key={pair.key} className="driver-row">
                    <div>
                      <strong>{pair.short}</strong>
                      <span>{pair.sentence}</span>
                    </div>
                    <Pill tone={correlationStrength(pair.value) === "weak" ? "neutral" : "info"}>
                      {pair.value.toFixed(2)}
                    </Pill>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="two-column-grid">
            <article className="panel">
              <SectionHeader
                eyebrow="Field routines"
                title="Common condition groups"
                hint="Recurring environmental states."
              />
              <div className="pattern-grid">
                {(patterns.centers || []).map((item) => (
                  <PatternCard key={item.cluster} item={item} active={patterns.cluster === item.cluster} />
                ))}
                {!patterns.centers?.length && <div className="empty-card">Waiting for more data to show routines.</div>}
              </div>
            </article>

            <article className="panel">
              <SectionHeader
                eyebrow="Correlation summary"
                title="Correlation heatmap"
                hint="Signed relationship strength."
              />
              <div className="correlation-heatmap">
                {correlationPairs.map((pair) => {
                  const strength = Math.abs(pair.value || 0);
                  const opacity = 0.2 + strength * 0.75;
                  const color = pair.value >= 0 ? `rgba(45,108,223, ${opacity})` : `rgba(201,95,75, ${opacity})`;

                  return (
                    <div key={pair.key} className="heatmap-tile" style={{ backgroundColor: color }}>
                      <span>{shortPairLabel(pair.label)}</span>
                      <strong>{pair.value.toFixed(3)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="heatmap-legend">
                <span><i className="legend-dot positive" /> Positive</span>
                <span><i className="legend-dot negative" /> Negative</span>
              </div>
            </article>
          </section>
        </main>
      )}
    </div>
  );
}
