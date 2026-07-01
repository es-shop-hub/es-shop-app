// products.js - VERSION FINALE ULTIME PRO + search   + vrai OFFLINE 
import { 
  db, collection, getDocs, addDoc, updateDoc, doc, getDoc, deleteDoc, Timestamp, writeLog
} from './firebase.js';
import { getAuth, onAuthStateChanged } from "./auth.js";

// --- OFFLINE ---
import {
  isOffline,
  addToQueue,
  syncQueue,
  setupNetworkListeners,
  updateNetworkBadge,
  showSyncToast
} from "./offline.js";

import { getAppConfig } from "./appConfig.js";
import {
  isExpirationEnabled,
  toExpirationTimestamp,
  formatExpirationDate,
  buildBatchId
} from "./expiration.js";
import {
  computeStockIncreaseFundingAmount,
  recordStockFundingExpense
} from "./finance/data.js";

// --- DOM ---
const tableBody = document.getElementById('products-table');
const addBtn = document.querySelector('.add-product button');
const searchInput = document.getElementById('searchInput');

let allProducts = [];
let CURRENCY_SYMBOL = "$";
let expirationFeatureEnabled = false;
let productModalMode = "add";
let editingProductId = null;
let editingProductStock = 0;
let confirmResolver = null;

const productModal = document.getElementById("productModal");
const productModalTitle = document.getElementById("productModalTitle");
const productModalError = document.getElementById("productModalError");
const productStockField = document.getElementById("productStockField");
const productFundingFields = document.getElementById("productFundingFields");
const productMinOfflineField = document.getElementById("productMinOfflineField");
const productExpirationFields = document.getElementById("productExpirationFields");
const productExpirationDateField = document.getElementById("productExpirationDateField");
const confirmModal = document.getElementById("confirmModal");
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalMessage = document.getElementById("confirmModalMessage");

// --- AUTH ---
const auth = getAuth();
let currentUserId = null;

async function loadCurrencyConfig() {
  try {
    const cfg = await getAppConfig();
    CURRENCY_SYMBOL =
      cfg?.currencySymbol || "$";
    expirationFeatureEnabled = isExpirationEnabled(cfg);
    syncProductExpirationFields();
  } catch (err) {
    console.error(err);

  }
}

function syncProductExpirationFields() {
  if (productExpirationFields) {
    productExpirationFields.classList.toggle(
      "field-hidden",
      !expirationFeatureEnabled
    );
  }

  toggleProductExpirationDateField();
}

function toggleProductExpirationDateField() {
  const hasExpiration =
    document.getElementById("productHasExpiration")?.checked === true;
  const showDate =
    expirationFeatureEnabled &&
    productModalMode === "add" &&
    hasExpiration;

  if (productExpirationDateField) {
    productExpirationDateField.classList.toggle("field-hidden", !showDate);
  }
}

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

let debugTimer;

function debug(msg) {
  const box = document.getElementById("debug");

  if (!box) return;

  box.textContent = msg;
  box.classList.add("show");
  clearTimeout(debugTimer);

  debugTimer = setTimeout(() => {
    box.classList.remove("show");
    box.textContent = "";
  }, 5000);
}

