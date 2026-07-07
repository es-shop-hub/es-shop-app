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
  recordStockFundingExpense
} from "./finance/data.js";
import { bindFormAction, bindActionButton } from "./utils/buttonManager.js";

const PURCHASE_FUNDING_LABELS = {
  investment: "Investissement",
  reinvestment: "Réinvestissement"
};

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
const purchaseFundingAmountInput = document.getElementById("purchaseFundingAmount");
const purchaseFundingAmountField = document.getElementById("purchaseFundingAmountField");
const purchaseFundingHint = document.getElementById("purchaseFundingHint");
const purchaseCostPreview = document.getElementById("purchaseCostPreview");
const stockAdjustExpirationField = document.getElementById("stockAdjustExpirationField");
const stockAdjustExpirationDateInput = document.getElementById("stockAdjustExpirationDate");

const DEFAULT_MARGIN = 1.3;

let fundingSuggestTimer = null;
let lastFundingContext = {
  purchaseCost: 0,
  profitSinceLastPurchase: 0,
  reinvestSuggested: 0
};

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

function getSelectedPurchaseFundingType() {
  return document.querySelector('input[name="purchaseFundingType"]:checked')?.value || "";
}

function getEffectiveUnitPrice(productId, unitPriceInput) {
  const product = allProducts.find(p => p.id === productId);

  if (unitPriceInput !== null && unitPriceInput > 0) {
    return unitPriceInput;
  }

  return Number(product?.price_buy || 0);
}

function getPurchaseCostFromForm() {
  const productId = productSelect?.value || "";
  const quantity = parseInt(document.getElementById("quantity")?.value, 10);
  const unitPriceRaw = document.getElementById("unitPrice")?.value?.trim();
  const unitPrice =
    unitPriceRaw === "" ? null : Number(unitPriceRaw);

  if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
    return 0;
  }

  const effectivePrice = getEffectiveUnitPrice(productId, unitPrice);

  return effectivePrice > 0 ? quantity * effectivePrice : 0;
}

async function getLastPurchaseDateForProduct(productId) {
  const snap = await getDocs(
    query(purchaseItemsCol, where("productId", "==", productId))
  );

  let latestMs = null;

  snap.docs.forEach(itemDoc => {
    const createdAt = itemDoc.data()?.createdAt;
    const time = createdAt?.toDate?.()?.getTime();

    if (time != null && (latestMs === null || time > latestMs)) {
      latestMs = time;
    }
  });

  return latestMs ? new Date(latestMs) : null;
}

async function getProductProfitSince(productId, sinceDate) {
  const sinceMs = sinceDate ? sinceDate.getTime() : 0;

  const itemsSnap = await getDocs(
    query(collection(db, "sale_items"), where("productId", "==", productId))
  );

  const pendingItems = [];
  const saleIds = new Set();

  itemsSnap.docs.forEach(itemDoc => {
    const data = itemDoc.data();
    const time = data.createdAt?.toDate?.()?.getTime() ?? 0;

    if (time >= sinceMs && data.saleId) {
      pendingItems.push(data);
      saleIds.add(data.saleId);
    }
  });

  if (!pendingItems.length) {
    return 0;
  }

  const activeSaleIds = new Set();
  const saleIdList = [...saleIds];

  for (let i = 0; i < saleIdList.length; i += 10) {
    const chunk = saleIdList.slice(i, i + 10);

    await Promise.all(
      chunk.map(async (saleId) => {
        const saleSnap = await getDoc(doc(db, "sales", saleId));

        if (saleSnap.exists() && saleSnap.data()?.status === "active") {
          activeSaleIds.add(saleId);
        }
      })
    );
  }

  return pendingItems.reduce((sum, item) => {
    if (!activeSaleIds.has(item.saleId)) {
      return sum;
    }

    return sum + Number(item.profit || 0);
  }, 0);
}

