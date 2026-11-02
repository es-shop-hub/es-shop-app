import {
  db,
  doc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  updateDoc,
  writeBatch,
  increment,
  writeLog,
  Timestamp
} from "./firebase.js";

import { auth, onAuthStateChanged } from "./auth.js";
import { getAppConfig } from "./appConfig.js";
import {
  sanitizeClientName,
  upsertClientByName
} from "./clients-service.js";
import { bindActionButton } from "./utils/buttonManager.js";
import {
  BATCH_COLLECTIONS,
  formatBatchReason
} from "../batch/js/batch-utils.js";

const $ = id => document.getElementById(id);

const CANCEL_WINDOW_MS = 48 * 60 * 60 * 1000;

const state = {
  sales: [],
  saleItems: [],
  batchMovements: [],
  batchProducts: [],
  products: [],
  users: [],
  debts: [],
  rows: [],
  currency: "FC",
  shopMeta: null
};

let currentUser = null;
let metaLoaded = false;

function n(v) {
  return Number(v) || 0;
}

function formatMoney(v) {
  return `${Math.round(n(v)).toLocaleString()} ${state.currency}`;
}

async function loadAppCurrency() {
  try {
    const config = await getAppConfig();
    const symbol = String(config?.currencySymbol || "").trim();
    const code = String(config?.currency || "").trim();
    state.currency = symbol || code || "FC";
    state.shopMeta = {
      shopName: config?.shopName || "StockFlow",
      shopAddress: config?.shopAddress || "",
      shopPhone: config?.shopPhone || "",
      currencySymbol: state.currency,
      logoUrl: config?.logoUrl || ""
    };
  } catch (error) {
    console.warn("[vendus] loadAppCurrency", error);
    state.currency = "FC";
    state.shopMeta = { shopName: "StockFlow", currencySymbol: "FC" };
  }
}

function getVendusPeriodLabel() {
  const range = $("statsRange")?.value || "today";
  const labels = {
    today: "Aujourd'hui",
    yesterday: "Hier",
    "7days": "7 jours",
    "30days": "30 jours",
    month: "Ce mois",
    year: "Cette année",
    custom: "Période personnalisée"
  };
  return labels[range] || range;
}

async function setupVendusPdf() {
  try {
    const pdf = await import("./pdf/vendus-pdf.js");
    pdf.initVendusPdfButton(() =>
      pdf.buildVendusPdfFromState(state, {
        ...state.shopMeta,
        periodLabel: getVendusPeriodLabel()
      })
    );
  } catch (err) {
    console.warn("[vendus] PDF:", err);
    const btn = $("pdfBtn");
    if (btn) {
      btn.disabled = true;
      btn.title = "Export PDF indisponible";
    }
  }
}

function getDate(v) {
  if (!v) return null;

  if (typeof v?.toDate === "function") {
    return v.toDate();
  }

  if (v?.seconds) {
    return new Date(v.seconds * 1000);
  }

  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function isWithinCancelWindow(createdAt) {
  const date = createdAt instanceof Date ? createdAt : getDate(createdAt);
  if (!date) return false;
  return Date.now() - date.getTime() <= CANCEL_WINDOW_MS;
}

function canCancelSale(row, isBatch) {
  return (
    !isBatch &&
    Boolean(row?.saleId) &&
    (row.saleStatus || "active") !== "cancelled" &&
    isWithinCancelWindow(row.createdAt)
  );
}

function closeOpenCancelPanels(exceptCard) {
  document.querySelectorAll(".sale-card.is-cancel-open").forEach(card => {
    if (exceptCard && card === exceptCard) return;
    card.classList.remove("is-cancel-open");
    const toggle = card.querySelector(".sale-cancel-toggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Afficher l'annulation");
      toggle.textContent = "›";
    }
  });
}

function confirmCancelSaleTriple() {
  if (!window.confirm("Annuler cette vente ? Le stock sera rétabli.")) {
    return false;
  }
  if (
    !window.confirm(
      "Confirmation 2/3 : cette action est irréversible. Continuer ?"
    )
  ) {
    return false;
  }
  if (
    !window.confirm(
      "Confirmation 3/3 : annuler définitivement la vente ?"
    )
  ) {
    return false;
  }
  return true;
}

