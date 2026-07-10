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
  ca: document.getElementById("caProducts"),
  profit: document.getElementById("profitProducts"),
  lowQty: document.getElementById("lowQtyProducts"),
  top: document.getElementById("topProducts"),
  low: document.getElementById("lowProducts")
};

const periodFilter = document.getElementById("periodFilter");
const applyPeriodBtn = document.getElementById("applyPeriodBtn");
const statusMsg = document.getElementById("statusMsg");

const kpiEls = {
  caValue: document.getElementById("kpiCaValue"),
  caName: document.getElementById("kpiCaName"),
  profitValue: document.getElementById("kpiProfitValue"),
  profitName: document.getElementById("kpiProfitName"),
  lowQtyValue: document.getElementById("kpiLowQtyValue"),
  lowQtyName: document.getElementById("kpiLowQtyName")
};

const auth = getAuth();
let currencySymbol = "$";
let currentUserId = null;

async function checkUser(uid) {
  if (!uid) throw new Error("UID invalide");

  const userSnap = await getDoc(doc(db, "users", uid));

  if (!userSnap.exists()) {
    throw new Error("Utilisateur introuvable");
  }

  const userData = userSnap.data();

  if (!userData?.isActive) {
    throw new Error("Compte désactivé");
  }

  if (userData.role !== "admin") {
    throw new Error("Accès refusé");
  }

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

  if (period === "7d") {
    return new Date(now.getTime() - 7 * 86400000);
  }

  if (period === "30d") {
    return new Date(now.getTime() - 30 * 86400000);
  }

  return null;
}

function getPeriodLabel(period) {
  if (period === "7d") return "7 derniers jours";
  if (period === "30d") return "30 derniers jours";
  return "Toute la période";
}

function createProgressBar(percent, type) {
  const progress = document.createElement("div");
  progress.className = "progress";

  const fill = document.createElement("div");
  fill.className = `progress-fill ${type}`;
  fill.style.width = `${Math.min(Number(percent) || 0, 100)}%`;

  progress.appendChild(fill);
  return progress;
}

function createCard(item, options = {}) {
  const {
    type = "gold",
    badgeType = "best",
    position = 1,
    lines = [],
    percent = 0,
    progressType = type
  } = options;

  const card = document.createElement("div");
  card.className = `rank-card ${type}`;

  const top = document.createElement("div");
  top.className = "card-top";

  const name = document.createElement("div");
  name.className = "product-name";
  name.textContent = sanitizeText(item.name);

  const badge = document.createElement("div");
  badge.className = `rank-badge ${badgeType}`;
  badge.textContent = `#${position}`;

  top.append(name, badge);

  const stats = document.createElement("div");
  stats.className = "card-stats";

  lines.forEach(([label, value]) => {
    const line = document.createElement("div");
    line.className = "stat-line";

    const l = document.createElement("span");
    l.textContent = label;

    const v = document.createElement("strong");
    v.textContent = value;

    line.append(l, v);
    stats.appendChild(line);
  });

  card.append(top, stats);

  if (percent > 0) {
    card.appendChild(createProgressBar(percent, progressType));
  }

  return card;
}

function buildProductStats(productsMap, saleItems, activeSaleIds) {
  const map = new Map();
  let totalSold = 0;
  let totalRevenue = 0;

  saleItems.forEach(item => {
    const saleId = item.saleId;
    const productId = item.productId;

    if (!productId) return;
    if (saleId && activeSaleIds && !activeSaleIds.has(saleId)) return;

    const quantity = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    const profit = Number(item.profit ?? (price * quantity));

    if (quantity <= 0) return;

    totalSold += quantity;
    totalRevenue += price * quantity;

    if (!map.has(productId)) {
      map.set(productId, {
        productId,
        quantity: 0,
        revenue: 0,
        profit: 0,
        unitPrices: []
      });
    }

    const entry = map.get(productId);
    entry.quantity += quantity;
    entry.revenue += price * quantity;
    entry.profit += profit;
    entry.unitPrices.push(price);
  });

  const ranking = Array.from(map.entries()).map(([productId, stats]) => {
    const product = productsMap.get(productId);

    if (!product || product.isActive === false) {
      return null;
    }

    const avgPrice = stats.quantity
      ? stats.revenue / stats.quantity
      : 0;

    const maxQuantity = Math.max(...Array.from(map.values()).map(v => v.quantity), 0);
    const ratio = maxQuantity > 0 ? stats.quantity / maxQuantity : 0;

    let score = Math.pow(ratio, 2.2) * 9.8;
    if (score > 0 && score < 1) score = 1;

    const percent = totalSold
      ? (stats.quantity / totalSold) * 100
      : 0;

    return {
      productId,
      name: sanitizeText(product.name || "Produit inconnu"),
      quantity: stats.quantity,
      revenue: round2(stats.revenue),
      profit: round2(stats.profit),
      avgPrice: round2(avgPrice),
      percent: round2(percent),
      score: round2(Math.min(score, 9.8))
    };
  }).filter(Boolean);

  return { ranking, totalSold, totalRevenue };
}

function renderList(container, items, builder, emptyText) {
  if (!container) return;

  if (!items.length) {
    showEmpty(container, emptyText);
    return;
  }

  container.replaceChildren(
    ...items.map((item, index) => builder(item, index))
  );
}

function updateKpi(els, valueText, nameText) {
  if (els.value) els.value.textContent = valueText;
  if (els.name) els.name.textContent = nameText;
}