function syncPurchaseFundingAmountField(fundingType, { preserveUserEdit = true } = {}) {
  if (purchaseFundingAmountField) {
    const showAmount =
      fundingType === "investment" || fundingType === "reinvestment";

    purchaseFundingAmountField.classList.toggle("field-hidden", !showAmount);
  }

  if (!purchaseFundingAmountInput) {
    return;
  }

  const showAmount =
    fundingType === "investment" || fundingType === "reinvestment";

  if (!showAmount) {
    purchaseFundingAmountInput.value = "";
    delete purchaseFundingAmountInput.dataset.userEdited;
    return;
  }

  if (preserveUserEdit && purchaseFundingAmountInput.dataset.userEdited === "true") {
    return;
  }

  const { purchaseCost, reinvestSuggested } = lastFundingContext;

  if (fundingType === "investment") {
    purchaseFundingAmountInput.value =
      purchaseCost > 0 ? purchaseCost.toFixed(2) : "";
    return;
  }

  if (fundingType === "reinvestment") {
    purchaseFundingAmountInput.value =
      reinvestSuggested > 0 ? reinvestSuggested.toFixed(2) : "";
  }
}

async function refreshPurchaseFundingSuggestions() {
  const productId = productSelect?.value || "";
  const purchaseCost = getPurchaseCostFromForm();

  if (purchaseCostPreview) {
    purchaseCostPreview.textContent =
      purchaseCost > 0
        ? `Coût achat estimé : ${purchaseCost.toFixed(2)} ${CURRENCY_SYMBOL}`
        : "Coût achat estimé : — (saisissez produit, quantité et prix)";
  }

  if (!productId) {
    lastFundingContext = {
      purchaseCost: 0,
      profitSinceLastPurchase: 0,
      reinvestSuggested: 0
    };

    if (purchaseFundingHint) {
      purchaseFundingHint.textContent =
        "Sélectionnez un produit pour calculer le plafond de réinvestissement.";
    }

    syncPurchaseFundingAmountField(getSelectedPurchaseFundingType());
    return;
  }

  let profitSince = 0;

  try {
    const lastPurchaseDate = await getLastPurchaseDateForProduct(productId);
    profitSince = await getProductProfitSince(productId, lastPurchaseDate);
  } catch (err) {
    console.error(err);
  }

  const reinvestSuggested =
    purchaseCost > 0
      ? Math.min(purchaseCost, Math.max(0, profitSince))
      : 0;

  lastFundingContext = {
    purchaseCost,
    profitSinceLastPurchase: profitSince,
    reinvestSuggested
  };

  if (purchaseFundingHint) {
    purchaseFundingHint.textContent =
      `Bénéfice produit depuis dernier achat : ${profitSince.toFixed(2)} ${CURRENCY_SYMBOL}. ` +
      `Plafond réinvestissement suggéré : ${reinvestSuggested.toFixed(2)} ${CURRENCY_SYMBOL} ` +
      `(min entre coût achat et bénéfice). Vous pouvez corriger le montant avant validation.`;
  }

  syncPurchaseFundingAmountField(getSelectedPurchaseFundingType());
}

function schedulePurchaseFundingRefresh() {
  clearTimeout(fundingSuggestTimer);

  fundingSuggestTimer = setTimeout(() => {
    refreshPurchaseFundingSuggestions().catch(console.error);
  }, 300);
}

function resetPurchaseFundingUi() {
  if (purchaseFundingAmountInput) {
    purchaseFundingAmountInput.value = "";
    delete purchaseFundingAmountInput.dataset.userEdited;
  }

  lastFundingContext = {
    purchaseCost: 0,
    profitSinceLastPurchase: 0,
    reinvestSuggested: 0
  };

  if (purchaseFundingHint) {
    purchaseFundingHint.textContent =
      "Choisissez le type de financement de cet achat.";
  }

  if (purchaseCostPreview) {
    purchaseCostPreview.textContent = "Coût achat estimé : —";
  }

  if (purchaseFundingAmountField) {
    purchaseFundingAmountField.classList.add("field-hidden");
  }
}

function readPurchaseFundingFromForm() {
  const fundingType = getSelectedPurchaseFundingType();
  const amountRaw = purchaseFundingAmountInput?.value?.trim() || "";
  const fundingAmount = amountRaw === "" ? NaN : Number(amountRaw);

  return { fundingType, fundingAmount };
}

