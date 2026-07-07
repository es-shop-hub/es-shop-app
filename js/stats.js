// stats.js v2
import "./firebase.js";

import {
  db,
  doc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from "./firebase.js";
import { auth, onAuthStateChanged } from "./auth.js";
import { getAppConfig } from "./appConfig.js";
import { bindActionButton } from "./utils/buttonManager.js";

export const $ = id => document.getElementById(id);
export const n = v => Number(v) || 0;

const STATS_LIST_LIMIT = 10;

let chartApi = null;

export const state = {
  saleItems: [],
  purchases: [],
  purchaseItems: [],
  recentPurchases: [],
  sales: [],
  expenses: [],
  debts: [],
  recentDebts: [],
  losses: [],
  products: [],
  users: [],
  stockMovements: [],
  recentStockMovements: [],
  currency: "$",
  config: null,
  chartReady: false
};

let debugTimeout = null;

function updateDateLimits() {
  const dateFrom = $("dateFrom");
  const dateTo = $("dateTo");

  if (!dateFrom || !dateTo) return;

  const today = new Date().toISOString().split("T")[0];

  dateFrom.max = today;
  dateTo.max = today;

  if (dateFrom.value) {
    dateTo.min = dateFrom.value;
  } else {
    dateTo.removeAttribute("min");
  }

  if (
    dateFrom.value &&
    dateTo.value &&
    dateTo.value < dateFrom.value
  ) {
    dateTo.value = dateFrom.value;
  }
}

export function debug(msg) {
  const box = $("debug");
  if (!box) return;

  box.textContent = msg;
  clearTimeout(debugTimeout);
  debugTimeout = setTimeout(() => {
    box.textContent = "";
  }, 5000);
}

function bindEvents() {
  $("dateFrom")?.addEventListener("change", updateDateLimits);
  $("dateTo")?.addEventListener("change", updateDateLimits);
  updateDateLimits();

  $("statsRange")?.addEventListener("change", () => {
    const custom = $("statsRange").value === "custom";

    if ($("dateFrom")) {
      $("dateFrom").disabled = !custom;
    }

    if ($("dateTo")) {
      $("dateTo").disabled = !custom;
    }

    updateDateLimits();
  });

  bindActionButton($("applyFiltersBtn"), async () => {
    await loadData();
  });

  bindActionButton($("refreshBtn"), async () => {
    await loadData();
  });

  $("statsRange")?.dispatchEvent(new Event("change"));
}

export function getDate(v) {
  if (!v) return null;

  if (typeof v?.toDate === "function") return v.toDate();

  if (v?.seconds) return new Date(v.seconds * 1000);

  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function buildSalesQuery() {
  const seller = $("sellerFilter")?.value || "all";
  const { start, end } = buildDateRange();
  const constraints = [];

  if (start) {
    constraints.push(where("createdAt", ">=", start));
  }

  if (end) {
    constraints.push(where("createdAt", "<=", end));
  }

  if (seller !== "all") {
    constraints.push(where("sellerId", "==", seller));
  }

  constraints.push(orderBy("createdAt", "desc"));

  return query(collection(db, "sales"), ...constraints);
}

function buildDateRange() {
  const range = $("statsRange")?.value || "30days";
  const now = new Date();

  let start = null;
  let end = new Date();

  switch (range) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;

    case "yesterday":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      break;

    case "7days":
      start = new Date(now.getTime() - 7 * 86400000);
      break;

    case "30days":
      start = new Date(now.getTime() - 30 * 86400000);
      break;

    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;

    case "year":
      start = new Date(now.getFullYear(), 0, 1);
      break;

    case "custom": {
      const from = $("dateFrom")?.value;
      const to = $("dateTo")?.value;

      if (from && to) {
        start = new Date(from);
        end = new Date(to);
        end.setHours(23, 59, 59, 999);
      }
      break;
    }
  }

  return { start, end };
}

function buildCollectionQuery(collectionName) {
  const { start, end } = buildDateRange();
  const constraints = [];

  if (start) {
    constraints.push(where("createdAt", ">=", start));
  }

  if (end) {
    constraints.push(where("createdAt", "<=", end));
  }

  constraints.push(orderBy("createdAt", "desc"));

  return query(collection(db, collectionName), ...constraints);
}

function buildRecentListQuery(collectionName) {
  const { start, end } = buildDateRange();
  const constraints = [];

  if (start) {
    constraints.push(where("createdAt", ">=", start));
  }

  if (end) {
    constraints.push(where("createdAt", "<=", end));
  }

  constraints.push(orderBy("createdAt", "desc"));
  constraints.push(limit(STATS_LIST_LIMIT));

  return query(collection(db, collectionName), ...constraints);
}

function buildOpenDebtsQuery(listOnly = false) {
  const constraints = [
    where("amount_remaining", ">", 0),
    orderBy("amount_remaining", "desc")
  ];

  if (listOnly) {
    constraints.push(limit(STATS_LIST_LIMIT));
  }

  return query(collection(db, "debts"), ...constraints);
}

export function formatMoney(v) {
  return `${Math.round(n(v)).toLocaleString()} ${state.currency}`;
}

export function clearNode(id) {
  const el = $(id);
  if (el) el.replaceChildren();
}

async function loadData() {
  debug("Chargement...");

  try {
    const select = $("sellerFilter");
    const currentValue = select?.value || "all";

    state.config = await getAppConfig();
    state.currency = state.config?.currencySymbol || "$";

    const salesQuery = buildSalesQuery();
    const expensesQuery = buildCollectionQuery("expenses");
    const lossesQuery = buildCollectionQuery("losses");
    const purchasesQuery = buildCollectionQuery("purchases");
    const recentPurchasesQuery = buildRecentListQuery("purchases");
    const stockQuery = buildCollectionQuery("stock_movements");
    const recentStockQuery = buildRecentListQuery("stock_movements");
    const openDebtsQuery = buildOpenDebtsQuery(false);
    const recentDebtsQuery = buildOpenDebtsQuery(true);

    const [
      salesSnap,
      expensesSnap,
      debtsSnap,
      recentDebtsSnap,
      lossesSnap,
      productsSnap,
      usersSnap,
      stockSnap,
      recentStockSnap,
      saleItemsSnap,
      purchasesSnap,
      recentPurchasesSnap,
      purchaseItemsSnap
    ] = await Promise.all([
      getDocs(salesQuery),
      getDocs(expensesQuery),
      getDocs(openDebtsQuery),
      getDocs(recentDebtsQuery),
      getDocs(lossesQuery),
      getDocs(collection(db, "products")),
      getDocs(collection(db, "users")),
      getDocs(stockQuery),
      getDocs(recentStockQuery),
      getDocs(collection(db, "sale_items")),
      getDocs(purchasesQuery),
      getDocs(recentPurchasesQuery),
      getDocs(collection(db, "purchase_items"))
    ]);

    state.sales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.expenses = expensesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.debts = debtsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.recentDebts = recentDebtsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.losses = lossesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.stockMovements = stockSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.recentStockMovements = recentStockSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
    state.saleItems = saleItemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.purchases = purchasesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.recentPurchases = recentPurchasesSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));
    state.purchaseItems = purchaseItemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    populateSellerFilter();

    if (select) {
      select.value = currentValue;
    }

    const { render } = await import("./render.js");
    await render(chartApi);
    debug("OK");
  } catch (e) {
    console.error(e);
    debug(e.message);
  }
}

