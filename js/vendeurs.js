import "./firebase.js";

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
import { bindActionButton } from "./utils/buttonManager.js";

const $ = id => document.getElementById(id);
const n = v => Number(v) || 0;

const SELLER_SHARE_THRESHOLD = 30;
const UNKNOWN = "__unknown__";

const state = {
  sales: [],
  saleItems: [],
  users: [],
  currency: "$"
};

let initialized = false;
let debugTimeout = null;

function debug(msg) {
  const box = $("debug");
  if (!box) {
    return;
  }
  box.textContent = msg;
  clearTimeout(debugTimeout);
  debugTimeout = setTimeout(() => {
    box.textContent = "";
  }, 5000);
}

function formatMoney(v) {
  return `${Math.round(n(v)).toLocaleString()} ${state.currency}`;
}

function clearNode(id) {
  const el = $(id);
  if (el) {
    el.replaceChildren();
  }
}

function updateDateLimits() {
  const dateFrom = $("dateFrom");
  const dateTo = $("dateTo");
  if (!dateFrom || !dateTo) {
    return;
  }

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
    default:
      break;
  }

  return { start, end };
}

function buildSalesQuery() {
  const { start, end } = buildDateRange();
  const constraints = [];

  if (start) {
    constraints.push(where("createdAt", ">=", start));
  }
  if (end) {
    constraints.push(where("createdAt", "<=", end));
  }
  constraints.push(orderBy("createdAt", "desc"));

  return query(collection(db, "sales"), ...constraints);
}

function resolveSellerName(sellerId) {
  if (!sellerId || sellerId === UNKNOWN) {
    return "Vendeur inconnu";
  }

  const user = state.users.find(
    u =>
      u.userId === sellerId ||
      u.uid === sellerId ||
      u.id === sellerId
  );

  return user?.name || sellerId;
}

function appendEmpty(box, message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  box.appendChild(empty);
}

function renderSellerList(box, data, badgeClass) {
  data.forEach(({ id, v, shareCount, shareCa, shareCombined }) => {
    const el = document.createElement("div");
    el.className = "list-item";

    const left = document.createElement("div");
    left.className = "list-left";

    if (badgeClass) {
      const tag = document.createElement("div");
      tag.className = `badge ${badgeClass}`;
      tag.textContent = badgeClass === "badge-green" ? "TOP" : "LOW";
      left.appendChild(tag);
    }

    const title = document.createElement("div");
    title.className = "list-title";
    title.textContent = resolveSellerName(id);

    const sub = document.createElement("div");
    sub.className = "list-sub";
    sub.textContent =
      `${v.saleCount} vente(s) • ${shareCount.toFixed(1)}% nb` +
      ` • ${shareCa.toFixed(1)}% CA` +
      ` • ${shareCombined.toFixed(1)}% mix`;

    const value = document.createElement("div");
    value.className = "list-value";
    value.textContent = formatMoney(v.amount);

    left.appendChild(title);
    left.appendChild(sub);
    el.appendChild(left);
    el.appendChild(value);
    box.appendChild(el);
  });
}

function saleLineAmount(sale, itemsBySale) {
  const fromSale = n(sale.total_amount);
  if (fromSale > 0) {
    return fromSale;
  }
  const saleKey = sale.saleId || sale.id;
  const items = itemsBySale[saleKey] || [];
  return items.reduce(
    (sum, i) => sum + n(i.price) * n(i.quantity),
    0
  );
}

function renderSellers() {
  clearNode("leaderboardList");
  clearNode("weakSellerList");

  const boxTop = $("leaderboardList");
  const boxWeak = $("weakSellerList");
  if (!boxTop || !boxWeak) {
    return;
  }

  const itemsBySale = {};
  state.saleItems.forEach(i => {
    const saleId = i.saleId || i.sale_id;
    if (!saleId) {
      return;
    }
    if (!itemsBySale[saleId]) {
      itemsBySale[saleId] = [];
    }
    itemsBySale[saleId].push(i);
  });

  /*
   * cancelled exclus ; signaler le nombre d'exclusions.
   * % nb et % CA séparés ; mix = moyenne des deux (classement TOP/LOW).
   */
  const cancelledSales = state.sales.filter(s => s.status === "cancelled");
  const activeSales = state.sales.filter(s => s.status !== "cancelled");
  const excludedCount = cancelledSales.length;

  const noteEl = $("sellersExclusionNote");
  if (noteEl) {
    noteEl.textContent =
      excludedCount > 0
        ? `${excludedCount} vente(s) annulée(s) exclue(s) du calcul`
        : "Aucune vente annulée exclue";
  }

  const map = {};

  activeSales.forEach(s => {
    const sellerId = s.sellerId || UNKNOWN;
    if (!map[sellerId]) {
      map[sellerId] = { amount: 0, saleCount: 0 };
    }
    map[sellerId].saleCount += 1;
    map[sellerId].amount += saleLineAmount(s, itemsBySale);
  });

  const totalSaleCount = activeSales.length;
  const totalAmount = Object.values(map).reduce(
    (sum, v) => sum + n(v.amount),
    0
  );

  if (totalSaleCount === 0) {
    appendEmpty(boxTop, "Aucune vente active sur cette période");
    appendEmpty(boxWeak, "Aucun vendeur à comparer");
    return;
  }

  const ranked = Object.entries(map)
    .filter(([, v]) => v.saleCount > 0)
    .map(([id, v]) => {
      const shareCount = (v.saleCount / totalSaleCount) * 100;
      const shareCa = totalAmount > 0 ? (n(v.amount) / totalAmount) * 100 : 0;
      const shareCombined = (shareCount + shareCa) / 2;
      return { id, v, shareCount, shareCa, shareCombined };
    });

  const topSellers = ranked
    .filter(entry => entry.shareCombined >= SELLER_SHARE_THRESHOLD)
    .sort((a, b) => b.shareCombined - a.shareCombined)
    .slice(0, 5);

  const weakSellers = ranked
    .filter(entry => entry.shareCombined < SELLER_SHARE_THRESHOLD)
    .sort((a, b) => a.shareCombined - b.shareCombined)
    .slice(0, 5);

  if (topSellers.length === 0) {
    appendEmpty(
      boxTop,
      `Aucun vendeur ≥ ${SELLER_SHARE_THRESHOLD}% mix (nb+CA)`
    );
  } else {
    renderSellerList(boxTop, topSellers, "badge-green");
  }

  if (weakSellers.length === 0) {
    appendEmpty(
      boxWeak,
      `Aucun vendeur < ${SELLER_SHARE_THRESHOLD}% mix (nb+CA)`
    );
  } else {
    renderSellerList(boxWeak, weakSellers, "badge-orange");
  }
}

async function loadData() {
  debug("Chargement...");

  try {
    const config = await getAppConfig();
    state.currency = config?.currencySymbol || "$";

    const [salesSnap, saleItemsSnap, usersSnap] = await Promise.all([
      getDocs(buildSalesQuery()),
      getDocs(collection(db, "sale_items")),
      getDocs(collection(db, "users"))
    ]);

    state.sales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.saleItems = saleItemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderSellers();
    debug("OK");
  } catch (error) {
    console.error(error);
    debug(error?.message || "Erreur chargement");
  }
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

async function initializePage(user) {
  if (initialized) {
    return;
  }
  initialized = true;

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));
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

    bindEvents();
    await loadData();
  } catch (error) {
    console.error(error);
    initialized = false;
    debug(error?.message || "Erreur initialisation");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, user => {
    if (!user) {
      location.replace("login.html");
      return;
    }
    initializePage(user);
  });
});