function getCurrentUserId() {
  return (
    currentUser?.userId ||
    currentUser?.uid ||
    currentUser?.id ||
    auth.currentUser?.uid ||
    ""
  );
}

function buildDateRange() {
  const range = $("statsRange")?.value || "today";
  const now = new Date();

  let start = null;
  let end = new Date();

  switch (range) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      break;

    case "yesterday":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      break;

    case "7days":
      start = new Date(now.getTime() - 7 * 86400000);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;

    case "30days":
      start = new Date(now.getTime() - 30 * 86400000);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;

    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end.setHours(23, 59, 59, 999);
      break;

    case "year":
      start = new Date(now.getFullYear(), 0, 1);
      end.setHours(23, 59, 59, 999);
      break;

    case "custom": {
      const from = $("dateFrom")?.value;
      const to = $("dateTo")?.value;

      if (!from || !to) {
        return { start: null, end: null };
      }

      start = new Date(from);
      start.setHours(0, 0, 0, 0);
      end = new Date(to);
      end.setHours(23, 59, 59, 999);
      break;
    }
  }

  return { start, end };
}

function getFilterValues() {
  return {
    productId: $("productFilter")?.value || "",
    sellerId: $("sellerFilter")?.value || "all",
    payment: $("paymentFilter")?.value || "",
    status: $("statusFilter")?.value || "",
    type: $("typeFilter")?.value || "all",
    clientName: ($("clientSearch")?.value || "").trim()
  };
}

function getBatchProductName(productId) {
  if (!productId) return "Produit lot";
  const batchProduct = state.batchProducts.find(p => p.id === productId);
  if (batchProduct?.name) return batchProduct.name;
  const classic = state.products.find(p => p.id === productId);
  return classic?.name || "Produit lot";
}

function resolveUserName(userId) {
  if (!userId) return "—";
  const user = state.users.find(
    u =>
      u.userId === userId ||
      u.uid === userId ||
      u.id === userId
  );
  return user?.name || userId;
}

function buildSalesQuery(dateRange) {
  const { start, end } = dateRange;
  const { sellerId, payment, status } = getFilterValues();
  const constraints = [];

  if (!start || !end) {
    return null;
  }

  constraints.push(where("createdAt", ">=", start));
  constraints.push(where("createdAt", "<=", end));

  if (sellerId !== "all") {
    constraints.push(where("sellerId", "==", sellerId));
  }

  if (payment) {
    constraints.push(where("payment_status", "==", payment));
  }

  if (status) {
    constraints.push(where("status", "==", status));
  }

  constraints.push(orderBy("createdAt", "desc"));

  return query(collection(db, "sales"), ...constraints);
}

function buildSaleItemsQuery(dateRange) {
  const { start, end } = dateRange;
  const { productId } = getFilterValues();
  const constraints = [];

  if (!start || !end) {
    return null;
  }

  constraints.push(where("createdAt", ">=", start));
  constraints.push(where("createdAt", "<=", end));

  if (productId) {
    constraints.push(where("productId", "==", productId));
  }

  constraints.push(orderBy("createdAt", "desc"));

  return query(collection(db, "sale_items"), ...constraints);
}

function updateDateLimits() {
  const dateFrom = $("dateFrom");
  const dateTo = $("dateTo");
  if (!dateFrom || !dateTo) return;

  const today = new Date().toISOString().split("T")[0];
  dateFrom.max = today;
  dateTo.max = today;

  if (dateFrom.value && dateFrom.value > today) {
    dateFrom.value = today;
  }

  if (dateTo.value && dateTo.value > today) {
    dateTo.value = today;
  }

  if (
    dateFrom.value &&
    dateTo.value &&
    dateTo.value < dateFrom.value
  ) {
    dateTo.value = dateFrom.value;
  }
}

async function loadMetaData() {
  await loadAppCurrency();

  if (metaLoaded) {
    return;
  }

  const [productsSnap, usersSnap, debtsSnap, batchProdSnap] = await Promise.all([
    getDocs(collection(db, "products")),
    getDocs(collection(db, "users")),
    getDocs(collection(db, "debts")),
    getDocs(collection(db, BATCH_COLLECTIONS.PRODUCTS)).catch(() => ({ docs: [] }))
  ]);

  state.products = productsSnap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  state.users = usersSnap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  state.debts = debtsSnap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  state.batchProducts = batchProdSnap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  metaLoaded = true;
  populateFilterOptions();
}

