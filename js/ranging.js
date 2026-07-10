import {
  db,
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  writeLog
} from "./firebase.js";

import { getAuth, onAuthStateChanged } from "./auth.js";
import { getAppConfig } from "./appConfig.js";
import { bindActionButton } from "./utils/buttonManager.js";

const MAX_ITEMS = 10;

const containers = {
  mostSold: document.getElementById("mostSoldProducts"),
  profit: document.getElementById("profitProducts"),
  ca: document.getElementById("caProducts"),
  leastSold: document.getElementById("leastSoldProducts"),
  lowStock: document.getElementById("lowStockProducts")
};

const periodFilter = document.getElementById("periodFilter");
const applyPeriodBtn = document.getElementById("applyPeriodBtn");
const statusMsg = document.getElementById("statusMsg");

const kpiEls = {
  salesValue: document.getElementById("kpiSalesValue"),
  salesName: document.getElementById("kpiSalesName"),
  profitValue: document.getElementById("kpiProfitValue"),
  profitName: document.getElementById("kpiProfitName"),
  stockValue: document.getElementById("kpiStockValue"),
  stockName: document.getElementById("kpiStockName")
};

const auth = getAuth();
let currencySymbol = "$";
let currentUserId = null;
let lowStockLimit = 5;

async function checkUser(uid) {
  if (!uid) throw new Error("UID invalide");

  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) throw new Error("Utilisateur introuvable");

  const userData = userSnap.data();
  if (!userData?.isActive) throw new Error("Compte désactivé");
  if (userData.role !== "admin") throw new Error("Accès refusé");

  return userData;
}

