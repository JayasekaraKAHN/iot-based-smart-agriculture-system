#include <WiFi.h>
#define MQTT_MAX_PACKET_SIZE 512
#include <PubSubClient.h>
#include "DHT.h"
#include <Wire.h>
#include <EEPROM.h>
#include <HTTPClient.h>
#include <hd44780.h>
#include <hd44780ioClass/hd44780_I2Cexp.h>
#include "time.h"

// ================= LCD =================
hd44780_I2Cexp lcd;

// ================= TinyML =================
#include "ph_regressor.h"
#include "crop_classifier.h"
#include "crop_labels.h"
#include "zone_classifier.h"
#include "zone_labels.h"

Eloquent::ML::Port::PhRegressor phModel;
Eloquent::ML::Port::CropClassifier cropModel;
Eloquent::ML::Port::ZoneClassifier zoneModel;

// ================= WiFi =================
const char* ssid = "Hiruni";
const char* password = "Hiruni2022";

// ================= MQTT =================
const char* mqtt_server = "192.168.1.2";
const int mqtt_port = 1883;
const char* mqtt_topic = "agricultural/esp32/data";

WiFiClient espClient;
PubSubClient mqttClient(espClient);

#define DEVICE_ID "ESP32_GARDEN_01"

// ================= Location (EEPROM) =================
const int EEPROM_SIZE = 64;
const int EEPROM_ADDR_LON = 0;
const int EEPROM_ADDR_LAT = 4;
const int EEPROM_ADDR_VALID = 8;

float storedLongitude = 0.0f;
float storedLatitude = 0.0f;
bool hasLocation = false;

unsigned long lastGeoUpdate = 0;
const unsigned long GEO_UPDATE_INTERVAL_MS = 6UL * 60UL * 60UL * 1000UL; // 6 hours

// ================= Sensors =================
#define DHTPIN 4
#define DHTTYPE DHT22
DHT dht(DHTPIN, DHTTYPE);

#define RAIN_SENSOR_PIN 34
#define SOIL_SENSOR_PIN 35
#define SOIL_POWER_PIN 25

// ================= CALIBRATION =================
int SOIL_ADC_DRY = 2620;
int SOIL_ADC_WET = 1200;

int RAIN_ADC_DRY = 2520;
int RAIN_ADC_WET = 2000;

// ================= Rain System =================
float rainFiltered = 0;
bool isRaining = false;
float rainMMperHour = 0;

// ================= Helpers =================
float safeLog(float x) {
  return log1p(max(x, 0.0f));
}

// ================= ADC =================
int readSoilADC() {
  digitalWrite(SOIL_POWER_PIN, HIGH);
  delay(100);

  long total = 0;
  for (int i = 0; i < 10; i++) {
    total += analogRead(SOIL_SENSOR_PIN);
    delay(10);
  }

  digitalWrite(SOIL_POWER_PIN, LOW);
  return total / 10;
}

int readRainADC() {
  analogRead(RAIN_SENSOR_PIN); // flush

  long total = 0;
  for (int i = 0; i < 10; i++) {
    total += analogRead(RAIN_SENSOR_PIN);
    delay(5);
  }

  return total / 10;
}

// ================= SOIL =================
float getSoilMoisture() {
  int adc = readSoilADC();

  float soil = 100.0 * (float)(adc - SOIL_ADC_DRY) /
               (SOIL_ADC_WET - SOIL_ADC_DRY);

  return constrain(soil, 0, 100);
}

// ================= RAIN =================
float getRainPercent() {
  int adc = readRainADC();

  float rain = 100.0 * (float)(adc - RAIN_ADC_DRY) /
               (RAIN_ADC_WET - RAIN_ADC_DRY);

  rain = constrain(rain, 0, 100);

  rainFiltered = (0.7 * rainFiltered) + (0.3 * rain);

  return rainFiltered;
}

// ================= RAIN MM CONVERSION =================
float estimateRainMM(float rainPercent) {
  if (rainPercent < 5) return 0;
  return rainPercent * 0.25;   // calibrated multiplier
}

// ================= Location Helpers =================
void loadLocationFromEEPROM() {
  EEPROM.begin(EEPROM_SIZE);
  uint8_t valid = EEPROM.read(EEPROM_ADDR_VALID);
  if (valid == 1) {
    EEPROM.get(EEPROM_ADDR_LON, storedLongitude);
    EEPROM.get(EEPROM_ADDR_LAT, storedLatitude);
    hasLocation = true;
  }
}

void saveLocationToEEPROM(float lon, float lat) {
  storedLongitude = lon;
  storedLatitude = lat;
  hasLocation = true;
  EEPROM.put(EEPROM_ADDR_LON, storedLongitude);
  EEPROM.put(EEPROM_ADDR_LAT, storedLatitude);
  EEPROM.write(EEPROM_ADDR_VALID, 1);
  EEPROM.commit();
}

