import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  Filler
} from "https://cdn.jsdelivr.net/npm/chart.js/+esm";
import zoomPlugin from "https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.2.0/+esm";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
  zoomPlugin
);

let statsChart = null;
let isRendering = false;
let gridBound = false;
let zoomControlsBound = false;

/** Une tuile = une courbe (style Search Console). */
const SERIES_DEFS = [
  { id: "classic_ca", group: "Classique", label: "CA classique", color: "#4285F4", kind: "money", defaultOn: true },
  { id: "classic_profit", group: "Classique", label: "Profit classique", color: "#A142F4", kind: "money", defaultOn: true },
  { id: "classic_cash", group: "Classique", label: "Cash classique", color: "#0D9488", kind: "money", defaultOn: false },
  { id: "classic_count", group: "Classique", label: "Nb ventes classique", color: "#34A853", kind: "count", defaultOn: false },

  { id: "batch_ca", group: "Batch", label: "Encaissé batch", color: "#E37400", kind: "money", defaultOn: true },
  { id: "batch_profit", group: "Batch", label: "Bénéfice batch", color: "#F4B400", kind: "money", defaultOn: true },
  { id: "batch_cash", group: "Batch", label: "Cash batch", color: "#F9AB00", kind: "money", defaultOn: false },
  { id: "batch_qty", group: "Batch", label: "Qté vendue batch", color: "#FA7B17", kind: "count", defaultOn: false },

  { id: "total_ca", group: "Total", label: "CA Total", color: "#1A73E8", kind: "money", defaultOn: true },
  { id: "total_profit", group: "Total", label: "Profit Total", color: "#7B1FA2", kind: "money", defaultOn: true },
  { id: "total_cash", group: "Total", label: "Cash Total", color: "#5E35B1", kind: "money", defaultOn: false },
  { id: "total_count", group: "Total", label: "Nb opérations Total", color: "#00897B", kind: "count", defaultOn: false },

  { id: "prev_ca", group: "Comparaison", label: "CA période préc.", color: "#9AA0A6", kind: "money", defaultOn: false, dashed: true }
];

const seriesEnabled = {};
SERIES_DEFS.forEach(s => {
  seriesEnabled[s.id] = s.defaultOn;
});

function getDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKey(date) {
  const d = getDate(date);
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabel(key) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

function buildDayRange(start, end) {
  const keys = [];
  if (!start || !end) return keys;
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  while (cur <= last) {
    keys.push(dayKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return keys;
}

function inferRangeFromSales(sales = []) {
  const dates = sales.map(s => getDate(s.createdAt)).filter(Boolean);
  if (!dates.length) {
    const end = new Date();
    const start = new Date(end.getTime() - 6 * 86400000);
    return { start, end };
  }
  const start = new Date(Math.min(...dates.map(d => d.getTime())));
  const end = new Date(Math.max(...dates.map(d => d.getTime())));
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function seriesFromMap(keys, map) {
  return keys.map(k => Number(map[k] || 0));
}

function mergeMaps(a, b) {
  const out = { ...a };
  Object.keys(b).forEach(k => {
    out[k] = (out[k] || 0) + (b[k] || 0);
  });
  return out;
}

function currencySymbol() {
  return window.statsData?.currency || "$";
}

function formatTileValue(kind, value) {
  const v = Number(value) || 0;
  if (kind === "count") {
    return String(Math.round(v));
  }
  return `${currencySymbol()}${Math.round(v).toLocaleString("fr-FR")}`;
}

function aggregateClassicByDay(sales = []) {
  const ca = {};
  const profit = {};
  const cash = {};
  const count = {};
  sales.forEach(sale => {
    if ((sale.status || "active") === "cancelled") return;
    const key = dayKey(sale.createdAt);
    if (!key) return;
    ca[key] = (ca[key] || 0) + Number(sale.total_amount || 0);
    profit[key] = (profit[key] || 0) + Number(sale.total_profit || 0);
    cash[key] = (cash[key] || 0) + Number(sale.amount_paid || 0);
    count[key] = (count[key] || 0) + 1;
  });
  return { ca, profit, cash, count };
}

function aggregateBatchByDay(movements = []) {
  const ca = {};
  const profit = {};
  const cash = {};
  const qty = {};
  const count = {};
  movements.forEach(m => {
    const key = dayKey(m.createdAt);
    if (!key) return;
    const collected = Number(m.amount_collected || 0);
    const p = Math.max(0, Number(m.profit_real || 0));
    ca[key] = (ca[key] || 0) + collected;
    profit[key] = (profit[key] || 0) + p;
    cash[key] = (cash[key] || 0) + collected;
    qty[key] = (qty[key] || 0) + Number(m.quantity_out || 0);
    count[key] = (count[key] || 0) + 1;
  });
  return { ca, profit, cash, qty, count };
}

function destroyChart() {
  if (statsChart) {
    statsChart.destroy();
    statsChart = null;
  }
}

function buildSeriesMaps(dataPack) {
  const {
    classic,
    batch,
    total,
    prevCaAligned,
    keys
  } = dataPack;

  return {
    classic_ca: seriesFromMap(keys, classic.ca),
    classic_profit: seriesFromMap(keys, classic.profit),
    classic_cash: seriesFromMap(keys, classic.cash),
    classic_count: seriesFromMap(keys, classic.count),
    batch_ca: seriesFromMap(keys, batch.ca),
    batch_profit: seriesFromMap(keys, batch.profit),
    batch_cash: seriesFromMap(keys, batch.cash),
    batch_qty: seriesFromMap(keys, batch.qty),
    total_ca: seriesFromMap(keys, total.ca),
    total_profit: seriesFromMap(keys, total.profit),
    total_cash: seriesFromMap(keys, total.cash),
    total_count: seriesFromMap(keys, total.count),
    prev_ca: keys.map((_, i) => prevCaAligned[i] ?? 0)
  };
}

function buildTotals(maps) {
  const totals = {};
  Object.keys(maps).forEach(id => {
    totals[id] = (maps[id] || []).reduce((s, v) => s + (Number(v) || 0), 0);
  });
  return totals;
}

function zeroTotals() {
  const totals = {};
  SERIES_DEFS.forEach(def => {
    totals[def.id] = 0;
  });
  return totals;
}

function renderMetricTiles(totals = zeroTotals()) {
  const grid = document.getElementById("chartMetricGrid");
  if (!grid) return;

  grid.replaceChildren();
  const frag = document.createDocumentFragment();

  SERIES_DEFS.forEach(def => {
    const on = !!seriesEnabled[def.id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = on ? "chart-metric-tile" : "chart-metric-tile is-off";
    btn.id = `chartTile_${def.id}`;
    btn.dataset.seriesId = def.id;
    btn.title = `${def.group} · ${def.label}`;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) {
      btn.style.borderColor = def.color;
      btn.style.background = `${def.color}18`;
      btn.style.color = "#111";
    }

    const dot = document.createElement("span");
    dot.className = "chart-metric-dot";
    dot.style.background = def.color;

    const checkRow = document.createElement("div");
    checkRow.className = "chart-metric-check";

    const label = document.createElement("span");
    label.textContent = def.label;

    checkRow.append(label);

    const valueEl = document.createElement("div");
    valueEl.className = "chart-metric-value";
    valueEl.textContent = formatTileValue(def.kind, totals[def.id] || 0);

    btn.append(dot, checkRow, valueEl);
    frag.appendChild(btn);
  });

  grid.appendChild(frag);
}

function bindMetricGrid() {
  if (gridBound) return;
  const grid = document.getElementById("chartMetricGrid");
  if (!grid) return;
  gridBound = true;

  grid.addEventListener("click", event => {
    const tile = event.target.closest(".chart-metric-tile");
    if (!tile) return;
    const id = tile.dataset.seriesId;
    if (!id || !(id in seriesEnabled)) return;
    seriesEnabled[id] = !seriesEnabled[id];
    renderChart();
  });

  const resetBtn = document.getElementById("chartResetZoomBtn");
  if (resetBtn && resetBtn.dataset.zoomBound !== "1") {
    resetBtn.dataset.zoomBound = "1";
    resetBtn.addEventListener("click", () => {
      if (statsChart?.resetZoom) {
        statsChart.resetZoom();
      }
    });
  }

  const zoomOutBtn = document.getElementById("chartZoomOutBtn");
  if (zoomOutBtn && zoomOutBtn.dataset.zoomBound !== "1") {
    zoomOutBtn.dataset.zoomBound = "1";
    zoomOutBtn.addEventListener("click", () => {
      if (!statsChart) return;
      statsChart.zoom(0.8);
    });
  }

  const zoomInBtn = document.getElementById("chartZoomInBtn");
  if (zoomInBtn && zoomInBtn.dataset.zoomBound !== "1") {
    zoomInBtn.dataset.zoomBound = "1";
    zoomInBtn.addEventListener("click", () => {
      if (!statsChart) return;
      statsChart.zoom(1.2);
    });
  }
}

function ensureZoomControls() {
  if (zoomControlsBound) return;
  zoomControlsBound = true;

  const canvas = document.getElementById("statsChart");
  if (!canvas) return;

  const host = canvas.parentElement;
  if (!host) return;

  const existing = host.querySelector(".chart-zoom-controls");
  if (existing) return;

  const controls = document.createElement("div");
  controls.className = "chart-zoom-controls";
  controls.style.display = "flex";
  controls.style.alignItems = "center";
  controls.style.justifyContent = "flex-end";
  controls.style.gap = "8px";
  controls.style.margin = "0 0 10px";

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.id = "chartZoomOutBtn";
  zoomOut.textContent = "Dézoomer";
  zoomOut.className = "chart-zoom-btn";
  zoomOut.style.padding = "6px 12px";
  zoomOut.style.borderRadius = "999px";
  zoomOut.style.border = "1px solid rgba(0,0,0,0.12)";
  zoomOut.style.background = "#f7f7f7";
  zoomOut.style.cursor = "pointer";
  zoomOut.addEventListener("click", () => {
    if (!statsChart) return;
    statsChart.zoom(0.8);
  });

  const reset = document.createElement("button");
  reset.type = "button";
  reset.id = "chartResetZoomBtn";
  reset.textContent = "Réinit. zoom";
  reset.className = "chart-zoom-btn";
  reset.style.padding = "6px 12px";
  reset.style.borderRadius = "999px";
  reset.style.border = "1px solid rgba(0,0,0,0.12)";
  reset.style.background = "#f7f7f7";
  reset.style.cursor = "pointer";
  reset.addEventListener("click", () => {
    if (statsChart?.resetZoom) {
      statsChart.resetZoom();
    }
  });

  controls.append(zoomOut, reset);
  host.insertBefore(controls, canvas);
}

export function renderChart() {
  if (isRendering) return;
  isRendering = true;

  try {
    bindMetricGrid();
    ensureZoomControls();

    const canvas = document.getElementById("statsChart");
    if (!canvas) {
      renderMetricTiles(zeroTotals());
      return;
    }

    const data = window.statsData || {
      sales: [],
      batchMovements: [],
      previousPeriod: { sales: [] },
      currency: "$"
    };

    const sales = data.sales || [];
    const allBatchMovements = data.batchMovements || [];
    const previous = data.previousPeriod || {};
    const prevSales = previous.sales || [];

    const { start, end } = inferRangeFromSales(sales);
    const keys = buildDayRange(start, end);

    const batchMovements = allBatchMovements.filter(m => {
      const d = getDate(m.createdAt);
      if (!d) return false;
      return d >= start && d <= end;
    });

    const classic = aggregateClassicByDay(sales);
    const batch = aggregateBatchByDay(batchMovements);
    const total = {
      ca: mergeMaps(classic.ca, batch.ca),
      profit: mergeMaps(classic.profit, batch.profit),
      cash: mergeMaps(classic.cash, batch.cash),
      count: mergeMaps(classic.count, batch.count)
    };

    const prevLen = keys.length || 7;
    const prevStart = new Date(start.getTime() - prevLen * 86400000);
    const prevEnd = new Date(start.getTime() - 86400000);
    const prevKeys = buildDayRange(prevStart, prevEnd);
    const prevClassic = aggregateClassicByDay(prevSales);
    const prevCaAligned = seriesFromMap(prevKeys, prevClassic.ca);

    const maps = buildSeriesMaps({
      classic,
      batch,
      total,
      prevCaAligned,
      keys
    });
    const totals = buildTotals(maps);
    renderMetricTiles(totals);

    const datasets = [];
    SERIES_DEFS.forEach(def => {
      if (!seriesEnabled[def.id]) return;
      datasets.push({
        label: def.label,
        data: maps[def.id] || keys.map(() => 0),
        borderColor: def.color,
        backgroundColor: def.color,
        borderWidth: 2.5,
        borderDash: def.dashed ? [6, 4] : [],
        tension: 0.3,
        fill: false,
        pointRadius: 2,
        pointHoverRadius: 4
      });
    });

    if (!datasets.length) {
      datasets.push({
        label: "Aucune série sélectionnée",
        data: keys.map(() => 0),
        borderColor: "#666",
        backgroundColor: "#666",
        borderWidth: 1,
        tension: 0.2,
        fill: false,
        pointRadius: 0
      });
    }

    destroyChart();

    statsChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: keys.map(formatDayLabel),
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            titleFont: { size: 11 },
            bodyFont: { size: 11 }
          },
          zoom: {
            limits: {
              x: { min: "original", max: "original" },
              y: { min: "original", max: "original" }
            },
            pan: {
              enabled: true,
              mode: "xy",
              modifierKey: null
            },
            zoom: {
              wheel: { enabled: true, speed: 0.08 },
              pinch: { enabled: true },
              mode: "xy",
              drag: {
                enabled: false
              }
            }
          }
        },
        scales: {
          x: {
            display: true,
            border: { display: true, color: "rgba(0,0,0,0.12)" },
            grid: {
              display: true,
              drawOnChartArea: true,
              color: "rgba(0,0,0,0.08)",
              lineWidth: 1
            },
            ticks: { color: "#667085", maxRotation: 0, font: { size: 10 } }
          },
          y: {
            beginAtZero: true,
            border: { display: true, color: "rgba(0,0,0,0.12)" },
            ticks: { color: "#667085", font: { size: 10 } },
            grid: {
              display: true,
              drawOnChartArea: true,
              color: "rgba(0,0,0,0.1)",
              lineWidth: 1
            }
          }
        }
      }
    });
  } finally {
    isRendering = false;
  }
}

function waitStatsData() {
  const timer = setInterval(() => {
    if (window.statsData) {
      clearInterval(timer);
      renderChart();
    }
  }, 200);
}

export function initChart() {
  bindMetricGrid();
  renderMetricTiles(zeroTotals());
  window.addEventListener("stats-updated", renderChart);
  if (window.statsData) {
    renderChart();
  } else {
    waitStatsData();
  }
}

window.renderStatsChart = renderChart;