function populateFilterOptions() {
  const filters = getFilterValues();

  const productFilter = $("productFilter");
  if (productFilter) {
    const current = productFilter.value || filters.productId;
    productFilter.replaceChildren();

    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Tous les produits";
    productFilter.appendChild(first);

    const productOptions = new Map();

    state.products.forEach(product => {
      productOptions.set(product.id, product.name || "Produit");
    });
    state.batchProducts.forEach(product => {
      if (!productOptions.has(product.id)) {
        productOptions.set(product.id, `${product.name || "Produit"} (lot)`);
      }
    });

    [...productOptions.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .forEach(([id, name]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = name;
        productFilter.appendChild(option);
      });

    productFilter.value = current;
  }

  const sellerFilter = $("sellerFilter");
  if (sellerFilter) {
    const currentValue = sellerFilter.value || filters.sellerId || "all";

    sellerFilter.replaceChildren();

    const first = document.createElement("option");
    first.value = "all";
    first.textContent = "Tous les vendeurs";
    sellerFilter.appendChild(first);

    state.users
      .filter(u => String(u.role || "").toLowerCase() === "seller")
      .forEach(user => {
        const option = document.createElement("option");
        option.value = user.userId || user.uid || user.id;
        option.textContent = user.name || "Vendeur";
      sellerFilter.appendChild(option);
    });

    if (currentUser?.role === "seller") {
      const ownId =
        currentUser.userId ||
        currentUser.uid ||
        currentUser.id;
      sellerFilter.value = ownId;
      sellerFilter.disabled = true;
    } else {
      sellerFilter.disabled = false;
      const exists = [...sellerFilter.options].some(
        opt => opt.value === currentValue
      );
      sellerFilter.value = exists ? currentValue : "all";
    }
  }
}

async function checkAccess(uid) {
  const userSnap = await getDoc(doc(db, "users", uid));

  if (!userSnap.exists()) {
    location.replace("404.html");
    return;
  }

  currentUser = { id: userSnap.id, ...userSnap.data() };

  if (
    currentUser.role !== "admin" &&
    currentUser.role !== "seller"
  ) {
    location.replace("404.html");
    return;
  }

  if (currentUser.role === "seller") {
    const ownId =
      currentUser.userId ||
      currentUser.uid ||
      currentUser.id;
    const sellerFilter = $("sellerFilter");
    if (sellerFilter) {
      sellerFilter.value = ownId;
      sellerFilter.disabled = true;
    }
  }

  bindEvents();
  await loadMetaData();
  await setupVendusPdf();
  await loadData();
}

async function loadData() {
  const dateRange = buildDateRange();

  if (!dateRange.start || !dateRange.end) {
    if ($("statsRange")?.value === "custom") {
      return;
    }
  }

  const salesQuery = buildSalesQuery(dateRange);
  const saleItemsQuery = buildSaleItemsQuery(dateRange);

  if (!salesQuery || !saleItemsQuery) {
    return;
  }

  console.log("[vendus] loadData Firestore", $("statsRange")?.value || "today");

  try {
    await loadAppCurrency();

    const { start, end } = dateRange;

    const [salesSnap, saleItemsSnap, batchMoveSnap, batchProdSnap] =
      await Promise.all([
        getDocs(salesQuery),
        getDocs(saleItemsQuery),
        getDocs(
          query(
            collection(db, BATCH_COLLECTIONS.MOVEMENTS),
            orderBy("createdAt", "desc")
          )
        ).catch(err => {
          console.warn("[vendus] batch_movements:", err);
          return { docs: [] };
        }),
        getDocs(collection(db, BATCH_COLLECTIONS.PRODUCTS)).catch(err => {
          console.warn("[vendus] batch_products:", err);
          return { docs: [] };
        })
      ]);

    state.sales = salesSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    const saleIds = new Set(state.sales.map(s => s.id));

    state.saleItems = saleItemsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(item => saleIds.has(item.saleId));

    state.batchProducts = batchProdSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    state.batchMovements = batchMoveSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => {
        const d = getDate(m.createdAt);
        if (!d) return false;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
      });

    buildRows();
    render();
  } catch (error) {
    console.error("[vendus] loadData", error);
    state.sales = [];
    state.saleItems = [];
    state.batchMovements = [];
    state.batchProducts = [];
    state.rows = [];
    render();

    const list = $("salesList");
    if (list) {
      list.replaceChildren();
      const err = document.createElement("div");
      err.className = "empty";
      err.textContent = error?.message?.includes("index")
        ? "Index Firestore requis — voir la console Firebase"
        : "Erreur chargement des ventes";
      list.appendChild(err);
    }
  }
}

