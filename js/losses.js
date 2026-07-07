import {
  db,
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  query,
  where,
  Timestamp,
  writeLog
} from "./firebase.js";
import { getAuth, onAuthStateChanged } from "./auth.js";
import { getAppConfig } from "./appConfig.js";
import {
  isExpirationEnabled,
  allocateFifo,
  refreshProductExpirationCache,
  toExpirationTimestamp,
  buildBatchId
} from "./expiration.js";
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
  getNotificationPermission,
  pushActivityNotification,
  isAppInBackground
} from "./finance/notifications.js";
import { showToast } from "./finance/toast.js";
import { bindActionButton } from "./utils/buttonManager.js";

const auth = getAuth();
let currentUserId = null;
let allData = [];
let allProducts = [];
let currentPage = 1;
let currentEditId = null;
let currentEditItem = null;
let expirationFeatureEnabled = false;

const list = document.getElementById("recordsList");
const startDate = document.getElementById("startDate");
const endDate = document.getElementById("endDate");
const searchInput = document.getElementById("searchInput");
const lossCorrectionModal = document.getElementById("lossCorrectionModal");

bindDateLimits(startDate, endDate);

async function loadProducts() {
  const select = document.getElementById("productSelect");
  if (!select) return;

  const snap = await getDocs(collection(db, "products"));
  allProducts = [];
  select.replaceChildren();

  snap.forEach(d => {
    const p = { id: d.id, ...d.data() };
    allProducts.push(p);

    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = `${p.name} (${p.variant || "standard"}) — stock:${p.stock_current}`;
    select.appendChild(option);
  });
}

