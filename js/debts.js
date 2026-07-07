import {
  db,
  collection,
  addDoc,
  doc,
  updateDoc,
  Timestamp,
  runTransaction,
  writeLog
} from "./firebase.js";
import { getAuth, onAuthStateChanged } from "./auth.js";
import { COLLECTIONS } from "./finance/collections.js";
import { loadFinanceByCollection, dateRangeFromInputs } from "./finance/data.js";
import {
  debug,
  setLoading,
  resetInputs,
  bindDateLimits,
  renderPagination,
  closeActionModal,
  formatItemDate,
  ITEMS_PER_PAGE,
  getDebtDueInfo,
  sortDebtsByPriority,
  summarizeDebts,
  STALE_DEBT_DAYS,
  parseFinanceAmount
} from "./finance/shared.js";
import {
  initFinanceActivityNotifications,
  getNotificationPermission,
  mountNotificationPermissionBanner
} from "./finance/notifications.js";
import { showToast } from "./finance/toast.js";
import { injectOptions } from "./filter.js";
import { bindActionButton } from "./utils/buttonManager.js";

const auth = getAuth();
let currentUserId = null;
let allData = [];
let currentPage = 1;
let currentEditId = null;
let currentEditItem = null;

const list = document.getElementById("recordsList");
const startDate = document.getElementById("startDate");
const endDate = document.getElementById("endDate");
const searchInput = document.getElementById("searchInput");
const filterStatus = document.getElementById("filterStatus");
const filterDebtType = document.getElementById("filterDebtType");
const debtPaymentModal = document.getElementById("debtPaymentModal");

injectOptions("filterStatus", [
  { value: "all", label: "Tous statuts" },
  { value: "partial", label: "Partiel" },
  { value: "paid", label: "Payé" }
]);

bindDateLimits(startDate, endDate);

function getFiltered() {
  const search = (searchInput?.value || "").toLowerCase();
  const status = filterStatus?.value || "all";
  const debtType = filterDebtType?.value || "all";

  return allData.filter(item => {
    if (item.status === "cancelled") return false;

    const matchStatus = status === "all" || item.status === status;
    const matchType = debtType === "all" || item.category === debtType;

    const matchSearch =
      !search ||
      (item.name || "").toLowerCase().includes(search) ||
      (item.phone || "").toLowerCase().includes(search);

    return matchStatus && matchType && matchSearch;
  });
}

function renderDebtSummary() {
  const box = document.getElementById("debtSummary");
  if (!box) return;

  box.replaceChildren();
  const summary = summarizeDebts(allData);

  if (!summary.total) {
    const ok = document.createElement("p");
    ok.className = "debt-summary-ok";
    ok.textContent = "Aucune Dette ouverte.";
    box.appendChild(ok);
    return;
  }

  const title = document.createElement("strong");
  title.textContent = "Suivi Dettes";
  box.appendChild(title);

  const stats = document.createElement("div");
  stats.className = "debt-summary-stats";

  const parts = [
    summary.overdue ? `${summary.overdue} en retard` : null,
    summary.today ? `${summary.today} échéance aujourd'hui` : null,
    summary.soon ? `${summary.soon} échéance proche` : null,
    summary.stale ? `${summary.stale} sans échéance (+${STALE_DEBT_DAYS} j)` : null,
    summary.open ? `${summary.open} ouverte(s)` : null
  ].filter(Boolean);

  const p = document.createElement("p");
  p.textContent = `${summary.total} Dette(s) • ${summary.amountRemaining.toLocaleString()} FC restants`;
  stats.appendChild(p);

  if (parts.length) {
    const detail = document.createElement("p");
    detail.className = "debt-summary-detail";
    detail.textContent = parts.join(" • ");
    stats.appendChild(detail);
  }

  box.appendChild(stats);

  if (summary.overdue > 0 || summary.today > 0) {
    box.classList.add("debt-summary-alert");
  } else {
    box.classList.remove("debt-summary-alert");
  }
}

