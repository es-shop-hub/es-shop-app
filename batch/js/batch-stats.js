import { getAuth, onAuthStateChanged } from "../../js/auth.js";
import {
  loadBatchProducts,
  loadBatches,
  loadBatchMovements,
  aggregateBatchStats
} from "./batch-service.js";
import {
  showToast,
  setStatus,
  formatMoney,
  formatDate,
  formatBatchReason,
  statusBadge
} from "./batch-utils.js";
import { bindActionButton } from "../../js/utils/buttonManager.js";
import { getAppConfig } from "../../js/appConfig.js";

const auth = getAuth();
const MOVEMENTS_PAGE_SIZE = 20;

let products = [];
let productsMap = {};
let shopMeta = null;
let lastStats = null;
let lastPeriodLabel = "30 derniers jours";
let pdfReady = false;
let periodMovementsCached = [];
let movementsPage = 1;

const PERIOD_LABELS = {
  today: "Aujourd'hui",
  yesterday: "Hier",
  "7days": "7 derniers jours",
  "30days": "30 derniers jours",
  month: "Ce mois",
  year: "Cette année",
  custom: "Personnalisé"
};

const els = {
  kpiCollected: document.getElementById("kpiCollected"),
  kpiCostConsumed: document.getElementById("kpiCostConsumed"),
  kpiCostEngaged: document.getElementById("kpiCostEngaged"),
  kpiBenefitDisplay: document.getElementById("kpiBenefitDisplay"),
  kpiQtyOut: document.getElementById("kpiQtyOut"),
  kpiStock: document.getElementById("kpiStock"),
  statsRange: document.getElementById("statsRange"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  filterProduct: document.getElementById("filterProduct"),
  productTableBody: document.getElementById("productTableBody"),
  batchTableBody: document.getElementById("batchTableBody"),
  movementsList: document.getElementById("movementsList"),
  movementsPager: document.getElementById("movementsPager"),
  movementsPagerInfo: document.getElementById("movementsPagerInfo"),
  movementsPrevBtn: document.getElementById("movementsPrevBtn"),
  movementsNextBtn: document.getElementById("movementsNextBtn"),
  movementsSectionSub: document.getElementById("movementsSectionSub")
};

function blockAccess() {
  document.body.replaceChildren();
  const div = document.createElement("div");
  div.style.cssText =
    "display:flex;height:100vh;align-items:center;justify-content:center;background:#111;color:#fff;font-size:18px;";
  div.textContent = "⛔ Accès refusé — connectez-vous.";
  document.body.appendChild(div);
}

function updateDateLimits() {
  const dateFrom = els.dateFrom;
  const dateTo = els.dateTo;
  if (!dateFrom || !dateTo) return;

  const today = new Date().toISOString().split("T")[0];
  dateFrom.max = today;
  dateTo.max = today;

  if (dateFrom.value) {
    dateTo.min = dateFrom.value;
  } else {
    dateTo.removeAttribute("min");
  }

  if (dateFrom.value && dateTo.value && dateTo.value < dateFrom.value) {
    dateTo.value = dateFrom.value;
  }
}

function syncCustomDateInputs() {
  const custom = (els.statsRange?.value || "") === "custom";
  if (els.dateFrom) els.dateFrom.disabled = !custom;
  if (els.dateTo) els.dateTo.disabled = !custom;
  updateDateLimits();
}

function buildDateRange() {
  const range = els.statsRange?.value || "30days";
  const now = new Date();
  let start = null;
  let end = new Date(now);
  end.setHours(23, 59, 59, 999);

  switch (range) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "yesterday":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - 1,
        23,
        59,
        59,
        999
      );
      break;
    case "7days":
      start = new Date(now.getTime() - 7 * 86400000);
      start.setHours(0, 0, 0, 0);
      break;
    case "30days":
      start = new Date(now.getTime() - 30 * 86400000);
      start.setHours(0, 0, 0, 0);
      break;
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      start.setHours(0, 0, 0, 0);
      break;
    case "year":
      start = new Date(now.getFullYear(), 0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    case "custom": {
      const from = els.dateFrom?.value;
      const to = els.dateTo?.value;
      if (from && to) {
        start = new Date(from);
        start.setHours(0, 0, 0, 0);
        end = new Date(to);
        end.setHours(23, 59, 59, 999);
      } else {
        return { start: null, end: null, label: PERIOD_LABELS.custom, valid: false };
      }
      break;
    }
    default:
      start = new Date(now.getTime() - 30 * 86400000);
      start.setHours(0, 0, 0, 0);
      break;
  }

  return {
    start,
    end,
    label: PERIOD_LABELS[range] || PERIOD_LABELS["30days"],
    valid: true
  };
}