function buildRows() {
  state.rows = [];
  const filters = getFilterValues();
  const includeClassic = filters.type === "all" || filters.type === "classic";
  const includeBatch = filters.type === "all" || filters.type === "batch";

  if (includeClassic) {
    const saleMap = new Map(state.sales.map(s => [s.id, s]));

    state.saleItems.forEach(item => {
      const sale = saleMap.get(item.saleId);
      if (!sale) return;

      if (filters.productId && item.productId !== filters.productId) {
        return;
      }

      const product = state.products.find(p => p.id === item.productId);
      const seller = state.users.find(
        u =>
          u.userId === sale.sellerId ||
          u.uid === sale.sellerId ||
          u.id === sale.sellerId
      );
      const debt = state.debts.find(e => e.relatedSaleId === sale.id);

      state.rows.push({
        source: "classic",
        saleId: sale.id,
        movementId: null,
        productId: item.productId,
        productName: product?.name || "Produit",
        sellerId: sale.sellerId || "",
        sellerName: seller?.name || "Vendeur",
        quantity: n(item.quantity),
        price: n(item.price),
        profit: n(item.profit),
        total: n(item.quantity) * n(item.price),
        clientName:
          sale.clientName ||
          sale.client_name ||
          debt?.name ||
          "",
        paymentStatus: sale.payment_status || "paid",
        saleStatus: sale.status || "active",
        amountRemaining: n(debt?.amount_remaining),
        reason: "sale",
        reasonLabel: "Vente",
        createdAt: getDate(sale.createdAt)
      });
    });
  }

  if (includeBatch) {
    state.batchMovements.forEach(m => {
      if (filters.productId && m.productId !== filters.productId) {
        return;
      }
      if (
        filters.sellerId !== "all" &&
        m.createdBy &&
        m.createdBy !== filters.sellerId
      ) {
        return;
      }
      // Paiement / statut classique ne s'appliquent pas aux lots
      if (filters.payment || filters.status) {
        if (filters.type === "all") {
          return;
        }
      }

      const qty = n(m.quantity_out);
      const total = n(m.amount_collected);
      const unitPrice = qty > 0 ? total / qty : total;

      state.rows.push({
        source: "batch",
        saleId: null,
        movementId: m.id,
        productId: m.productId,
        productName: getBatchProductName(m.productId),
        sellerId: m.createdBy || "",
        sellerName: resolveUserName(m.createdBy),
        quantity: qty,
        price: unitPrice,
        profit: n(m.profit_real),
        total,
        clientName: m.clientName || "",
        paymentStatus: "paid",
        saleStatus: "active",
        amountRemaining: 0,
        reason: m.reason || "sale",
        reasonLabel: formatBatchReason(m.reason),
        createdAt: getDate(m.createdAt)
      });
    });
  }

  state.rows.sort((a, b) => {
    const ta = a.createdAt?.getTime() || 0;
    const tb = b.createdAt?.getTime() || 0;
    return tb - ta;
  });

  if (filters.clientName) {
    const term = filters.clientName.toLowerCase();
    state.rows = state.rows.filter(row =>
      (row.clientName || "").toLowerCase().includes(term)
    );
  }
}