bool parseLatLon(const String& payload, float &lon, float &lat) {
  int latIdx = payload.indexOf("\"lat\":");
  int lonIdx = payload.indexOf("\"lon\":");
  if (latIdx < 0 || lonIdx < 0) return false;

  int latStart = latIdx + 6;
  int latEnd = payload.indexOf(',', latStart);
  int lonStart = lonIdx + 6;
  int lonEnd = payload.indexOf(',', lonStart);
  if (latEnd < 0) latEnd = payload.indexOf('}', latStart);
  if (lonEnd < 0) lonEnd = payload.indexOf('}', lonStart);

  lat = payload.substring(latStart, latEnd).toFloat();
  lon = payload.substring(lonStart, lonEnd).toFloat();
  return true;
}

void updateLocationFromIP() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin("http://ip-api.com/json");
  int httpCode = http.GET();
  if (httpCode == 200) {
    String body = http.getString();
    float lon = 0.0f, lat = 0.0f;
    if (parseLatLon(body, lon, lat)) {
      saveLocationToEEPROM(lon, lat);
    }
  }
  http.end();
}

// ================= WIFI =================
void connectWiFi() {
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    updateLocationFromIP();
    lastGeoUpdate = millis();
  }
}

// ================= MQTT =================
void connectMQTT() {
  if (!mqttClient.connected()) {
    mqttClient.connect(DEVICE_ID);
  }
}

void updateLCD(float t, float h, float s, float rainMM, float ph, const char* crop, const char* zone) {
  lcd.clear();

  // ===== Row 1 == (Temperature & Humidity)
  lcd.setCursor(0, 0);
  lcd.print("T:");
  lcd.print(t,1);       // e.g. 30.7
  lcd.print("C ");

  lcd.print("H:");
  lcd.print(h,0);       // e.g. 78
  lcd.print("%");

  // ===== Row 2 ===== (Soil & Rain)
  lcd.setCursor(0, 1);
  lcd.print("Soil:");
  lcd.print(s,0);       // shorter (no decimal)
  lcd.print("% ");

  lcd.print("R:");
  lcd.print(rainMM,1);  // e.g. 2.5
  lcd.print("mm");

  // ===== Row 3 ===== (pH & Zone)
  lcd.setCursor(0, 2);
  lcd.print("pH:");
  lcd.print(ph,1);

  lcd.print(" Z:");
  lcd.print(zone);      // keep short label!

  // ===== Row 4 ===== (Crop)
  lcd.setCursor(0, 3);
  lcd.print("Crop:");
  lcd.print(crop);
}


// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  dht.begin();

  pinMode(SOIL_POWER_PIN, OUTPUT);
  digitalWrite(SOIL_POWER_PIN, LOW);

  analogReadResolution(12);

  Wire.begin(21, 22);
  lcd.begin(20, 4);
  lcd.backlight();

  WiFi.mode(WIFI_STA);
  loadLocationFromEEPROM();
  connectWiFi();

  mqttClient.setServer(mqtt_server, mqtt_port);
}

// ================= LOOP =================
void loop() {

  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  if (!mqttClient.connected()) connectMQTT();
  mqttClient.loop();

  if (WiFi.status() == WL_CONNECTED && millis() - lastGeoUpdate > GEO_UPDATE_INTERVAL_MS) {
    updateLocationFromIP();
    lastGeoUpdate = millis();
  }

  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity)) return;

  float soil = getSoilMoisture();
  float rain = getRainPercent();

  rainMMperHour = estimateRainMM(rain);
  float rainInput = rainMMperHour;

  // ================= ML =================
  float features[11] = {
    temperature, humidity, soil, rainInput,
    temperature * humidity,
    rainInput * soil,
    temperature / (humidity + 1),
    temperature * temperature,
    safeLog(humidity),
    soil - 0.3 * rainInput,
    0
  };

  float ph = phModel.predict(features);

  float cf[5] = {temperature, humidity, soil, rainInput, ph};
  int cropIdx = cropModel.predict(cf);
  const char* crop = "Unknown";
  if (cropIdx >= 0 && cropIdx < kCropLabelCount) {
    crop = kCropLabels[cropIdx];
  }

  const char* zone = "Unknown";
  if (hasLocation) {
    int zoneIdx = zoneModel.predict(storedLongitude, storedLatitude);
    zone = kZoneLabels[zoneIdx];
  }

  // ================= DEBUG =================
  Serial.println("=== Sensor Readings ===");
  Serial.printf("Temp: %.1f | Hum: %.1f\n", temperature, humidity);
  Serial.printf("Soil: %.1f%% | Rain: %.1f mm/h\n", soil, rainMMperHour);
  Serial.printf("pH: %.2f | Crop: %s | Zone: %s\n\n", ph, crop, zone);

  // ================= MQTT =================
  char payload[512];
  snprintf(payload, sizeof(payload),
    "{\"t\":%.1f,\"h\":%.1f,\"s\":%.1f,\"rain_mm\":%.1f,\"ph\":%.2f,\"crop\":\"%s\",\"zone\":\"%s\",\"lon\":%.5f,\"lat\":%.5f}",
    temperature, humidity, soil, rainMMperHour, ph, crop, zone,
    storedLongitude, storedLatitude);

  mqttClient.publish(mqtt_topic, payload);

  // ================= LCD =================
  updateLCD(temperature, humidity, soil, rainMMperHour, ph, crop, zone);

  delay(2000);
}
