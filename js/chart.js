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
let pinchLastDist = 0;

const ZOOM_IN = 1.2;
const ZOOM_OUT = 0.4;
const WHEEL_IN = 1.08;
const WHEEL_OUT = 0.65;
const PINCH_OUT_EXP = 1.8;
const MAX_RANGE_MULT = 6;

let originalRanges = { x: null, y: null };

/** Une tuile = une courbe (style Search Console). */
const SERIES_DEFS = [
  { id: "classic_ca", group: "Classique", label: "CA classique", color: "#1565C0", kind: "money", defaultOn: true },
  { id: "classic_profit", group: "Classique", label: "Profit classique", color: "#6A1B9A", kind: "money", defaultOn: true },
  { id: "classic_cash", group: "Classique", label: "Cash classique", color: "#00695C", kind: "money", defaultOn: false },
  { id: "classic_count", group: "Classique", label: "Nb ventes classique", color: "#2E7D32", kind: "count", defaultOn: false },

  { id: "batch_ca", group: "Batch", label: "Encaissé batch", color: "#E65100", kind: "money", defaultOn: true },
  { id: "batch_profit", group: "Batch", label: "Bénéfice batch", color: "#F9A825", kind: "money", defaultOn: true },
  { id: "batch_cash", group: "Batch", label: "Cash batch", color: "#C2185B", kind: "money", defaultOn: false },
  { id: "batch_qty", group: "Batch", label: "Qté vendue batch", color: "#BF360C", kind: "count", defaultOn: false },

  { id: "total_ca", group: "Total", label: "CA Total", color: "#0D47A1", kind: "money", defaultOn: true },
  { id: "total_profit", group: "Total", label: "Profit Total", color: "#4A148C", kind: "money", defaultOn: true },
  { id: "total_cash", group: "Total", label: "Cash Total", color: "#00838F", kind: "money", defaultOn: false },
  { id: "total_count", group: "Total", label: "Nb opérations Total", color: "#4E342E", kind: "count", defaultOn: false },

  { id: "prev_ca", group: "Comparaison", label: "CA période préc.", color: "#78909C", kind: "money", defaultOn: false, dashed: true }
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

function storeOriginalRanges(chart) {
  if (!chart?.scales) return;
  const x = chart.scales.x;
  const y = chart.scales.y;
  originalRanges = {
    x:
      x && Number.isFinite(x.min) && Number.isFinite(x.max)
        ? { min: x.min, max: x.max }
        : null,
    y:
      y && Number.isFinite(y.min) && Number.isFinite(y.max)
        ? { min: y.min, max: y.max }
        : null
  };
}

function setPanEnabled(enabled) {
  const pan = statsChart?.options?.plugins?.zoom?.pan;
  if (!pan) return;
  pan.enabled = enabled;
}

function scaleOrigRange(scaleId, fallbackRange) {
  const orig = originalRanges[scaleId];
  if (orig && Number.isFinite(orig.max - orig.min) && orig.max !== orig.min) {
    return orig.max - orig.min;
  }
  return fallbackRange;
}

function applyScaleFactor(scaleId, factor) {
  if (!statsChart || !(factor > 0) || factor === 1) return;
  const scale = statsChart.scales[scaleId];
  const opts = statsChart.options?.scales?.[scaleId];
  if (!scale || !opts) return;

  const range = scale.max - scale.min;
  if (!Number.isFinite(range) || range <= 0) return;

  const origRange = scaleOrigRange(scaleId, range);
  const maxRange = origRange * MAX_RANGE_MULT;
  let nextRange = range / factor;

  if (factor < 1) {
    if (range >= maxRange * 0.999) return;
    if (nextRange > maxRange) nextRange = maxRange;
  } else if (!(nextRange > 0) || !Number.isFinite(nextRange)) {
    return;
  }

  const center = (scale.min + scale.max) / 2;
  const nextMin = center - nextRange / 2;
  const nextMax = center + nextRange / 2;

  if (scaleId === "y") opts.beginAtZero = false;
  opts.min = nextMin;
  opts.max = nextMax;
}

function zoomByAll(factor) {
  if (!statsChart) return;
  applyScaleFactor("x", factor);
  applyScaleFactor("y", factor);
  statsChart.update("none");
}

function zoomOutAll(factor) {
  zoomByAll(factor);
}

function restoreInitialZoom() {
  if (!statsChart) return;
  const xOpts = statsChart.options?.scales?.x;
  const yOpts = statsChart.options?.scales?.y;
  if (xOpts) {
    delete xOpts.min;
    delete xOpts.max;
  }
  if (yOpts) {
    yOpts.beginAtZero = true;
    delete yOpts.min;
    delete yOpts.max;
  }
  if (typeof statsChart.resetZoom === "function") {
    statsChart.resetZoom();
    return;
  }
  statsChart.update();
}

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function onChartWheel(event) {
  if (!statsChart) return;
  event.preventDefault();
  if (event.deltaY > 0) {
    zoomOutAll(WHEEL_OUT);
    return;
  }
  zoomByAll(WHEEL_IN);
}

function onPinchStart(event) {
  if (event.touches.length === 2) {
    pinchLastDist = touchDistance(event.touches);
    setPanEnabled(false);
    event.preventDefault();
  }
}

function onPinchMove(event) {
  if (!statsChart || event.touches.length !== 2) return;
  event.preventDefault();
  const dist = touchDistance(event.touches);
  if (!(pinchLastDist > 0) || !(dist > 0)) {
    pinchLastDist = dist;
    return;
  }
  const factor = dist / pinchLastDist;
  pinchLastDist = dist;
  if (factor < 1) {
    zoomOutAll(Math.pow(factor, PINCH_OUT_EXP));
    return;
  }
  if (factor > 1) {
    zoomByAll(factor);
  }
}

function onPinchEnd(event) {
  if (event.touches.length < 2) {
    pinchLastDist = 0;
    setPanEnabled(true);
  }
}

function bindChartGestures() {
  const host =
    document.getElementById("chartContainer") ||
    document.getElementById("statsChart");
  if (!host || host.dataset.zoomGesturesBound === "1") return;
  host.dataset.zoomGesturesBound = "1";
  host.addEventListener("wheel", onChartWheel, { passive: false });
  host.addEventListener("touchstart", onPinchStart, { passive: false });
  host.addEventListener("touchmove", onPinchMove, { passive: false });
  host.addEventListener("touchend", onPinchEnd, { passive: false });
  host.addEventListener("touchcancel", onPinchEnd, { passive: false });
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

  bindChartGestures();

  const resetBtn = document.getElementById("chartResetZoomBtn");
  if (resetBtn && resetBtn.dataset.zoomBound !== "1") {
    resetBtn.dataset.zoomBound = "1";
    resetBtn.addEventListener("click", () => {
      restoreInitialZoom();
    });
  }

  const zoomOutBtn = document.getElementById("chartZoomOutBtn");
  if (zoomOutBtn && zoomOutBtn.dataset.zoomBound !== "1") {
    zoomOutBtn.dataset.zoomBound = "1";
    zoomOutBtn.addEventListener("click", () => {
      zoomOutAll(ZOOM_OUT);
    });
  }

  const zoomInBtn = document.getElementById("chartZoomInBtn");
  if (zoomInBtn && zoomInBtn.dataset.zoomBound !== "1") {
    zoomInBtn.dataset.zoomBound = "1";
    zoomInBtn.addEventListener("click", () => {
      zoomByAll(ZOOM_IN);
    });
  }
}

export function renderChart() {
  if (isRendering) return;
  isRendering = true;

  try {
    bindMetricGrid();

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
            pan: {
              enabled: true,
              mode: "xy",
              modifierKey: null
            },
            zoom: {
              wheel: { enabled: false },
              pinch: { enabled: false },
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
    storeOriginalRanges(statsChart);
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