function renderKpis(rows) {
  const activeRows = rows.filter(row => row.saleStatus !== "cancelled");
  const classicRows = activeRows.filter(r => r.source !== "batch");
  const batchRows = activeRows.filter(r => r.source === "batch");

  const soldCount = activeRows.reduce(
    (sum, row) => sum + row.quantity,
    0
  );

  const salesTotal = activeRows.reduce(
    (sum, row) => sum + row.total,
    0
  );

  const netProfit = activeRows.reduce(
    (sum, row) => sum + row.profit,
    0
  );

  const debtBySale = new Map();
  classicRows.forEach(row => {
    if (
      row.saleId &&
      row.paymentStatus === "partial" &&
      row.amountRemaining > 0
    ) {
      debtBySale.set(row.saleId, row.amountRemaining);
    }
  });

  const debtTotal = [...debtBySale.values()].reduce(
    (sum, amount) => sum + amount,
    0
  );

  $("soldCount").textContent = String(soldCount);
  $("salesTotal").textContent = formatMoney(salesTotal);

  const netProfitEl = $("netProfit");
  if (netProfitEl) {
    netProfitEl.textContent = formatMoney(netProfit);
  }

  $("debtTotal").textContent = formatMoney(debtTotal);
  if ($("resultCount")) {
    $("resultCount").textContent =
      `${rows.length} ligne(s) — Classique : ${classicRows.length} • Lots : ${batchRows.length}`;
  }
}