function render(page = 1) {
  currentPage = page;
  renderDebtSummary();

  const data = sortDebtsByPriority(getFiltered());
  const start = (page - 1) * ITEMS_PER_PAGE;
  const pageData = data.slice(start, start + ITEMS_PER_PAGE);

  list.replaceChildren();

  if (!pageData.length) {
    const empty = document.createElement("div");
    empty.textContent = "Aucune Dette trouvée";
    empty.style.padding = "20px";
    empty.style.textAlign = "center";
    empty.style.color = "#777";
    list.appendChild(empty);
    renderPagination(list, 0, currentPage, render);
    return;
  }

  pageData.forEach(item => {
    const dueInfo = getDebtDueInfo(item);
    const card = document.createElement("div");
    card.className = `finance-item debt-priority-${dueInfo.level}`;

    const left = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.name || "Client";

    const badge = document.createElement("span");
    badge.className = "badge badge-debt";
    badge.textContent = "Dette";
    title.appendChild(badge);

    const statusBadge = document.createElement("span");
    statusBadge.className = `badge debt-badge-${dueInfo.level}`;
    statusBadge.textContent = dueInfo.label;
    title.appendChild(statusBadge);

    const sub = document.createElement("small");
    sub.textContent = `${item.category || "client"} • ${item.phone || "-"}`;
    sub.style.display = "block";
    sub.style.color = "#666";

    if (item.DueDate?.toDate && item.status !== "paid") {
      const due = document.createElement("small");
      due.textContent = `Échéance: ${item.DueDate.toDate().toLocaleDateString("fr-FR")}`;
      due.style.display = "block";
      due.style.color = "#888";
      left.appendChild(due);
    }

    const dateEl = document.createElement("small");
    dateEl.textContent = formatItemDate(item.createdAt);
    dateEl.style.display = "block";
    dateEl.style.color = "#999";

    left.append(title, sub, dateEl);

    const right = document.createElement("div");
    const amount = document.createElement("div");
    amount.style.fontWeight = "700";
    amount.textContent = `${Number(item.amount_remaining || 0).toLocaleString()} FC`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Payer";
    btn.addEventListener("click", () => openDebtPayment(item));

    right.append(amount);

    if (item.status !== "paid" && Number(item.amount_remaining || 0) > 0) {
      right.appendChild(btn);
    }
    card.append(left, right);
    list.appendChild(card);
  });

  renderPagination(list, data.length, currentPage, render);
}

async function loadData(useFirebaseFilter = false) {
  try {
    setLoading(list, true);
    const range = useFirebaseFilter
      ? dateRangeFromInputs(startDate?.value, endDate?.value)
      : null;

    console.log("[debts] loadData", useFirebaseFilter ? "filtered" : "all");
    allData = await loadFinanceByCollection(COLLECTIONS.debts, range);
    render(1);
  } catch (err) {
    console.error("[debts] load erreur:", err);
    showToast(err?.message || "Erreur chargement Dettes", "error");
    debug(err?.message || "Erreur chargement Dettes");
  } finally {
    setLoading(list, false);
  }
}

function openDebtPayment(item) {
  if (item.status === "paid" || Number(item.amount_remaining || 0) <= 0) {
    alert("Dette déjà payée");
    return;
  }

  currentEditId = item.id;
  currentEditItem = item;
  document.getElementById("debtPaymentAmount").value = "";
  document.getElementById("debtPaymentError").textContent = "";
  debtPaymentModal.classList.add("show");
  debtPaymentModal.setAttribute("aria-hidden", "false");
}

async function submitDebtPayment() {
  const errorEl = document.getElementById("debtPaymentError");
  const pay = Number(document.getElementById("debtPaymentAmount")?.value);
  const id = currentEditId;
  const item = currentEditItem;

  if (isNaN(pay) || pay <= 0) {
    errorEl.textContent = "Montant invalide";
    return;
  }

  if (!id || !item) return;

  try {
    const debtRef = doc(db, COLLECTIONS.debts, id);

    await runTransaction(db, async tx => {
      const debtSnap = await tx.get(debtRef);
      if (!debtSnap.exists()) throw new Error("Dette introuvable");

      const d = debtSnap.data();
      if (d.status === "paid" || Number(d.amount_remaining || 0) <= 0) {
        throw new Error("Dette déjà payée");
      }

      const newPaid = Number(d.amount_paid || 0) + pay;
      const total = Number(d.amount_total || 0);

      if (newPaid > total) throw new Error("Paiement dépasse la Dette");

      const remaining = total - newPaid;
      const status = remaining > 0 ? "partial" : "paid";

      tx.update(debtRef, {
        amount_paid: newPaid,
        amount_remaining: remaining,
        status,
        updatedAt: Timestamp.now()
      });

      if (d.relatedSaleId) {
        tx.update(doc(db, "sales", d.relatedSaleId), {
          amount_paid: newPaid,
          amount_remaining: remaining,
          payment_status: status,
          hasDebt: remaining > 0,
          updatedAt: Timestamp.now()
        });
      }
    });

    await writeLog({
      userId: currentUserId,
      action: "debt_payment",
      targetId: id,
      details: { pay, relatedSaleId: item.relatedSaleId || null }
    });

    closeActionModal(debtPaymentModal, errorEl);
    showToast("Paiement Dette enregistré", "success");
    debug("Paiement Dette enregistré");
    await loadData();
  } catch (err) {
    console.error("[debts] paiement erreur:", err);
    errorEl.textContent = err?.message || "Erreur paiement";
    showToast(err?.message || "Erreur paiement", "error");
  }
}