function populateSellerFilter() {
  const select = $("sellerFilter");
  if (!select) return;

  const currentValue = select.value || "all";

  while (select.children.length > 1) {
    select.removeChild(select.lastChild);
  }

  const sellers = state.users.filter(u => {
    const role = String(u.role || "").trim().toLowerCase();
    return role === "seller";
  });

  sellers.forEach(u => {
    const opt = document.createElement("option");
    opt.value = u.userId || u.uid || u.id;
    opt.textContent = u.name || "Vendeur";
    select.appendChild(opt);
  });

  const exists = sellers.some(
    u => (u.userId || u.uid || u.id) === currentValue
  );

  select.value = exists ? currentValue : "all";
}

export async function loadPreviousPeriodData() {
  const range = $("statsRange")?.value || "30days";
  const now = new Date();

  let start;
  let end;

  switch (range) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      break;

    case "yesterday":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 23, 59, 59, 999);
      break;

    case "7days":
      end = new Date(now.getTime() - 7 * 86400000);
      start = new Date(end.getTime() - 7 * 86400000);
      break;

    case "30days":
      end = new Date(now.getTime() - 30 * 86400000);
      start = new Date(end.getTime() - 30 * 86400000);
      break;

    case "month":
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      break;

    case "year":
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
      break;

    case "custom":
      return { sales: [], expenses: [], losses: [] };

    default:
      return { sales: [], expenses: [], losses: [] };
  }

  const seller = $("sellerFilter")?.value || "all";

  const salesConstraints = [
    where("createdAt", ">=", start),
    where("createdAt", "<=", end)
  ];

  if (seller !== "all") {
    salesConstraints.push(where("sellerId", "==", seller));
  }

  salesConstraints.push(orderBy("createdAt", "desc"));

  const salesSnap = await getDocs(
    query(collection(db, "sales"), ...salesConstraints)
  );

  const expensesSnap = await getDocs(
    query(
      collection(db, "expenses"),
      where("createdAt", ">=", start),
      where("createdAt", "<=", end),
      orderBy("createdAt", "desc")
    )
  );

  const lossesSnap = await getDocs(
    query(
      collection(db, "losses"),
      where("createdAt", ">=", start),
      where("createdAt", "<=", end),
      orderBy("createdAt", "desc")
    )
  );

  return {
    sales: salesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    expenses: expensesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    losses: lossesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  };
}

function formatFilterDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString("fr-FR");
}

function getStatsFilterLabel() {
  const range = $("statsRange")?.value || "30days";
  const { start, end } = buildDateRange();
  const seller = $("sellerFilter")?.value || "all";

  const rangeLabels = {
    today: "Aujourd'hui",
    yesterday: "Hier",
    "7days": "7 derniers jours",
    "30days": "30 derniers jours",
    month: "Ce mois",
    year: "Cette année",
    custom: "Personnalisé"
  };

  let periodLabel = rangeLabels[range] || range;

  if (start && end) {
    periodLabel += ` (${formatFilterDate(start)} → ${formatFilterDate(end)})`;
  }

  let sellerLabel = "Tous les vendeurs";
  if (seller !== "all") {
    const user = state.users.find(u =>
      (u.userId || u.uid || u.id) === seller
    );
    sellerLabel = user?.name || seller;
  }

  return {
    period: periodLabel,
    seller: sellerLabel,
    summary: `Période : ${periodLabel} • Vendeur : ${sellerLabel}`
  };
}

function buildPdfPayload() {
  const sales = state.sales;
  const expenses = state.expenses;
  const debts = state.debts;
  const losses = state.losses;
  const products = state.products || [];
  const stockMovements = state.stockMovements || [];
  const saleItems = state.saleItems || [];

  const productMap = {};

  products.forEach(product => {
    productMap[product.id] = product;
  });

  const openDebts = debts.filter(debt =>
    debt.status !== "paid" &&
    n(debt.amount_remaining) > 0
  );

  const activeLosses = losses.filter(loss =>
    loss.isSystemCorrection !== true &&
    loss.status !== "cancelled"
  );

  const totalSales = sales.reduce(
    (sum, sale) => sum + n(sale.total_amount),
    0
  );

  const totalProfit = sales.reduce(
    (sum, sale) => sum + n(sale.total_profit),
    0
  );

  const totalExpenses = expenses.reduce(
    (sum, item) => sum + n(item.amount),
    0
  );

  const totalLosses = activeLosses.reduce(
    (sum, item) => sum + n(item.amount),
    0
  );

  const totalDebtRemaining = openDebts.reduce(
    (sum, item) => sum + n(item.amount_remaining),
    0
  );

  const netProfit = totalProfit - totalExpenses - totalLosses;

  const salesWithProducts = sales.map(sale => {
    const items = saleItems
      .filter(item =>
        item.saleId === sale.id ||
        item.sale_id === sale.id
      )
      .map(item => {
        const productId = item.productId || item.product_id;
        const product = productMap[productId];

        return {
          productId,
          productName: product?.name || "Produit inconnu",
          quantity: n(item.quantity),
          price: n(item.price),
          profit: n(item.profit)
        };
      });

    return {
      id: sale.id,
      sellerId: sale.sellerId,
      amount: n(sale.total_amount),
      profit: n(sale.total_profit),
      status: sale.status,
      payment_status: sale.payment_status,
      amount_paid: n(sale.amount_paid),
      amount_remaining: n(sale.amount_remaining),
      createdAt: sale.createdAt,
      items
    };
  });

  const filterInfo = getStatsFilterLabel();

  return {
    meta: {
      shopName: state.config?.shopName || "StockFlow",
      shopAddress: state.config?.shopAddress || "",
      shopPhone: state.config?.shopPhone || "",
      currency: state.currency,
      currencySymbol: state.config?.currencySymbol || state.currency || "$",
      logoUrl: state.config?.logoUrl || "shopLogo.png",
      generatedAt: new Date().toISOString(),
      filterPeriod: filterInfo.period,
      filterSeller: filterInfo.seller,
      filterSummary: filterInfo.summary
    },
    kpis: {
      totalSales,
      totalProfit,
      totalExpenses,
      totalLosses,
      totalDebtRemaining,
      netProfit
    },
    sales: salesWithProducts,
    debts: debts.map(debt => ({
      id: debt.id,
      name: debt.name || "",
      phone: debt.phone || "",
      total: n(debt.amount_total),
      paid: n(debt.amount_paid),
      remaining: n(debt.amount_remaining),
      status: debt.status,
      relatedSaleId: debt.relatedSaleId
    })),
    losses: losses.map(loss => ({
      id: loss.id,
      amount: n(loss.amount),
      reason: loss.reason || "",
      category: loss.category || ""
    })),
    products: products.map(product => ({
      id: product.id,
      name: product.name || "",
      stock: n(product.stock_current),
      alert: n(product.stock_alert)
    })),
    stockMovements: stockMovements.slice(-300)
  };
}

