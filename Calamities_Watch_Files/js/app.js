/* =========================================================
   CONFIG — plug in your keys here during the buildathon
   ========================================================= */
const CONFIG = {
  OPENWEATHER_API_KEY: "",     // TODO: paste OpenWeatherMap key
  MUMBAI_CENTER: [19.0760, 72.8777],
  DEFAULT_ZOOM: 12,
  // TODO: initialize Firebase here once config is ready
  // FIREBASE_CONFIG: { apiKey:"", authDomain:"", projectId:"", ... }
};

const REPORT_TYPES = {
  flooding:      { label: "Flooding",       color: "#ff5a5f" },
  waterlogging:  { label: "Waterlogging",   color: "#2fa5d8" },
  tree_fall:     { label: "Tree fall",      color: "#35c48f" },
  power_outage:  { label: "Power outage",   color: "#ffb020" },
  road_block:    { label: "Road blocked",   color: "#a463f2" },
  other:         { label: "Other",          color: "#7e93a7" },
};

/* =========================================================
   STATE — dual persistence: localStorage now, Firebase sync later
   ========================================================= */
let reports = JSON.parse(localStorage.getItem("calamitiesWatch_reports") || "[]");
let map, markersLayer, userLocationMarker = null, radarLayer = null, radarOn = false;
let selectedSeverity = "medium";
let userLatLng = null;
let reportChart = null;

/* =========================================================
   MAP
   ========================================================= */
function initMap(){
  map = L.map('map', { zoomControl:false }).setView(CONFIG.MUMBAI_CENTER, CONFIG.DEFAULT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position:'bottomright' }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  // allow tapping the map to pin a report location
  map.on('click', (e) => { userLatLng = e.latlng; });

  reports.forEach(addMarkerForReport);
}

function addMarkerForReport(r){
  const meta = REPORT_TYPES[r.type] || REPORT_TYPES.other;
  const marker = L.circleMarker([r.lat, r.lng], {
    radius: r.severity === "high" ? 10 : r.severity === "medium" ? 8 : 6,
    color: meta.color,
    fillColor: meta.color,
    fillOpacity: 0.55,
    weight: 2
  }).bindPopup(`<b>${meta.label}</b><br>${r.description}<br><small>${new Date(r.timestamp).toLocaleString()}</small>`);
  marker.addTo(markersLayer);
}

function locateUser(){
  if(!navigator.geolocation){ alert("Geolocation not supported on this device."); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    map.flyTo(userLatLng, 15);
    
    // Add or update user location marker
    if(userLocationMarker){
      userLocationMarker.setLatLng(userLatLng);
    } else {
      userLocationMarker = L.circleMarker(userLatLng, {
        radius: 8,
        color: "#2fa5d8",
        fillColor: "#2fa5d8",
        fillOpacity: 0.8,
        weight: 2,
        dashArray: "4, 2"
      }).bindPopup("📍 Your location").addTo(map);
    }
    
    fetchWeather(userLatLng.lat, userLatLng.lng);
  }, () => alert("Couldn't get your location — check location permissions."));
}

/* Rain radar — RainViewer public tiles (no key needed).
   Falls back to a note if the API is unreachable. */
async function toggleRadar(){
  const btn = document.getElementById('btnRadar');
  if(radarOn && radarLayer){
    map.removeLayer(radarLayer);
    radarOn = false;
    btn.classList.remove('active');
    return;
  }
  try{
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    const latestFrame = data.radar.past[data.radar.past.length - 1].path;
    radarLayer = L.tileLayer(`https://tilecache.rainviewer.com${latestFrame}/256/{z}/{x}/{y}/2/1_1.png`, {
      opacity: 0.6
    }).addTo(map);
    radarOn = true;
    btn.classList.add('active');
  }catch(err){
    console.warn("RainViewer unavailable, consider Windy iframe fallback.", err);
    alert("Radar layer unavailable right now. (Fallback: embed Windy iframe here.)");
  }
}

/* =========================================================
   WEATHER
   ========================================================= */
