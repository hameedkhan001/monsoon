const STORAGE_KEY = "cda-monsoon-cleaning-v1";

function getConfig() {
  return window.MONSOON_CONFIG || {};
}

function isLiveSyncEnabled() {
  return Boolean(getConfig().sheetsApiUrl);
}

let syncTimer = null;
let syncInFlight = false;

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
let mapViewInitialized = false;

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

function mergeStatusUpdates(statusRows) {
  if (!statusRows.length) return false;

  const byId = new Map(statusRows.map((row) => [row.id, row]));
  let changed = false;

  points = points.map((point) => {
    const remote = byId.get(point.id);
    if (!remote) return point;

    const nextStatus = remote.status === "done" ? "done" : "pending";
    if (point.status !== nextStatus || point.updatedAt !== remote.updatedAt) {
      changed = true;
      return {
        ...point,
        status: nextStatus,
        updatedAt: remote.updatedAt || point.updatedAt,
        progress: nextStatus === "done" ? 100 : point.progress,
      };
    }
    return point;
  });

  return changed;
}

async function fetchRemoteStatus() {
  const { sheetsApiUrl } = getConfig();
  const res = await fetch(`${sheetsApiUrl}?t=${Date.now()}`);
  if (!res.ok) throw new Error("Failed to fetch status");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function pushStatusUpdate(point) {
  const { sheetsApiUrl, sheetsSecret } = getConfig();
  const res = await fetch(sheetsApiUrl, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      secret: sheetsSecret,
      action: "updateStatus",
      id: point.id,
      status: point.status,
      updatedAt: point.updatedAt,
    }),
  });

  const result = await res.json();
  if (!result.ok) throw new Error(result.error || "Sync failed");
}

async function syncFromSheet() {
  if (!isLiveSyncEnabled() || syncInFlight) return;
  syncInFlight = true;
  setSyncBadge("syncing");

  try {
    const remote = await fetchRemoteStatus();
    const changed = mergeStatusUpdates(remote);
    if (changed) {
      saveToStorage();
      refreshUI();
    }
    setSyncBadge("live");
  } catch (err) {
    console.error(err);
    setSyncBadge("error");
  } finally {
    syncInFlight = false;
  }
}

function startLiveSync() {
  if (!isLiveSyncEnabled()) {
    setSyncBadge("local");
    return;
  }

  syncFromSheet();
  clearInterval(syncTimer);
  syncTimer = setInterval(syncFromSheet, getConfig().syncIntervalMs || 5000);
}

function setSyncBadge(state) {
  const el = document.getElementById("sync-badge");
  if (!el) return;

  const labels = {
    live: "Live",
    syncing: "…",
    error: "Error",
    local: "Local",
    saving: "Saving",
  };

  el.textContent = labels[state] || labels.local;
  el.className = `sync-badge sync-${state}`;
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
  points = normalizePoints(data);

  if (isLiveSyncEnabled()) {
    try {
      const remote = await fetchRemoteStatus();
      mergeStatusUpdates(remote);
    } catch (err) {
      console.warn("Could not load remote status, using local file defaults", err);
    }
  } else {
    points = mergeWithStored(points);
  }

  saveToStorage();

  if (waterwaysRes.ok) {
    waterways = await waterwaysRes.json();
    renderWaterways();
  }

  selectedId = null;
  populateCategoryFilter();
  refreshUI();
  fitMapToData();
  startLiveSync();
  showToast(
    isLiveSyncEnabled()
      ? `Loaded ${points.length} points — live sync on`
      : `Loaded ${points.length} points, ${waterways.length} waterways`
  );
}

function fitMapToData() {
  if (mapViewInitialized) return;

  const bounds = [];
  points.forEach((p) => bounds.push([p.lat, p.lng]));
  if (showWaterways) {
    waterways.forEach((w) => {
      w.coordinates.forEach((coord) => bounds.push(coord));
    });
  }

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    mapViewInitialized = true;
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

async function toggleStatus(id) {
  const point = points.find((p) => p.id === id);
  if (!point) return;

  const previousStatus = point.status;
  const previousUpdatedAt = point.updatedAt;

  point.status = point.status === "done" ? "pending" : "done";
  point.updatedAt = new Date().toISOString();
  point.progress = point.status === "done" ? 100 : point.progress;

  saveToStorage();
  refreshUI();

  if (isLiveSyncEnabled()) {
    setSyncBadge("saving");
    try {
      await pushStatusUpdate(point);
      setSyncBadge("live");
      showToast(`${point.name} saved — team will see update`);
    } catch (err) {
      point.status = previousStatus;
      point.updatedAt = previousUpdatedAt;
      saveToStorage();
      refreshUI();
      setSyncBadge("error");
      showToast("Could not save to shared sheet — try again");
      console.error(err);
    }
    return;
  }

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
        if (isMobile()) closeSidebar();
      }
      renderList();
    });
  });
}

function renderMarkers() {
  markerLayer.clearLayers();
  const filtered = getFilteredPoints();

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
  });
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

  map.on("zoomstart movestart", () => {
    mapViewInitialized = true;
  });
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

function bindEvents() {
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

  document.getElementById("btn-panel-toggle")?.addEventListener("click", toggleSidebar);
  document.getElementById("sidebar-backdrop")?.addEventListener("click", closeSidebar);
  document.getElementById("sidebar-handle")?.addEventListener("click", closeSidebar);

  window.addEventListener("resize", () => {
    if (map) map.invalidateSize();
  });
}

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function openSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sidebar) return;
  sidebar.classList.add("open");
  if (backdrop) {
    backdrop.hidden = false;
    backdrop.classList.add("visible");
  }
  setTimeout(() => map?.invalidateSize(), 320);
}

function closeSidebar() {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sidebar) return;
  sidebar.classList.remove("open");
  if (backdrop) {
    backdrop.classList.remove("visible");
    backdrop.hidden = true;
  }
  setTimeout(() => map?.invalidateSize(), 320);
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  if (sidebar.classList.contains("open")) closeSidebar();
  else openSidebar();
}

async function init() {
  initMap();
  bindEvents();

  try {
    await loadFieldData();
    setTimeout(() => map?.invalidateSize(), 100);
  } catch (err) {
    console.error(err);
    showToast("Could not load data/points.json — run scripts/build-data.py");
  }
}

init();