function sanitizeText(value, max = 80) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatMoney(value) {
  return `${currencySymbol}${round2(value).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

function formatPercent(value) {
  return `${round2(value).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  })} %`;
}

function setStatus(text) {
  if (statusMsg) statusMsg.textContent = text || "";
}

function showEmpty(container, text) {
  if (!container) return;
  container.replaceChildren();

  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = text;
  container.appendChild(div);
}

function getPeriodStart(period) {
  const now = new Date();
  if (period === "7d") return new Date(now.getTime() - 7 * 86400000);
  if (period === "30d") return new Date(now.getTime() - 30 * 86400000);
  return null;
}

function getPeriodLabel(period) {
  if (period === "7d") return "7 derniers jours";
  if (period === "30d") return "30 derniers jours";
  return "Toute la période";
}

function getStockThreshold(product) {
  const alert = Number(product?.stock_alert);
  if (Number.isFinite(alert) && alert > 0) return alert;
  return lowStockLimit;
}

function getStockLevel(stockCurrent, threshold) {
  if (stockCurrent <= 0) return "critical";
  if (stockCurrent <= threshold) return "low";
  return "ok";
}

function getStockLabel(level) {
  if (level === "critical") return "Stock critique";
  if (level === "low") return "Stock faible";
  return "Stock OK";
}

/**
 * Agrège sale_items pour les ventes actives uniquement.
 * CA = Σ (price × quantity)
 * Bénéfice = Σ profit (champ Firestore, déjà (prix vente − prix achat) × qté)
 */
function buildSalesRanking(productsMap, saleItems, activeSaleIds) {
  const statsMap = new Map();
  let totalQuantity = 0;

  saleItems.forEach(item => {
    const saleId = item.saleId;
    const productId = item.productId;

    if (!productId) return;
    if (saleId && activeSaleIds && !activeSaleIds.has(saleId)) return;

    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.price) || 0;

    if (quantity <= 0) return;

    const lineRevenue = round2(unitPrice * quantity);
    const lineProfit = Number.isFinite(Number(item.profit))
      ? round2(Number(item.profit))
      : 0;

    totalQuantity += quantity;

    if (!statsMap.has(productId)) {
      statsMap.set(productId, {
        productId,
        quantity: 0,
        revenue: 0,
        profit: 0
      });
    }

    const entry = statsMap.get(productId);
    entry.quantity += quantity;
    entry.revenue = round2(entry.revenue + lineRevenue);
    entry.profit = round2(entry.profit + lineProfit);
  });

  const ranking = [];

  statsMap.forEach((stats, productId) => {
    const product = productsMap.get(productId);
    if (!product || product.isActive === false) return;

    const stockCurrent = Number(product.stock_current) || 0;
    const stockThreshold = getStockThreshold(product);
    const stockLevel = getStockLevel(stockCurrent, stockThreshold);

    const marginRate = stats.revenue > 0
      ? round2((stats.profit / stats.revenue) * 100)
      : 0;

    const profitPerUnit = stats.quantity > 0
      ? round2(stats.profit / stats.quantity)
      : 0;

    const avgPrice = stats.quantity > 0
      ? round2(stats.revenue / stats.quantity)
      : 0;

    const salesShare = totalQuantity > 0
      ? round2((stats.quantity / totalQuantity) * 100)
      : 0;

    ranking.push({
      productId,
      name: sanitizeText(product.name || "Produit inconnu"),
      quantity: stats.quantity,
      revenue: stats.revenue,
      profit: stats.profit,
      marginRate,
      profitPerUnit,
      avgPrice,
      salesShare,
      stockCurrent,
      stockThreshold,
      stockLevel
    });
  });

  return { ranking, totalQuantity };
}

function buildLowStockList(productsMap, salesByProductId) {
  const list = [];

  productsMap.forEach((product, productId) => {
    if (product.isActive === false) return;

    const stockCurrent = Number(product.stock_current) || 0;
    const stockThreshold = getStockThreshold(product);
    const stockLevel = getStockLevel(stockCurrent, stockThreshold);

    if (stockLevel === "ok") return;

    const sales = salesByProductId.get(productId);

    list.push({
      productId,
      name: sanitizeText(product.name || "Produit inconnu"),
      stockCurrent,
      stockThreshold,
      stockLevel,
      quantity: sales?.quantity || 0,
      revenue: sales?.revenue || 0,
      profit: sales?.profit || 0,
      marginRate: sales?.marginRate || 0,
      avgPrice: sales?.avgPrice || 0,
      salesShare: sales?.salesShare || 0,
      profitPerUnit: sales?.profitPerUnit || 0
    });
  });

  return list.sort((a, b) => {
    if (a.stockCurrent !== b.stockCurrent) return a.stockCurrent - b.stockCurrent;
    return a.stockThreshold - b.stockThreshold;
  });
}

function sortByQuantityDesc(items) {
  return [...items].sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    return b.revenue - a.revenue;
  });
}

function sortByQuantityAsc(items) {
  return [...items].sort((a, b) => {
    if (a.quantity !== b.quantity) return a.quantity - b.quantity;
    return a.revenue - b.revenue;
  });
}

function sortByProfitMargin(items) {
  return [...items]
    .filter(item => item.revenue > 0)
    .sort((a, b) => {
      if (b.marginRate !== a.marginRate) return b.marginRate - a.marginRate;
      if (b.profit !== a.profit) return b.profit - a.profit;
      return b.quantity - a.quantity;
    });
}

function sortByRevenue(items) {
  return [...items].sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    return b.quantity - a.quantity;
  });
}

function createProgressBar(percent, type) {
  const progress = document.createElement("div");
  progress.className = "progress";

  const fill = document.createElement("div");
  fill.className = `progress-fill ${type}`;
  fill.style.width = `${Math.min(Math.max(Number(percent) || 0, 0), 100)}%`;

  progress.appendChild(fill);
  return progress;
}

function createStatLine(label, value) {
  const line = document.createElement("div");
  line.className = "stat-line";

  const l = document.createElement("span");
  l.textContent = label;

  const v = document.createElement("strong");
  v.textContent = value;

  line.append(l, v);
  return line;
}

function createCard(item, options = {}) {
  const {
    type = "gold",
    badgeType = "best",
    position = 1,
    lines = [],
    percent = 0,
    progressType = type,
    stockFlag = null
  } = options;

  const card = document.createElement("article");
  card.className = `rank-card ${type}`;

  const top = document.createElement("div");
  top.className = "card-top";

  const nameWrap = document.createElement("div");
  nameWrap.style.flex = "1";
  nameWrap.style.minWidth = "0";

  const name = document.createElement("div");
  name.className = "product-name";
  name.textContent = item.name;

  nameWrap.appendChild(name);

  if (stockFlag) {
    const flag = document.createElement("span");
    flag.className = `stock-flag ${stockFlag}`;
    flag.textContent = stockFlag === "critical" ? "Stock critique" : "Stock faible";
    nameWrap.appendChild(flag);
  }

  const badge = document.createElement("div");
  badge.className = `rank-badge ${badgeType}`;
  badge.textContent = `#${position}`;

  top.append(nameWrap, badge);

  const stats = document.createElement("div");
  stats.className = "card-stats";
  lines.forEach(([label, value]) => {
    stats.appendChild(createStatLine(label, value));
  });

  card.append(top, stats);

  if (percent > 0) {
    card.appendChild(createProgressBar(percent, progressType));
  }

  return card;
}

function renderList(container, items, builder, emptyText) {
  if (!container) return;

  if (!items.length) {
    showEmpty(container, emptyText);
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    fragment.appendChild(builder(item, index));
  });
  container.replaceChildren(fragment);
}

