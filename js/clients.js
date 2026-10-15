import {
  db,
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  orderBy,
  updateDoc,
  Timestamp,
  writeLog
} from "./firebase.js";
import { getAuth, onAuthStateChanged } from "./auth.js";
import { getAppConfig } from "./appConfig.js";
import { bindActionButton } from "./utils/buttonManager.js";
import {
  sanitizeClientName,
  normalizeClientNameKey,
  upsertClientByName,
  loadClients,
  loadClientRewards,
  createClientReward,
  round2
} from "./clients-service.js";

const auth = getAuth();
const $ = id => document.getElementById(id);

const state = {
  clients: [],
  sales: [],
  rewards: [],
  currency: "$",
  period: "month",
  aggregates: [],
  selected: null,
  userId: null
};

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
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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

function saleInPeriod(sale, start, end) {
  const d = getDate(sale.createdAt);
  if (!d) return false;
  if (end && d > end) return false;
  if (start && d < start) return false;
  return true;
}

async function checkUser(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) throw new Error("Utilisateur introuvable");
  const data = snap.data();
  if (!data?.isActive) throw new Error("Compte désactivé");
  return data;
}

async function loadSales() {
  const snap = await getDocs(
    query(collection(db, "sales"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function buildAggregates() {
  const { start, end, label } = getPeriodBounds(state.period);
  const hint = $("filterHint");
  if (hint) {
    hint.textContent = `Filtre : ${label} — clients récurrents mis en avant.`;
  }

  const periodSales = state.sales.filter(
    s => (s.status || "active") !== "cancelled" && saleInPeriod(s, start, end)
  );

  const byKey = new Map();

  periodSales.forEach(sale => {
    const name = sanitizeClientName(sale.clientName || "");
    const nameKey = normalizeClientNameKey(name);
    if (!nameKey) return;

    if (!byKey.has(nameKey)) {
      byKey.set(nameKey, {
        nameKey,
        name,
        clientId: null,
        salesCount: 0,
        ca: 0,
        profit: 0,
        lastSaleAt: null,
        saleIds: []
      });
    }

    const row = byKey.get(nameKey);
    row.salesCount += 1;
    row.ca = round2(row.ca + (Number(sale.total_amount) || 0));
    row.profit = round2(row.profit + (Number(sale.total_profit) || 0));
    row.saleIds.push(sale.id);
    const d = getDate(sale.createdAt);
    if (d && (!row.lastSaleAt || d > row.lastSaleAt)) {
      row.lastSaleAt = d;
      row.name = name || row.name;
    }
  });

  state.clients.forEach(c => {
    const key = c.nameKey || normalizeClientNameKey(c.name);
    if (!key) return;
    if (byKey.has(key)) {
      const row = byKey.get(key);
      row.clientId = c.id;
      row.name = c.name || row.name;
      row.phone = c.phone || "";
    } else {
      byKey.set(key, {
        nameKey: key,
        name: c.name || key,
        clientId: c.id,
        phone: c.phone || "",
        salesCount: 0,
        ca: 0,
        profit: 0,
        lastSaleAt: getDate(c.lastSaleAt),
        saleIds: [],
        registryOnly: true
      });
    }
  });

  state.aggregates = [...byKey.values()]
    .map(row => ({
      ...row,
      isRecurring: row.salesCount >= 2
    }))
    .sort((a, b) => {
      if (a.isRecurring !== b.isRecurring) return a.isRecurring ? -1 : 1;
      return b.ca - a.ca;
    });

  const recurring = state.aggregates.filter(a => a.isRecurring).length;
  const periodCa = state.aggregates.reduce((s, a) => s + a.ca, 0);
  const rewardsTotal = state.rewards
    .filter(r => (r.status || "active") === "active")
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  if ($("kpiClientsCount")) {
    $("kpiClientsCount").textContent = String(
      state.aggregates.filter(a => a.salesCount > 0 || a.clientId).length
    );
  }
  if ($("kpiRecurringCount")) {
    $("kpiRecurringCount").textContent = String(recurring);
  }
  if ($("kpiPeriodCa")) $("kpiPeriodCa").textContent = formatMoney(periodCa);
  if ($("kpiRewardsTotal")) {
    $("kpiRewardsTotal").textContent = formatMoney(rewardsTotal);
  }

  renderClientsList();
  renderRecommendations();
  fillCatchupSales(periodSales);
}

function renderClientsList() {
  const box = $("clientsList");
  if (!box) return;
  box.replaceChildren();

  const withSales = state.aggregates.filter(a => a.salesCount > 0);
  if (!withSales.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Aucun client avec ventes sur cette période.";
    box.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  withSales.forEach(row => {
    const card = document.createElement("div");
    card.className = "client-card";
    card.id = `clientCard_${row.nameKey}`;
    if (state.selected?.nameKey === row.nameKey) {
      card.classList.add("active");
    }

    const top = document.createElement("div");
    top.className = "client-top";

    const title = document.createElement("strong");
    title.textContent = row.name;

    const badge = document.createElement("span");
    badge.className = row.isRecurring ? "badge recurring" : "badge";
    badge.textContent = row.isRecurring ? "Récurrent" : "Client";

    top.append(title, badge);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = [
      `CA : ${formatMoney(row.ca)}`,
      `${row.salesCount} vente(s)`,
      `Bénéfice : ${formatMoney(row.profit)}`,
      row.lastSaleAt
        ? `Dernier : ${row.lastSaleAt.toLocaleDateString("fr-FR")}`
        : ""
    ]
      .filter(Boolean)
      .join(" • ");

    card.append(top, meta);
    card.addEventListener("click", () => selectClient(row));
    frag.appendChild(card);
  });

  box.appendChild(frag);
}

function selectClient(row) {
  state.selected = row;
  renderClientsList();

  const summary = $("detailSummary");
  if (summary) {
    summary.textContent = `${row.name} — CA période ${formatMoney(row.ca)} — ${row.salesCount} vente(s)${row.isRecurring ? " — RÉCURRENT" : ""}`;
  }

  const pct = Number($("rewardPercent")?.value) || 0;
  if ($("rewardAmount")) {
    $("rewardAmount").value = String(round2((row.ca * pct) / 100));
  }

  const list = $("clientSalesList");
  if (!list) return;
  list.replaceChildren();

  const sales = state.sales.filter(s => row.saleIds.includes(s.id));
  if (!sales.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Aucune vente liée.";
    list.appendChild(empty);
    return;
  }

  sales.forEach(sale => {
    const line = document.createElement("div");
    line.className = "meta";
    const d = getDate(sale.createdAt);
    line.textContent = `${d ? d.toLocaleString("fr-FR") : "—"} — ${formatMoney(sale.total_amount || 0)} — ${sale.payment_status || "paid"}`;
    list.appendChild(line);
  });
}

function fillCatchupSales(periodSales) {
  const select = $("catchupSale");
  if (!select) return;

  const current = select.value;
  select.replaceChildren();

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Choisir une vente…";
  select.appendChild(opt0);

  periodSales.slice(0, 80).forEach(sale => {
    const opt = document.createElement("option");
    opt.value = sale.id;
    const d = getDate(sale.createdAt);
    const name = sale.clientName || "Sans nom";
    opt.textContent = `${d ? d.toLocaleDateString("fr-FR") : "—"} — ${name} — ${formatMoney(sale.total_amount || 0)}`;
    select.appendChild(opt);
  });

  if (current) select.value = current;
  updateCatchupAmount();
}

function updateCatchupAmount() {
  const saleId = $("catchupSale")?.value;
  const sale = state.sales.find(s => s.id === saleId);
  if ($("catchupAmount")) {
    $("catchupAmount").value = sale
      ? formatMoney(sale.total_amount || 0)
      : "—";
  }
}

function renderRecommendations() {
  const box = $("recoList");
  if (!box) return;
  box.replaceChildren();

  const recos = [];
  const withSales = state.aggregates.filter(a => a.salesCount > 0);
  const recurring = withSales.filter(a => a.isRecurring);
  const rewardedKeys = new Set(
    state.rewards
      .filter(r => (r.status || "active") === "active")
      .map(r => normalizeClientNameKey(r.clientName))
  );

  if (recurring.length) {
    recos.push(
      `${recurring.length} client(s) récurrent(s) sur le filtre — prioriser fidélisation.`
    );
  }

  const top = [...withSales].sort((a, b) => b.ca - a.ca).slice(0, 3);
  if (top.length) {
    recos.push(
      `Top apport : ${top.map(t => `${t.name} (${formatMoney(t.ca)})`).join(", ")}.`
    );
  }

  const highNoReward = withSales.filter(
    a => a.ca > 0 && !rewardedKeys.has(a.nameKey)
  );
  const avgCa =
    withSales.length
      ? withSales.reduce((s, a) => s + a.ca, 0) / withSales.length
      : 0;
  const notables = highNoReward.filter(a => a.ca >= avgCa && a.ca > 0);
  if (notables.length) {
    recos.push(
      `${notables.length} client(s) au CA ≥ moyenne sans récompense ce mois — évaluer une récompense.`
    );
  }

  const oneShot = withSales.filter(a => a.salesCount === 1);
  if (oneShot.length && withSales.length) {
    recos.push(
      `${oneShot.length} client(s) à 1 seule visite — opportunité de rappel / offre retour.`
    );
  }

  if (!recos.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Pas assez de données pour des recommandations.";
    box.appendChild(empty);
    return;
  }

  recos.forEach(text => {
    const div = document.createElement("div");
    div.className = "reco";
    div.textContent = text;
    box.appendChild(div);
  });
}

async function handleCatchup() {
  const name = sanitizeClientName($("catchupName")?.value || "");
  const saleId = $("catchupSale")?.value;
  const phone = ($("catchupPhone")?.value || "").trim();

  if (!name) throw new Error("Nom client requis.");
  if (!saleId) throw new Error("Choisissez une vente.");

  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) throw new Error("Vente introuvable.");

  await updateDoc(doc(db, "sales", saleId), {
    clientName: name,
    updatedAt: Timestamp.now()
  });

  await upsertClientByName(name, state.userId, {
    phone,
    lastSaleAt: sale.createdAt || Timestamp.now()
  });

  await writeLog({
    userId: state.userId,
    action: "sale_client_catchup",
    targetId: saleId,
    details: { clientName: name, amount: sale.total_amount || 0 }
  });

  if ($("catchupName")) $("catchupName").value = "";
  if ($("catchupPhone")) $("catchupPhone").value = "";

  await refreshAll();
  setStatus("Client lié à la vente.");
}

function calcRewardLocal() {
  if (!state.selected) {
    alert("Sélectionnez un client.");
    return;
  }
  const pct = Number($("rewardPercent")?.value) || 0;
  if ($("rewardAmount")) {
    $("rewardAmount").value = String(
      round2((state.selected.ca * pct) / 100)
    );
  }
}

async function handleSaveReward() {
  if (!state.selected) throw new Error("Sélectionnez un client.");

  const amount = Number($("rewardAmount")?.value);
  const percentUsed = Number($("rewardPercent")?.value);
  const note = ($("rewardNote")?.value || "").trim();

  let clientId = state.selected.clientId;
  if (!clientId) {
    const upserted = await upsertClientByName(
      state.selected.name,
      state.userId
    );
    clientId = upserted?.clientId || null;
  }

  await createClientReward(
    {
      clientId,
      clientName: state.selected.name,
      monthKey: currentMonthKey(),
      amount,
      percentUsed,
      clientSalesTotal: state.selected.ca,
      note
    },
    state.userId
  );

  state.rewards = await loadClientRewards(currentMonthKey());
  buildAggregates();
  if ($("rewardNote")) $("rewardNote").value = "";
  setStatus("Récompense enregistrée.");
}

async function refreshAll() {
  setStatus("Chargement…");
  const [clients, sales, rewards] = await Promise.all([
    loadClients(),
    loadSales(),
    loadClientRewards(currentMonthKey())
  ]);
  state.clients = clients;
  state.sales = sales;
  state.rewards = rewards;
  buildAggregates();
  setStatus("Prêt.");
}

function bindEvents() {
  bindActionButton($("applyFilterBtn"), async () => {
    state.period = $("periodFilter")?.value || "month";
    buildAggregates();
  });

  $("catchupSale")?.addEventListener("change", updateCatchupAmount);
  bindActionButton($("catchupSaveBtn"), handleCatchup);
  bindActionButton($("calcRewardBtn"), async () => calcRewardLocal());
  bindActionButton($("saveRewardBtn"), handleSaveReward);
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
    setStatus(err.message || "Erreur");
    alert(err.message || "Accès refusé");
  }
});
