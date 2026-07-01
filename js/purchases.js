// purchases.js - VERSION FINALE PRO  (+ filtre côté client bon à <300 produits) + vrai OFFLINE + rapide

import { 
  db, collection, addDoc, getDocs, doc, updateDoc, query, where, serverTimestamp, getDoc, runTransaction, writeLog
} from './firebase.js';
import { getAuth, onAuthStateChanged } from "./auth.js";

import {
  isOffline,
  addToQueue,
  setupNetworkListeners,
  updateNetworkBadge,
  showSyncToast,
  syncQueue
} from "./offline.js";
import { getAppConfig } from "./appConfig.js";
import {
  isExpirationEnabled,
  toExpirationTimestamp,
  formatExpirationDate,
  buildBatchId,
  getNearestExpiration,
  refreshProductExpirationCache
} from "./expiration.js";
import {
  computeStockIncreaseFundingAmount,
  recordStockFundingExpense
} from "./finance/data.js";

// --- AUTH ---
const auth = getAuth();
let currentUserId = null;

// --- DOM ---
const purchaseForm = document.getElementById('purchaseForm');
const stockTableBody = document.querySelector('#stockTable tbody');
const productSelect = document.getElementById('productSelect');
const productNameInput = document.getElementById('productName');
const variantInput = document.getElementById('variant');
const imageUrlInput = document.getElementById('imageUrl');

const stockSearch = document.getElementById('stockSearch');
const stockFilter = document.getElementById('stockFilter');

let allProducts = [];
let CURRENCY_SYMBOL = "$";
let expirationFeatureEnabled = false;
let stockAdjustProductId = null;
let stockAdjustProductHasExpiration = false;

const stockAdjustModal = document.getElementById("stockAdjustModal");
const stockAdjustProductName = document.getElementById("stockAdjustProductName");
const stockAdjustCurrentQty = document.getElementById("stockAdjustCurrentQty");
const stockAdjustError = document.getElementById("stockAdjustError");
const stockNewQtyInput = document.getElementById("stockNewQty");
const purchaseExpirationField = document.getElementById("purchaseExpirationField");
const purchaseExpirationDateInput = document.getElementById("purchaseExpirationDate");
const stockAdjustExpirationField = document.getElementById("stockAdjustExpirationField");
const stockAdjustExpirationDateInput = document.getElementById("stockAdjustExpirationDate");

const DEFAULT_MARGIN = 1.3;

async function loadCurrencyConfig() {
  try {
    const cfg = await getAppConfig();
    CURRENCY_SYMBOL =
      cfg?.currencySymbol || "$";
    expirationFeatureEnabled = isExpirationEnabled(cfg);
  } catch (err) {
    console.error(err);
  }
}

function syncPurchaseExpirationField() {
  if (!purchaseExpirationField) return;

  const product = allProducts.find(
    p => p.id === productSelect?.value
  );

  const show =
    expirationFeatureEnabled &&
    !!product?.hasExpiration;

  purchaseExpirationField.classList.toggle("field-hidden", !show);

  if (!show && purchaseExpirationDateInput) {
    purchaseExpirationDateInput.value = "";
  }
}