function rebuildProductsMap() {
  productsMap = {};
  products.forEach(p => {
    productsMap[p.id] = p;
  });
}

function fillProductFilter() {
  if (!els.filterProduct) return;

  const current = els.filterProduct.value;
  els.filterProduct.replaceChildren();

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "Tous les produits";
  els.filterProduct.appendChild(allOpt);

  products.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    els.filterProduct.appendChild(opt);
  });

  els.filterProduct.value = current || "";
}

function renderKpis(stats) {
  if (els.kpiCollected) els.kpiCollected.textContent = formatMoney(stats.totalCollected);
  if (els.kpiCostConsumed) {
    els.kpiCostConsumed.textContent = formatMoney(stats.totalCostConsumed || 0);
  }
  if (els.kpiCostEngaged) {
    els.kpiCostEngaged.textContent = formatMoney(stats.totalCostEngaged || 0);
  }
  if (els.kpiBenefitDisplay) {
    els.kpiBenefitDisplay.textContent = formatMoney(stats.totalMargin || 0);
  }
  if (els.kpiQtyOut) els.kpiQtyOut.textContent = String(stats.totalQtyOut);
  if (els.kpiStock) els.kpiStock.textContent = String(stats.totalStockRemaining);
}

function renderProductTable(rows) {
  if (!els.productTableBody) return;
  els.productTableBody.replaceChildren();

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty-state";
    td.textContent = "Aucune donnée produit.";
    tr.appendChild(td);
    els.productTableBody.appendChild(tr);
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");

    const cells = [
      row.productName,
      String(row.batch_count),
      String(row.stock_remaining),
      String(row.qty_out),
      formatMoney(row.margin)
    ];

    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (i >= 2) td.className = "num";
      tr.appendChild(td);
    });

    els.productTableBody.appendChild(tr);
  });
}

function renderBatchTable(rows) {
  if (!els.batchTableBody) return;
  els.batchTableBody.replaceChildren();

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.className = "empty-state";
    td.textContent = "Aucun lot.";
    tr.appendChild(td);
    els.batchTableBody.appendChild(tr);
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");
    const badge = statusBadge(row.status);

    const nameTd = document.createElement("td");
    nameTd.textContent = row.productName;

    const statusTd = document.createElement("td");
    const badgeEl = document.createElement("span");
    badgeEl.className = `badge ${badge.cls}`;
    badgeEl.textContent = badge.label;
    statusTd.appendChild(badgeEl);

    const stockTd = document.createElement("td");
    stockTd.className = "num";
    const stockMain = document.createElement("div");
    stockMain.textContent = String(row.quantity_remaining);
    const stockSub = document.createElement("small");
    stockSub.className = "cell-sub";
    stockSub.textContent = `Initial : ${row.quantity_initial}`;
    stockTd.append(stockMain, stockSub);

    const qtyTd = document.createElement("td");
    qtyTd.className = "num";
    qtyTd.textContent = String(row.qty_out);

    const collectedTd = document.createElement("td");
    collectedTd.className = "num";
    collectedTd.textContent = formatMoney(row.collected);

    const marginTd = document.createElement("td");
    marginTd.className = "num";
    marginTd.textContent = formatMoney(row.margin);

    const idTd = document.createElement("td");
    idTd.textContent = row.batchId.slice(0, 10) + "…";

    tr.append(nameTd, statusTd, stockTd, qtyTd, collectedTd, marginTd, idTd);
    els.batchTableBody.appendChild(tr);
  });
}

function movementsTotalPages() {
  return Math.max(1, Math.ceil(periodMovementsCached.length / MOVEMENTS_PAGE_SIZE));
}

function updateMovementsPager() {
  const total = periodMovementsCached.length;
  const pages = movementsTotalPages();
  movementsPage = Math.min(Math.max(1, movementsPage), pages);

  if (els.movementsSectionSub) {
    els.movementsSectionSub.textContent =
      total === 0
        ? "Aucun mouvement sur cette période"
        : `${total} mouvement${total > 1 ? "s" : ""} — ${MOVEMENTS_PAGE_SIZE} par page`;
  }

  if (!els.movementsPager) return;

  if (total <= MOVEMENTS_PAGE_SIZE) {
    els.movementsPager.hidden = true;
    return;
  }

  els.movementsPager.hidden = false;
  if (els.movementsPagerInfo) {
    els.movementsPagerInfo.textContent = `Page ${movementsPage} / ${pages}`;
  }
  if (els.movementsPrevBtn) els.movementsPrevBtn.disabled = movementsPage <= 1;
  if (els.movementsNextBtn) els.movementsNextBtn.disabled = movementsPage >= pages;
}