async function loadProductMovements(productId) {
  const snap = await getDocs(
    query(collection(db, "stock_movements"), where("productId", "==", productId))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addStockMovement(payload) {
  await addDoc(collection(db, "stock_movements"), {
    ...payload,
    createdBy: currentUserId,
    createdAt: Timestamp.now()
  });
}

function getFiltered() {
  const search = (searchInput?.value || "").toLowerCase();

  return allData.filter(item => {
    if (item.isSystemCorrection) return false;
    if (item.status === "cancelled") return false;

    return (
      !search ||
      (item.reason || "").toLowerCase().includes(search) ||
      (item.category || "").toLowerCase().includes(search)
    );
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
    empty.textContent = "Aucune Perte trouvée";
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
    title.textContent = item.reason || "Perte";

    const badge = document.createElement("span");
    badge.className = "badge badge-loss";
    badge.textContent = "Perte";
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

    if (item.category === "product_loss" && !item.isSystemCorrection) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Corriger";
      btn.addEventListener("click", () => openLossCorrection(item));
      right.append(amount, btn);
    } else {
      right.appendChild(amount);
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

    console.log("[losses] loadData", useFirebaseFilter ? "filtered" : "all");
    allData = await loadFinanceByCollection(COLLECTIONS.losses, range);
    render(1);
  } catch (err) {
    console.error("[losses] load erreur:", err);
    showToast(err?.message || "Erreur chargement Pertes", "error");
    debug(err?.message || "Erreur chargement Pertes");
  } finally {
    setLoading(list, false);
  }
}

function openLossCorrection(item) {
  currentEditId = item.id;
  currentEditItem = item;

  const product = allProducts.find(p => p.id === item.relatedTo);
  const expirationField = document.getElementById("lossCorrectionExpirationField");

  if (expirationField) {
    expirationField.classList.toggle(
      "field-hidden",
      !(expirationFeatureEnabled && product?.hasExpiration)
    );
  }

  document.getElementById("lossCorrectionQty").value = "";
  document.getElementById("lossCorrectionExpirationDate").value = "";
  document.getElementById("lossCorrectionError").textContent = "";
  lossCorrectionModal.classList.add("show");
  lossCorrectionModal.setAttribute("aria-hidden", "false");
}

async function submitLossCorrection() {
  const errorEl = document.getElementById("lossCorrectionError");
  const qty = Number(document.getElementById("lossCorrectionQty")?.value);
  const id = currentEditId;
  const item = currentEditItem;

  if (isNaN(qty) || qty <= 0) {
    errorEl.textContent = "Quantité invalide";
    return;
  }

  if (!item || !id) return;

  try {
    const productId = item.relatedTo;
    const product = allProducts.find(p => p.id === productId);

    if (!product) {
      errorEl.textContent = "Produit introuvable";
      return;
    }

    const priceBuy = Number(product.price_buy || 0);
    const expirationDateStr =
      document.getElementById("lossCorrectionExpirationDate")?.value || "";
    const productHasExpiration =
      expirationFeatureEnabled && product.hasExpiration;
    const expirationTimestamp = productHasExpiration
      ? toExpirationTimestamp(expirationDateStr)
      : null;

    const inPayload = {
      productId,
      type: "IN",
      quantity: qty,
      reason: "correction_loss",
      referenceId: id
    };

    if (productHasExpiration && expirationTimestamp) {
      inPayload.expirationDate = expirationTimestamp;
      inPayload.batchId = buildBatchId();
    }

    await addStockMovement(inPayload);

    const productUpdate = {
      stock_current: Number(product.stock_current || 0) + qty,
      updatedAt: Timestamp.now()
    };

    if (productHasExpiration && expirationTimestamp) {
      productUpdate.expirationDate = expirationTimestamp;
    }

    await updateDoc(doc(db, "products", productId), productUpdate);

    if (productHasExpiration) {
      await refreshProductExpirationCache(
        productId,
        await loadProductMovements(productId)
      );
    }

    await addDoc(collection(db, COLLECTIONS.losses), {
      reason: "correction",
      category: "product_loss_correction",
      isSystemCorrection: true,
      amount: qty * priceBuy,
      relatedTo: productId,
      relatedLossId: id,
      createdAt: Timestamp.now(),
      createdBy: currentUserId
    });

    await updateDoc(doc(db, COLLECTIONS.losses, id), {
      status: "cancelled",
      updatedAt: Timestamp.now()
    });

    await writeLog({
      userId: currentUserId,
      action: "loss_correction",
      targetId: id,
      details: { productId, qty }
    });

    closeActionModal(lossCorrectionModal, errorEl);
    showToast("Correction Perte enregistrée", "success");
    await loadProducts();
    await loadData();
    debug("Correction Perte OK");
  } catch (err) {
    console.error("[losses] correction erreur:", err);
    errorEl.textContent = err?.message || "Erreur correction";
    showToast(err?.message || "Erreur correction", "error");
  }
}

bindActionButton(document.getElementById("submitProductLoss"), async () => {
  try {
    const productId = document.getElementById("productSelect")?.value;
    const qtyLost = Number(document.getElementById("productQuantityLost")?.value);
    const reason = document.getElementById("productLossReason")?.value;

    if (!productId || qtyLost <= 0) {
      alert("Produit invalide");
      return;
    }

    const product = allProducts.find(p => p.id === productId);
    if (!product) {
      alert("Produit introuvable");
      return;
    }

    const currentStock = Number(product.stock_current || 0);
    if (qtyLost > currentStock) {
      alert("Quantité supérieure au stock");
      return;
    }

    const priceBuy = Number(product.price_buy || 0);
    const amount = qtyLost * priceBuy;
    const useFifo = expirationFeatureEnabled && product.hasExpiration;

    const ref = await addDoc(collection(db, COLLECTIONS.losses), {
      reason,
      category: "product_loss",
      amount,
      relatedTo: productId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: currentUserId
    });

    if (useFifo) {
      const movements = await loadProductMovements(productId);
      const allocations = allocateFifo(productId, qtyLost, movements);

      for (const allocation of allocations) {
        await addStockMovement({
          productId,
          type: "OUT",
          quantity: allocation.qty,
          reason: "loss",
          referenceId: ref.id,
          expirationDate: allocation.expirationDate || null,
          batchId: allocation.batchId || null
        });
      }

      await refreshProductExpirationCache(
        productId,
        await loadProductMovements(productId)
      );
    } else {
      await addStockMovement({
        productId,
        type: "OUT",
        quantity: qtyLost,
        reason: "loss",
        referenceId: ref.id
      });
    }

    await updateDoc(doc(db, "products", productId), {
      stock_current: Math.max(0, currentStock - qtyLost),
      updatedAt: Timestamp.now()
    });

    await writeLog({
      userId: currentUserId,
      action: "loss_product_create",
      targetId: ref.id,
      details: { productId, qtyLost, amount }
    });

    if (isAppInBackground() && amount >= 10000) {
      pushActivityNotification(
        "Perte importante",
        `${reason || "Perte produit"} • ${amount.toLocaleString()} FC`,
        `loss-local-${ref.id}`
      );
    }

    resetInputs(["productQuantityLost"]);
    showToast("Perte produit enregistrée", "success");
    debug("Perte produit enregistrée");
    await loadProducts();
    await loadData();
  } catch (err) {
    console.error("[losses] product erreur:", err);
    showToast(err?.message || "Erreur Perte produit", "error");
  }
});

bindActionButton(document.getElementById("submitMoneyLoss"), async () => {
  const amount = Number(document.getElementById("moneyLostAmount")?.value);
  const reason = document.getElementById("moneyLossReason")?.value;

  if (isNaN(amount) || amount <= 0) {
    showToast("Montant invalide", "error");
    return;
  }

  if (!currentUserId) {
    showToast("Session non prête. Réessayez.", "error");
    return;
  }

  try {
    console.log("[losses] addDoc money", { amount, reason });

    await addDoc(collection(db, COLLECTIONS.losses), {
      reason,
      category: "money_loss",
      amount,
      type: "fixed",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      createdBy: currentUserId
    });

    await writeLog({
      userId: currentUserId,
      action: "loss_money_create",
      details: { amount, reason }
    });

    if (isAppInBackground() && amount >= 10000) {
      pushActivityNotification(
        "Perte importante",
        `${reason || "Perte financière"} • ${amount.toLocaleString()} FC`,
        `loss-money-${Date.now()}`
      );
    }

    resetInputs(["moneyLostAmount"]);
    showToast("Perte argent enregistrée", "success");
    debug("Perte argent enregistrée");
    await loadData();
  } catch (err) {
    console.error("[losses] money erreur:", err);
    showToast(err?.message || "Erreur enregistrement", "error");
  }
});

document.getElementById("applyFirebaseFilter")?.addEventListener("click", () => loadData(true));
bindActionButton(document.getElementById("lossCorrectionSaveBtn"), submitLossCorrection);
document.getElementById("lossCorrectionCancelBtn")?.addEventListener("click", () => {
  closeActionModal(lossCorrectionModal, document.getElementById("lossCorrectionError"));
});

searchInput?.addEventListener("input", () => render(1));

onAuthStateChanged(auth, async user => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  currentUserId = user.uid;

  try {
    const cfg = await getAppConfig();
    expirationFeatureEnabled = isExpirationEnabled(cfg);
  } catch (err) {
    console.error(err);
  }

  if (getNotificationPermission() === "granted") {
    initFinanceActivityNotifications();
  }

  await loadProducts();
  await loadData();
});
