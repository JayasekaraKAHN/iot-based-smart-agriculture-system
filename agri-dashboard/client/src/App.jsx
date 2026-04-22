import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  BarChart,
  Bar,
  ScatterChart,
  Scatter,
  ZAxis,
  Area,
  AreaChart,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from "recharts";

const API_BASE = "http://localhost:5001";

const TEXT = {
  en: {
    title: "🌱 Smart Agriculture Dashboard",
    subtitle: "AI-Powered Decision Support for Modern Farming",
    live: "Live Connected",
    waiting: "Connecting...",
    rawTab: "Live Monitoring",
    mlTab: "AI Insights",
    analyticsTab: "Analytics",
    alertsTab: "Alerts & Actions",
    export: "Export Data",
    role: "View as",
    farmer: "Farmer",
    officer: "Agri Officer",
    researcher: "Researcher",
    admin: "System Admin",
    lastUpdate: "Last update",
    deviceStatus: "Device Status",
    online: "Online",
    offline: "Offline",
    irrigationNeeded: "Irrigation Needed",
    goodConditions: "Optimal Conditions",
    criticalAlert: "Critical Alert",
    warningAlert: "Warning",
    recommendations: "Recommendations",
    cropSuitability: "Crop Suitability",
    weatherForecast: "Short-term Forecast",
    zoneInfo: "Zone Information",
    dailySummary: "Daily Summary",
    weeklySummary: "Weekly Summary"
  },
  si: {
    title: "🌱 ස්මාර්ට් කෘෂි පුවරුව",
    subtitle: "නවීන ගොවිතැන සඳහා AI-බලගතු තීරණ සහාය",
    live: "සජීවී සම්බන්ධතාවය",
    waiting: "සම්බන්ධ වෙමින්...",
    rawTab: "සජීවී අධීක්ෂණය",
    mlTab: "AI අවබෝධයන්",
    analyticsTab: "විශ්ලේෂණ",
    alertsTab: "ඇඟවීම් සහ ක්‍රියා",
    export: "දත්ත අපනයනය",
    role: "දැක්ම",
    farmer: "ගොවියා",
    officer: "කෘෂි නිලධාරී",
    researcher: "පර්යේෂක",
    admin: "පද්ධති පරිපාලක",
    lastUpdate: "අවසන් යාවත්කාලය",
    deviceStatus: "උපාංග තත්වය",
    online: "සබැඳි",
    offline: "නොබැඳි",
    irrigationNeeded: "ජලාශය අවශ්‍යයි",
    goodConditions: "ප්‍රශස්ත තත්වයන්",
    criticalAlert: "තීව්‍ර ඇඟවීම",
    warningAlert: "අනතුරු ඇඟවීම",
    recommendations: "නිර්දේශ",
    cropSuitability: "බෝග ගැළපීම",
    weatherForecast: "කෙටිකාලීන පුරෝකථනය",
    zoneInfo: "කලාප තොරතුරු",
    dailySummary: "දෛනික සාරාංශය",
    weeklySummary: "සතිපතා සාරාංශය"
  }
};

const ROLE_VIEWS = [
  { value: "farmer", label: "Farmer" },
  { value: "officer", label: "Agri Officer" },
  { value: "researcher", label: "Researcher" },
  { value: "admin", label: "System Admin" }
];

// Crop database with optimal conditions
const CROP_DATABASE = {
  "Tea": { tempRange: [10, 30], humidityRange: [70, 90], soilRange: [40, 70], phRange: [4.5, 6.5], icon: "🍵" },
  "Green Gram": { tempRange: [25, 35], humidityRange: [60, 80], soilRange: [30, 60], phRange: [6.0, 7.5], icon: "🫘" },
  "Paddy": { tempRange: [20, 35], humidityRange: [80, 95], soilRange: [60, 90], phRange: [5.5, 7.0], icon: "🌾" },
  "Corn": { tempRange: [18, 32], humidityRange: [60, 80], soilRange: [40, 70], phRange: [6.0, 7.0], icon: "🌽" },
  "Coconut": { tempRange: [27, 32], humidityRange: [70, 90], soilRange: [50, 75], phRange: [5.5, 7.5], icon: "🥥" },
  "Not Suitable": { tempRange: [0, 100], humidityRange: [0, 100], soilRange: [0, 100], phRange: [0, 14], icon: "⚠️" }
};