function sanitizeText(value, max = 120) {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function showConfirmModal(title, message) {
  return new Promise((resolve) => {
    if (!confirmModal) {
      resolve(window.confirm(message));
      return;
    }

    confirmResolver = resolve;
    confirmModalTitle.textContent = title;
    confirmModalMessage.textContent = message;
    confirmModal.classList.add("show");
    confirmModal.setAttribute("aria-hidden", "false");
  });
}

function closeConfirmModal(result) {
  if (!confirmModal) return;
  confirmModal.classList.remove("show");
  confirmModal.setAttribute("aria-hidden", "true");
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

document.getElementById("confirmModalYes")?.addEventListener("click", () => {
  closeConfirmModal(true);
});

document.getElementById("confirmModalNo")?.addEventListener("click", () => {
  closeConfirmModal(false);
});

function setProductModalError(message) {
  if (productModalError) {
    productModalError.textContent = message || "";
  }
}

function toggleOfflineFields() {
  const allowed =
    document.getElementById("productOfflineAllowed")?.value === "OUI";

  if (productMinOfflineField) {
    productMinOfflineField.classList.toggle("field-hidden", !allowed);
  }
}

function closeProductModal() {
  if (!productModal) return;
  productModal.classList.remove("show");
  productModal.setAttribute("aria-hidden", "true");
  setProductModalError("");
  editingProductId = null;
  editingProductStock = 0;
}

function openProductModal(mode, data = null) {
  if (!productModal) return;

  productModalMode = mode;
  editingProductId = data?.id || null;
  editingProductStock = Number(data?.stock_current || 0);

  productModalTitle.textContent =
    mode === "add"
      ? "Ajouter un produit"
      : "Modifier le produit";

  document.getElementById("productName").value = data?.name || "";
  document.getElementById("productVariant").value = data?.variant || "";
  document.getElementById("productImageUrl").value = data?.imageUrl || "";
  document.getElementById("productPriceBuy").value = data?.price_buy ?? "";
  document.getElementById("productPriceSell").value = data?.price_sell ?? "";
  document.getElementById("productPriceMin").value =
    data?.price_min ?? data?.price_sell ?? "";

  const stockInput = document.getElementById("productStockInitial");
  if (stockInput) {
    stockInput.value = data?.stock_current ?? "";
  }

  if (productStockField) {
    productStockField.classList.toggle("field-hidden", mode !== "add");
  }

  if (productFundingFields) {
    productFundingFields.classList.toggle("field-hidden", mode !== "add");
  }

  const fundingInvestment = document.getElementById("productFundingInvestment");
  const fundingReinvestment = document.getElementById("productFundingReinvestment");
  if (fundingInvestment) {
    fundingInvestment.checked = false;
  }
  if (fundingReinvestment) {
    fundingReinvestment.checked = false;
  }

  const offlineAllowed = document.getElementById("productOfflineAllowed");
  if (offlineAllowed) {
    offlineAllowed.value = data?.offlineBlocked ? "NON" : "OUI";
  }

  const minOfflineInput = document.getElementById("productMinOfflineStock");
  if (minOfflineInput) {
    minOfflineInput.value =
      data?.minOfflineStock ??
      data?.stock_current ??
      "";
  }

  toggleOfflineFields();
  syncProductExpirationFields();

  const hasExpirationInput = document.getElementById("productHasExpiration");
  if (hasExpirationInput) {
    hasExpirationInput.checked = !!data?.hasExpiration;
  }

  const expirationDateInput = document.getElementById("productExpirationDate");
  if (expirationDateInput) {
    expirationDateInput.value = "";
  }

  toggleProductExpirationDateField();
  setProductModalError("");
  productModal.classList.add("show");
  productModal.setAttribute("aria-hidden", "false");
  document.getElementById("productName")?.focus();
}

function readProductForm() {
  const offlineAllowed =
    document.getElementById("productOfflineAllowed")?.value === "OUI";

  const stockRaw = document.getElementById("productStockInitial")?.value;
  const stock =
    productModalMode === "add"
      ? parseInt(stockRaw, 10)
      : editingProductStock;

  const minOfflineRaw =
    document.getElementById("productMinOfflineStock")?.value;

  let offlineBlocked = !offlineAllowed;
  let minOfflineStock =
    productModalMode === "add"
      ? stock
      : Number(editingProductStock || 0);

  if (offlineAllowed) {
    const offlineValue = parseInt(minOfflineRaw, 10);
    const maxStock =
      productModalMode === "add"
        ? stock
        : editingProductStock;

    if (
      !isNaN(offlineValue) &&
      offlineValue >= 0 &&
      offlineValue <= maxStock
    ) {
      minOfflineStock = offlineValue;
    }
  }

  return {
    name: sanitizeText(
      document.getElementById("productName")?.value || ""
    ),
    variant: sanitizeText(
      document.getElementById("productVariant")?.value || ""
    ),
    imageUrl: sanitizeText(
      document.getElementById("productImageUrl")?.value || "",
      500
    ),
    price_buy: parseFloat(
      document.getElementById("productPriceBuy")?.value
    ),
    price_sell: parseFloat(
      document.getElementById("productPriceSell")?.value
    ),
    price_min: parseFloat(
      document.getElementById("productPriceMin")?.value
    ),
    stock,
    offlineBlocked,
    minOfflineStock,
    hasExpiration:
      expirationFeatureEnabled &&
      document.getElementById("productHasExpiration")?.checked === true,
    expirationDateStr:
      document.getElementById("productExpirationDate")?.value || "",
    isInvestment:
      document.getElementById("productFundingInvestment")?.checked === true,
    isReinvestment:
      document.getElementById("productFundingReinvestment")?.checked === true
  };
}

function validateProductForm(data, mode) {
  if (
    !data.name ||
    !data.variant ||
    isNaN(data.price_buy) ||
    isNaN(data.price_sell) ||
    isNaN(data.price_min) ||
    (mode === "add" && isNaN(data.stock))
  ) {
    throw new Error("Valeurs invalides");
  }

  if (
    data.imageUrl &&
    !/^https?:\/\//i.test(data.imageUrl)
  ) {
    throw new Error("URL image invalide");
  }

  if (data.price_min <= data.price_buy) {
    throw new Error("Prix minimum invalide");
  }

  if (data.price_sell < data.price_min) {
    throw new Error("Prix vente invalide");
  }

  if (mode === "add" && data.stock < 0) {
    throw new Error("Stock initial invalide");
  }

  if (
    mode === "edit" &&
    !data.offlineBlocked &&
    data.minOfflineStock >= 1 &&
    data.minOfflineStock > editingProductStock
  ) {
    throw new Error("Stock minimum offline trop élevé");
  }

  if (
    mode === "add" &&
    data.hasExpiration &&
    expirationFeatureEnabled &&
    data.stock > 0 &&
    !data.expirationDateStr
  ) {
    throw new Error("Date expiration requise pour produit périssable");
  }

  if (mode === "add" && !data.isInvestment && !data.isReinvestment) {
    throw new Error("Cochez Investissement ou Réinvestissement");
  }

  return data;
}

async function saveProductFromModal() {
  try {
    const data = validateProductForm(
      readProductForm(),
      productModalMode
    );

    if (productModalMode === "add") {
      const payload = {
        ...data,
        createdBy: currentUserId
      };

      if (isOffline()) {
        const offlineProduct = {
          ...payload,
          id: "offline_" + Date.now(),
          _offline: true
        };

        allProducts.unshift(offlineProduct);
        renderProducts(allProducts);

        addToQueue({
          type: "PRODUCT_CREATE",
          data: payload
        });

        debug("Produit sauvegardé offline");
        showSyncToast("Produit sauvegardé offline", "warning");
        closeProductModal();
        return;
      }

      await processProductCreateOnline(payload);
      debug("Produit enregistré");
      await loadProducts();
      closeProductModal();
      return;
    }

    if (!navigator.onLine) {
      setProductModalError("Modification impossible hors ligne");
      debug("Modification impossible hors ligne");
      return;
    }

    const now = Timestamp.now();

    await updateDoc(doc(db, "products", editingProductId), {
      name: data.name,
      variant: data.variant,
      imageUrl: data.imageUrl,
      price_buy: data.price_buy,
      offlineBlocked: data.offlineBlocked,
      minOfflineStock: data.minOfflineStock,
      price_sell: data.price_sell,
      price_min: data.price_min,
      hasExpiration: expirationFeatureEnabled ? !!data.hasExpiration : false,
      updatedAt: now
    });

    await writeLog({
      userId: currentUserId,
      action: "product_update",
      targetId: editingProductId,
      details: {
        name: data.name,
        variant: data.variant
      }
    });

    debug("Produits synchronisés");
    await loadProducts();
    closeProductModal();
  } catch (err) {
    console.error(err);
    const message = err?.message || "Erreur produit";
    setProductModalError(message);
    debug(message);
  }
}

async function processProductCreateOnline(data) {

  const {
    name,
    variant,
    imageUrl,
    price_buy,
    price_sell,
    price_min,
    stock,
    offlineBlocked,
    minOfflineStock,
    createdBy,
    hasExpiration,
    expirationDateStr,
    isInvestment,
    isReinvestment
  } = data;

  await checkUser(createdBy);

  const config = await getAppConfig();
  const expirationOn = isExpirationEnabled(config);
  const productHasExpiration = expirationOn && !!hasExpiration;
  const expirationTimestamp = productHasExpiration
    ? toExpirationTimestamp(expirationDateStr)
    : null;

  const now = Timestamp.now();

  const productPayload = {
    name,
    variant,
    imageUrl: imageUrl || "",
    category: "default",
    price_buy,
    price_sell,
    price_min,
    stock_current: stock,
    offlineBlocked,
    minOfflineStock,
    stock_alert: 10,
    isActive: true,
    hasExpiration: productHasExpiration,
    expirationDate: expirationTimestamp,
    createdAt: now,
    updatedAt: now
  };

  const prodRef = await addDoc(
    collection(db, "products"),
    productPayload
  );

  const movementPayload = {
    productId: prodRef.id,
    type: "IN",
    quantity: stock,
    reason: "initial",
    referenceId: prodRef.id,
    createdBy,
    createdAt: now
  };

  if (productHasExpiration && expirationTimestamp) {
    movementPayload.expirationDate = expirationTimestamp;
    movementPayload.batchId = buildBatchId();
  }

  await addDoc(
    collection(db, "stock_movements"),
    movementPayload
  );

  await writeLog({
    userId: createdBy,
    action: "product_create",
    targetId: prodRef.id,
    details: {
      name,
      variant,
      stock,
      hasExpiration: productHasExpiration,
      expirationDate: expirationDateStr || null
    }
  });

  const fundingAmount = Number(price_buy) * Number(stock);
  const productLabel = `${name}${variant ? ` (${variant})` : ""}`;

  if (fundingAmount > 0) {
    const expenseTasks = [];

    if (isInvestment) {
      expenseTasks.push(
        recordStockFundingExpense({
          category: "investment",
          amount: fundingAmount,
          reason: `Investissement — ${productLabel}`,
          relatedTo: prodRef.id,
          note: `Stock initial: ${stock}`,
          createdBy,
          createdAt: now
        })
      );
    }

    if (isReinvestment) {
      expenseTasks.push(
        recordStockFundingExpense({
          category: "reinvestment",
          amount: fundingAmount,
          reason: `Réinvestissement — ${productLabel}`,
          relatedTo: prodRef.id,
          note: `Stock initial: ${stock}`,
          createdBy,
          createdAt: now
        })
      );
    }

    if (expenseTasks.length) {
      await Promise.all(expenseTasks);
    }
  }

}

// ------ render
function renderProducts(products) {
  tableBody.replaceChildren();
  
  if (!Array.isArray(products)) return;

  const fragment = document.createDocumentFragment();

  products.forEach(p => {
    const priceSell = Number(p.price_sell) || 0;
    const priceMin = Number(p.price_min) || priceSell;
    const stockCurrent = Number(p.stock_current) || 0;

    const tr = document.createElement("tr");
    if (!p.isActive) {
  tr.style.opacity = "0.5";
    }

    // IMAGE
    const tdImg = document.createElement("td");
    const imgDiv = document.createElement("div");

    imgDiv.className = "product-img";

    if (
      typeof p.imageUrl === "string" &&
      /^https?:\/\/[^"'()<>\s]+$/i.test(p.imageUrl)
    ) {
      imgDiv.style.backgroundImage = `url("${p.imageUrl}")`;
    }

    tdImg.appendChild(imgDiv);

    // NAME
    const tdName = document.createElement("td");
    tdName.textContent = p.name || "-";

    // VARIANT
    const tdVariant = document.createElement("td");
    tdVariant.textContent = p.variant || "-";

    // PRICE SELL
    const tdSell = document.createElement("td");
    tdSell.textContent = `${priceSell.toFixed(2)}${CURRENCY_SYMBOL}`;

    // PRICE MIN
    const tdMin = document.createElement("td");
    tdMin.textContent = `${priceMin.toFixed(2)}${CURRENCY_SYMBOL}`;

    // STOCK
    const tdStock = document.createElement("td");
    tdStock.textContent = String(stockCurrent);

    tdStock.className =
      stockCurrent > (p.stock_alert || 0)
        ? "stock-ok"
        : "stock-low";

    const tdExpiration = document.createElement("td");
    if (p.hasExpiration) {
      tdExpiration.textContent = formatExpirationDate(p.expirationDate);
    } else {
      tdExpiration.textContent = "-";
    }

        const tdState = document.createElement("td");

tdState.textContent =
  `${p.isActive ? "Actif" : "Désactivé"} | ${
    p.offlineBlocked
      ? "Offline bloqué"
      : `Offline ≥ ${p.minOfflineStock}`
  }`;

tdState.className = p.isActive
  ? "stock-ok"
  : "stock-low";
  

    // ACTIONS
    const tdActions = document.createElement("td");

    const editBtn = document.createElement("button");
    editBtn.className = "btn btn-edit";
    editBtn.textContent = "Modifier";
    
    const activateBtn = document.createElement("button");
    const deleteBtn = document.createElement("button");
deleteBtn.className = "btn btn-delete";
deleteBtn.textContent = "Supprimer";

deleteBtn.addEventListener("click", () => {
  deleteProduct(p.id, p.name);
});
    
    if (p.isActive) {
  activateBtn.className = "btn btn-add";
  activateBtn.textContent = "Désactiver";
} else {
  activateBtn.className = "btn btn-add";
  activateBtn.textContent = "Réactiver";
}

    editBtn.addEventListener("click", () => {
      openProductModal("edit", p);
    });

    activateBtn.addEventListener("click", () => {
  toggleProductStatus(p.id, p.name, p.isActive);
});

    tdActions.append(editBtn, activateBtn, deleteBtn);

    tr.append(
      tdImg,
      tdName,
      tdVariant,
      tdSell,
      tdMin,
      tdStock,
      tdExpiration,
      tdState,
      tdActions
    );

    fragment.appendChild(tr);
  });

  tableBody.appendChild(fragment);
}

// search box 
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const value = e.target.value.toLowerCase().trim();

    const filtered = allProducts.filter(p => {
      const name = (p.name || "").toLowerCase();
      const variant = (p.variant || "").toLowerCase();

      return name.includes(value) || variant.includes(value);
    });

    renderProducts(filtered);
  });
}