async function loadProductMovements(productId) {
  const snap = await getDocs(
    query(
      stockMovementsCol,
      where("productId", "==", productId)
    )
  );

  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

const toggleBtn = document.querySelector('.commande button');

if (toggleBtn) {

  toggleBtn.addEventListener('click', () => {
  const f = purchaseForm;
  f.style.display = (getComputedStyle(f).display === "none") ? "flex" : "none";
});
}

// --- COLLECTIONS ---
const purchasesCol = collection(db, 'purchases');
const purchaseItemsCol = collection(db, 'purchase_items');
const productsCol = collection(db, 'products');
const stockMovementsCol = collection(db, 'stock_movements');
const logsCol = collection(db, 'logs');

//----- recherche et filtre------
if (stockSearch) stockSearch.addEventListener('input', applyFilters);
if (stockFilter) stockFilter.addEventListener('change', applyFilters);

function applyFilters() {
  let list = [...allProducts];

  const searchValue = stockSearch.value.toLowerCase();
  const filterValue = stockFilter.value;

  if (searchValue) {
    list = list.filter(p =>
      p.name.toLowerCase().includes(searchValue) ||
      (p.variant || "").toLowerCase().includes(searchValue)
    );
  }

  if (filterValue === "low") {
    list = list.filter(p => p.stock_current <= 10);
  }

  renderStock(list);
}

// --- CONFIG ---
const STOCK_ALERT_THRESHOLD = 10;

// --- CHECK USER ---
async function checkUser(uid) {
  const userDoc = await getDoc(doc(db, "users", uid));
  if (!userDoc.exists()) throw new Error("Utilisateur inconnu");

  const data = userDoc.data();
  if (!data.isActive || (data.role !== "admin" && data.role !== "seller")) {
    throw new Error("Accès refusé");
  }

  return data;
}

/* ---   DEBUG  --- */
let debugTimer;

function debug(msg) {

  const box =
    document.getElementById("debug");

  if (!box) return;

  box.textContent = msg;

  box.classList.add("show");

  clearTimeout(debugTimer);

  debugTimer = setTimeout(() => {

    box.classList.remove("show");

    box.textContent = "";

  }, 5000);

}

/* =========================
   PROCESS PURCHASE ONLINE
========================= */

async function processPurchaseOnline(data) {

  const {
    supplier,
    productId,
    quantity,
    unitPrice,
    createdBy,
    expirationDateStr
  } = data;

  await checkUser(createdBy);

  const config = await getAppConfig();
  const expirationOn = isExpirationEnabled(config);

  const productSnap = await getDoc(doc(db, "products", productId));
  if (!productSnap.exists()) {
    throw new Error("Produit supprimé");
  }

  const productData = productSnap.data();
  const productHasExpiration = expirationOn && !!productData?.hasExpiration;
  const expirationTimestamp = productHasExpiration
    ? toExpirationTimestamp(expirationDateStr)
    : null;

  if (productHasExpiration && !expirationTimestamp) {
    throw new Error("Date expiration requise");
  }

  const now = serverTimestamp;

  const totalCost =
    unitPrice !== null
      ? quantity * unitPrice
      : 0;

  const purchaseRef =
    await addDoc(purchasesCol, {

      supplier,

      total_cost: totalCost,

      createdBy,

      createdAt: now()

    });

  const purchaseItemPayload = {
    purchaseId: purchaseRef.id,
    productId,
    quantity,
    price: unitPrice,
    createdAt: now()
  };

  if (productHasExpiration && expirationTimestamp) {
    purchaseItemPayload.expirationDate = expirationTimestamp;
  }

  await addDoc(purchaseItemsCol, purchaseItemPayload);

  let diffExpense = 0;
  let stockBefore = 0;
  let unitPriceUsed = 0;

  await runTransaction(db, async (tx) => {

    const productRef =
      doc(db, "products", productId);

    const productSnapTx =
      await tx.get(productRef);

    if (!productSnapTx.exists()) {

      throw new Error(
        "Produit supprimé"
      );

    }

    const productDataTx =
      productSnapTx.data();

    const currentStock =
      Number(
        productDataTx?.stock_current || 0
      );

    stockBefore = currentStock;

    const oldBuyPrice =
      Number(
        productDataTx?.price_buy || 0
      );

    const updateData = {

      stock_current:
        currentStock + quantity,

      updatedAt: now()

    };

    if (
      unitPrice !== null &&
      unitPrice > 0
    ) {

      updateData.price_buy =
        unitPrice;

      if (unitPrice > oldBuyPrice) {

        diffExpense =
          (unitPrice - oldBuyPrice)
          * quantity;

      }

      unitPriceUsed = unitPrice;

    } else if (oldBuyPrice > 0) {

      unitPriceUsed = oldBuyPrice;

    }

    if (productHasExpiration && expirationTimestamp) {
      updateData.expirationDate = expirationTimestamp;
    }

    tx.update(
      productRef,
      updateData
    );

    const moveRef =
      doc(stockMovementsCol);

    const movementPayload = {
      productId,
      type: "IN",
      quantity,
      reason: "purchase",
      referenceId: purchaseRef.id,
      createdBy,
      createdAt: now()
    };

    if (productHasExpiration && expirationTimestamp) {
      movementPayload.expirationDate = expirationTimestamp;
      movementPayload.batchId = buildBatchId();
    }

    tx.set(moveRef, movementPayload);

  });

  if (productHasExpiration) {
    const movements = await loadProductMovements(productId);
    const nearest = getNearestExpiration(movements, productId);

    await updateDoc(doc(db, "products", productId), {
      expirationDate: nearest || null,
      updatedAt: serverTimestamp()
    });
  }

  if (diffExpense > 0) {

    await addDoc(
      collection(db, "expenses"),
      {
        reason: "Écart achat",
        category: "other",
        type: "purchase_diff",
        amount: diffExpense,
        relatedPurchaseId: purchaseRef.id,
        status: "active",
        isSystemCorrection: false,
        createdBy,
        createdAt: now(),
        updatedAt: now()
      }
    );

  }

  const stockAfter = stockBefore + quantity;
  const reinvestAmount = computeStockIncreaseFundingAmount(
    stockBefore,
    stockAfter,
    unitPriceUsed
  );

  if (reinvestAmount > 0) {
    const productLabel = productData.name || "Produit";

    await recordStockFundingExpense({
      category: "reinvestment",
      amount: reinvestAmount,
      reason: `Réinvestissement — ${productLabel} (×${quantity})`,
      relatedTo: productId,
      relatedPurchaseId: purchaseRef.id,
      note: supplier || "",
      createdBy,
      createdAt: now()
    });
  }

  await writeLog({
    userId: createdBy,
    action: "purchase_create",
    targetId: purchaseRef.id,
    details: {
      supplier,
      productId,
      quantity,
      totalCost,
      expirationDate: expirationDateStr || null
    }
  });

}

// --- AJOUT ACHAT ---
if (purchaseForm) {
  purchaseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUserId) {
      alert("Utilisateur non connecté");
      debug("Utilisateur non connecté");
      return;
    }

    const supplier =
      document.getElementById('supplierName')
      ?.value
      .trim();

    const selectedProductId =
      productSelect?.value || "";

    const quantity =
      parseInt(
        document.getElementById('quantity')?.value
      );

    const unitPriceRaw =
      document.getElementById('unitPrice')
      ?.value
      ?.trim();

    const unitPrice =
      unitPriceRaw === ""
        ? null
        : Number(unitPriceRaw);

    // --- VALIDATION ---
    if (!supplier) {
      alert("Fournisseur requis");
      debug("Fournisseur manquant");
      return;
    }

    if (
      !selectedProductId ||
      selectedProductId === "new"
    ) {
      alert("Produit invalide");
      debug("Produit invalide");
      return;
    }

    if (
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      alert("Quantité invalide");
      debug("Quantité invalide");
      return;
    }

    if (
      unitPrice !== null &&
      (
        !Number.isFinite(unitPrice) ||
        unitPrice <= 0
      )
    ) {
      alert("Prix invalide");
      debug("Prix achat invalide");
      return;
    }

    const selectedProduct = allProducts.find(
      p => p.id === selectedProductId
    );

    const expirationDateStr =
      purchaseExpirationDateInput?.value || "";

    if (
      expirationFeatureEnabled &&
      selectedProduct?.hasExpiration &&
      !expirationDateStr
    ) {
      alert("Date expiration requise");
      debug("Date expiration manquante");
      return;
    }

    try {

      const productExists =
        allProducts.some(
          p => p.id === selectedProductId
        );

      if (!productExists) {
        throw new Error(
          "Produit introuvable"
        );
      }

      /* =========================
         OFFLINE PURCHASE
      ========================= */

      if (isOffline()) {

        addToQueue({
          type: "PURCHASE",
          data: {
            supplier,
            productId: selectedProductId,
            quantity,
            unitPrice,
            expirationDateStr: expirationDateStr || null,
            createdBy: currentUserId,
            createdAt: Date.now()
          }
        });

        debug(
          "📦 Achat sauvegardé offline"
        );

        showSyncToast(
          "📦 Achat sauvegardé hors ligne",
          "warning"
        );

        purchaseForm.reset();

        return;

      }

      /* =========================
         ONLINE PURCHASE
      ========================= */

      await processPurchaseOnline({
        supplier,
        productId: selectedProductId,
        quantity,
        unitPrice,
        expirationDateStr: expirationDateStr || null,
        createdBy: currentUserId
      });

      debug("✅ Achat enregistré");

      purchaseForm.reset();
      purchaseForm.classList.remove("purchase-overlay");
purchaseForm.style.display = "none";

      await loadStock();

    } catch (err) {

      console.error(err);
      debug(
        err?.message ||
        "Erreur achat"
      );
      alert(
        err?.message ||
        "Erreur lors de l'achat"
      );
    }
  });
}

