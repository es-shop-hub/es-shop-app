import {
  db,
  collection,
  getDocs,
  getDoc,
  doc,
  query,
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
  shopMeta: null,
  period: "month",
  nameFilter: "",
  aggregates: [],
  filteredAggregates: [],
  totalPeriodProfit: 0,
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
  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  if (typeof value._seconds === "number") {
    return new Date(value._seconds * 1000);
  }
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

function rewardSumForNameKey(nameKey) {
  if (!nameKey) return 0;
  return round2(
    state.rewards
      .filter(
        r =>
          (r.status || "active") === "active" &&
          normalizeClientNameKey(r.clientName || "") === nameKey
      )
      .reduce((s, r) => s + (Number(r.amount) || 0), 0)
  );
}

function firestoreErrorMessage(err, fallback = "Erreur") {
  if (err?.code === "permission-denied") {
    return "Permissions insuffisantes. Rôle admin ou seller requis, et règles Firestore clients à jour.";
  }
  return err?.message || fallback;
}

/**
 * Compte unique encore en role legacy "user" → admin
 * (débloquer Clients / écritures isActiveMember).
 */
async function bootstrapSoleAdminIfNeeded(uid, data) {
  if (!data || data.role === "admin" || data.role === "seller") {
    return data;
  }
  if (data.role !== "user" || !data.isActive) {
    return data;
  }

  try {
    const usersSnap = await getDocs(collection(db, "users"));
    if (usersSnap.size > 1) {
      return data;
    }

    await updateDoc(doc(db, "users", uid), {
      role: "admin",
      updatedAt: Timestamp.now()
    });
    return { ...data, role: "admin" };
  } catch (err) {
    console.error("[clients] bootstrap admin:", err);
    throw new Error(
      "Compte bloqué (rôle legacy « user »). Déployez les règles Firestore à jour, ou définissez role=admin dans la Console Firebase."
    );
  }
}

async function checkUser(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) throw new Error("Utilisateur introuvable");
  let data = snap.data();
  if (!data?.isActive) throw new Error("Compte désactivé");

  data = await bootstrapSoleAdminIfNeeded(uid, data);

  if (data.role !== "admin" && data.role !== "seller") {
    throw new Error(
      "Rôle non autorisé. Un compte admin ou seller est requis pour Clients."
    );
  }
  return data;
}

