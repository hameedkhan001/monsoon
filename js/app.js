const STORAGE_KEY = "cda-monsoon-cleaning-v1";

/** @type {Array<{id:string,name:string,lat:number,lng:number,status:'done'|'pending',updatedAt?:string,area?:string}>} */
let points = [];
let waterways = [];
let map;
let markerLayer;
let waterwayLayer;
let showWaterways = true;
let activeFilter = "all";
let activeCategory = "all";
let searchQuery = "";
let selectedId = null;

const layers = {};

function showToast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function makeId(name, lat, lng, index) {
  const slug = String(name || "point")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  return `${slug}-${lat}-${lng}-${index}`;
}

function normalizeStatus(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (["yes", "y", "done", "completed", "complete", "1", "true", "cleaned", "cleared", "finished"].includes(v)) {
    return "done";
  }
  return "pending";
}

function parseCoordinate(value) {
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function findColumn(row, candidates) {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase() === candidate.toLowerCase());
    if (found) return row[found];
  }
  for (const candidate of candidates) {
    const found = keys.find((k) => k.trim().toLowerCase().includes(candidate.toLowerCase()));
    if (found) return row[found];
  }
  return undefined;
}

function rowsToPoints(rows) {
  return rows
    .map((row, index) => {
      const name =
        findColumn(row, ["name", "kalwat", "location", "point", "site", "address"]) ??
        `Point ${index + 1}`;
      const lat = parseCoordinate(
        findColumn(row, ["lat", "latitude", "y", "northing"])
      );
      const lng = parseCoordinate(
        findColumn(row, ["lng", "lon", "long", "longitude", "x", "easting"])
      );
      const statusRaw = findColumn(row, ["status", "done", "cleaned", "completed", "yes/no", "yes"]);
      const area = findColumn(row, ["area", "zone", "sector", "ward"]);

      if (lat == null || lng == null) return null;

      return {
        id: makeId(name, lat, lng, index),
        name: String(name).trim(),
        lat,
        lng,
        status: normalizeStatus(statusRaw),
        updatedAt: statusRaw ? new Date().toISOString() : undefined,
        area: area ? String(area).trim() : undefined,
      };
    })
    .filter(Boolean);
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
}

function mergeWithStored(imported) {
  const stored = loadFromStorage() || [];
  const byId = new Map(stored.map((p) => [p.id, p]));

  return imported.map((p) => {
    const existing = byId.get(p.id);
    if (existing) {
      return {
        ...p,
        status: existing.status,
        updatedAt: existing.updatedAt,
      };
    }
    return p;
  });
}

function normalizePoints(raw) {
  return raw.map((p, index) => ({
    id: p.id || makeId(p.name, p.lat, p.lng, index),
    sr: p.sr,
    name: p.name,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    status: p.status === "done" ? "done" : "pending",
    progress: p.progress ?? 0,
    updatedAt: p.updatedAt,
    area: p.location || p.area,
    landmark: p.landmark,
    team: p.team,
    remarks: p.remarks,
    date: p.date,
  }));
}

async function loadFieldData() {
  const [pointsRes, waterwaysRes] = await Promise.all([
    fetch("data/points.json"),
    fetch("data/waterways.json"),
  ]);

  if (!pointsRes.ok) throw new Error("points.json not found");

  const data = await pointsRes.json();
  points = mergeWithStored(normalizePoints(data));
  saveToStorage();

  if (waterwaysRes.ok) {
    waterways = await waterwaysRes.json();
    renderWaterways();
  }

  selectedId = null;
  populateCategoryFilter();
  refreshUI();
  fitMapToData();
  showToast(`Loaded ${points.length} points, ${waterways.length} waterways`);
}

function fitMapToData() {
  const bounds = [];

  points.forEach((p) => bounds.push([p.lat, p.lng]));
  if (showWaterways) {
    waterways.forEach((w) => {
      w.coordinates.forEach((coord) => bounds.push(coord));
    });
  }

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
}

function renderWaterways() {
  if (!waterwayLayer) return;
  waterwayLayer.clearLayers();

  if (!showWaterways) return;

  waterways.forEach((waterway) => {
    const line = L.polyline(waterway.coordinates, {
      color: "#38bdf8",
      weight: 3,
      opacity: 0.85,
      waterwayId: waterway.id,
    });

    line.bindPopup(`
      <div class="popup-title">${escapeHtml(waterway.name)}</div>
      <div class="popup-meta">Nullah / waterway route</div>
      <div class="popup-meta">${waterway.coordinates.length} vertices</div>
    `);

    line.addTo(waterwayLayer);
  });
}