// --- LOAD STOCK ---
async function loadStock() {
  stockTableBody.replaceChildren();
  const prodSnap = await getDocs(productsCol);
  if (isOffline()) 
  {
  debug("📴 Stock affiché depuis cache local" );
  showSyncToast(
  "📴 Stock affiché depuis cache local",
  "warning"
);
   }

  allProducts = [];
  
  productSelect.replaceChildren();

const defaultOption = document.createElement("option");

defaultOption.value = "";
defaultOption.textContent = "-- Sélectionner --";

productSelect.appendChild(defaultOption);

  prodSnap.forEach(docSnap => {
    const p = docSnap.data();
    if (!p.isActive) return;

    allProducts.push({
      id: docSnap.id,
      ...p
    });
    // AJOUT DIRECT AU SELECT
const opt = document.createElement('option');
opt.value = docSnap.id;
opt.textContent = `${p.name} ${p.variant ? "(" + p.variant + ")" : ""}`;
productSelect.appendChild(opt);
  });

  renderStock(allProducts);
}

function calcProductBenefit(product) {
  const buy = Number(product.price_buy || 0);
  const minPrice =
    Number(product.price_min) ||
    Number(product.price_sell) ||
    buy;
  const stock = Number(product.stock_current || 0);
  const unitMargin = Math.max(0, minPrice - buy);

  return {
    unitMargin,
    totalBenefit: unitMargin * stock
  };
}