function updateKpi(valueEl, nameEl, valueText, nameText) {
  if (valueEl) valueEl.textContent = valueText;
  if (nameEl) nameEl.textContent = nameText;
}

function renderRanking(ranking, lowStockList, period) {
  const hasSales = ranking.length > 0;
  const hasLowStock = lowStockList.length > 0;

  if (!hasSales && !hasLowStock) {
    Object.values(containers).forEach(container => {
      showEmpty(container, "Aucune donnée sur cette période");
    });

    updateKpi(kpiEls.salesValue, kpiEls.salesName, "—", "Aucune donnée");
    updateKpi(kpiEls.profitValue, kpiEls.profitName, "—", "Aucune donnée");
    updateKpi(kpiEls.stockValue, kpiEls.stockName, "—", "Aucune donnée");

    setStatus(`Période : ${getPeriodLabel(period)} — aucune vente ni alerte stock`);
    return;
  }

  const byQuantityDesc = sortByQuantityDesc(ranking);
  const byQuantityAsc = sortByQuantityAsc(ranking);
  const byProfitMargin = sortByProfitMargin(ranking);
  const byRevenue = sortByRevenue(ranking);

  const maxQty = byQuantityDesc[0]?.quantity || 1;
  const maxProfit = byProfitMargin[0]?.profit || 1;
  const maxRevenue = byRevenue[0]?.revenue || 1;

  if (hasSales) {
    const topSold = byQuantityDesc[0];
    updateKpi(
      kpiEls.salesValue,
      kpiEls.salesName,
      `${topSold.quantity} unités`,
      topSold.name
    );

    const topMargin = byProfitMargin[0];
    updateKpi(
      kpiEls.profitValue,
      kpiEls.profitName,
      formatPercent(topMargin.marginRate),
      `${topMargin.name} (${formatMoney(topMargin.profit)})`
    );
  } else {
    updateKpi(kpiEls.salesValue, kpiEls.salesName, "—", "Aucune vente");
    updateKpi(kpiEls.profitValue, kpiEls.profitName, "—", "Aucune vente");
  }

  if (hasLowStock) {
    const critical = lowStockList[0];
    updateKpi(
      kpiEls.stockValue,
      kpiEls.stockName,
      `${critical.stockCurrent} restant(s)`,
      critical.name
    );
  } else {
    updateKpi(kpiEls.stockValue, kpiEls.stockName, "—", "Stock suffisant");
  }

  renderList(
    containers.mostSold,
    byQuantityDesc.slice(0, MAX_ITEMS),
    (item, index) => createCard(item, {
      type: "gold",
      badgeType: "best",
      position: index + 1,
      percent: maxQty ? (item.quantity / maxQty) * 100 : 0,
      progressType: "gold",
      stockFlag: item.stockLevel !== "ok" ? item.stockLevel : null,
      lines: [
        ["Quantité vendue", String(item.quantity)],
        ["CA", formatMoney(item.revenue)],
        ["Bénéfice", formatMoney(item.profit)],
        ["Marge", formatPercent(item.marginRate)],
        ["Stock actuel", String(item.stockCurrent)],
        ["Part des ventes", formatPercent(item.salesShare)]
      ]
    }),
    "Aucune vente sur cette période"
  );

  renderList(
    containers.profit,
    byProfitMargin.slice(0, MAX_ITEMS),
    (item, index) => createCard(item, {
      type: "green",
      badgeType: "green",
      position: index + 1,
      percent: maxProfit ? (item.profit / maxProfit) * 100 : 0,
      progressType: "green",
      stockFlag: item.stockLevel !== "ok" ? item.stockLevel : null,
      lines: [
        ["Marge", formatPercent(item.marginRate)],
        ["Bénéfice total", formatMoney(item.profit)],
        ["Bénéfice / unité", formatMoney(item.profitPerUnit)],
        ["CA", formatMoney(item.revenue)],
        ["Quantité", String(item.quantity)],
        ["Stock", String(item.stockCurrent)]
      ]
    }),
    "Aucun produit avec marge calculable"
  );

  renderList(
    containers.ca,
    byRevenue.slice(0, MAX_ITEMS),
    (item, index) => createCard(item, {
      type: "blue",
      badgeType: "blue",
      position: index + 1,
      percent: maxRevenue ? (item.revenue / maxRevenue) * 100 : 0,
      progressType: "blue",
      stockFlag: item.stockLevel !== "ok" ? item.stockLevel : null,
      lines: [
        ["CA", formatMoney(item.revenue)],
        ["Prix moyen", formatMoney(item.avgPrice)],
        ["Quantité", String(item.quantity)],
        ["Bénéfice", formatMoney(item.profit)],
        ["Marge", formatPercent(item.marginRate)],
        ["Stock", String(item.stockCurrent)]
      ]
    }),
    "Aucun produit avec CA"
  );

  const leastSoldPool = byQuantityAsc.filter(item => item.quantity > 0);
  const mostSoldIds = new Set(byQuantityDesc.slice(0, MAX_ITEMS).map(i => i.productId));

  renderList(
    containers.leastSold,
    leastSoldPool
      .filter(item => !mostSoldIds.has(item.productId))
      .slice(0, MAX_ITEMS),
    (item, index) => createCard(item, {
      type: "orange",
      badgeType: "orange",
      position: index + 1,
      percent: maxQty ? (item.quantity / maxQty) * 100 : 0,
      progressType: "orange",
      stockFlag: item.stockLevel !== "ok" ? item.stockLevel : null,
      lines: [
        ["Quantité", String(item.quantity)],
        ["CA", formatMoney(item.revenue)],
        ["Bénéfice", formatMoney(item.profit)],
        ["Marge", formatPercent(item.marginRate)],
        ["Stock", String(item.stockCurrent)],
        ["Seuil alerte", String(item.stockThreshold)]
      ]
    }),
    "Aucun produit peu vendu distinct"
  );

  renderList(
    containers.lowStock,
    lowStockList.slice(0, MAX_ITEMS),
    (item, index) => createCard(item, {
      type: item.stockLevel === "critical" ? "stock-critical" : "stock-low",
      badgeType: item.stockLevel === "critical" ? "stock-critical" : "stock-low",
      position: index + 1,
      percent: item.stockThreshold > 0
        ? Math.min((item.stockCurrent / item.stockThreshold) * 100, 100)
        : 0,
      progressType: "red",
      stockFlag: item.stockLevel,
      lines: [
        ["Stock actuel", String(item.stockCurrent)],
        ["Seuil alerte", String(item.stockThreshold)],
        ["Niveau", getStockLabel(item.stockLevel)],
        ["Ventes période", String(item.quantity)],
        ["CA période", formatMoney(item.revenue)],
        ["Bénéfice période", formatMoney(item.profit)]
      ]
    }),
    "Aucun produit en stock faible ou critique"
  );

  setStatus(
    `Période : ${getPeriodLabel(period)} — ${ranking.length} produit(s) vendu(s), ${lowStockList.length} alerte(s) stock`
  );
}