// --- LOAD PRODUCTS ---
async function loadProducts() {
  const prodSnap = await getDocs(
  collection(db, "products")
);

if (prodSnap.metadata.fromCache) {
  debug("Produits chargés depuis cache offline");
} else {
  debug("Produits synchronisés");
}

  allProducts = prodSnap.docs
    .map(d => ({
      id: d.id,
      ...d.data()
    }));

  if (searchInput) searchInput.value = "";

  renderProducts(allProducts);
}

// --- ADD PRODUCT ---
addBtn.addEventListener("click", () => {
  openProductModal("add");
});

document.getElementById("productSaveBtn")?.addEventListener("click", () => {
  saveProductFromModal();
});

document.getElementById("productCancelBtn")?.addEventListener("click", () => {
  closeProductModal();
});

document.getElementById("productOfflineAllowed")?.addEventListener("change", () => {
  toggleOfflineFields();
});

document.getElementById("productHasExpiration")?.addEventListener("change", () => {
  toggleProductExpirationDateField();
});

productModal?.addEventListener("click", (event) => {
  if (event.target === productModal) {
    closeProductModal();
  }
});

// --- DEACTIVATE PRODUCT ---
async function toggleProductStatus(id, name, currentState) {
    if (!navigator.onLine) {
  debug("Modification impossible hors ligne");
  return;
}

  const actionText = currentState
    ? "désactiver"
    : "réactiver";

  const confirmed = await showConfirmModal(
    "Confirmation",
    `Confirmer ${actionText} ${sanitizeText(name)} ?`
  );

  if (!confirmed) {
    return;
  }

  const now = Timestamp.now();

  await updateDoc(doc(db, "products", id), {
    isActive: !currentState,
    updatedAt: now
  });

  await writeLog({
    userId: currentUserId,
    action: currentState ? "product_deactivate" : "product_activate",
    targetId: id,
    details: { name: sanitizeText(name) }
  });

  debug(
    currentState
      ? "Produit désactivé"
      : "Produit réactivé"
  );

  await loadProducts();
}