function updateBenefitSummary(list) {
  const strip = document.getElementById("benefitStrip");
  const totalEl = document.getElementById("totalBenefitValue");
  const unitEl = document.getElementById("avgBenefitUnit");

  if (!strip || !totalEl) return;

  const total = list.reduce(
    (sum, p) => sum + calcProductBenefit(p).totalBenefit,
    0
  );

  const withMargin = list.filter(
    p => calcProductBenefit(p).unitMargin > 0
  );

  const avgUnit = withMargin.length
    ? withMargin.reduce((s, p) => s + calcProductBenefit(p).unitMargin, 0) / withMargin.length
    : 0;

  totalEl.textContent = `${total.toFixed(2)} ${CURRENCY_SYMBOL}`;
  if (unitEl) {
    unitEl.textContent = `${avgUnit.toFixed(2)} ${CURRENCY_SYMBOL}`;
  }

  strip.hidden = list.length === 0;
}

// --------- render ----------
function renderStock(list) {

  stockTableBody.replaceChildren();
  updateBenefitSummary(list);

  const fragment = document.createDocumentFragment();

  list.forEach(p => {

    const tr = document.createElement('tr');

    // --- NAME ---
    const nameTd = document.createElement('td');

    const variantText = p.variant
      ? ` (${p.variant})`
      : "";

    nameTd.textContent =
      `${p.name}${variantText}`;

    // --- STOCK ---
    const stockTd = document.createElement('td');
    stockTd.textContent =
      String(p.stock_current || 0);

    const expirationTd = document.createElement('td');
    expirationTd.textContent =
      p.hasExpiration
        ? formatExpirationDate(p.expirationDate)
        : "-";

    // --- BUY PRICE ---
    const buyTd = document.createElement('td');

    buyTd.textContent =
      `${Number(p.price_buy || 0).toFixed(2)} ${CURRENCY_SYMBOL}`;

    // --- STOCK VALUE ---
    const valueTd = document.createElement('td');

    const totalValue =
      (Number(p.stock_current || 0) *
      Number(p.price_buy || 0));

    valueTd.textContent =
      `${totalValue.toFixed(2)} ${CURRENCY_SYMBOL}`;

    const benefitTd = document.createElement("td");
    benefitTd.className = "benefit-cell";
    const { unitMargin, totalBenefit } = calcProductBenefit(p);
    benefitTd.textContent =
      `${unitMargin.toFixed(2)} / ${totalBenefit.toFixed(2)} ${CURRENCY_SYMBOL}`;

    // --- ACTION ---
    const actionTd = document.createElement('td');

    const rachatBtn = document.createElement('button');

rachatBtn.type = "button";
rachatBtn.textContent = "Rachat";

rachatBtn.addEventListener("click", () => {

  openPurchaseForProduct(p);

});

const btn = document.createElement('button');

btn.type = "button";
btn.textContent = "Modifier";

btn.addEventListener("click", () => {

  manualUpdate(p.id);

});

actionTd.appendChild(rachatBtn);
actionTd.appendChild(btn);

    tr.appendChild(nameTd);
    tr.appendChild(stockTd);
    tr.appendChild(expirationTd);
    tr.appendChild(buyTd);
    tr.appendChild(valueTd);
    tr.appendChild(benefitTd);
    tr.appendChild(actionTd);

    fragment.appendChild(tr);

  });

  stockTableBody.appendChild(fragment);

}