bindActionButton(document.getElementById("addDebtBtn"), async () => {
  const type = document.getElementById("debtType")?.value;
  const name = document.getElementById("debtName")?.value.trim();
  const totalRaw = document.getElementById("debtAmount")?.value;
  const paidRaw = document.getElementById("debtPayed")?.value;
  const phone = document.getElementById("debtPhone")?.value.trim();
  const note = document.getElementById("debtNote")?.value.trim();
  const dueDateInput = document.getElementById("debtDueDate")?.value;

  const total = parseFinanceAmount(totalRaw);
  const paid = paidRaw === "" || paidRaw === undefined
    ? 0
    : parseFinanceAmount(paidRaw);

  if (!name) {
    showToast("Nom obligatoire", "error");
    return;
  }

  if (isNaN(total) || total <= 0) {
    showToast("Montant total invalide", "error");
    return;
  }

  if (paidRaw !== "" && (isNaN(paid) || paid < 0)) {
    showToast("Montant payé invalide", "error");
    return;
  }

  if (paid > total) {
    showToast("Montant payé supérieur au total", "error");
    return;
  }

  if (!currentUserId) {
    showToast("Session non prête. Réessayez.", "error");
    return;
  }

  try {
    const safePaid = paid;
    const remaining = total - safePaid;

    let dueTimestamp = null;
    if (dueDateInput) {
      dueTimestamp = Timestamp.fromDate(new Date(dueDateInput));
    } else {
      const defaultDue = new Date();
      defaultDue.setDate(defaultDue.getDate() + 7);
      dueTimestamp = Timestamp.fromDate(defaultDue);
    }

    console.log("[debts] addDoc", { name, total, remaining });

    await addDoc(collection(db, COLLECTIONS.debts), {
      reason: `${type} debt`,
      name,
      category: type,
      phone: phone || "",
      DueDate: dueTimestamp,
      amount_total: total,
      amount_paid: safePaid,
      amount_remaining: remaining,
      status: remaining > 0 ? "partial" : "paid",
      note: note || "",
      relatedSaleId: null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: currentUserId
    });

    await writeLog({
      userId: currentUserId,
      action: "debt_create",
      details: { name, total, remaining }
    });

    resetInputs([
      "debtName", "debtAmount", "debtPayed",
      "debtPhone", "debtDueDate", "debtNote"
    ]);

    if (filterStatus) {
      filterStatus.value = "all";
    }

    showToast("Dette enregistrée avec succès", "success");
    debug("Dette enregistrée");
    await loadData();
  } catch (err) {
    console.error("[debts] add erreur:", err);
    showToast(err?.message || "Erreur enregistrement Dette", "error");
    debug(err?.message || "Erreur enregistrement");
  }
});

document.getElementById("applyFirebaseFilter")?.addEventListener("click", () => loadData(true));
bindActionButton(document.getElementById("debtPaymentSaveBtn"), submitDebtPayment);
document.getElementById("debtPaymentCancelBtn")?.addEventListener("click", () => {
  closeActionModal(debtPaymentModal, document.getElementById("debtPaymentError"));
});

searchInput?.addEventListener("input", () => render(1));
filterStatus?.addEventListener("change", () => render(1));
filterDebtType?.addEventListener("change", () => render(1));

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  currentUserId = user.uid;

  if (filterStatus) {
    filterStatus.value = "all";
  }

  mountNotificationPermissionBanner("notificationBanner");

  if (getNotificationPermission() === "granted") {
    initFinanceActivityNotifications();
  }

  await loadData();
});