function renderMovementsPage() {
  if (!els.movementsList) return;
  els.movementsList.replaceChildren();

  if (!periodMovementsCached.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Aucun mouvement sur cette période.";
    els.movementsList.appendChild(empty);
    updateMovementsPager();
    return;
  }

  const start = (movementsPage - 1) * MOVEMENTS_PAGE_SIZE;
  const pageRows = periodMovementsCached.slice(start, start + MOVEMENTS_PAGE_SIZE);

  pageRows.forEach(m => {
    const row = document.createElement("div");
    row.className = "item-row";

    const info = document.createElement("div");
    info.className = "item-info";

    const productName = productsMap[m.productId]?.name || m.productId;
    const title = document.createElement("strong");
    title.textContent = `${productName} — ${m.quantity_out} u.`;

    const line1 = document.createElement("small");
    line1.className = "item-line";
    line1.textContent = `Encaissé ${formatMoney(m.amount_collected)} · Marge ${formatMoney(m.profit_real)}`;

    const line2 = document.createElement("small");
    line2.className = "item-line";
    const parts = [
      m.clientName ? `Client ${m.clientName}` : null,
      `Raison ${formatBatchReason(m.reason)}`,
      formatDate(m.createdAt)
    ].filter(Boolean);
    line2.textContent = parts.join(" · ");

    info.append(title, line1, line2);
    row.appendChild(info);
    els.movementsList.appendChild(row);
  });

  updateMovementsPager();
}

function goMovementsPage(delta) {
  movementsPage += delta;
  renderMovementsPage();
}

async function refreshStats() {
  setStatus("● Chargement…");

  const period = buildDateRange();
  if (!period.valid) {
    showToast("Choisissez une date début et une date fin.", "error");
    setStatus("● Online");
    return;
  }

  try {
    products = await loadBatchProducts();
    rebuildProductsMap();
    fillProductFilter();

    const productFilter = els.filterProduct?.value || "";
    const movementFilters = {
      start: period.start,
      end: period.end
    };
    if (productFilter) movementFilters.productId = productFilter;

    const [batches, movements] = await Promise.all([
      loadBatches(),
      loadBatchMovements(movementFilters)
    ]);

    const filteredBatches = productFilter
      ? batches.filter(b => b.productId === productFilter)
      : batches;

    periodMovementsCached = movements;
    movementsPage = 1;

    const stats = aggregateBatchStats(
      filteredBatches,
      periodMovementsCached,
      productsMap
    );
    lastStats = stats;
    lastPeriodLabel = period.label;

    renderKpis(stats);
    renderProductTable(stats.byProduct);
    renderBatchTable(stats.byBatch);
    renderMovementsPage();
    setStatus("● Online");
  } catch (err) {
    console.error(err);
    setStatus("● Erreur");
    showToast(err.message || "Erreur de chargement.", "error");
  }
}

async function setupBatchStatsPdf() {
  if (pdfReady) return;
  try {
    const pdf = await import("../../js/pdf/batch-stats-pdf.js");
    pdf.initBatchStatsPdfButton(() => {
      const productFilter = els.filterProduct?.value || "";
      const productName = productFilter
        ? productsMap[productFilter]?.name || productFilter
        : "Tous les produits";
      return pdf.buildBatchStatsPdfPayload(
        lastStats,
        shopMeta,
        `Lots — ${productName} — ${lastPeriodLabel}`
      );
    });
    pdfReady = true;
  } catch (err) {
    console.warn("[batch-stats] PDF:", err);
    const btn = document.getElementById("pdfBtn");
    if (btn) {
      btn.disabled = true;
      btn.title = "Export PDF indisponible";
    }
  }
}

function bindFilterEvents() {
  els.statsRange?.addEventListener("change", syncCustomDateInputs);
  els.dateFrom?.addEventListener("change", updateDateLimits);
  els.dateTo?.addEventListener("change", updateDateLimits);
  syncCustomDateInputs();

  bindActionButton(document.getElementById("applyFilterBtn"), refreshStats);
  bindActionButton(document.getElementById("refreshBtn"), refreshStats);

  els.movementsPrevBtn?.addEventListener("click", () => goMovementsPage(-1));
  els.movementsNextBtn?.addEventListener("click", () => goMovementsPage(1));
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    blockAccess();
    return;
  }
  try {
    const config = await getAppConfig();
    shopMeta = {
      shopName: config?.shopName || "StockFlow",
      shopAddress: config?.shopAddress || "",
      shopPhone: config?.shopPhone || "",
      currencySymbol: config?.currencySymbol || config?.currency || "$",
      logoUrl: config?.logoUrl || ""
    };
  } catch (_) {
    shopMeta = { shopName: "StockFlow", currencySymbol: "$" };
  }
  bindFilterEvents();
  await setupBatchStatsPdf();
  await refreshStats();
});