// ---  auto form ---
function openPurchaseForProduct(product) {

  purchaseForm.style.display = "flex";

  productSelect.value = product.id;
  syncPurchaseExpirationField();

  purchaseForm.classList.add("purchase-overlay");

  const supplierInput =
    document.getElementById("supplierName");

  if (supplierInput) {
    supplierInput.focus();
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}

function openStockAdjustModal(product) {
  if (!stockAdjustModal || !product) return;

  stockAdjustProductId = product.id;
  stockAdjustProductHasExpiration =
    expirationFeatureEnabled && !!product.hasExpiration;
  stockAdjustProductName.textContent = product.name || "-";
  stockAdjustCurrentQty.textContent = String(product.stock_current ?? 0);
  stockNewQtyInput.value = String(product.stock_current ?? 0);
  stockAdjustError.textContent = "";

  if (stockAdjustExpirationField) {
    stockAdjustExpirationField.classList.toggle(
      "field-hidden",
      !stockAdjustProductHasExpiration
    );
  }

  if (stockAdjustExpirationDateInput) {
    stockAdjustExpirationDateInput.value = "";
  }

  stockAdjustModal.classList.add("show");
  stockAdjustModal.setAttribute("aria-hidden", "false");
  stockNewQtyInput.focus();
}

function closeStockAdjustModal() {
  if (!stockAdjustModal) return;
  stockAdjustModal.classList.remove("show");
  stockAdjustModal.setAttribute("aria-hidden", "true");
  stockAdjustProductId = null;
  stockAdjustError.textContent = "";
}

async function submitStockAdjust() {
  if (isOffline()) {
    alert("Correction stock impossible offline");
    return;
  }

  if (!currentUserId) {
    alert("Non connecté");
    return;
  }

  const newQty = parseInt(stockNewQtyInput?.value, 10);
  if (isNaN(newQty) || newQty < 0) {
    stockAdjustError.textContent = "Quantité invalide";
    return;
  }

  const expirationDateStr =
    stockAdjustExpirationDateInput?.value || "";

  try {
    await applyManualStockUpdate(
      stockAdjustProductId,
      newQty,
      expirationDateStr
    );
    closeStockAdjustModal();
  } catch (e) {
    console.error(e);
    const message = e?.message || "Erreur modification stock";
    stockAdjustError.textContent = message;
    debug(message);
    alert(message);
  }
}

async function applyManualStockUpdate(productId, newQty, expirationDateStr = "") {
  await checkUser(currentUserId);

  const prodRef = doc(db, "products", productId);
  const prodSnapBefore = await getDoc(prodRef);

  if (!prodSnapBefore.exists()) {
    throw new Error("Produit introuvable");
  }

  const productData = prodSnapBefore.data();
  const isIn = newQty > Number(productData.stock_current || 0);
  const productHasExpiration =
    expirationFeatureEnabled && !!productData?.hasExpiration;

  const expirationTimestamp =
    isIn && productHasExpiration
      ? toExpirationTimestamp(expirationDateStr)
      : null;

  if (isIn && productHasExpiration && !expirationTimestamp) {
    throw new Error("Date expiration requise pour entrée stock");
  }

  const stockBefore = Number(productData.stock_current || 0);

  await runTransaction(db, async (tx) => {
    const prodSnap = await tx.get(prodRef);

    if (!prodSnap.exists()) {
      throw new Error("Produit introuvable");
    }

    const currentStock =
      Number(prodSnap.data().stock_current || 0);

    const diff = newQty - currentStock;

    if (diff === 0) {
      throw new Error("Aucune modification");
    }

    const updateData = {
      stock_current: newQty,
      updatedAt: serverTimestamp()
    };

    if (diff > 0 && productHasExpiration && expirationTimestamp) {
      updateData.expirationDate = expirationTimestamp;
    }

    tx.update(prodRef, updateData);

    const moveRef = doc(stockMovementsCol);

    const movementPayload = {
      productId,
      type: diff > 0 ? "IN" : "OUT",
      quantity: Math.abs(diff),
      reason: "manual_correction",
      referenceId: productId,
      createdBy: currentUserId,
      createdAt: serverTimestamp()
    };

    if (diff > 0 && productHasExpiration && expirationTimestamp) {
      movementPayload.expirationDate = expirationTimestamp;
      movementPayload.batchId = buildBatchId();
    }

    tx.set(moveRef, movementPayload);

    const logRef = doc(logsCol);

    tx.set(logRef, {
      userId: currentUserId,
      action: "manual_stock_update",
      targetId: productId,
      details: {
        oldQty: currentStock,
        newQty,
        expirationDate: expirationDateStr || null
      },
      createdAt: serverTimestamp()
    });
  });

  const reinvestAmount = computeStockIncreaseFundingAmount(
    stockBefore,
    newQty,
    Number(productData.price_buy || 0)
  );

  if (reinvestAmount > 0) {
    const productLabel = productData.name || "Produit";
    const diff = newQty - stockBefore;

    await recordStockFundingExpense({
      category: "reinvestment",
      amount: reinvestAmount,
      reason: `Réinvestissement — ${productLabel} (correction +${diff})`,
      relatedTo: productId,
      note: "Mise à jour manuelle stock",
      createdBy: currentUserId,
      createdAt: serverTimestamp()
    });
  }

  if (productHasExpiration) {
    const movements = await loadProductMovements(productId);
    await refreshProductExpirationCache(productId, movements);
  }

  debug("Stock modifié");
  await loadStock();
}

document.getElementById("stockAdjustSaveBtn")?.addEventListener("click", () => {
  submitStockAdjust();
});

document.getElementById("stockAdjustCancelBtn")?.addEventListener("click", () => {
  closeStockAdjustModal();
});

stockAdjustModal?.addEventListener("click", (event) => {
  if (event.target === stockAdjustModal) {
    closeStockAdjustModal();
  }
});

// --- MANUAL UPDATE ---
async function manualUpdate(productId) {
  if (isOffline()) {
    alert("Correction stock impossible offline");
    return;
  }

  const product = allProducts.find(p => p.id === productId);
  if (!product) {
    alert("Produit introuvable");
    return;
  }

  openStockAdjustModal(product);
}

/* ---   NETWORK INIT    --- */
let isSyncing = false;
updateNetworkBadge(
  navigator.onLine
);

setupNetworkListeners(async () => {
  try {
   if (isSyncing) return;
isSyncing = true;

try {
  await syncQueue({
    PURCHASE:processPurchaseOnline
  });
} finally {
  isSyncing = false;
}
    await loadStock();
    debug("🔄 Synchronisation terminée");
  } catch(err) {

    console.error(err);
    debug(
      err?.message ||
      "Erreur synchronisation"
    );
  }
});


productSelect?.addEventListener("change", () => {
  syncPurchaseExpirationField();
});

// --- INIT ---
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Utilisateur non connecté !");
    window.location.replace("login.html");
    return;
  }
  currentUserId = user.uid;
  try {
    await checkUser(currentUserId);
    if (isSyncing) return;

isSyncing = true;
try {
  await syncQueue({
    PURCHASE:processPurchaseOnline
  });
} finally {
  isSyncing = false;
}
    await loadCurrencyConfig();
    await loadStock();
  } catch (e) {
    alert(e.message);
  }
});