async function loadSales() {
  const snap = await getDocs(
    query(collection(db, "sales"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function matchesNameFilter(row, nameTerm) {
  if (!nameTerm) return true;
  const key = row.nameKey || normalizeClientNameKey(row.name || "");
  const name = normalizeClientNameKey(row.name || "");
  return key.includes(nameTerm) || name.includes(nameTerm);
}

function openDetailPopup(focusSales = false) {
  document.body.classList.add("client-detail-popup-open");
  const backdrop = $("clientDetailBackdrop");
  if (backdrop) backdrop.setAttribute("aria-hidden", "false");

  const section = $("clientDetailSection");
  section?.setAttribute("role", "dialog");
  section?.setAttribute("aria-modal", "true");

  requestAnimationFrame(() => {
    if (focusSales) {
      $("clientSalesList")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      $("detailClientName")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      $("rewardPercent")?.focus({ preventScroll: true });
    }
  });
}

function closeDetailPopup() {
  document.body.classList.remove("client-detail-popup-open");
  const backdrop = $("clientDetailBackdrop");
  if (backdrop) backdrop.setAttribute("aria-hidden", "true");
  const section = $("clientDetailSection");
  section?.removeAttribute("role");
  section?.removeAttribute("aria-modal");
}

function buildAggregates() {
  const { start, end, label } = getPeriodBounds(state.period);
  const nameTerm = normalizeClientNameKey(state.nameFilter || "");

  const hint = $("filterHint");
  if (hint) {
    const namePart = state.nameFilter
      ? ` · nom « ${state.nameFilter} »`
      : "";
    hint.textContent = `Filtre : ${label}${namePart} — clients récurrents mis en avant.`;
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
        phone: "",
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

  const totalSalesCount = periodSales.filter(s =>
    normalizeClientNameKey(sanitizeClientName(s.clientName || ""))
  ).length;

  state.aggregates = [...byKey.values()]
    .map(row => {
      const salesSharePct =
        totalSalesCount > 0
          ? round2((100 * row.salesCount) / totalSalesCount)
          : 0;
      return {
        ...row,
        isRecurring: row.salesCount >= 2,
        salesSharePct,
        rewardMonth: rewardSumForNameKey(row.nameKey)
      };
    })
    .sort((a, b) => {
      if (a.isRecurring !== b.isRecurring) return a.isRecurring ? -1 : 1;
      return b.ca - a.ca;
    });

  state.filteredAggregates = state.aggregates.filter(a =>
    matchesNameFilter(a, nameTerm)
  );

  const view = state.filteredAggregates;
  const recurring = view.filter(a => a.isRecurring).length;
  const periodCa = view.reduce((s, a) => s + a.ca, 0);
  state.totalPeriodProfit = round2(view.reduce((s, a) => s + a.profit, 0));
  const rewardsTotal = state.rewards
    .filter(r => {
      if ((r.status || "active") !== "active") return false;
      if (!nameTerm) return true;
      return matchesNameFilter(
        {
          name: r.clientName || "",
          nameKey: normalizeClientNameKey(r.clientName || "")
        },
        nameTerm
      );
    })
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  if ($("kpiClientsCount")) {
    $("kpiClientsCount").textContent = String(
      view.filter(a => a.salesCount > 0 || a.clientId).length
    );
  }
  if ($("kpiRecurringCount")) {
    $("kpiRecurringCount").textContent = String(recurring);
  }
  if ($("kpiPeriodCa")) $("kpiPeriodCa").textContent = formatMoney(periodCa);
  if ($("kpiRewardsTotal")) {
    $("kpiRewardsTotal").textContent = formatMoney(rewardsTotal);
  }

  if (state.selected?.nameKey) {
    const refreshed = view.find(a => a.nameKey === state.selected.nameKey);
    if (refreshed) state.selected = refreshed;
  }

  renderTopClients();
  renderClientsList();
  renderRecommendations();
  fillCatchupSales(periodSales);

  if (state.selected) {
    paintDetailSummary(state.selected);
  }
}

function fillTopList(containerId, rows, valueFn) {
  const box = $(containerId);
  if (!box) return;
  box.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Aucune donnée.";
    box.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach((row, index) => {
    const line = document.createElement("div");
    line.className = "top-row";
    line.id = `${containerId}_row_${index}`;

    const left = document.createElement("span");
    left.textContent = `${index + 1}. ${row.name}`;

    const right = document.createElement("span");
    right.textContent = valueFn(row);

    line.append(left, right);
    frag.appendChild(line);
  });
  box.appendChild(frag);
}

function renderTopClients() {
  const withSales = state.filteredAggregates.filter(a => a.salesCount > 0);

  const byShare = [...withSales]
    .sort((a, b) => b.salesSharePct - a.salesSharePct || b.ca - a.ca)
    .slice(0, 5);

  const byProfit = [...withSales]
    .sort((a, b) => b.profit - a.profit || b.ca - a.ca)
    .slice(0, 5);

  fillTopList(
    "topBySalesShare",
    byShare,
    row => `${row.salesSharePct}% · ${row.salesCount} v.`
  );
  fillTopList(
    "topByProfit",
    byProfit,
    row => formatMoney(row.profit)
  );
}

function getClientProfitSharePct(row) {
  const total = state.totalPeriodProfit;
  if (!(total > 0)) return 0;
  return round2((100 * (Number(row.profit) || 0)) / total);
}

function paintDetailSummary(row) {
  const profitSharePct = getClientProfitSharePct(row);

  const nameEl = $("detailClientName");
  if (nameEl) {
    nameEl.textContent = row.name || "Client";
    nameEl.classList.remove("is-empty");
  }

  const summary = $("detailSummary");
  if (summary) {
    summary.textContent = `CA période ${formatMoney(row.ca)} — ${row.salesCount} vente(s) — part ventes ${row.salesSharePct ?? 0}%${row.isRecurring ? " — RÉCURRENT" : ""}`;
  }

  const profitEl = $("detailProfit");
  if (profitEl) {
    profitEl.textContent = `Bénéfice période : ${formatMoney(row.profit)}`;
  }

  const shareEl = $("detailProfitShare");
  if (shareEl) {
    shareEl.textContent = `Part du bénéfice total : ${profitSharePct}% (sur ${formatMoney(state.totalPeriodProfit)})`;
  }

  const rewardEl = $("detailRewardMonth");
  if (rewardEl) {
    rewardEl.textContent = `Récompense mois : ${formatMoney(row.rewardMonth || 0)}`;
  }
}

function clearDetailSummary() {
  const nameEl = $("detailClientName");
  if (nameEl) {
    nameEl.textContent = "Aucun client sélectionné";
    nameEl.classList.add("is-empty");
  }
  if ($("detailSummary")) {
    $("detailSummary").textContent = "Choisissez un client dans la liste ci-dessous.";
  }
  if ($("detailProfit")) {
    $("detailProfit").textContent = "Bénéfice période : —";
  }
  if ($("detailProfitShare")) {
    $("detailProfitShare").textContent = "Part du bénéfice total : —";
  }
  if ($("detailRewardMonth")) {
    $("detailRewardMonth").textContent = "Récompense mois : —";
  }
}

function renderClientsList() {
  const box = $("clientsList");
  if (!box) return;
  box.replaceChildren();

  const withSales = state.filteredAggregates.filter(a => a.salesCount > 0);
  if (!withSales.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.nameFilter
      ? "Aucun client ne correspond à ce nom sur la période."
      : "Aucun client avec ventes sur cette période.";
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
      `Part : ${row.salesSharePct ?? 0}%`,
      `Bénéfice : ${formatMoney(row.profit)}`,
      `Part bénéfice : ${getClientProfitSharePct(row)}%`,
      `Récompense : ${formatMoney(row.rewardMonth || 0)}`,
      row.lastSaleAt
        ? `Dernier : ${row.lastSaleAt.toLocaleDateString("fr-FR")}`
        : ""
    ]
      .filter(Boolean)
      .join(" • ");

    const actions = document.createElement("div");
    actions.className = "client-card-actions";

    const btnReward = document.createElement("button");
    btnReward.type = "button";
    btnReward.className = "secondary";
    btnReward.id = `btnReward_${row.nameKey}`;
    btnReward.textContent = "Récompense";
    btnReward.addEventListener("click", event => {
      event.stopPropagation();
      selectClient(row, { focusSales: false, openPopup: true });
    });

    const btnSales = document.createElement("button");
    btnSales.type = "button";
    btnSales.className = "secondary";
    btnSales.id = `btnSales_${row.nameKey}`;
    btnSales.textContent = "Ventes";
    btnSales.addEventListener("click", event => {
      event.stopPropagation();
      selectClient(row, { focusSales: true, openPopup: true });
    });

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.id = `btnEdit_${row.nameKey}`;
    btnEdit.textContent = "Modifier";
    bindActionButton(btnEdit, async event => {
      event.stopPropagation();
      await editClientProfile(row);
    });

    actions.append(btnReward, btnSales, btnEdit);

    card.append(top, meta, actions);
    card.addEventListener("click", () => {
      selectClient(row, { openPopup: true });
    });
    frag.appendChild(card);
  });

  box.appendChild(frag);
}

function selectClient(row, options = {}) {
  const { focusSales = false, openPopup = false } = options;
  state.selected = row;
  renderClientsList();
  paintDetailSummary(row);

  const pct = Number($("rewardPercent")?.value) || 0;
  if ($("rewardAmount")) {
    $("rewardAmount").value = String(round2(((Number(row.profit) || 0) * pct) / 100));
  }

  const list = $("clientSalesList");
  if (list) {
    list.replaceChildren();

    const sales = state.sales.filter(s => row.saleIds.includes(s.id));
    if (!sales.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Aucune vente liée.";
      list.appendChild(empty);
    } else {
      sales.forEach(sale => {
        const line = document.createElement("div");
        line.className = "meta";
        const d = getDate(sale.createdAt);
        line.textContent = `${d ? d.toLocaleString("fr-FR") : "—"} — ${formatMoney(sale.total_amount || 0)} — bénéfice ${formatMoney(sale.total_profit || 0)} — ${sale.payment_status || "paid"}`;
        list.appendChild(line);
      });
    }
  }

  if (openPopup) {
    openDetailPopup(focusSales);
  }
}

async function editClientProfile(row) {
  const nextName = window.prompt("Nom du client :", row.name || "");
  if (nextName == null) return;

  const name = sanitizeClientName(nextName);
  if (!name) {
    alert("Nom client invalide.");
    return;
  }

  const nextPhone = window.prompt(
    "Téléphone (optionnel) :",
    row.phone || ""
  );
  if (nextPhone == null) return;
  const phone = String(nextPhone).trim().slice(0, 40);

  try {
    const upserted = await upsertClientByName(name, state.userId, {
      phone,
      lastSaleAt: row.lastSaleAt
        ? Timestamp.fromDate(row.lastSaleAt)
        : Timestamp.now()
    });

    if (row.clientId && upserted?.clientId && row.clientId !== upserted.clientId) {
      // nom changé vers une autre clé : OK, upsert gère
    }

    if (row.name !== name && row.saleIds?.length) {
      await Promise.all(
        row.saleIds.map(saleId =>
          updateDoc(doc(db, "sales", saleId), {
            clientName: name,
            updatedAt: Timestamp.now()
          })
        )
      );
    }

    await writeLog({
      userId: state.userId,
      action: "client_profile_update",
      targetId: upserted?.clientId || row.clientId || "",
      details: {
        previous: row.name,
        clientName: name,
        phone
      }
    });

    await refreshAll();
    setStatus("Client mis à jour.");
  } catch (err) {
    console.error(err);
    alert(firestoreErrorMessage(err, "Impossible de modifier le client."));
  }
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
  const withSales = state.filteredAggregates.filter(a => a.salesCount > 0);
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
      round2(((Number(state.selected.profit) || 0) * pct) / 100)
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

  const settled = await Promise.allSettled([
    loadClients(),
    loadSales(),
    loadClientRewards(currentMonthKey())
  ]);

  const [clientsRes, salesRes, rewardsRes] = settled;

  if (salesRes.status === "rejected") {
    throw salesRes.reason;
  }

  state.sales = salesRes.value || [];
  state.clients =
    clientsRes.status === "fulfilled" ? clientsRes.value || [] : [];
  state.rewards =
    rewardsRes.status === "fulfilled" ? rewardsRes.value || [] : [];

  if (clientsRes.status === "rejected") {
    console.error("[clients] loadClients:", clientsRes.reason);
  }
  if (rewardsRes.status === "rejected") {
    console.error("[clients] loadClientRewards:", rewardsRes.reason);
  }

  buildAggregates();

  const partial =
    clientsRes.status === "rejected" || rewardsRes.status === "rejected";
  setStatus(
    partial
      ? "Prêt (registre clients / récompenses partiel — vérifiez les règles Firestore)."
      : "Prêt."
  );
}

function applyClientFilters() {
  state.period = $("periodFilter")?.value || "month";
  state.nameFilter = sanitizeClientName($("clientNameFilter")?.value || "");
  buildAggregates();
}

async function setupClientsPdf() {
  try {
    const pdf = await import("./pdf/clients-pdf.js");
    pdf.initClientsPdfButton(() => {
      const { label } = getPeriodBounds(state.period);
      const nameTerm = state.nameFilter;
      const rewardsTotal = state.rewards
        .filter(r => {
          if ((r.status || "active") !== "active") return false;
          if (!nameTerm) return true;
          return matchesNameFilter(
            {
              name: r.clientName || "",
              nameKey: normalizeClientNameKey(r.clientName || "")
            },
            nameTerm
          );
        })
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
      return pdf.buildClientsPdfPayload(state, state.shopMeta, {
        periodLabel: label,
        periodProfit: state.totalPeriodProfit,
        rewardsTotal
      });
    });
  } catch (err) {
    console.warn("[clients] PDF:", err);
    const btn = $("pdfBtn");
    if (btn) {
      btn.disabled = true;
      btn.title = "Export PDF indisponible";
    }
  }
}

function bindEvents() {
  bindActionButton($("applyFilterBtn"), async () => {
    applyClientFilters();
  });

  $("clientNameFilter")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyClientFilters();
    }
  });

  $("catchupSale")?.addEventListener("change", updateCatchupAmount);
  bindActionButton($("catchupSaveBtn"), async () => {
    try {
      await handleCatchup();
    } catch (err) {
      console.error(err);
      alert(firestoreErrorMessage(err, "Impossible d'enregistrer le client."));
    }
  });
  bindActionButton($("calcRewardBtn"), async () => calcRewardLocal());
  bindActionButton($("saveRewardBtn"), async () => {
    try {
      await handleSaveReward();
    } catch (err) {
      console.error(err);
      alert(firestoreErrorMessage(err, "Impossible d'enregistrer la récompense."));
    }
  });

  $("clientDetailModalClose")?.addEventListener("click", () => {
    closeDetailPopup();
  });
  $("clientDetailBackdrop")?.addEventListener("click", () => {
    closeDetailPopup();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeDetailPopup();
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
    state.shopMeta = {
      shopName: config?.shopName || "StockFlow",
      shopAddress: config?.shopAddress || "",
      shopPhone: config?.shopPhone || "",
      currencySymbol: state.currency,
      logoUrl: config?.logoUrl || ""
    };
    clearDetailSummary();
    bindEvents();
    await setupClientsPdf();
    await refreshAll();
  } catch (err) {
    console.error(err);
    const msg = firestoreErrorMessage(err, "Accès refusé");
    setStatus(msg);
    alert(msg);
  }
});