async function fetchWeather(lat, lng){
  const [wLat, wLng] = [lat || CONFIG.MUMBAI_CENTER[0], lng || CONFIG.MUMBAI_CENTER[1]];

  if(!CONFIG.OPENWEATHER_API_KEY){
    renderWeatherMock();
    return;
  }
  try{
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${wLat}&lon=${wLng}&units=metric&appid=${CONFIG.OPENWEATHER_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    renderWeather({
      temp: Math.round(data.main.temp),
      cond: data.weather[0].description,
      rain: data.rain ? (data.rain["1h"] || 0) : 0,
      humidity: data.main.humidity,
      wind: Math.round(data.wind.speed * 3.6)
    });
  }catch(err){
    console.warn("Weather fetch failed, using mock data.", err);
    renderWeatherMock();
  }
}

function renderWeather(w){
  document.getElementById('wTemp').textContent = `${w.temp}°`;
  document.getElementById('wCond').textContent = w.cond;
  document.getElementById('wRain').textContent = `${w.rain} mm`;
  document.getElementById('wHumidity').textContent = `${w.humidity}%`;
  document.getElementById('wWind').textContent = `${w.wind} km/h`;
  document.getElementById('wUpdated').textContent =
    new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  document.getElementById('wIcon').textContent = w.rain > 2 ? "🌧️" : w.rain > 0 ? "🌦️" : "⛅";
}

function renderWeatherMock(){
  // Placeholder monsoon-typical values so the UI is demoable without a key yet
  renderWeather({ temp:28, cond:"Moderate rain", rain:4.2, humidity:86, wind:14 });
}

/* =========================================================
   REPORT COUNT + CHART
   ========================================================= */
function renderStats(){
  document.getElementById('reportTotal').textContent = reports.length;

  const counts = {};
  Object.keys(REPORT_TYPES).forEach(k => counts[k] = 0);
  reports.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });

  const labels = Object.keys(REPORT_TYPES).map(k => REPORT_TYPES[k].label);
  const data = Object.keys(REPORT_TYPES).map(k => counts[k]);
  const colors = Object.keys(REPORT_TYPES).map(k => REPORT_TYPES[k].color);

  if(reportChart){ reportChart.destroy(); }
  const ctx = document.getElementById('reportChart').getContext('2d');
  reportChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets:[{ data, backgroundColor:colors, borderWidth:0 }] },
    options: {
      cutout:'68%',
      plugins:{ legend:{ display:false } },
      maintainAspectRatio:false
    }
  });

  const legend = document.getElementById('statsLegend');
  legend.innerHTML = Object.keys(REPORT_TYPES).map(k =>
    `<div class="legend-item"><span class="legend-dot" style="background:${REPORT_TYPES[k].color}"></span>${REPORT_TYPES[k].label} (${counts[k]})</div>`
  ).join('');
}

function renderFeed(){
  const list = document.getElementById('feedList');
  if(reports.length === 0){
    list.innerHTML = `<div class="feed-empty">No reports yet — be the first to flag an issue.</div>`;
    return;
  }
  const recent = [...reports].sort((a,b) => b.timestamp - a.timestamp).slice(0, 12);
  list.innerHTML = recent.map(r => {
    const meta = REPORT_TYPES[r.type] || REPORT_TYPES.other;
    return `<div class="feed-item" style="border-left-color:${meta.color}">
      <div class="type" style="color:${meta.color}">${meta.label}</div>
      <div class="meta">${r.description.slice(0,60)}${r.description.length>60?'…':''} · ${timeAgo(r.timestamp)}</div>
    </div>`;
  }).join('');
}

function updateTicker(){
  const ticker = document.getElementById('ticker');
  if(reports.length === 0){
    ticker.textContent = "No citizen reports yet — tap Report incident to add the first one.";
    return;
  }
  const latest = [...reports].sort((a,b) => b.timestamp - a.timestamp).slice(0,5);
  ticker.textContent = latest.map(r => {
    const meta = REPORT_TYPES[r.type] || REPORT_TYPES.other;
    return `${meta.label.toUpperCase()}: ${r.description}`;
  }).join('   •   ');
}

function timeAgo(ts){
  const mins = Math.floor((Date.now() - ts) / 60000);
  if(mins < 1) return "just now";
  if(mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins/60);
  return `${hrs}h ago`;
}

/* =========================================================
   REPORT SUBMISSION
   ========================================================= */
function openReportModal(){
  document.getElementById('reportModalOverlay').classList.add('open');
  const status = document.getElementById('gpsStatus');
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos => {
      userLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      
      // Add or update user location marker
      if(userLocationMarker){
        userLocationMarker.setLatLng(userLatLng);
      } else {
        userLocationMarker = L.circleMarker(userLatLng, {
          radius: 8,
          color: "#2fa5d8",
          fillColor: "#2fa5d8",
          fillOpacity: 0.8,
          weight: 2,
          dashArray: "4, 2"
        }).bindPopup("📍 Your location").addTo(map);
      }
      
      status.textContent = "📍 Location: using your current GPS position";
    }, () => {
      userLatLng = { lat: CONFIG.MUMBAI_CENTER[0], lng: CONFIG.MUMBAI_CENTER[1] };
      status.textContent = "📍 Location: GPS unavailable — using map center. Tap the map to adjust.";
    });
  }
}

function closeReportModal(){
  document.getElementById('reportModalOverlay').classList.remove('open');
}

function selectSeverity(btn){
  document.querySelectorAll('.severity-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedSeverity = btn.dataset.severity;
}

document.getElementById('reportForm').addEventListener('submit', function(e){
  e.preventDefault();

  const type = document.getElementById('reportType').value;
  const description = document.getElementById('reportDesc').value.trim();
  if(!description) return;

  const loc = userLatLng || { lat: CONFIG.MUMBAI_CENTER[0], lng: CONFIG.MUMBAI_CENTER[1] };

  const report = {
    id: `r_${Date.now()}`,
    type,
    severity: selectedSeverity,
    description,
    lat: loc.lat,
    lng: loc.lng,
    timestamp: Date.now()
  };

  reports.push(report);
  saveReports();
  addMarkerForReport(report);
  renderStats();
  renderFeed();
  updateTicker();

  // TODO: also push to Firebase Firestore here for cross-device sync
  // TODO: optionally pass description through the Claude API to
  //       auto-classify type/severity from free-text citizen input

  this.reset();
  closeReportModal();
});

function saveReports(){
  localStorage.setItem("calamitiesWatch_reports", JSON.stringify(reports));
}

/* =========================================================
   INIT
   ========================================================= */
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  fetchWeather(CONFIG.MUMBAI_CENTER[0], CONFIG.MUMBAI_CENTER[1]);
  renderStats();
  renderFeed();
  updateTicker();
});