function formatValue(value, unit) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${Number(value).toFixed(unit === "" ? 0 : 1)}${unit}`;
}

function formatDirection(direction) {
  if (!direction) return "--";
  if (direction === "rising") return "📈 Rising";
  if (direction === "falling") return "📉 Falling";
  return "➡️ Stable";
}

function getStatus(value, bounds) {
  if (value === null || value === undefined) return "neutral";
  if (!bounds) return "neutral";
  if (value < bounds.low || value > bounds.high) return "bad";
  if (value < bounds.low * 1.05 || value > bounds.high * 0.95) return "warn";
  return "ok";
}

function getRainStatus(rainfall) {
  if (rainfall === 0) return { status: "No Rain", icon: "☀️", class: "rain-none" };
  if (rainfall < 2.5) return { status: "Light Rain", icon: "🌦️", class: "rain-light" };
  if (rainfall < 10) return { status: "Moderate Rain", icon: "🌧️", class: "rain-moderate" };
  return { status: "Heavy Rain", icon: "⛈️", class: "rain-heavy" };
}

function getSoilMoistureAdvice(soilMoisture, rainfall, temperature) {
  if (soilMoisture < 20) {
    if (rainfall > 0) return { text: "Monitor soil - rain is active", priority: "medium", icon: "👁️" };
    return { text: "Urgent irrigation required", priority: "high", icon: "💧" };
  }
  if (soilMoisture < 30) {
    if (temperature > 30) return { text: "Irrigate within 2-3 hours", priority: "high", icon: "⏰" };
    return { text: "Plan irrigation for today", priority: "medium", icon: "📅" };
  }
  if (soilMoisture < 40) {
    return { text: "Irrigation may be needed soon", priority: "low", icon: "📊" };
  }
  if (soilMoisture > 80) {
    return { text: "Excess moisture - check drainage", priority: "medium", icon: "⚠️" };
  }
  return { text: "Soil moisture optimal", priority: "good", icon: "✅" };
}

function calculateCropConfidence(crop, currentValues) {
  if (!crop || crop === "Not Suitable" || !CROP_DATABASE[crop]) return 0;
  
  const db = CROP_DATABASE[crop];
  const { t, h, s, ph } = currentValues;
  
  let score = 0;
  let count = 0;
  
  if (t >= db.tempRange[0] && t <= db.tempRange[1]) score += 25;
  else score += Math.max(0, 25 - Math.abs(t - (db.tempRange[0] + db.tempRange[1]) / 2));
  count++;
  
  if (h >= db.humidityRange[0] && h <= db.humidityRange[1]) score += 25;
  else score += Math.max(0, 25 - Math.abs(h - (db.humidityRange[0] + db.humidityRange[1]) / 2) / 2);
  count++;
  
  if (s >= db.soilRange[0] && s <= db.soilRange[1]) score += 25;
  else score += Math.max(0, 25 - Math.abs(s - (db.soilRange[0] + db.soilRange[1]) / 2) / 2);
  count++;
  
  if (ph >= db.phRange[0] && ph <= db.phRange[1]) score += 25;
  else score += Math.max(0, 25 - Math.abs(ph - (db.phRange[0] + db.phRange[1]) / 2) * 5);
  count++;
  
  return Math.min(100, Math.max(0, score));
}

function AlertItem({ alert }) {
  const severity = alert?.severity || "warning";
  const icon = severity === "critical" ? "🚨" : severity === "warning" ? "⚠️" : "ℹ️";
  return (
    <div className={`alert ${severity}`}>
      <span className="alert-icon">{icon}</span>
      <span>{alert.message || alert}</span>
    </div>
  );
}

function Gauge({ value, label, max = 100 }) {
  const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), max) : 0;
  const percentage = (safeValue / max) * 100;
  return (
    <div className="gauge">
      <div className="gauge-label">{label}</div>
      <div className="gauge-track">
        <div className="gauge-fill" style={{ width: `${percentage}%` }} />
      </div>
      <div className="gauge-value">{formatValue(safeValue, max === 100 ? "%" : "")}</div>
    </div>
  );
}

function IrrigationCard({ latest }) {
  if (!latest) return null;
  
  const advice = getSoilMoistureAdvice(latest.s, latest.r, latest.t);
  const priorityColors = {
    high: "critical",
    medium: "warning",
    low: "info",
    good: "success"
  };
  
  return (
    <div className={`card irrigation-card priority-${advice.priority}`}>
      <h3>💧 Irrigation Advisor</h3>
      <div className="irrigation-content">
        <div className="irrigation-icon">{advice.icon}</div>
        <div className="irrigation-text">
          <p className="irrigation-advice">{advice.text}</p>
          <div className="irrigation-metrics">
            <span>Soil: {formatValue(latest.s, "%")}</span>
            <span>Rain: {formatValue(latest.r, "mm/h")}</span>
            <span>Temp: {formatValue(latest.t, "°C")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoneMapCard({ latest }) {
  if (!latest) return null;
  
  const zone = latest.zone || "Unknown";
  const zoneInfo = {
    "Wet": { desc: "High rainfall region", color: "#3498db", icon: "🌧️" },
    "Dry": { desc: "Low rainfall region", color: "#e67e22", icon: "☀️" },
    "Intermediate": { desc: "Moderate rainfall region", color: "#2ecc71", icon: "🌤️" },
    "Unknown": { desc: "Zone not detected", color: "#95a5a6", icon: "❓" }
  };
  
  const info = zoneInfo[zone] || zoneInfo["Unknown"];
  
  return (
    <div className="card zone-card">
      <h3>🌍 Location & Zone</h3>
      <div className="zone-content">
        <div className="zone-icon" style={{ backgroundColor: info.color }}>
          {info.icon}
        </div>
        <div className="zone-details">
          <p className="zone-name">{zone} Zone</p>
          <p className="zone-desc">{info.desc}</p>
          {latest.crop && (
            <p className="zone-crop">Suggested: {CROP_DATABASE[latest.crop]?.icon || "🌱"} {latest.crop}</p>
          )}
        </div>
      </div>
      <div className="zone-map-placeholder">
        <div className="map-marker">📍</div>
        <p className="map-coords">Coordinates tracking active</p>
      </div>
    </div>
  );
}

function DailySummaryCard({ trends }) {
  if (!trends || trends.length === 0) return null;
  
  const last24h = trends.slice(-144); // 24 hours of 10min intervals
  
  const avgTemp = last24h.reduce((sum, p) => sum + p.t, 0) / last24h.length;
  const avgHumidity = last24h.reduce((sum, p) => sum + p.h, 0) / last24h.length;
  const avgSoil = last24h.reduce((sum, p) => sum + p.s, 0) / last24h.length;
  const totalRain = last24h.reduce((sum, p) => sum + p.r, 0) * (10/60); // Convert to mm
  
  const maxTemp = Math.max(...last24h.map(p => p.t));
  const minTemp = Math.min(...last24h.map(p => p.t));
  
  return (
    <div className="card summary-card">
      <h3>📅 Last 24 Hours Summary</h3>
      <div className="summary-grid">
        <div className="summary-item">
          <span className="summary-label">Avg Temperature</span>
          <span className="summary-value">{formatValue(avgTemp, "°C")}</span>
          <span className="summary-range">({formatValue(minTemp, "°C")} - {formatValue(maxTemp, "°C")})</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Avg Humidity</span>
          <span className="summary-value">{formatValue(avgHumidity, "%")}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Avg Soil Moisture</span>
          <span className="summary-value">{formatValue(avgSoil, "%")}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Total Rainfall</span>
          <span className="summary-value">{formatValue(totalRain, "mm")}</span>
        </div>
      </div>
    </div>
  );
}

function CropRecommendationCard({ latest }) {
  if (!latest) return null;
  
  const crop = latest.crop || "Not Suitable";
  const confidence = calculateCropConfidence(crop, latest);
  const cropInfo = CROP_DATABASE[crop] || CROP_DATABASE["Not Suitable"];
  
  return (
    <div className="card crop-card">
      <h3>🌾 Crop Recommendation</h3>
      <div className="crop-content">
        <div className="crop-icon-large">{cropInfo.icon}</div>
        <div className="crop-details">
          <p className="crop-name">{crop}</p>
          <div className="confidence-bar">
            <div className="confidence-label">
              <span>Suitability</span>
              <span className="confidence-value">{confidence.toFixed(0)}%</span>
            </div>
            <div className="confidence-track">
              <div 
                className="confidence-fill" 
                style={{ 
                  width: `${confidence}%`,
                  backgroundColor: confidence > 70 ? "#2ecc71" : confidence > 40 ? "#f39c12" : "#e74c3c"
                }}
              />
            </div>
          </div>
          <div className="crop-conditions">
            <div className="condition-item">
              <span className="condition-label">Temp:</span>
              <span className={latest.t >= cropInfo.tempRange[0] && latest.t <= cropInfo.tempRange[1] ? "condition-good" : "condition-bad"}>
                {formatValue(latest.t, "°C")} {cropInfo.tempRange[0] !== 0 ? `(${cropInfo.tempRange[0]}-${cropInfo.tempRange[1]}°C)` : ""}
              </span>
            </div>
            <div className="condition-item">
              <span className="condition-label">Humidity:</span>
              <span className={latest.h >= cropInfo.humidityRange[0] && latest.h <= cropInfo.humidityRange[1] ? "condition-good" : "condition-bad"}>
                {formatValue(latest.h, "%")} {cropInfo.humidityRange[0] !== 0 ? `(${cropInfo.humidityRange[0]}-${cropInfo.humidityRange[1]}%)` : ""}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceHealthCard({ latest, status, messagesPerMinute }) {
  const uptime = latest ? "Active" : "No Data";
  const lastSeen = latest?.time ? new Date(latest.time).toLocaleString() : "--";
  const deviceId = latest?.id || "ESP32_UNKNOWN";
  
  return (
    <div className="card device-card">
      <h3>📡 Device Health</h3>
      <div className="device-status-grid">
        <div className="device-stat">
          <span className="device-label">Status</span>
          <span className={`device-value ${status.connected ? "status-online" : "status-offline"}`}>
            {status.connected ? "🟢 Online" : "🔴 Offline"}
          </span>
        </div>
        <div className="device-stat">
          <span className="device-label">Device ID</span>
          <span className="device-value">{deviceId}</span>
        </div>
        <div className="device-stat">
          <span className="device-label">Data Rate</span>
          <span className="device-value">{messagesPerMinute} msg/min</span>
        </div>
        <div className="device-stat">
          <span className="device-label">Last Update</span>
          <span className="device-value">{lastSeen}</span>
        </div>
      </div>
      <div className="device-health-bar">
        <div className="health-indicator" style={{ 
          width: status.connected ? '100%' : '20%',
          backgroundColor: status.connected ? '#2ecc71' : '#e74c3c'
        }}>
          <span>{status.connected ? 'System Healthy' : 'Connection Issue'}</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [latest, setLatest] = useState(null);
  const [trends, setTrends] = useState([]);
  const [status, setStatus] = useState({ connected: false });
  const [activeTab, setActiveTab] = useState("raw");
  const [role, setRole] = useState("farmer");
  const [lang, setLang] = useState("en");
  const [hours, setHours] = useState(24);
  const [updateTimes, setUpdateTimes] = useState([]);
  const [showAlertPanel, setShowAlertPanel] = useState(true);

  useEffect(() => {
    let socket;
    const fetchInitial = async () => {
      try {
        const latestRes = await axios.get(`${API_BASE}/api/latest`);
        setLatest(latestRes.data.data);
        const trendsRes = await axios.get(`${API_BASE}/api/trends?hours=${hours}`);
        setTrends(trendsRes.data.data || []);
      } catch (err) {
        console.error("Failed to fetch initial data:", err);
      }
    };

    fetchInitial();

    socket = io(API_BASE);
    socket.on("status", (payload) => setStatus(payload));
    socket.on("latest", (data) => {
      setLatest(data);
      setUpdateTimes((prev) => [...prev.slice(-50), Date.now()]);
    });

    return () => socket?.disconnect();
  }, [hours]);

  const analytics = latest?.analytics;
  const rawAlerts = analytics?.alertsML || [];
  const alerts = useMemo(() => rawAlerts.map((alert) => (typeof alert === "string" ? { message: alert, severity: "warning" } : alert)), [rawAlerts]);
  const anomalies = useMemo(() => analytics?.anomalies || [], [analytics]);
  const trend = analytics?.trend || {};
  const correlations = analytics?.correlations || {};
  const thresholds = analytics?.thresholdsML || {};
  const forecast = analytics?.forecast || {};
  const patterns = analytics?.patterns || {};

  const messagesPerMinute = useMemo(() => {
    if (!updateTimes.length) return 0;
    const windowMs = 60000;
    const now = Date.now();
    return updateTimes.filter((t) => now - t <= windowMs).length;
  }, [updateTimes]);

  const chartData = useMemo(() => trends.map((p) => ({
    ...p,
    time: new Date(p.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  })), [trends]);

  const text = TEXT[lang];

  const exportCSV = () => {
    if (!trends.length) return;
    const headers = ["time", "temperature", "humidity", "soil_moisture", "rainfall", "ph"];
    const rows = trends.map((row) => [
      row.time,
      row.t ?? "",
      row.h ?? "",
      row.s ?? "",
      row.r ?? "",
      row.ph ?? ""
    ]);
    const content = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `agri-data-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const rainStatus = getRainStatus(latest?.r || 0);
  const TempStatus = getStatus(latest?.t, thresholds.t);
  const HumStatus = getStatus(latest?.h, thresholds.h);
  const SoilStatus = getStatus(latest?.s, thresholds.s);
  const PhStatus = getStatus(latest?.ph, thresholds.ph);

  // Generate smart alerts based on conditions
  const smartAlerts = useMemo(() => {
    if (!latest) return [];
    const generatedAlerts = [];
    
    // Soil moisture alerts
    if (latest.s < 20) {
      generatedAlerts.push({ 
        message: "🚨 Critical: Soil moisture below 20% - Immediate irrigation required", 
        severity: "critical",
        priority: 1
      });
    } else if (latest.s < 30) {
      generatedAlerts.push({ 
        message: "⚠️ Warning: Soil moisture low - Plan irrigation within 3 hours", 
        severity: "warning",
        priority: 2
      });
    }
    
    // Temperature alerts
    if (latest.t > 35) {
      generatedAlerts.push({ 
        message: "🌡️ High temperature detected - Monitor crop stress", 
        severity: "warning",
        priority: 2
      });
    } else if (latest.t < 10) {
      generatedAlerts.push({ 
        message: "❄️ Low temperature - Potential frost risk", 
        severity: "critical",
        priority: 1
      });
    }
    
    // pH alerts
    if (latest.ph < 5.5 || latest.ph > 8.5) {
      generatedAlerts.push({ 
        message: "🧪 Soil pH out of optimal range - Consider soil treatment", 
        severity: "warning",
        priority: 3
      });
    }
    
    // Heavy rain alert
    if (latest.r > 10) {
      generatedAlerts.push({ 
        message: "⛈️ Heavy rainfall detected - Check drainage systems", 
        severity: "warning",
        priority: 2
      });
    }
    
    // Good conditions
    if (latest.fit && generatedAlerts.length === 0) {
      generatedAlerts.push({ 
        message: "✅ All conditions optimal for cultivation", 
        severity: "info",
        priority: 10
      });
    }
    
    return generatedAlerts.sort((a, b) => a.priority - b.priority);
  }, [latest]);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <div className="hero-actions">
          <div className={`pill ${status.connected ? "pill-ok" : "pill-warn"}`}>
            {status.connected ? `${text.live} 🟢` : `${text.waiting} 🔴`}
          </div>
          <div className="toolbar">
            <label>
              {text.role}
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLE_VIEWS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {text[item.value]}
                  </option>
                ))}
              </select>
            </label>
            <button className="ghost" onClick={() => setLang((prev) => (prev === "en" ? "si" : "en"))}>
              {lang === "en" ? "සිං" : "EN"}
            </button>
          </div>
        </div>
      </header>

      <nav className="tabs">
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button className={activeTab === "raw" ? "active" : ""} onClick={() => setActiveTab("raw")}>
            📊 {text.rawTab}
          </button>
          <button className={activeTab === "analytics" ? "active" : ""} onClick={() => setActiveTab("analytics")}>
            📈 {text.analyticsTab}
          </button>
          <button className={activeTab === "ml" ? "active" : ""} onClick={() => setActiveTab("ml")}>
            🤖 {text.mlTab}
          </button>
          <button className={activeTab === "alerts" ? "active" : ""} onClick={() => setActiveTab("alerts")}>
            🚨 {text.alertsTab}
          </button>
        </div>
        <div className="tab-actions">
          <label>
            Hours
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              <option value={6}>6h</option>
              <option value={12}>12h</option>
              <option value={24}>24h</option>
              <option value={48}>48h</option>
              <option value={168}>7d</option>
            </select>
          </label>
          <button className="primary" onClick={exportCSV}>
            📥 {text.export}
          </button>
        </div>
      </nav>

      {/* Smart Alert Banner */}
      {showAlertPanel && smartAlerts.length > 0 && (
        <div className="alert-banner">
          <div className="alert-banner-content">
            {smartAlerts.slice(0, 3).map((alert, idx) => (
              <AlertItem key={idx} alert={alert} />
            ))}
          </div>
          <button className="alert-banner-close" onClick={() => setShowAlertPanel(false)}>×</button>
        </div>
      )}

      {activeTab === "raw" && (
        <section>
          {/* Main Sensor Cards */}
          <section className="grid grid-4">
            <div className={`card stat-card ${TempStatus}`}>
              <h3>🌡️ Temperature</h3>
              <p className="value">{formatValue(latest?.t, "°C")}</p>
              <div className="muted">
                {formatDirection(trend.t?.direction)}
                <br />Range: {thresholds.t ? `${thresholds.t.low}-${thresholds.t.high}°C` : "--"}
              </div>
            </div>
            <div className={`card stat-card ${HumStatus}`}>
              <h3>💧 Humidity</h3>
              <p className="value">{formatValue(latest?.h, "%")}</p>
              <div className="muted">
                {formatDirection(trend.h?.direction)}
                <br />Range: {thresholds.h ? `${thresholds.h.low}-${thresholds.h.high}%` : "--"}
              </div>
            </div>
            <div className={`card stat-card ${SoilStatus}`}>
              <h3>🌱 Soil Moisture</h3>
              <p className="value">{formatValue(latest?.s, "%")}</p>
              <div className="muted">
                {formatDirection(trend.s?.direction)}
                <br />Range: {thresholds.s ? `${thresholds.s.low}-${thresholds.s.high}%` : "--"}
              </div>
            </div>
            <div className={`card stat-card ${rainStatus.class}`}>
              <h3>🌧️ Rainfall</h3>
              <p className="value">{formatValue(latest?.r, " mm/h")}</p>
              <div className="muted">
                {rainStatus.icon} {rainStatus.status}
                <br />Status: {latest?.r > 0 ? "Active" : "Dry"}
              </div>
            </div>
          </section>

          {/* Secondary Metrics */}
          <section className="grid grid-4">
            <div className={`card stat-card ${PhStatus}`}>
              <h3>🧪 Soil pH</h3>
              <p className="value">{formatValue(latest?.ph, "")}</p>
              <div className="muted">
                Optimal: 6.0-7.5
                <br />Status: {latest?.ph >= 6.0 && latest?.ph <= 7.5 ? "Good" : "Needs Attention"}
              </div>
            </div>
            <div className="card stat-card ok">
              <h3>🌾 Growth Index</h3>
              <p className="value">{formatValue((latest?.growthIndex || 0) * 100, "%")}</p>
              <div className="muted">
                Cultivation potential
                <br />Updated: Live
              </div>
            </div>
            <div className="card stat-card warn">
              <h3>💦 Water Stress</h3>
              <p className="value">{formatValue((latest?.waterStress || 0) * 100, "%")}</p>
              <div className="muted">
                Evapotranspiration factor
                <br />Combined metric
              </div>
            </div>
            <div className={`card stat-card ${latest?.fit ? "ok" : "warn"}`}>
              <h3>✅ Suitability</h3>
              <p className="value">{latest?.fit ? "Suitable" : "Needs Care"}</p>
              <div className="muted">
                Overall conditions
                <br />For: {latest?.crop || "N/A"}
              </div>
            </div>
          </section>

          {/* Key Insights Row */}
          <section className="grid grid-3">
            <IrrigationCard latest={latest} />
            <CropRecommendationCard latest={latest} />
            <ZoneMapCard latest={latest} />
          </section>

          {/* Gauges */}
          <section className="grid grid-4">
            <div className="card">
              <Gauge value={latest?.t || 0} label="Temperature (°C)" max={50} />
            </div>
            <div className="card">
              <Gauge value={latest?.h || 0} label="Humidity (%)" max={100} />
            </div>
            <div className="card">
              <Gauge value={latest?.s || 0} label="Soil Moisture (%)" max={100} />
            </div>
            <div className="card">
              <Gauge value={latest?.ph || 0} label="pH Level" max={14} />
            </div>
          </section>

          {/* Charts */}
          <section className="grid grid-2">
            <div className="card chart-card">
              <h3>📈 Temperature & Humidity Trends</h3>
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ff6b6b" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#ff6b6b" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorHum" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4ecdc4" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#4ecdc4" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="t" stroke="#ff6b6b" fillOpacity={1} fill="url(#colorTemp)" name="Temp (°C)" />
                    <Area type="monotone" dataKey="h" stroke="#4ecdc4" fillOpacity={1} fill="url(#colorHum)" name="Humidity (%)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card chart-card">
              <h3>🌱 Soil Moisture & Rainfall</h3>
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="s" stroke="#95a5a6" strokeWidth={2} name="Soil (%)" dot={false} />
                    <Line type="monotone" dataKey="r" stroke="#3498db" strokeWidth={2} name="Rain (mm/h)" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Full History Chart */}
          <section className="card chart-card">
            <h3>📊 Complete Sensor History</h3>
            <div className="chart-wrapper" style={{ height: '400px' }}>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="t" name="Temp (°C)" stroke="#ff6b6b" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="h" name="Humidity (%)" stroke="#4ecdc4" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="s" name="Soil (%)" stroke="#95a5a6" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="r" name="Rain (mm/h)" stroke="#3498db" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="ph" name="pH" stroke="#9b59b6" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </section>
      )}

      {activeTab === "analytics" && (
        <section>
          <section className="grid grid-2">
            <DailySummaryCard trends={trends} />
            <DeviceHealthCard latest={latest} status={status} messagesPerMinute={messagesPerMinute} />
          </section>

          {/* Rainfall Analysis */}
          <section className="grid grid-2">
            <div className="card chart-card">
              <h3>🌧️ Rainfall Pattern Analysis</h3>
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="r" fill="#3498db" name="Rainfall (mm/h)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="rain-summary">
                <p>Total Accumulated: {formatValue(trends.reduce((sum, p) => sum + p.r, 0) * (10/60), "mm")}</p>
                <p>Current Status: {rainStatus.icon} {rainStatus.status}</p>
              </div>
            </div>

            <div className="card">
              <h3>🎯 Environmental Score</h3>
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={[
                  { metric: 'Temp', value: latest?.t ? Math.min((latest.t / 40) * 100, 100) : 0 },
                  { metric: 'Humidity', value: latest?.h || 0 },
                  { metric: 'Soil', value: latest?.s || 0 },
                  { metric: 'pH', value: latest?.ph ? (latest.ph / 14) * 100 : 0 },
                  { metric: 'Growth', value: (latest?.growthIndex || 0) * 100 }
                ]}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" />
                  <PolarRadiusAxis angle={90} domain={[0, 100]} />
                  <Radar name="Current" dataKey="value" stroke="#2ecc71" fill="#2ecc71" fillOpacity={0.6} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Trend Analysis */}
          <section className="grid grid-3">
            <div className="card">
              <h3>📈 Temperature Trend</h3>
              <p className="value">{formatDirection(trend.t?.direction)}</p>
              <span className="muted">Slope: {trend.t?.slope ?? "--"}</span>
              <div className="trend-chart-mini">
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={chartData.slice(-20)}>
                    <Line type="monotone" dataKey="t" stroke="#ff6b6b" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h3>💧 Humidity Trend</h3>
              <p className="value">{formatDirection(trend.h?.direction)}</p>
              <span className="muted">Slope: {trend.h?.slope ?? "--"}</span>
              <div className="trend-chart-mini">
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={chartData.slice(-20)}>
                    <Line type="monotone" dataKey="h" stroke="#4ecdc4" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h3>🌱 Soil Trend</h3>
              <p className="value">{formatDirection(trend.s?.direction)}</p>
              <span className="muted">Slope: {trend.s?.slope ?? "--"}</span>
              <div className="trend-chart-mini">
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={chartData.slice(-20)}>
                    <Line type="monotone" dataKey="s" stroke="#95a5a6" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Forecast Section */}
          <section className="card">
            <h3>🔮 Short-term Forecast (Next Hour)</h3>
            <div className="grid grid-4">
              <div className="forecast-item">
                <span className="forecast-label">🌡️ Temperature</span>
                <span className="forecast-value">{formatValue(forecast.t?.next, "°C")}</span>
                <span className="forecast-change">{forecast.t?.slope > 0 ? "↗️ Rising" : forecast.t?.slope < 0 ? "↘️ Falling" : "→ Stable"}</span>
              </div>
              <div className="forecast-item">
                <span className="forecast-label">💧 Humidity</span>
                <span className="forecast-value">{formatValue(forecast.h?.next, "%")}</span>
                <span className="forecast-change">{forecast.h?.slope > 0 ? "↗️ Rising" : forecast.h?.slope < 0 ? "↘️ Falling" : "→ Stable"}</span>
              </div>
              <div className="forecast-item">
                <span className="forecast-label">🌱 Soil</span>
                <span className="forecast-value">{formatValue(forecast.s?.next, "%")}</span>
                <span className="forecast-change">{forecast.s?.slope > 0 ? "↗️ Rising" : forecast.s?.slope < 0 ? "↘️ Falling" : "→ Stable"}</span>
              </div>
              <div className="forecast-item">
                <span className="forecast-label">🧪 pH</span>
                <span className="forecast-value">{formatValue(forecast.ph?.next, "")}</span>
                <span className="forecast-change">{forecast.ph?.slope > 0 ? "↗️ Rising" : forecast.ph?.slope < 0 ? "↘️ Falling" : "→ Stable"}</span>
              </div>
            </div>
          </section>
        </section>
      )}

      {activeTab === "ml" && (
        <section>
          <section className="grid grid-2">
            <div className="card">
              <h3>🤖 ML Alerts</h3>
              <div className="alert-stack">
                {alerts.length === 0 && <div className="muted">No ML-detected anomalies. System stable.</div>}
                {alerts.map((alert, idx) => (
                  <AlertItem key={`${alert.message || alert}-${idx}`} alert={alert} />
                ))}
              </div>
            </div>
            <div className="card">
              <h3>⚠️ Detected Anomalies</h3>
              <ul className="list">
                {anomalies.length === 0 && <li>No statistical anomalies detected.</li>}
                {anomalies.map((item) => (
                  <li key={`${item.metric}-${item.z}`}>
                    <strong>{item.metric.toUpperCase()}</strong>: {item.value} (z-score: {item.z})
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="card">
            <h3>🎯 Pattern Recognition</h3>
            <div className="pattern-display">
              <div className="pattern-current">
                <h4>Current Cluster: {patterns.cluster ?? "--"}</h4>
                <p className="pattern-label">{patterns.label || "No pattern identified"}</p>
              </div>
              <div className="pattern-centers">
                <h4>Identified Patterns:</h4>
                <div className="grid grid-3">
                  {(patterns.centers || []).map((center, idx) => (
                    <div key={`center-${idx}`} className="pattern-card">
                      <div className="pattern-id">Pattern #{idx}</div>
                      <div className="pattern-desc">{center.label}</div>
                      <div className="pattern-metrics">
                        <span>T: {formatValue(center.t, "°C")}</span>
                        <span>H: {formatValue(center.h, "%")}</span>
                        <span>S: {formatValue(center.s, "%")}</span>
                        <span>R: {formatValue(center.r, "mm/h")}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-2">
            <div className="card">
              <h3>🔗 Correlation Analysis</h3>
              <div className="correlation-matrix">
                {[
                  { label: "Temperature ↔ Humidity", value: correlations.t_h, key: "t_h" },
                  { label: "Temperature ↔ Soil", value: correlations.t_s, key: "t_s" },
                  { label: "Humidity ↔ Soil", value: correlations.h_s, key: "h_s" },
                  { label: "Soil ↔ Rainfall", value: correlations.s_r, key: "s_r" },
                  { label: "Temperature ↔ Rainfall", value: correlations.t_r, key: "t_r" }
                ].map((item) => {
                  const absValue = Math.abs(item.value || 0);
                  const strength = absValue > 0.7 ? "strong" : absValue > 0.4 ? "moderate" : "weak";
                  return (
                    <div key={item.key} className={`correlation-item ${strength}`}>
                      <span className="correlation-label">{item.label}</span>
                      <span className="correlation-value">{(item.value || 0).toFixed(3)}</span>
                      <div className="correlation-bar">
                        <div 
                          className="correlation-fill" 
                          style={{ 
                            width: `${absValue * 100}%`,
                            backgroundColor: absValue > 0.7 ? "#2ecc71" : absValue > 0.4 ? "#f39c12" : "#95a5a6"
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card chart-card">
              <h3>📊 Correlation Scatter</h3>
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart>
                  <CartesianGrid />
                  <XAxis dataKey="t" name="Temperature" unit="°C" />
                  <YAxis dataKey="s" name="Soil" unit="%" />
                  <ZAxis dataKey="h" range={[60, 200]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                  <Scatter data={chartData} fill="#6c5ce7" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <h3>💡 AI-Generated Insights</h3>
            <div className="insights-grid">
              {trend.s?.direction === "falling" && (
                <div className="insight-card warning">
                  <span className="insight-icon">📉</span>
                  <p>Soil moisture has been <strong>decreasing</strong> over the last {hours} hours. Consider irrigation soon.</p>
                </div>
              )}
              {latest?.fit && (
                <div className="insight-card success">
                  <span className="insight-icon">✅</span>
                  <p>Current conditions are <strong>optimal</strong> for {latest.crop}. Maintain current practices.</p>
                </div>
              )}
              {(latest?.waterStress || 0) > 0.6 && (
                <div className="insight-card critical">
                  <span className="insight-icon">💦</span>
                  <p>Water stress index is <strong>elevated</strong> at {((latest?.waterStress || 0) * 100).toFixed(0)}%. Plants may be experiencing stress.</p>
                </div>
              )}
              {Math.abs(correlations.t_h || 0) > 0.7 && (
                <div className="insight-card info">
                  <span className="insight-icon">🔗</span>
                  <p>Strong correlation detected between temperature and humidity ({(correlations.t_h || 0).toFixed(2)}). Typical for this climate.</p>
                </div>
              )}
            </div>
          </section>
        </section>
      )}

      {activeTab === "alerts" && (
        <section>
          <section className="grid grid-2">
            <div className="card">
              <h3>🚨 Active Alerts</h3>
              <div className="alert-stack">
                {smartAlerts.length === 0 && (
                  <div className="alert info">
                    <span className="alert-icon">✅</span>
                    <span>All systems normal. No alerts at this time.</span>
                  </div>
                )}
                {smartAlerts.map((alert, idx) => (
                  <AlertItem key={idx} alert={alert} />
                ))}
              </div>
            </div>

            <div className="card">
              <h3>📋 Recommendations</h3>
              <div className="recommendations-list">
                {(latest?.recommendations || []).length === 0 && (
                  <p className="muted">No specific recommendations at this time.</p>
                )}
                {(latest?.recommendations || []).map((rec, idx) => (
                  <div key={idx} className="recommendation-item">
                    <span className="recommendation-icon">💡</span>
                    <span>{rec}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid grid-3">
            <IrrigationCard latest={latest} />
            <CropRecommendationCard latest={latest} />
            <DeviceHealthCard latest={latest} status={status} messagesPerMinute={messagesPerMinute} />
          </section>

          {/* Action Items */}
          <section className="card">
            <h3>✅ Suggested Actions</h3>
            <div className="action-items-grid">
              <div className="action-item">
                <div className="action-header">
                  <span className="action-icon">💧</span>
                  <span className="action-title">Irrigation Management</span>
                </div>
                <div className="action-content">
                  {latest?.s < 30 ? (
                    <p>✓ Schedule irrigation for next <strong>2-3 hours</strong></p>
                  ) : (
                    <p>○ No irrigation needed currently</p>
                  )}
                </div>
              </div>

              <div className="action-item">
                <div className="action-header">
                  <span className="action-icon">🌡️</span>
                  <span className="action-title">Temperature Control</span>
                </div>
                <div className="action-content">
                  {latest?.t > 35 ? (
                    <p>✓ Consider shade or cooling methods</p>
                  ) : (
                    <p>○ Temperature within acceptable range</p>
                  )}
                </div>
              </div>

              <div className="action-item">
                <div className="action-header">
                  <span className="action-icon">🧪</span>
                  <span className="action-title">Soil Treatment</span>
                </div>
                <div className="action-content">
                  {latest?.ph < 6.0 || latest?.ph > 7.5 ? (
                    <p>✓ pH adjustment recommended</p>
                  ) : (
                    <p>○ Soil pH is optimal</p>
                  )}
                </div>
              </div>

              <div className="action-item">
                <div className="action-header">
                  <span className="action-icon">🌧️</span>
                  <span className="action-title">Drainage Check</span>
                </div>
                <div className="action-content">
                  {latest?.r > 5 ? (
                    <p>✓ Monitor drainage systems</p>
                  ) : (
                    <p>○ No drainage issues expected</p>
                  )}
                </div>
              </div>

              <div className="action-item">
                <div className="action-header">
                  <span className="action-icon">📊</span>
                  <span className="action-title">Data Collection</span>
                </div>
                <div className="action-content">
                  <p>✓ System collecting data at {messagesPerMinute} msg/min</p>
                </div>
              </div>

              <div className="action-item">
                <div className="action-header">
                  <span className="action-icon">🌾</span>
                  <span className="action-title">Crop Management</span>
                </div>
                <div className="action-content">
                  {latest?.fit ? (
                    <p>✓ Conditions optimal for {latest.crop}</p>
                  ) : (
                    <p>⚠ Monitor crop health closely</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </section>
      )}

      <footer className="footer">
        <div>
          {text.lastUpdate}: {latest?.time ? new Date(latest.time).toLocaleString() : "--"}
        </div>
        <div>
          Device: {latest?.id || "ESP32"} | Zone: {latest?.zone || "Unknown"} | Data points: {trends.length}
        </div>
      </footer>
    </div>
  );
}