function renderRanking(ranking, period) {
  if (!ranking.length) {
    Object.values(containers).forEach(container => {
      showEmpty(container, "Aucune vente sur cette période");
    });

    updateKpi(
      { value: kpiEls.caValue, name: kpiEls.caName },
      "—",
      "Aucune donnée"
    );
    updateKpi(
      { value: kpiEls.profitValue, name: kpiEls.profitName },
      "—",
      "Aucune donnée"
    );
    updateKpi(
      { value: kpiEls.lowQtyValue, name: kpiEls.lowQtyName },
      "—",
      "Aucune donnée"
    );

    setStatus(`Période : ${getPeriodLabel(period)} — aucune vente`);
    return;
  }

  const byRevenue = [...ranking].sort((a, b) => b.revenue - a.revenue);
  const byProfit = [...ranking].sort((a, b) => b.profit - a.profit);
  const byQuantityDesc = [...ranking].sort((a, b) => b.quantity - a.quantity);
  const byQuantityAsc = [...ranking].sort((a, b) => a.quantity - b.quantity);

  const maxRevenue = byRevenue[0]?.revenue || 1;
  const maxProfit = byProfit[0]?.profit || 1;
  const maxQty = byQuantityDesc[0]?.quantity || 1;

  const topCa = byRevenue[0];
  const topProfit = byProfit[0];
  const lowestQty = byQuantityAsc[0];

  updateKpi(
    { value: kpiEls.caValue, name: kpiEls.caName },
    formatMoney(topCa.revenue),
    topCa.name
  );
  updateKpi(
    { value: kpiEls.profitValue, name: kpiEls.profitName },
    formatMoney(topProfit.profit),
    topProfit.name
  );
  updateKpi(
    { value: kpiEls.lowQtyValue, name: kpiEls.lowQtyName },
    String(lowestQty.quantity),
    lowestQty.name
  );

  renderList(
    containers.ca,
    byRevenue.slice(0, MAX_ITEMS),
    (item, index) => createCard(item, {
      type: "blue",
      badgeType: "blue",
      position: index + 1,
      percent: (item.revenue / maxRevenue) * 100,
      progressType: "blue",
      lines: [
        ["CA", formatMoney(item.revenue)],
        ["Prix moyen", formatMoney(item.avgPrice)],
        ["Quantité", String(item.quantity)]
      ]
    }),
    "Aucun produit avec CA"
  );

  renderList(
    containers.profit,
    byProfit.slice(0, MAX_ITEMS),
    (item, index) => createCard(item, {
      type: "green",
      badgeType: "green",
      position: index + 1,
      percent: (item.profit / maxProfit) * 100,
      progressType: "green",
      lines: [
        ["Bénéfice", formatMoney(item.profit)],
        ["CA", formatMoney(item.revenue)],
        ["Quantité", String(item.quantity)]
      ]
    }),
    "Aucun produit avec bénéfice"
  );

  renderList(
    containers.lowQty,
    byQuantityAsc.slice(0, MAX_ITEMS),
    (item, index) => createCard(item, {
      type: "orange",
      badgeType: "orange",
      position: index + 1,
      percent: maxQty ? (item.quantity / maxQty) * 100 : 0,
      progressType: "orange",
      lines: [
        ["Quantité", String(item.quantity)],
        ["CA", formatMoney(item.revenue)],
        ["Part ventes", `${item.percent}%`]
      ]
    }),
    "Aucun produit faible"
  );

  const topTen = byQuantityDesc.slice(0, MAX_ITEMS);
  const topIds = new Set(topTen.map(item => item.productId));

  const lowTen = byQuantityAsc
    .filter(item => !topIds.has(item.productId))
    .slice(0, MAX_ITEMS);

  renderList(
    containers.top,
    topTen,
    (item, index) => createCard(item, {
      type: "gold",
      badgeType: "best",
      position: index + 1,
      percent: item.percent,
      progressType: "gold",
      lines: [
        ["Ventes", String(item.quantity)],
        ["CA", formatMoney(item.revenue)],
        ["Cote", `${item.score}/10`]
      ]
    }),
    "Top indisponible"
  );

  renderList(
    containers.low,
    lowTen,
    (item, index) => createCard(item, {
      type: "low",
      badgeType: "low",
      position: index + 1,
      percent: item.percent,
      progressType: "red",
      lines: [
        ["Ventes", String(item.quantity)],
        ["CA", formatMoney(item.revenue)],
        ["Cote", `${item.score}/10`]
      ]
    }),
    "Classement faible indisponible"
  );

  setStatus(
    `Période : ${getPeriodLabel(period)} — ${ranking.length} produit(s) vendu(s)`
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
    ? query(
        collection(db, "sales"),
        where("createdAt", ">=", periodStart)
      )
    : collection(db, "sales");

  const saleItemsQuery = periodStart
    ? query(
        collection(db, "sale_items"),
        where("createdAt", ">=", periodStart)
      )
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
  const { ranking } = buildProductStats(productsMap, saleItems, activeSaleIds);

  renderRanking(ranking, period);

  if (currentUserId) {
    await writeLog({
      action: "view_ranking",
      userId: currentUserId,
      period,
      productsCount: ranking.length
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

    await loadRanking();
  } catch (err) {
    console.error(err);
    alert(err?.message || "Erreur");
  }
});