function validatePurchaseFunding(fundingType, fundingAmount) {
  if (!fundingType) {
    throw new Error("Sélectionnez le type de financement");
  }

  if (fundingType === "none") {
    return { fundingType: "none", fundingAmount: 0 };
  }

  if (!Number.isFinite(fundingAmount) || fundingAmount <= 0) {
    throw new Error("Montant financement invalide");
  }

  return { fundingType, fundingAmount };
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

const toggleBtn = document.getElementById("addPurchaseBtn");

function closePurchaseForm() {
  if (!purchaseForm) return;

  purchaseForm.reset();
  purchaseForm.classList.remove("purchase-overlay");
  purchaseForm.style.display = "none";
  resetPurchaseFundingUi();
  syncPurchaseExpirationField();
}

function openPurchaseForm() {
  if (!purchaseForm) return;

  purchaseForm.style.display = "flex";
  purchaseForm.classList.add("purchase-overlay");
  syncPurchaseExpirationField();
  schedulePurchaseFundingRefresh();
  document.getElementById("supplierName")?.focus();
}

if (toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    const isHidden =
      getComputedStyle(purchaseForm).display === "none";

    if (isHidden) {
      openPurchaseForm();
    } else {
      closePurchaseForm();
    }
  });
}

document.getElementById("purchaseCancelBtn")?.addEventListener("click", () => {
  closePurchaseForm();
});

document.getElementById("purchaseFormCloseBtn")?.addEventListener("click", () => {
  closePurchaseForm();
});

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
    expirationDateStr,
    fundingType = "none",
    fundingAmount = 0
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

  const productLabel = productData.name || "Produit";
  const fundingValue = Number(fundingAmount) || 0;

  if (
    (fundingType === "investment" || fundingType === "reinvestment") &&
    fundingValue > 0
  ) {
    const fundingLabel = PURCHASE_FUNDING_LABELS[fundingType] || fundingType;

    await recordStockFundingExpense({
      category: fundingType,
      amount: fundingValue,
      reason: `${fundingLabel} — ${productLabel} (×${quantity})`,
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
  bindFormAction(purchaseForm, async () => {
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

    let fundingPayload;

    try {
      const rawFunding = readPurchaseFundingFromForm();
      fundingPayload = validatePurchaseFunding(
        rawFunding.fundingType,
        rawFunding.fundingAmount
      );
    } catch (fundingErr) {
      alert(fundingErr.message);
      debug(fundingErr.message);
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
            fundingType: fundingPayload.fundingType,
            fundingAmount: fundingPayload.fundingAmount,
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

        closePurchaseForm();

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
        fundingType: fundingPayload.fundingType,
        fundingAmount: fundingPayload.fundingAmount,
        createdBy: currentUserId
      });

      debug("✅ Achat enregistré");

      closePurchaseForm();

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
  }, document.getElementById("purchaseSubmitBtn"));
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

  openPurchaseForm();

  productSelect.value = product.id;
  syncPurchaseExpirationField();
  schedulePurchaseFundingRefresh();

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

  if (productHasExpiration) {
    const movements = await loadProductMovements(productId);
    await refreshProductExpirationCache(productId, movements);
  }

  debug("Stock modifié");
  await loadStock();
}

bindActionButton(document.getElementById("stockAdjustSaveBtn"), () => submitStockAdjust());

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
  schedulePurchaseFundingRefresh();
});

document.getElementById("quantity")?.addEventListener("input", schedulePurchaseFundingRefresh);
document.getElementById("unitPrice")?.addEventListener("input", schedulePurchaseFundingRefresh);

document.querySelectorAll('input[name="purchaseFundingType"]').forEach(radio => {
  radio.addEventListener("change", () => {
    if (purchaseFundingAmountInput) {
      delete purchaseFundingAmountInput.dataset.userEdited;
    }

    syncPurchaseFundingAmountField(getSelectedPurchaseFundingType(), {
      preserveUserEdit: false
    });
  });
});

purchaseFundingAmountInput?.addEventListener("input", () => {
  purchaseFundingAmountInput.dataset.userEdited = "true";
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
