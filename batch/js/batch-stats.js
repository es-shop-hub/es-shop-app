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
  statusBadge
} from "./batch-utils.js";
import { bindActionButton } from "../../js/utils/buttonManager.js";

const auth = getAuth();
let products = [];
let productsMap = {};

const els = {
  kpiMargin: document.getElementById("kpiMargin"),
  kpiCollected: document.getElementById("kpiCollected"),
  kpiQtyOut: document.getElementById("kpiQtyOut"),
  kpiStock: document.getElementById("kpiStock"),
  filterProduct: document.getElementById("filterProduct"),
  productTableBody: document.getElementById("productTableBody"),
  batchTableBody: document.getElementById("batchTableBody"),
  movementsList: document.getElementById("movementsList")
};

function blockAccess() {
  document.body.replaceChildren();
  const div = document.createElement("div");
  div.style.cssText = "display:flex;height:100vh;align-items:center;justify-content:center;background:#111;color:#fff;font-size:18px;";
  div.textContent = "⛔ Accès refusé — connectez-vous.";
  document.body.appendChild(div);
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
  if (els.kpiMargin) els.kpiMargin.textContent = formatMoney(stats.totalMargin);
  if (els.kpiCollected) els.kpiCollected.textContent = formatMoney(stats.totalCollected);
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
    td.colSpan = 6;
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

    const nums = [
      `${row.quantity_remaining}/${row.quantity_initial}`,
      String(row.qty_out),
      formatMoney(row.collected),
      formatMoney(row.margin)
    ];

    tr.appendChild(nameTd);
    tr.appendChild(statusTd);

    nums.forEach(text => {
      const td = document.createElement("td");
      td.className = "num";
      td.textContent = text;
      tr.appendChild(td);
    });

    const idTd = document.createElement("td");
    idTd.textContent = row.batchId.slice(0, 10) + "…";
    tr.appendChild(idTd);

    els.batchTableBody.appendChild(tr);
  });
}

function renderMovements(movements) {
  if (!els.movementsList) return;
  els.movementsList.replaceChildren();

  if (!movements.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Aucun mouvement enregistré.";
    els.movementsList.appendChild(empty);
    return;
  }

  movements.slice(0, 50).forEach(m => {
    const row = document.createElement("div");
    row.className = "item-row";

    const info = document.createElement("div");
    info.className = "item-info";

    const productName = productsMap[m.productId]?.name || m.productId;
    const title = document.createElement("strong");
    title.textContent = `${productName} — ${m.quantity_out} u.`;

    const sub = document.createElement("small");
    sub.textContent = [
      `Encaissé : ${formatMoney(m.amount_collected)}`,
      `Marge : ${formatMoney(m.profit_real)}`,
      `Lot : ${(m.batchId || "").slice(0, 10)}…`,
      `Raison : ${m.reason || "sale"}`,
      formatDate(m.createdAt)
    ].join(" • ");

    info.append(title, sub);
    row.appendChild(info);
    els.movementsList.appendChild(row);
  });
}

async function refreshStats() {
  setStatus("● Chargement…");

  try {
    products = await loadBatchProducts();
    rebuildProductsMap();
    fillProductFilter();

    const productFilter = els.filterProduct?.value || "";
    const [batches, movements] = await Promise.all([
      loadBatches(),
      loadBatchMovements(productFilter ? { productId: productFilter } : {})
    ]);

    const filteredBatches = productFilter
      ? batches.filter(b => b.productId === productFilter)
      : batches;

    const stats = aggregateBatchStats(filteredBatches, movements, productsMap);

    renderKpis(stats);
    renderProductTable(stats.byProduct);
    renderBatchTable(stats.byBatch);
    renderMovements(movements);
    setStatus("● Online");
  } catch (err) {
    console.error(err);
    setStatus("● Erreur");
    showToast(err.message || "Erreur de chargement.", "error");
  }
}

bindActionButton(document.getElementById("applyFilterBtn"), refreshStats);

onAuthStateChanged(auth, async user => {
  if (!user) {
    blockAccess();
    return;
  }
  await refreshStats();
});
