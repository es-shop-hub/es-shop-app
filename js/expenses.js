import {
  db,
  collection,
  addDoc,
  doc,
  updateDoc,
  Timestamp,
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
  ITEMS_PER_PAGE
} from "./finance/shared.js";
import {
  initFinanceActivityNotifications,
  getNotificationPermission
} from "./finance/notifications.js";
import { showToast } from "./finance/toast.js";
import { injectOptions } from "./filter.js";
import { bindActionButton } from "./utils/buttonManager.js";

const auth = getAuth();
let currentUserId = null;
let allData = [];
let currentPage = 1;
let currentEditId = null;

const list = document.getElementById("recordsList");
const startDate = document.getElementById("startDate");
const endDate = document.getElementById("endDate");
const searchInput = document.getElementById("searchInput");
const filterCategory = document.getElementById("filterCategory");
const expenseEditModal = document.getElementById("expenseEditModal");

const categories = [
  { value: "all", label: "Toutes catégories" },
  { value: "salary", label: "Salaire" },
  { value: "investment", label: "Investissement" },
  { value: "reinvestment", label: "Réinvestissement" },
  { value: "tax", label: "Taxe" },
  { value: "maintenance", label: "Maintenance" },
  { value: "rent", label: "Loyer" },
  { value: "other", label: "Autre" }
];

injectOptions("filterCategory", categories);
bindDateLimits(startDate, endDate);

function getFiltered() {
  const search = (searchInput?.value || "").toLowerCase();
  const category = filterCategory?.value || "all";

  return allData.filter(item => {
    if (item.isSystemCorrection) return false;
    if (item.status === "cancelled") return false;

    const matchCategory =
      category === "all" || item.category === category;

    const matchSearch =
      !search ||
      (item.reason || "").toLowerCase().includes(search) ||
      (item.category || "").toLowerCase().includes(search) ||
      (item.relatedTo || "").toLowerCase().includes(search);

    return matchCategory && matchSearch;
  });
}

function render(page = 1) {
  currentPage = page;
  const data = getFiltered();
  const start = (page - 1) * ITEMS_PER_PAGE;
  const pageData = data.slice(start, start + ITEMS_PER_PAGE);

  list.replaceChildren();

  if (!pageData.length) {
    const empty = document.createElement("div");
    empty.textContent = "Aucune Dépense trouvée";
    empty.style.padding = "20px";
    empty.style.textAlign = "center";
    empty.style.color = "#777";
    list.appendChild(empty);
    renderPagination(list, 0, currentPage, render);
    return;
  }

  pageData.forEach(item => {
    const card = document.createElement("div");
    card.className = "finance-item";

    const left = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.reason || "Dépense";

    const badge = document.createElement("span");
    badge.className = "badge badge-expense";
    badge.textContent = "Dépense";
    title.appendChild(badge);

    const sub = document.createElement("small");
    sub.textContent = item.category || "Sans catégorie";
    sub.style.display = "block";
    sub.style.color = "#666";

    const dateEl = document.createElement("small");
    dateEl.textContent = formatItemDate(item.createdAt);
    dateEl.style.display = "block";
    dateEl.style.color = "#999";

    left.append(title, sub, dateEl);

    const right = document.createElement("div");
    const amount = document.createElement("div");
    amount.style.fontWeight = "700";
    amount.textContent = `${Number(item.amount || 0).toLocaleString()} FC`;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Modifier";
    btn.addEventListener("click", () => openExpenseEdit(item));

    right.append(amount, btn);
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

    console.log("[expenses] loadData", useFirebaseFilter ? "filtered" : "all");
    allData = await loadFinanceByCollection(COLLECTIONS.expenses, range);
    render(1);
  } catch (err) {
    console.error("[expenses] load erreur:", err);
    showToast(err?.message || "Erreur chargement Dépenses", "error");
    debug(err?.message || "Erreur chargement Dépenses");
  } finally {
    setLoading(list, false);
  }
}

function openExpenseEdit(item) {
  currentEditId = item.id;
  document.getElementById("expenseEditAmount").value = item.amount ?? "";
  document.getElementById("expenseEditError").textContent = "";
  expenseEditModal.classList.add("show");
  expenseEditModal.setAttribute("aria-hidden", "false");
}

async function submitExpenseEdit() {
  const errorEl = document.getElementById("expenseEditError");
  const newAmount = Number(document.getElementById("expenseEditAmount")?.value);

  if (isNaN(newAmount) || newAmount <= 0) {
    errorEl.textContent = "Montant invalide";
    return;
  }

  try {
    await updateDoc(doc(db, COLLECTIONS.expenses, currentEditId), {
      amount: newAmount,
      updatedAt: Timestamp.now()
    });

    await writeLog({
      userId: currentUserId,
      action: "expense_update",
      targetId: currentEditId,
      details: { amount: newAmount }
    });

    closeActionModal(expenseEditModal, errorEl);
    showToast("Dépense modifiée", "success");
    await loadData();
    debug("Dépense modifiée");
  } catch (err) {
    console.error("[expenses] edit erreur:", err);
    errorEl.textContent = err?.message || "Erreur";
    showToast(err?.message || "Erreur modification", "error");
  }
}

bindActionButton(document.getElementById("addExpenseBtn"), async () => {
  const label = document.getElementById("label")?.value.trim();
  const category = document.getElementById("category")?.value;
  const amount = Number(document.getElementById("amount")?.value);
  const type = document.getElementById("type")?.value;
  const relatedTo = document.getElementById("relatedTo")?.value.trim();
  const note = document.getElementById("note")?.value.trim();

  if (!label || isNaN(amount) || amount <= 0) {
    showToast("Montant ou libellé invalide", "error");
    return;
  }

  if (!currentUserId) {
    showToast("Session non prête. Réessayez.", "error");
    return;
  }

  try {
    console.log("[expenses] addDoc", { label, amount, category });

    await addDoc(collection(db, COLLECTIONS.expenses), {
      reason: label,
      category,
      amount,
      type,
      relatedTo: relatedTo || null,
      note: note || "",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: currentUserId
    });

    await writeLog({
      userId: currentUserId,
      action: "expense_create",
      details: { amount, category, label }
    });

    resetInputs(["label", "amount", "relatedTo", "note"]);
    showToast("Dépense enregistrée avec succès", "success");
    debug("Dépense enregistrée");
    await loadData();
  } catch (err) {
    console.error("[expenses] add erreur:", err);
    showToast(err?.message || "Erreur enregistrement", "error");
  }
});

document.getElementById("applyFirebaseFilter")?.addEventListener("click", () => {
  loadData(true);
});

bindActionButton(document.getElementById("expenseEditSaveBtn"), submitExpenseEdit);
document.getElementById("expenseEditCancelBtn")?.addEventListener("click", () => {
  closeActionModal(expenseEditModal, document.getElementById("expenseEditError"));
});

searchInput?.addEventListener("input", () => render(1));
filterCategory?.addEventListener("change", () => render(1));
startDate?.addEventListener("change", () => render(1));
endDate?.addEventListener("change", () => render(1));

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  currentUserId = user.uid;

  if (getNotificationPermission() === "granted") {
    initFinanceActivityNotifications();
  }

  await loadData();
});