/*    --- Supprimer produit  ---    */
async function deleteProduct(id, name) {
  if (!navigator.onLine) {
    debug("Suppression impossible hors ligne");
    return;
  }

  const safeName = sanitizeText(name);

  const firstConfirm = await showConfirmModal(
    "Attention",
    "Le produit sera supprimé définitivement. Cette action ne pourra pas être annulée."
  );

  if (!firstConfirm) {
    return;
  }

  const secondConfirm = await showConfirmModal(
    "Confirmation finale",
    `Êtes-vous absolument certain de vouloir supprimer "${safeName}" ?`
  );

  if (!secondConfirm) {
    return;
  }

  try {
    await deleteDoc(doc(db, "products", id));

    await writeLog({
      userId: currentUserId,
      action: "product_delete",
      targetId: id,
      details: { name: safeName }
    });

    debug("Produit supprimé");

    await loadProducts();
  } catch (err) {
    console.error(err);
    debug("Erreur suppression produit");
  }
}

// --- INIT ---
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Utilisateur non connecté !");
    window.location.replace("login.html");
    return;
  }

  try {
    currentUserId = user.uid;
    await checkUser(currentUserId);
    
    setupNetworkListeners(async () => {
  await syncQueue({
    PRODUCT_CREATE:
      processProductCreateOnline
  });
});
    updateNetworkBadge(navigator.onLine);
    await loadCurrencyConfig();
    await loadProducts();
  } catch (e) {
    alert(e.message);
    console.error(e);
  }
});