let initialized = false;

async function setupChartModule() {
  try {
    chartApi = await import("./chart.js");
    state.chartReady = false;
    chartApi.initChart();
  } catch (error) {
    console.error("Chart module:", error);
    debug("Graphique indisponible");
  }
}

async function setupPdfModule() {
  try {
    const pdf = await import("./download.js");
    pdf.initPdfExport(buildPdfPayload);
    pdf.initPdfExportButton();
  } catch (error) {
    console.warn("PDF module:", error);
    const btn = $("pdfBtn");
    if (btn) {
      btn.disabled = true;
      btn.title = "Export PDF indisponible";
    }
  }
}

async function initializeStats(user) {
  if (initialized) {
    return;
  }

  initialized = true;

  try {
    const userSnap = await getDoc(
      doc(db, "users", user.uid)
    );

    if (!userSnap.exists()) {
      location.replace("404.html");
      return;
    }

    const currentUser = { id: userSnap.id, ...userSnap.data() };

    if (currentUser.role === "seller") {
      location.replace("index.html");
      return;
    }

    if (currentUser.role !== "admin") {
      location.replace("404.html");
      return;
    }

    await setupChartModule();

    bindEvents();

    await setupPdfModule();

    await loadData();
  } catch (error) {
    console.error(error);
    initialized = false;
    debug(error?.message || "Erreur initialisation stats");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, user => {
    if (!user) {
      location.replace("login.html");
      return;
    }

    initializeStats(user);
  });
});