function setWaterwaysVisible(visible) {
  showWaterways = visible;
  if (showWaterways) {
    if (!map.hasLayer(waterwayLayer)) waterwayLayer.addTo(map);
    renderWaterways();
  } else if (map.hasLayer(waterwayLayer)) {
    map.removeLayer(waterwayLayer);
  }
}

function getMarkerShape(category) {
  if (category === "Bridge") return "bridge";
  if (category === "Culvert") return "culvert";
  return "point";
}

function culvertAngle(sr) {
  return ((sr || 0) * 47) % 160 - 80;
}

function createMarkerIcon(status, category, sr = 0) {
  const shape = getMarkerShape(category);
  let html;

  if (shape === "bridge") {
    html = `<div class="marker-wrap"><div class="clean-marker-bridge ${status}"></div></div>`;
  } else if (shape === "culvert") {
    const angle = culvertAngle(sr);
    html = `<div class="marker-wrap"><div class="clean-marker-culvert ${status}" style="transform:rotate(${angle}deg)"></div></div>`;
  } else {
    html = `<div class="marker-wrap"><div class="clean-marker ${status}"></div></div>`;
  }

  return L.divIcon({
    className: "",
    html,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10],
  });
}

function popupHtml(point) {
  const isDone = point.status === "done";
  const updated = point.updatedAt
    ? new Date(point.updatedAt).toLocaleString()
    : "Not yet updated";

  return `
    <div class="popup-title">${escapeHtml(point.name)}</div>
    ${point.category ? `<div class="popup-meta">Category: ${escapeHtml(point.category)}</div>` : ""}
    ${point.area ? `<div class="popup-meta">Area: ${escapeHtml(point.area)}</div>` : ""}
    ${point.landmark ? `<div class="popup-meta">Landmark: ${escapeHtml(point.landmark)}</div>` : ""}
    <div class="popup-meta">Lat: ${point.lat.toFixed(5)}, Lng: ${point.lng.toFixed(5)}</div>
    <div class="popup-status ${point.status}">${isDone ? "Done" : "Pending"}</div>
    <div class="popup-meta">Updated: ${updated}</div>
    <button class="popup-toggle ${isDone ? "mark-pending" : "mark-done"}" data-id="${point.id}">
      ${isDone ? "Mark as Not Done" : "Mark as Done (Yes)"}
    </button>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toggleStatus(id) {
  const point = points.find((p) => p.id === id);
  if (!point) return;

  point.status = point.status === "done" ? "pending" : "done";
  point.updatedAt = new Date().toISOString();
  saveToStorage();
  refreshUI();
  showToast(`${point.name} marked as ${point.status === "done" ? "done" : "pending"}`);
}

function getFilteredPoints() {
  return points.filter((p) => {
    if (activeFilter === "done" && p.status !== "done") return false;
    if (activeFilter === "pending" && p.status !== "pending") return false;
    if (activeCategory !== "all" && p.category !== activeCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const hay = `${p.name} ${p.area || ""} ${p.category || ""} ${p.sr || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function populateCategoryFilter() {
  const select = document.getElementById("category-filter");
  if (!select) return;

  const categories = [...new Set(points.map((p) => p.category).filter(Boolean))].sort();
  select.innerHTML =
    '<option value="all">All categories</option>' +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value = activeCategory;
}

function updateStats() {
  const total = points.length;
  const done = points.filter((p) => p.status === "done").length;
  const pending = total - done;
  const percent = total ? Math.round((done / total) * 100) : 0;

  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-done").textContent = done;
  document.getElementById("stat-pending").textContent = pending;
  document.getElementById("stat-percent").textContent = `${percent}%`;
}

function renderList() {
  const list = document.getElementById("point-list");
  const filtered = getFilteredPoints();
  document.getElementById("list-count").textContent = filtered.length;

  list.innerHTML = filtered
    .map(
      (p) => `
      <li class="point-item ${p.id === selectedId ? "active" : ""}" data-id="${p.id}">
        <span class="point-status-marker ${p.status} shape-${getMarkerShape(p.category)}"${
          getMarkerShape(p.category) === "culvert"
            ? ` style="transform:rotate(${culvertAngle(p.sr)}deg)"`
            : ""
        }></span>
        <span class="point-item-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
      </li>
    `
    )
    .join("");

  list.querySelectorAll(".point-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      selectedId = id;
      const point = points.find((p) => p.id === id);
      if (point) {
        map.setView([point.lat, point.lng], Math.max(map.getZoom(), 16));
        const marker = markerLayer.getLayers().find((m) => m.options.pointId === id);
        if (marker) marker.openPopup();
      }
      renderList();
    });
  });
}

