# Agri IoT Real-Time Dashboard (Node + React)

This dashboard uses MQTT → Telegraf → InfluxDB and a Node.js API with a React frontend.

## 1) Start Telegraf
```zsh
cd "/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/IOTBA/tst_prj/agri-dashboard"
telegraf --config telegraf.conf
```

## 2) Start the API server
```zsh
cd "/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/IOTBA/tst_prj/agri-dashboard/server"
npm install
npm start
```

Server runs on `http://localhost:5001`.

## 3) Start the React client
```zsh
cd "/Users/hirunijayasekara/Documents/SLIIT/Year 4/Y4S1/IOTBA/tst_prj/agri-dashboard/client"
npm install
npm run dev
```

Client runs on `http://localhost:3000`.

## Data Fields
This dashboard expects fields from InfluxDB:
- `t`, `h`, `s`, `r`, `ph`, `crop`, `zone`, `id`, `_time`
- Uppercase variants (`T`, `H`, `S`, `R`, `pH`) are also supported.

## Features for Farmers & Officers
- Real-time sensor gauges
- Suitability check (temperature, humidity, soil, rainfall, pH)
- Crop recommendation and zone info
- Growth index and water stress metrics
- ML-driven alerts (learned thresholds + anomaly detection)
- Correlation analysis and forecast summaries
- Pattern clustering for behavior analysis
- 24h trend chart

## 6.1 Task and Actions

| Task | Action Taken | Justification |
| --- | --- | --- |
| Refine visualization clarity | Simplified complex line graphs into color-coded trend indicators; added tooltips for exact values | Usability results: farmers found original charts confusing; simplified visuals improve readability and immediate comprehension |
| Improve alert visibility | Used red for critical alerts, orange for warnings, and universal icons (⚠, ❗) | UX principles: visibility of system status and error prevention; colors follow universal meanings |
| Enhance actionable insights | Displayed recommended crops based on micro-climate data in card format | Helps farmers make quick decisions; supports decision-making principle of UX |
| Mobile responsiveness | Adjusted layout for tablets and mobile with collapsible panels | Ensures consistent experience across devices (responsive design principle) |
| Multi-language support | Added toggle for English/Sinhala | Increases accessibility for local farmers and stakeholders |

## 6.2 Before - After Comparison

| Aspect | Before | After | Improvement |
| --- | --- | --- | --- |
| Temperature & Humidity Display | Raw line graphs | Colored gauges with numeric values | Easier interpretation for farmers |
| Alerts | Text only | Color-coded + icon + text | Faster recognition of critical issues |
| Crop Recommendations | Table format | Cards with icons and recommended actions | More actionable and user-friendly |
| Navigation | Single scrollable page | Tabbed layout (Raw Data / ML Insights) | Reduced cognitive load and improved task efficiency |
| Data Export | Not available | Export button for CSV/Excel | Supports researchers’ needs |
| Mobile Layout | Desktop layout scaled down | Responsive design with collapsible sections | Better usability on mobile/tablet devices |

## 6.3 Design Integration Summary
- Iterations were driven by usability findings and UX principles.
- Focused on simplifying visuals, enhancing alert recognition, and making actionable data prominent.
- Resulted in a more intuitive, stakeholder-focused dashboard that is usable on multiple devices, supports multi-language, and provides immediate insights.

## 7 Design Handoff Report

### 7.1 Annotated Prototype Screens

#### 7.1.1 Farmer Dashboard Prototype
**Purpose:** Provide farmers with simple real-time field monitoring and crop recommendations.

**Main Components**
- Crop Recommendation Card: Displays the most suitable crop and confidence score. Positioned at the top for quick decision support.
- Real-Time Sensor Cards: Temperature, Humidity, Soil Moisture, Soil pH with color indicators (Green/Yellow/Red) for rapid interpretation.
- Soil Moisture Gauge: Visual meter to guide irrigation decisions.
- Environmental Trend Line Chart: Temperature, Humidity, Soil Moisture trends for short-term monitoring.
- Rainfall Timeline: Recent rainfall events to avoid unnecessary irrigation.
- Alert Panel: High visibility warnings (low moisture, high temperature, heavy rainfall).

#### 7.1.2 Agricultural Officers Dashboard
**Purpose:** Enable officers to monitor multiple farms and provide advisory recommendations.

**Main Components**
- Farm Comparison Chart (future multi-farm): Bar comparison across farms.
- Crop Suitability Heatmap: Suitability across farms or zones.
- Rainfall Distribution Chart: Histogram showing rainfall frequency.
- Environmental Trend Graph: Seasonal changes across farms.
- Alert Frequency Panel: Count of alerts per farm to identify risks.

#### 7.1.3 Agricultural Researchers Dashboard
**Purpose:** Support researchers in analyzing long-term agricultural and climate trends.

**Main Components**
- Climate Trend Line Chart: Temperature, Rainfall, Soil Moisture trends.
- Environmental Correlation Scatter Plot: Relationships such as Temperature vs Soil Moisture.
- Crop Suitability Analysis Chart: Bar chart showing suitability scores across crops.
- Multi-Variable Heatmap: Relationships among climate variables and crop suitability.

#### 7.1.4 System Administrator / IoT Technician Dashboard
**Purpose:** Monitor system performance, sensor health, and data transmission.

**Main Components**
- Sensor Status Table: Sensor ID, status (online/offline), last update time.
- Data Stream Monitoring: Live update rate chart and last update status.
- MQTT Message Rate Graph: Message throughput per minute.
- Database Performance Chart: Writes per minute (future enhancement).
- System Alert Panel: Sensor failures or data transmission delays.

### 7.2 Interaction and Visualization Specifications
- Interactive Filters: date/time range, sensor parameter, alert type, and farm location.
- Drill-Down Functionality: click alerts to view historical trends and root cause.
- Real-Time Data Updates: automatic updates every 5–10 minutes (near real-time).
- Alert Notifications: alerts generated when learned thresholds are exceeded or anomalies detected.