async function loadRanking() {
  const period = periodFilter?.value || "30d";
  const periodStart = getPeriodStart(period);

  Object.values(containers).forEach(container => {
    if (container) container.replaceChildren();
  });

  setStatus("Chargement...");

  const salesQuery = periodStart
    ? query(collection(db, "sales"), where("createdAt", ">=", periodStart))
    : collection(db, "sales");

  const saleItemsQuery = periodStart
    ? query(collection(db, "sale_items"), where("createdAt", ">=", periodStart))
    : collection(db, "sale_items");

  const [salesSnap, saleItemsSnap, productsSnap] = await Promise.all([
    getDocs(salesQuery),
    getDocs(saleItemsQuery),
    getDocs(collection(db, "products"))
  ]);

  const activeSaleIds = new Set();
  salesSnap.forEach(docSnap => {
    const data = docSnap.data();
    if (data?.status !== "cancelled") {
      activeSaleIds.add(docSnap.id);
    }
  });

  const productsMap = new Map();
  productsSnap.forEach(docSnap => {
    const data = docSnap.data();
    if (data?.isActive !== false) {
      productsMap.set(docSnap.id, data);
    }
  });

  const saleItems = saleItemsSnap.docs.map(docSnap => docSnap.data());
  const { ranking } = buildSalesRanking(productsMap, saleItems, activeSaleIds);

  const salesByProductId = new Map(ranking.map(item => [item.productId, item]));
  const lowStockList = buildLowStockList(productsMap, salesByProductId);

  renderRanking(ranking, lowStockList, period);

  if (currentUserId) {
    await writeLog({
      action: "view_ranking",
      userId: currentUserId,
      period,
      productsCount: ranking.length,
      lowStockCount: lowStockList.length
    });
  }
}

bindActionButton(applyPeriodBtn, async () => {
  try {
    await loadRanking();
  } catch (err) {
    console.error(err);
    setStatus(err?.message || "Erreur de chargement");
  }
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    alert("Connexion requise");
    window.location.replace("login.html");
    return;
  }

  try {
    await checkUser(user.uid);
    currentUserId = user.uid;

    const config = await getAppConfig();
    currencySymbol = config?.currencySymbol || "$";
    lowStockLimit = Number(config?.lowStockLimit) || 5;

    await loadRanking();
  } catch (err) {
    console.error(err);
    alert(err?.message || "Erreur");
  }
});
