import {
  db,
  doc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
  orderBy
} from "./firebase.js";

import { auth, onAuthStateChanged } from "./auth.js";
import { getAppConfig } from "./appConfig.js";

const $ = id => document.getElementById(id);

const state = {
  sales: [],
  saleItems: [],
  products: [],
  users: [],
  debts: [],
  rows: [],
  currency: "FC"
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
  } catch (error) {
    console.warn("[vendus] loadAppCurrency", error);
    state.currency = "FC";
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
    clientName: ($("clientSearch")?.value || "").trim()
  };
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

  const [productsSnap, usersSnap, debtsSnap] = await Promise.all([
    getDocs(collection(db, "products")),
    getDocs(collection(db, "users")),
    getDocs(collection(db, "debts"))
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

    state.products
      .slice()
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .forEach(product => {
        const option = document.createElement("option");
      option.value = product.id;
        option.textContent = product.name || "Produit";
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

    const [salesSnap, saleItemsSnap] = await Promise.all([
      getDocs(salesQuery),
      getDocs(saleItemsQuery)
    ]);

    state.sales = salesSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    const saleIds = new Set(state.sales.map(s => s.id));

    state.saleItems = saleItemsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(item => saleIds.has(item.saleId));

    buildRows();
    render();
  } catch (error) {
    console.error("[vendus] loadData", error);
    state.sales = [];
    state.saleItems = [];
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

  const saleMap = new Map(state.sales.map(s => [s.id, s]));

  state.saleItems.forEach(item => {
    const sale = saleMap.get(item.saleId);
    if (!sale) return;

    const product = state.products.find(p => p.id === item.productId);

    const seller = state.users.find(
      u =>
        u.userId === sale.sellerId ||
        u.uid === sale.sellerId ||
        u.id === sale.sellerId
    );

    const debt = state.debts.find(e => e.relatedSaleId === sale.id);

    state.rows.push({
      saleId: sale.id,
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
      createdAt: getDate(sale.createdAt)
    });
  });

  state.rows.sort((a, b) => {
    const ta = a.createdAt?.getTime() || 0;
    const tb = b.createdAt?.getTime() || 0;
    return tb - ta;
  });

  const { clientName } = getFilterValues();
  if (clientName) {
    const term = clientName.toLowerCase();
    state.rows = state.rows.filter(row =>
      (row.clientName || "").toLowerCase().includes(term)
    );
  }
}

function renderKpis(rows) {
  const activeRows = rows.filter(row => row.saleStatus !== "cancelled");

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
  activeRows.forEach(row => {
    if (row.paymentStatus === "partial" && row.amountRemaining > 0) {
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
  $("resultCount").textContent = String(rows.length);
}

function createSaleCard(row) {
  const card = document.createElement("div");
  card.className = "sale-card";

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

  const clientMeta = document.createElement("div");
  clientMeta.className = "sale-meta";
  clientMeta.textContent = `Client : ${row.clientName || "-"}`;

  const sellerMeta = document.createElement("div");
  sellerMeta.className = "sale-meta";
  sellerMeta.textContent = `Vendeur : ${row.sellerName}`;

  const qtyMeta = document.createElement("div");
  qtyMeta.className = "sale-meta";
  qtyMeta.textContent = `Qté : ${row.quantity} × ${formatMoney(row.price)}`;

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

  if (row.saleStatus === "cancelled") {
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
  card.appendChild(clientMeta);
  card.appendChild(sellerMeta);
  card.appendChild(qtyMeta);
  card.appendChild(dateMeta);
  card.appendChild(badge);

  return card;
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
  rows.forEach(row => {
    fragment.appendChild(createSaleCard(row));
  });

  container.appendChild(fragment);
}

function resetFilters() {
  $("productFilter").value = "";
  $("paymentFilter").value = "";
  $("statusFilter").value = "";
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