function createSaleCard(row, showClientEdit = false) {
  const card = document.createElement("div");
  card.className = "sale-card";
  const isBatch = row.source === "batch";

  if (row.saleStatus === "cancelled") {
    card.classList.add("sale-cancelled");
  }

  const top = document.createElement("div");
  top.className = "sale-top";

  const product = document.createElement("div");
  product.className = "sale-product";
  product.textContent = row.productName;

  const price = document.createElement("div");
  price.className = "sale-price";
  price.textContent = formatMoney(row.total);

  top.appendChild(product);
  top.appendChild(price);

  const typeBadge = document.createElement("span");
  typeBadge.className = `badge ${isBatch ? "badge-batch" : "badge-classic"}`;
  typeBadge.textContent = isBatch ? "Lot" : "Classique";

  const clientMeta = document.createElement("div");
  clientMeta.className = "sale-meta";
  clientMeta.textContent = `Client : ${row.clientName || "-"}`;

  const sellerMeta = document.createElement("div");
  sellerMeta.className = "sale-meta";
  sellerMeta.textContent = isBatch
    ? `Créé par : ${row.sellerName}`
    : `Vendeur : ${row.sellerName}`;

  const qtyMeta = document.createElement("div");
  qtyMeta.className = "sale-meta";
  if (isBatch) {
    qtyMeta.textContent =
      `Qté : ${row.quantity} • Marge : ${formatMoney(row.profit)}` +
      ` • ${row.reasonLabel || "Vente"}`;
  } else {
    qtyMeta.textContent = `Qté : ${row.quantity} × ${formatMoney(row.price)}`;
  }

  const dateMeta = document.createElement("div");
  dateMeta.className = "sale-meta";
  const dateStr = row.createdAt
    ? row.createdAt.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
    : "-";
  dateMeta.textContent = `Date : ${dateStr}`;

  const badge = document.createElement("span");
  badge.className = "badge";

  if (isBatch) {
    if (row.reason === "loss" || row.reason === "perte") {
      badge.classList.add("badge-loss");
      badge.textContent = "Perte";
    } else {
      badge.classList.add("badge-paid");
      badge.textContent = row.reasonLabel || "Lot";
    }
  } else if (row.saleStatus === "cancelled") {
    badge.classList.add("badge-cancelled");
    badge.textContent = "Annulée";
  } else if (row.paymentStatus === "partial") {
    badge.classList.add("badge-partial");
    badge.textContent = `Dette • ${formatMoney(row.amountRemaining)}`;
  } else {
    badge.classList.add("badge-paid");
    badge.textContent = "Payé";
  }

  card.appendChild(top);
  card.appendChild(typeBadge);
  card.appendChild(clientMeta);
  card.appendChild(sellerMeta);
  card.appendChild(qtyMeta);
  card.appendChild(dateMeta);
  card.appendChild(badge);

  const canActOnSale =
    !isBatch &&
    showClientEdit &&
    row.saleStatus !== "cancelled" &&
    row.saleId;

  if (canActOnSale) {
    const actions = document.createElement("div");
    actions.className = "sale-card-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-edit-client";
    editBtn.id = `editClient_${row.saleId}`;
    editBtn.textContent = "Modifier client";
    bindActionButton(editBtn, async () => {
      await editSaleClientName(row.saleId, row.clientName);
    });
    actions.appendChild(editBtn);
    card.appendChild(actions);
  }

  const canCancel = showClientEdit && canCancelSale(row, isBatch);
  if (canCancel) {
    card.classList.add("has-cancel-rail");

    const rail = document.createElement("div");
    rail.className = "sale-cancel-rail";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sale-cancel-toggle";
    toggle.id = `cancelToggle_${row.saleId}`;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Afficher l'annulation");
    toggle.textContent = "›";
    toggle.addEventListener("click", event => {
      event.stopPropagation();
      const open = !card.classList.contains("is-cancel-open");
      closeOpenCancelPanels(card);
      card.classList.toggle("is-cancel-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.textContent = open ? "‹" : "›";
      toggle.setAttribute(
        "aria-label",
        open ? "Masquer l'annulation" : "Afficher l'annulation"
      );
    });

    const panel = document.createElement("div");
    panel.className = "sale-cancel-panel";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-cancel-sale";
    cancelBtn.id = `cancelSale_${row.saleId}`;
    cancelBtn.textContent = "Annuler la vente";
    bindActionButton(cancelBtn, async () => {
      await requestCancelSale(row.saleId);
    });
    panel.appendChild(cancelBtn);

    rail.appendChild(toggle);
    rail.appendChild(panel);
    card.appendChild(rail);
  }

  return card;
}

async function requestCancelSale(saleId) {
  if (!saleId) return;
  if (!confirmCancelSaleTriple()) return;
  await cancelSale(saleId);
}

async function cancelSale(saleId) {
  if (!saleId) return;

  const userId = getCurrentUserId();

  try {
    const saleRef = doc(db, "sales", saleId);
    const saleSnap = await getDoc(saleRef);

    if (!saleSnap.exists()) {
      alert("Vente introuvable.");
      return;
    }

    const sale = saleSnap.data();
    const saleStatus = sale.status || "active";

    if (saleStatus === "cancelled") {
      alert("Cette vente est déjà annulée.");
      return;
    }

    if (!isWithinCancelWindow(sale.createdAt)) {
      alert("Annulation impossible : la vente a plus de 48 heures.");
      return;
    }

    const [itemsSnap, debtsSnap] = await Promise.all([
      getDocs(query(collection(db, "sale_items"), where("saleId", "==", saleId))),
      getDocs(
        query(collection(db, "debts"), where("relatedSaleId", "==", saleId))
      )
    ]);

    const items = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const relatedDebts = debtsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const debtWithPayment = relatedDebts.find(d => n(d.amount_paid) > 0);
    if (debtWithPayment) {
      alert(
        "Annulation impossible : un paiement a déjà été enregistré sur la dette liée."
      );
      return;
    }

    if (!items.length) {
      alert("Aucun article trouvé pour cette vente.");
      return;
    }

    const stockByProduct = new Map();
    for (const item of items) {
      const productId = item.productId;
      const qty = n(item.quantity);
      if (!productId || qty <= 0) continue;
      stockByProduct.set(
        productId,
        (stockByProduct.get(productId) || 0) + qty
      );
    }

    const now = Timestamp.now();
    const batch = writeBatch(db);

    batch.update(saleRef, {
      status: "cancelled",
      updatedAt: now
    });

    for (const debt of relatedDebts) {
      if ((debt.status || "") === "cancelled") continue;
      batch.update(doc(db, "debts", debt.id), {
        status: "cancelled",
        updatedAt: now
      });
    }

    for (const item of items) {
      const qty = n(item.quantity);
      if (!item.productId || qty <= 0) continue;

      const moveRef = doc(collection(db, "stock_movements"));
      const movePayload = {
        productId: item.productId,
        type: "IN",
        quantity: qty,
        reason: "correction",
        referenceId: saleId,
        createdBy: userId,
        createdAt: now
      };

      if (item.expirationDate != null) {
        movePayload.expirationDate = item.expirationDate;
      }
      if (item.batchId) {
        movePayload.batchId = item.batchId;
      }

      batch.set(moveRef, movePayload);
    }

    for (const [productId, qty] of stockByProduct) {
      batch.update(doc(db, "products", productId), {
        stock_current: increment(qty),
        updatedAt: now
      });
    }

    await batch.commit();

    await writeLog({
      userId,
      action: "sale_cancel",
      targetId: saleId,
      details: {
        itemCount: items.length,
        productIds: [...stockByProduct.keys()]
      }
    });

    const debtsRefresh = await getDocs(collection(db, "debts"));
    state.debts = debtsRefresh.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    alert("Vente annulée. Stock rétabli.");
    await loadData();
  } catch (err) {
    console.error("[vendus] cancelSale", err);
    alert(err?.message || "Impossible d'annuler la vente.");
  }
}

async function editSaleClientName(saleId, currentName) {
  if (!saleId) return;

  const next = window.prompt(
    "Nom du client pour cette vente :",
    currentName || ""
  );
  if (next == null) return;

  const name = sanitizeClientName(next);
  if (!name) {
    alert("Nom client invalide.");
    return;
  }

  try {
    await updateDoc(doc(db, "sales", saleId), {
      clientName: name,
      updatedAt: Timestamp.now()
    });

    await upsertClientByName(name, currentUser?.uid || currentUser?.userId || "", {
      lastSaleAt: Timestamp.now()
    });

    await writeLog({
      userId: currentUser?.uid || currentUser?.userId || "",
      action: "sale_client_update",
      targetId: saleId,
      details: { clientName: name, previous: currentName || "" }
    });

    await loadData();
  } catch (err) {
    console.error(err);
    alert(err.message || "Impossible de modifier le client.");
  }
}

function render() {
  const rows = state.rows;

  renderKpis(rows);

  const container = $("salesList");
  if (!container) return;

  container.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Aucune vente trouvée pour cette période";
    container.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  const editedSales = new Set();
  rows.forEach(row => {
    const showEdit = row.saleId && !editedSales.has(row.saleId);
    if (showEdit) editedSales.add(row.saleId);
    fragment.appendChild(createSaleCard(row, showEdit));
  });

  container.appendChild(fragment);
}

function resetFilters() {
  $("productFilter").value = "";
  $("paymentFilter").value = "";
  $("statusFilter").value = "";
  if ($("typeFilter")) $("typeFilter").value = "all";
  $("clientSearch").value = "";
  $("statsRange").value = "today";
  $("dateFrom").value = "";
  $("dateTo").value = "";

  if (currentUser?.role !== "seller" && $("sellerFilter")) {
    $("sellerFilter").value = "all";
  }

  if ($("dateFrom")) {
    $("dateFrom").disabled = true;
  }
  if ($("dateTo")) {
    $("dateTo").disabled = true;
  }

  updateDateLimits();
  loadData();
}

function bindEvents() {
  $("dateFrom")?.addEventListener("change", updateDateLimits);
  $("dateTo")?.addEventListener("change", updateDateLimits);
  updateDateLimits();

  $("statsRange")?.addEventListener("change", () => {
    const custom = $("statsRange")?.value === "custom";

    if ($("dateFrom")) {
      $("dateFrom").disabled = !custom;
    }

    if ($("dateTo")) {
      $("dateTo").disabled = !custom;
    }

    updateDateLimits();
  });

  $("applyFiltersBtn")?.addEventListener("click", () => {
    if ($("statsRange")?.value === "custom") {
      const from = $("dateFrom")?.value;
      const to = $("dateTo")?.value;
      if (!from || !to) {
        const list = $("salesList");
        if (list) {
          list.replaceChildren();
          const msg = document.createElement("div");
          msg.className = "empty";
          msg.textContent = "Choisissez une date début et une date fin";
          list.appendChild(msg);
        }
        return;
      }
    }
    loadData();
  });

  $("clientSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("applyFiltersBtn")?.click();
    }
  });

  $("resetBtn")?.addEventListener("click", resetFilters);

  const custom = $("statsRange")?.value === "custom";
  if ($("dateFrom")) {
    $("dateFrom").disabled = !custom;
  }
  if ($("dateTo")) {
    $("dateTo").disabled = !custom;
  }
}

document.addEventListener("DOMContentLoaded", () => {
onAuthStateChanged(auth, async user => {
    if (!user) {
    location.replace("404.html");
    return;
  }

    try {
  await checkAccess(user.uid);
    } catch (error) {
      console.error(error);
      location.replace("404.html");
    }
  });
});
