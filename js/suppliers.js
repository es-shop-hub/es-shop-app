import {
  db,
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  orderBy,
  limit
} from "./firebase.js";
import { getAuth, onAuthStateChanged } from "./auth.js";
import { getAppConfig } from "./appConfig.js";
import { bindActionButton } from "./utils/buttonManager.js";

const auth = getAuth();
const $ = id => document.getElementById(id);
const n = v => Number(v) || 0;

const STOCK_IN_LIMIT = 15;
const RECENT_PURCHASES_LIMIT = 20;

const state = {
  purchases: [],
  purchaseItems: [],
  products: [],
  debts: [],
  stockIns: [],
  currency: "$",
  period: "all",
  search: "",
  aggregates: [],
  selected: null,
  userId: null
};

function round2(value) {
  return Math.round((n(value) + Number.EPSILON) * 100) / 100;
}

function setStatus(text) {
  const el = $("statusMsg");
  if (el) el.textContent = text || "";
}

function formatMoney(value) {
  return `${state.currency}${round2(value).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

function getDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  if (typeof value._seconds === "number") {
    return new Date(value._seconds * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sanitizeSupplierName(value, max = 80) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function normalizeSupplierKey(name) {
  const cleaned = sanitizeSupplierName(name);
  if (!cleaned) return "";
  return cleaned
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPeriodBounds(period) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (period === "all") {
    return { start: null, end, label: "Toute la période" };
  }

  if (period === "7d") {
    const start = new Date(now.getTime() - 7 * 86400000);
    start.setHours(0, 0, 0, 0);
    return { start, end, label: "7 derniers jours" };
  }

  if (period === "30d") {
    const start = new Date(now.getTime() - 30 * 86400000);
    start.setHours(0, 0, 0, 0);
    return { start, end, label: "30 derniers jours" };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  start.setHours(0, 0, 0, 0);
  return { start, end, label: "Mois en cours" };
}

function inPeriod(createdAt, start, end) {
  const d = getDate(createdAt);
  // Sans date : inclus seulement si filtre « toute la période »
  if (!d) return start == null;
  if (end && d > end) return false;
  if (start && d < start) return false;
  return true;
}

function getPurchaseTotal(purchase) {
  const fromDoc = n(purchase?.total_cost ?? purchase?.totalCost ?? purchase?.total);
  if (fromDoc > 0) return fromDoc;

  const purchaseId = purchase?.id;
  if (!purchaseId) return 0;

  return state.purchaseItems
    .filter(i => (i.purchaseId || i.purchase_id) === purchaseId)
    .reduce(
      (sum, i) =>
        sum + n(i.quantity) * n(i.price ?? i.unitPrice ?? i.purchase_price),
      0
    );
}

async function checkUser(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) throw new Error("Utilisateur introuvable");
  const data = snap.data();
  if (!data?.isActive) throw new Error("Compte désactivé");
  return data;
}

function appendEmpty(box, text) {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = text;
  box.appendChild(empty);
}

function getFilteredPurchases() {
  const { start, end } = getPeriodBounds(state.period);
  return state.purchases.filter(p => inPeriod(p.createdAt, start, end));
}

function buildAggregates() {
  const { label } = getPeriodBounds(state.period);
  const hint = $("filterHint");
  if (hint) {
    hint.textContent = `Filtre : ${label} — cliquez une carte pour le détail.`;
  }

  const periodPurchases = getFilteredPurchases();
  const searchKey = normalizeSupplierKey(state.search);
  const byKey = new Map();

  periodPurchases.forEach(purchase => {
    const name = sanitizeSupplierName(purchase.supplier || "") || "Fournisseur inconnu";
    const nameKey = normalizeSupplierKey(name) || "__unknown__";

    if (searchKey && !nameKey.includes(searchKey)) return;

    if (!byKey.has(nameKey)) {
      byKey.set(nameKey, {
        nameKey,
        name,
        ordersCount: 0,
        totalSpent: 0,
        lastPurchaseAt: null,
        purchases: []
      });
    }

    const row = byKey.get(nameKey);
    const total = getPurchaseTotal(purchase);
    row.ordersCount += 1;
    row.totalSpent = round2(row.totalSpent + total);
    row.purchases.push(purchase);

    const d = getDate(purchase.createdAt);
    if (d && (!row.lastPurchaseAt || d > row.lastPurchaseAt)) {
      row.lastPurchaseAt = d;
    }
  });

  state.aggregates = Array.from(byKey.values()).sort(
    (a, b) => b.totalSpent - a.totalSpent
  );

  if (state.selected) {
    const still = state.aggregates.find(
      a => a.nameKey === state.selected.nameKey
    );
    state.selected = still || null;
  }

  renderKpis(periodPurchases);
  renderSuppliersList();
  renderDetail();
  renderRecentPurchases(periodPurchases);
  renderStockIns();
  renderRecommendations(periodPurchases);
}

function getOpenSupplierDebtsTotal() {
  return state.debts
    .filter(
      d =>
        d.category === "supplier" &&
        (d.status || "") !== "cancelled" &&
        n(d.amount_remaining ?? d.amount) > 0
    )
    .reduce((sum, d) => sum + n(d.amount_remaining ?? d.amount), 0);
}

function renderKpis(periodPurchases) {
  const set = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  set("kpiSuppliersCount", String(state.aggregates.length));
  set("kpiOrdersCount", String(periodPurchases.length));
  set(
    "kpiTotalSpent",
    formatMoney(periodPurchases.reduce((s, p) => s + getPurchaseTotal(p), 0))
  );
  set("kpiOpenDebts", formatMoney(getOpenSupplierDebtsTotal()));
}

function renderSuppliersList() {
  const box = $("suppliersList");
  if (!box) return;
  box.replaceChildren();

  if (state.aggregates.length === 0) {
    appendEmpty(box, "Aucun fournisseur sur cette période");
    return;
  }

  const fragment = document.createDocumentFragment();

  state.aggregates.forEach(row => {
    const card = document.createElement("div");
    card.className = "supplier-card";
    card.id = `supplier-card-${row.nameKey}`;
    if (state.selected?.nameKey === row.nameKey) {
      card.classList.add("active");
    }

    const left = document.createElement("div");
    left.className = "card-left";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = row.name;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const last =
      row.lastPurchaseAt?.toLocaleDateString("fr-FR") || "—";
    meta.textContent = `${row.ordersCount} commande(s) • Dernier : ${last}`;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "Fournisseur";

    left.appendChild(title);
    left.appendChild(meta);
    left.appendChild(badge);

    const value = document.createElement("div");
    value.className = "card-value";
    value.textContent = formatMoney(row.totalSpent);

    card.appendChild(left);
    card.appendChild(value);

    card.addEventListener("click", () => {
      state.selected = row;
      renderSuppliersList();
      renderDetail();
    });

    fragment.appendChild(card);
  });

  box.appendChild(fragment);
}

function renderDetail() {
  const summary = $("detailSummary");
  const list = $("detailPurchasesList");
  if (!summary || !list) return;

  list.replaceChildren();

  if (!state.selected) {
    summary.textContent = "Aucun fournisseur sélectionné.";
    return;
  }

  const row = state.selected;
  summary.textContent = `${row.name} — ${row.ordersCount} commande(s), total ${formatMoney(row.totalSpent)}`;

  const purchases = [...row.purchases].sort((a, b) => {
    const da = getDate(a.createdAt)?.getTime() || 0;
    const tb = getDate(b.createdAt)?.getTime() || 0;
    return tb - da;
  });

  if (purchases.length === 0) {
    appendEmpty(list, "Aucun achat pour ce fournisseur");
    return;
  }

  const fragment = document.createDocumentFragment();

  purchases.forEach(p => {
    const item = document.createElement("div");
    item.className = "activity-item";
    item.id = `detail-purchase-${p.id}`;
    item.style.cursor = "default";

    const left = document.createElement("div");
    left.className = "card-left";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = getDate(p.createdAt)?.toLocaleString("fr-FR") || "Sans date";

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `Réf. ${p.id}`;

    left.appendChild(title);
    left.appendChild(meta);

    const value = document.createElement("div");
    value.className = "card-value";
    value.textContent = formatMoney(getPurchaseTotal(p));

    item.appendChild(left);
    item.appendChild(value);
    fragment.appendChild(item);
  });

  list.appendChild(fragment);
}

function renderRecentPurchases(periodPurchases) {
  const box = $("recentPurchasesList");
  if (!box) return;
  box.replaceChildren();

  const searchKey = normalizeSupplierKey(state.search);
  const list = [...periodPurchases]
    .filter(p => {
      if (!searchKey) return true;
      const key = normalizeSupplierKey(p.supplier || "");
      return key.includes(searchKey);
    })
    .sort((a, b) => {
      const da = getDate(a.createdAt)?.getTime() || 0;
      const tb = getDate(b.createdAt)?.getTime() || 0;
      return tb - da;
    })
    .slice(0, RECENT_PURCHASES_LIMIT);

  if (list.length === 0) {
    appendEmpty(box, "Aucun achat sur cette période");
    return;
  }

  const fragment = document.createDocumentFragment();

  list.forEach(p => {
    const item = document.createElement("div");
    item.className = "activity-item";
    item.id = `recent-purchase-${p.id}`;
    item.style.cursor = "default";

    const left = document.createElement("div");
    left.className = "card-left";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = sanitizeSupplierName(p.supplier || "") || "Fournisseur";

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = getDate(p.createdAt)?.toLocaleString("fr-FR") || "";

    left.appendChild(title);
    left.appendChild(meta);

    const value = document.createElement("div");
    value.className = "card-value";
    value.textContent = formatMoney(getPurchaseTotal(p));

    item.appendChild(left);
    item.appendChild(value);
    fragment.appendChild(item);
  });

  box.appendChild(fragment);
}

function renderStockIns() {
  const box = $("stockInList");
  if (!box) return;
  box.replaceChildren();

  const { start, end } = getPeriodBounds(state.period);
  const movements = state.stockIns
    .filter(m => inPeriod(m.createdAt, start, end))
    .slice(0, STOCK_IN_LIMIT);

  if (movements.length === 0) {
    appendEmpty(box, "Aucune entrée stock fournisseur sur cette période");
    return;
  }

  const fragment = document.createDocumentFragment();

  movements.forEach(m => {
    const item = document.createElement("div");
    item.className = "activity-item";
    item.id = `stock-in-${m.id}`;
    item.style.cursor = "default";

    const product = state.products.find(p => p.id === m.productId);

    const left = document.createElement("div");
    left.className = "card-left";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = `Entrée stock — ${product?.name || "Produit"}`;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const date = getDate(m.createdAt)?.toLocaleString("fr-FR") || "";
    const ref = m.referenceId ? ` • Réf. ${m.referenceId}` : "";
    meta.textContent = `${date} • Qty: ${n(m.quantity)}${ref}`;

    left.appendChild(title);
    left.appendChild(meta);

    const value = document.createElement("div");
    value.className = "card-value";
    value.textContent = `${n(m.quantity)} pcs`;

    item.appendChild(left);
    item.appendChild(value);
    fragment.appendChild(item);
  });

  box.appendChild(fragment);
}

function renderRecommendations(periodPurchases) {
  const box = $("recoList");
  if (!box) return;
  box.replaceChildren();

  const recos = [];
  const totalSpent = periodPurchases.reduce(
    (s, p) => s + getPurchaseTotal(p),
    0
  );

  if (periodPurchases.length === 0) {
    recos.push("Aucun achat sur la période — planifiez une commande ou élargissez le filtre.");
  } else if (state.aggregates[0] && totalSpent > 0) {
    const top = state.aggregates[0];
    const pct = Math.round((top.totalSpent / totalSpent) * 100);
    if (pct >= 50) {
      recos.push(
        `${top.name} concentre ${pct}% des achats — diversifiez si possible pour réduire le risque.`
      );
    } else {
      recos.push(
        `Premier fournisseur : ${top.name} (${pct}% du volume) — répartition correcte.`
      );
    }
  }

  const { start: start30 } = getPeriodBounds("30d");
  const last30 = state.purchases.filter(p => inPeriod(p.createdAt, start30, new Date()));
  if (last30.length === 0 && state.purchases.length > 0) {
    recos.push("Aucun achat sur les 30 derniers jours alors que l’historique existe — vérifier le stock.");
  }

  const openDebts = getOpenSupplierDebtsTotal();
  if (openDebts > 0) {
    recos.push(
      `Dettes fournisseurs ouvertes : ${formatMoney(openDebts)} — priorisez le règlement.`
    );
  }

  if (state.aggregates.length >= 3) {
    recos.push(
      `${state.aggregates.length} fournisseurs actifs sur la période — utile pour négocier les volumes.`
    );
  }

  if (recos.length === 0) {
    recos.push("Pas d’alerte particulière — continuez le suivi des commandes.");
  }

  recos.forEach((text, i) => {
    const div = document.createElement("div");
    div.className = "reco";
    div.id = `supplier-reco-${i}`;
    div.textContent = text;
    box.appendChild(div);
  });
}

async function loadPurchases() {
  try {
    const snap = await getDocs(
      query(collection(db, "purchases"), orderBy("createdAt", "desc"))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("[suppliers] orderBy purchases échoué → fallback:", err);
    const snap = await getDocs(collection(db, "purchases"));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort(
        (a, b) =>
          (getDate(b.createdAt)?.getTime() || 0) -
          (getDate(a.createdAt)?.getTime() || 0)
      );
  }
}

async function safeGetDocs(label, loader) {
  try {
    return await loader();
  } catch (err) {
    console.error(`[suppliers] ${label}:`, err);
    return null;
  }
}

async function loadData() {
  const purchases = await loadPurchases();

  const [itemsSnap, productsSnap, debtsSnap, stockSnap] = await Promise.all([
    safeGetDocs("purchase_items", () => getDocs(collection(db, "purchase_items"))),
    safeGetDocs("products", () => getDocs(collection(db, "products"))),
    safeGetDocs("debts", () => getDocs(collection(db, "debts"))),
    safeGetDocs("stock_movements", () =>
      getDocs(
        query(
          collection(db, "stock_movements"),
          orderBy("createdAt", "desc"),
          limit(80)
        )
      )
    ).then(async snap => {
      if (snap) return snap;
      return safeGetDocs("stock_movements_fallback", () =>
        getDocs(collection(db, "stock_movements"))
      );
    })
  ]);

  state.purchases = purchases;
  state.purchaseItems = itemsSnap
    ? itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    : [];
  state.products = productsSnap
    ? productsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    : [];
  state.debts = debtsSnap
    ? debtsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    : [];
  state.stockIns = (stockSnap ? stockSnap.docs : [])
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(m => m.type === "IN" && m.reason === "purchase")
    .sort(
      (a, b) =>
        (getDate(b.createdAt)?.getTime() || 0) -
        (getDate(a.createdAt)?.getTime() || 0)
    );
}

async function refreshAll() {
  setStatus("Chargement…");
  await loadData();
  buildAggregates();
  setStatus("Prêt.");
}

function applyFilters() {
  state.period = $("periodFilter")?.value || "all";
  state.search = $("searchSupplier")?.value || "";
  buildAggregates();
}

function bindEvents() {
  bindActionButton($("applyFilterBtn"), async () => {
    applyFilters();
  });

  $("searchSupplier")?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyFilters();
    }
  });
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.replace("login.html");
    return;
  }

  try {
    await checkUser(user.uid);
    state.userId = user.uid;
    const config = await getAppConfig();
    state.currency =
      String(config?.currencySymbol || "").trim() ||
      String(config?.currency || "").trim() ||
      "$";
    bindEvents();
    await refreshAll();
  } catch (err) {
    console.error(err);
    const msg =
      err?.code === "permission-denied"
        ? "Permissions insuffisantes pour charger les achats."
        : err?.message || "Erreur";
    setStatus(msg);
    alert(msg);
  }
});