function renderMarkers() {
  markerLayer.clearLayers();
  const filtered = getFilteredPoints();
  const bounds = [];

  filtered.forEach((point) => {
    const marker = L.marker([point.lat, point.lng], {
      icon: createMarkerIcon(point.status, point.category, point.sr),
      pointId: point.id,
    });

    marker.bindPopup(popupHtml(point));
    marker.on("popupopen", () => {
      selectedId = point.id;
      renderList();
      const btn = document.querySelector(".popup-toggle[data-id]");
      if (btn) {
        btn.addEventListener("click", () => toggleStatus(btn.dataset.id));
      }
    });

    marker.addTo(markerLayer);
    bounds.push([point.lat, point.lng]);
  });

  if (bounds.length && !selectedId) {
    fitMapToData();
  }
}

function refreshUI() {
  updateStats();
  renderList();
  renderMarkers();
}

function initMap() {
  map = L.map("map", {
    center: [33.6844, 73.0479],
    zoom: 12,
    zoomControl: true,
  });

  layers.osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  });

  layers.satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri",
      maxZoom: 19,
    }
  );

  layers.hybridLabels = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Labels &copy; Esri",
      maxZoom: 19,
      pane: "overlayPane",
    }
  );

  layers.osm.addTo(map);

  layers.hybrid = L.layerGroup([layers.satellite, layers.hybridLabels]);

  markerLayer = L.layerGroup().addTo(map);
  waterwayLayer = L.layerGroup().addTo(map);
}

function setBaseLayer(name) {
  [layers.osm, layers.satellite, layers.hybrid].forEach((layer) => {
    if (map.hasLayer(layer)) map.removeLayer(layer);
  });

  if (name === "osm") layers.osm.addTo(map);
  else if (name === "satellite") layers.satellite.addTo(map);
  else if (name === "hybrid") layers.hybrid.addTo(map);

  document.querySelectorAll(".layer-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.layer === name);
  });
}

function handleExcelFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const imported = rowsToPoints(rows);

      if (!imported.length) {
        showToast("No valid points found. Check lat/lng columns.");
        return;
      }

      points = mergeWithStored(imported);
      selectedId = null;
      saveToStorage();
      refreshUI();
      map.fitBounds(
        imported.map((p) => [p.lat, p.lng]),
        { padding: [40, 40], maxZoom: 15 }
      );
      showToast(`Imported ${imported.length} points from Excel`);
    } catch (err) {
      console.error(err);
      showToast("Failed to read Excel file");
    }
  };
  reader.readAsArrayBuffer(file);
}

function exportStatus() {
  if (!points.length) {
    showToast("No data to export");
    return;
  }

  const rows = points.map((p) => ({
    "Sr.#": p.sr || "",
    Category: p.category || "",
    "Location / Area": p.area || "",
    Landmark: p.landmark || "",
    Status: p.status === "done" ? "Done" : "Pending",
    "Progress %": p.status === "done" ? 100 : p.progress || 0,
    Date: p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : p.date || "",
    "Team / Supervisor": p.team || "",
    Remarks: p.remarks || "",
    Latitude: p.lat,
    Longitude: p.lng,
  }));

  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Cleaning Status");
  XLSX.writeFile(book, `monsoon-cleaning-status-${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast("Status exported to Excel");
}

function bindEvents() {
  document.getElementById("excel-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleExcelFile(file);
    e.target.value = "";
  });

  document.getElementById("btn-export").addEventListener("click", exportStatus);
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (confirm("Reload field data from data/points.json? Your status updates are kept for matching points.")) {
      loadFieldData();
    }
  });

  document.querySelectorAll(".layer-btn").forEach((btn) => {
    btn.addEventListener("click", () => setBaseLayer(btn.dataset.layer));
  });

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      refreshUI();
    });
  });

  document.getElementById("search-input").addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderList();
    renderMarkers();
  });

  document.getElementById("category-filter").addEventListener("change", (e) => {
    activeCategory = e.target.value;
    refreshUI();
  });

  document.getElementById("waterways-toggle").addEventListener("change", (e) => {
    setWaterwaysVisible(e.target.checked);
  });
}

async function init() {
  initMap();
  bindEvents();

  try {
    await loadFieldData();
  } catch (err) {
    console.error(err);
    showToast("Could not load data/points.json — run scripts/build-data.py");
  }
}

init();
