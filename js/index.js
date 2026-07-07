//v3 index.js FINAL ULTRA PRO + ANTI DOUBLE VENTE + debts logique + manual Stock + muti seller + OFFLINE + manual quantity + rapide ( OK )
import { 
  db, collection, addDoc, setDoc, getDoc, doc, updateDoc, Timestamp, getDocs, query, where, enableIndexedDbPersistence, runTransaction, serverTimestamp, writeLog
} from './firebase.js';
 
import {
  registerServiceWorker,
  setupInstallButton,
  setupNetworkListeners,
  syncQueue,
  addToQueue,
  initOfflinePersistence,
  validateOfflineProduct,
  isOffline,
  showOfflineWarning,
  showSyncToast
} from "./offline.js";

import { getAppConfig } from "./appConfig.js";
import {
  isExpirationEnabled,
  allocateFifo,
  refreshProductExpirationCache,
  getProductExpirationDisplay,
  getSellableQty
} from "./expiration.js";

import { getAuth, onAuthStateChanged } from "./auth.js";
import { generateReceipt } from "./receipt.js";
import { bindActionButton } from "./utils/buttonManager.js";


// --- DOM ---
const paymentType = document.getElementById('paymentType');
const amountPaidInput = document.getElementById('amountPaid');
const clientNameInput = document.getElementById('clientName');

const status = document.getElementById("status");

const productsContainer = document.getElementById('productsContainer');
const cartDom = document.querySelector('.cart');
const cartTotalDom = cartDom.querySelector('.total');
const sellBtn = cartDom.querySelector('.sell-btn');
const manualDateCheckbox = document.getElementById('manualDate');
const saleDateInput = document.getElementById('saleDate');
const searchInput = document.getElementById('searchInput');

let CURRENCY_SYMBOL = "$";

async function loadCurrencyConfig() {

  try {
    const cfg = await getAppConfig(true);

    CURRENCY_SYMBOL =
      cfg?.currencySymbol || "$";
    // refresh UI
    renderProducts(allProducts);
    updateCartUI();
  } catch (err) {
    console.error(err);
  }
}

//limit sales date
const today = new Date().toISOString().split("T")[0];
saleDateInput.max = today;
saleDateInput.min = "2026-04-30";
// sécurité date
saleDateInput.addEventListener("input", () => {
  const selected = new Date(saleDateInput.value).getTime();

  if (selected > Date.now()) {
    saleDateInput.value = "";
    alert("Date future interdite");
  }
});
manualDateCheckbox.addEventListener("change", () => {

  saleDateInput.disabled =
    !manualDateCheckbox.checked;

  if (!manualDateCheckbox.checked) {
    saleDateInput.value = "";
  }

});


// ---- open debts input 
function togglePaymentInput() {
  const isPartial = paymentType?.value === "partial";

  amountPaidInput.style.display = isPartial ? "block" : "none";

  if (!isPartial) {
    amountPaidInput.value = "";
  }
}

// INIT
document.addEventListener("DOMContentLoaded", () => {
  togglePaymentInput();
});

// EVENTS
paymentType.addEventListener('change', togglePaymentInput);

// 🔥 IMPORTANT : sync initial state au chargement
togglePaymentInput();

// --- STATE ---
let cart = [];
let allProducts = [];
let expirationFeatureEnabled = false;
let expirationAlertDays = 30;
let movementsByProduct = {};

// --- AUTH ---
const auth = getAuth();
let currentUserId = null;


// --- date format---
function getSaleDate() {

  const now = Date.now();

  if (manualDateCheckbox?.checked && saleDateInput?.value) {
    const selected = new Date(saleDateInput.value).getTime();

    // 🚫 future strict
    if (selected > now) {
      throw new Error("Date invalide (future)");
    }

    // 🚫 too old (option sécurité business)
    const maxPast = now - (365 * 24 * 60 * 60 * 1000);
    if (selected < maxPast) {
      throw new Error("Date trop ancienne");
    }
    return selected;
  }
  return now;
}

// --- SECURITY ---
async function checkUser(uid) {
  const userDoc = await getDoc(doc(db, "users", uid));
  if (!userDoc.exists()) throw new Error("Utilisateur inconnu");

  const data = userDoc.data();
  if (!data.isActive || !["admin","seller"].includes(data.role)) {
    throw new Error("Accès refusé");
  }

  return data;
}

function getAvailableStock(p) {
  const cacheStock = Number(p.stock_current) || 0;

  if (!expirationFeatureEnabled || !p.hasExpiration) {
    return cacheStock;
  }

  const movements = movementsByProduct[p.id] || [];
  const sellable = getSellableQty(movements, p.id);

  return Math.min(cacheStock, sellable);
}

async function loadProductMovements(products) {
  movementsByProduct = {};

  const perishable = products.filter(p => p.hasExpiration);
  if (!perishable.length) return;

  await Promise.all(
    perishable.map(async product => {
      const movSnap = await getDocs(
        query(
          collection(db, "stock_movements"),
          where("productId", "==", product.id)
        )
      );

      movementsByProduct[product.id] = movSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));
    })
  );
}

// --- LOAD PRODUCTS ---
async function loadProducts() {
  const cfg = await getAppConfig(true);
  expirationFeatureEnabled = isExpirationEnabled(cfg);
  expirationAlertDays = cfg?.expirationAlertDays ?? 30;

  const snap = await getDocs(collection(db, "products"));
  allProducts = [];

  snap.forEach(docSnap => {
    const p = docSnap.data();
    if (!p?.isActive) return;

    const price_min = p.price_min ?? p.price_sell ?? p.price_buy ?? 0;

    allProducts.push({
      id: docSnap.id,
      ...p,
      price_min
    });
  });

  if (expirationFeatureEnabled) {
    await loadProductMovements(allProducts);
  } else {
    movementsByProduct = {};
  }

  renderProducts(allProducts);
}

// --- RENDER ---
function renderProducts(list) {

  productsContainer.replaceChildren();

  list.forEach(p => {

    const div = document.createElement("div");
    div.className = "product fade-in";

    const expInfo = expirationFeatureEnabled
      ? getProductExpirationDisplay(
        p,
        movementsByProduct[p.id] || [],
        { alertDays: expirationAlertDays }
      )
      : null;

    const availableStock = getAvailableStock(p);

    if (expInfo?.expired) {
      div.classList.add("product-expired");
    }

    const img = p.imageUrl || "default.png";

    div.style.backgroundImage = `url(${img})`;
    div.style.backgroundSize = "cover";
    div.style.backgroundPosition = "center";

    if (expInfo?.style) {
      const badge = document.createElement("span");
      badge.className = "exp-badge";
      badge.textContent = expInfo.style.label;
      badge.style.backgroundColor = expInfo.style.backgroundColor;
      badge.style.color = expInfo.style.color;
      div.appendChild(badge);
    }

    const content = document.createElement("div");
    content.className = "product-content";

    // --- NAME ---
    const title = document.createElement("h4");
    title.textContent = p.name;

    // --- VARIANT ---
    const variant = document.createElement("div");

    if (p.variant) {

      variant.textContent = p.variant;

      variant.style.fontSize = "12px";
      variant.style.opacity = "0.82";
      variant.style.fontStyle = "italic";
      variant.style.marginTop = "-4px";

    }

    // --- STOCK ---
    const stock = document.createElement("p");

    if (expInfo && !expInfo.expired) {
      stock.textContent = `Stock: ${availableStock}`;
    } else if (expInfo?.expired) {
      stock.textContent = "Stock expiré";
    } else {
      stock.textContent = `Stock: ${p.stock_current ?? 0}`;
    }

    // --- PRICE ---
    const price = document.createElement("p");

    price.textContent =
  `${(p.price_sell || 0).toFixed(2)} ${CURRENCY_SYMBOL}`;

    // --- QUICK ADD ---
    div.addEventListener("click", (e) => {

      if (
        e.target.closest("input") ||
        e.target.closest("button")
      ) {
        return;
      }

      if (expInfo?.expired) {
        alert("Produit expiré — vente impossible");
        return;
      }

      addToCart(p);

    });

    // --- APPEND ---
    content.appendChild(title);

    if (p.variant) {
      content.appendChild(variant);
    }

    content.appendChild(stock);
    content.appendChild(price);

    div.appendChild(content);

    productsContainer.appendChild(div);

    requestAnimationFrame(() => {
      div.classList.add("visible");
    });
  });
}

// --- SEARCH ---
searchInput.addEventListener('input', () => {
  const v = searchInput.value.toLowerCase();
  renderProducts(
    allProducts.filter(p =>
      p.name.toLowerCase().includes(v) ||
      (p.variant || "").toLowerCase().includes(v)
    )
  );
});


// --- CART ---
function addToCart(p) {

  const availableStock = getAvailableStock(p);

  if (availableStock <= 0) {
    if (
      expirationFeatureEnabled &&
      p.hasExpiration &&
      (Number(p.stock_current) || 0) > 0
    ) {
      alert("Stock expiré — vente impossible");
    } else {
      alert("Stock épuisé");
    }
    return;
  }

  try {

    validateOfflineProduct(p);

  } catch (err) {

    alert(err.message);
    return;

  }

  const exist = cart.find(i => i.productId === p.id);

  if (exist) {

    if (exist.qty >= availableStock) {
      alert("Stock max atteint");
      return;
    }

    exist.qty++;

  } else {

    cart.push({
      productId: p.id,
      name: p.name,
      variant: p.variant || "",
      price: p.price_sell,
      price_min: p.price_min,
      price_buy: p.price_buy || 0,
      qty: 1
    });

  }

  updateCartUI();

}

function addToCartManual(p, qty) {

  const availableStock = getAvailableStock(p);

  if (availableStock <= 0) {
    if (
      expirationFeatureEnabled &&
      p.hasExpiration &&
      (Number(p.stock_current) || 0) > 0
    ) {
      alert("Stock expiré — vente impossible");
    } else {
      alert("Stock épuisé");
    }
    return;
  }

  try {

    validateOfflineProduct(p);

  } catch (err) {

    alert(err.message);
    return;

  }

  const exist = cart.find(i => i.productId === p.id);

  if (exist) {

    const newQty = exist.qty + qty;

    if (newQty > availableStock) {

      exist.qty = availableStock;
      alert("Stock max atteint");

    } else {

      exist.qty = newQty;

    }

  } else {

    cart.push({
      productId: p.id,
      name: p.name,
      variant: p.variant || "",
      price: p.price_sell,
      price_min: p.price_min,
      price_buy: p.price_buy || 0,
      qty: Math.min(qty, availableStock)
    });

  }

  updateCartUI();

}


function removeFromCart(id) {
  const i = cart.findIndex(x => x.productId === id);
  if (i !== -1) {
    cart[i].qty--;
    if (cart[i].qty <= 0) cart.splice(i,1);
  }
  updateCartUI();
}

// --- CART UI ---
function updateCartUI() {

  // 🔥 supprimer UNIQUEMENT anciens items
  cartDom
    .querySelectorAll(".cart-item")
    .forEach(el => el.remove());

  const frag = document.createDocumentFragment();

  let total = 0;

  const productMap = new Map(
    allProducts.map(p => [p.id, p])
  );

  cart.forEach(item => {

    total += item.price * item.qty;

    const div = document.createElement("div");
    div.className = "cart-item";

    const name = document.createElement("span");
    name.textContent = `${item.name} x${item.qty}`;

    const controls = document.createElement("span");
    controls.className = "cart-controls";

    // ======================
    // QTY INPUT
    // ======================
    const qtyInput = document.createElement("input");

    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.value = item.qty;

    qtyInput.classList.add("cart-qty-input");

    qtyInput.style.setProperty(
      "width",
      "38px",
      "important"
    );

    const qtyOk = document.createElement("button");
    qtyOk.textContent = "OK";

    qtyOk.addEventListener("click", () => {

      const val = Number(qtyInput.value);

      if (!Number.isFinite(val) || val <= 0) {
        qtyInput.value = item.qty;
        return alert("Qté invalide");
      }

      const product = productMap.get(item.productId);

      if (!product) {
        return alert("Produit introuvable");
      }

      const stockMax = getAvailableStock(product);

      if (val > stockMax) {
        qtyInput.value = item.qty;
        if (stockMax <= 0 && expirationFeatureEnabled && product.hasExpiration) {
          return alert("Stock expiré — vente impossible");
        }
        return alert(`Stock max: ${stockMax}`);
      }

      item.qty = val;

      updateCartUI();
    });

    // ======================
    // PRICE INPUT
    // ======================
    const priceInput = document.createElement("input");

    priceInput.type = "number";
    priceInput.value = item.price;
    priceInput.min = item.price_min;

    priceInput.classList.add("cart-price-input");

    priceInput.style.setProperty(
      "width",
      "50px",
      "important"
    );

    const priceOk = document.createElement("button");
    priceOk.textContent = "OK";

    priceOk.addEventListener("click", () => {

      const val = Number(priceInput.value);

      if (!Number.isFinite(val)) {
        priceInput.value = item.price;
        return alert("Prix invalide");
      }

      if (val < item.price_min) {
        priceInput.value = item.price;
        return alert(`Minimum: ${item.price_min}`);
      }

      item.price = val;

      updateCartUI();
    });

    // ======================
    // DELETE
    // ======================
    const del = document.createElement("button");

    del.textContent = "x";

    del.addEventListener("click", () => {
      removeFromCart(item.productId);
    });

    // ======================
    // APPEND
    // ======================
    controls.append(
      qtyInput,
      qtyOk,
      priceInput,
      priceOk,
      del
    );

    div.append(name, controls);

    frag.appendChild(div);
  });

  // 🔥 INSERT SAFE
  cartDom.insertBefore(
    frag,
    cartTotalDom
  );

  // 🔥 TOTAL SAFE
  cartTotalDom.textContent =
  `Total: ${total.toFixed(2)} ${CURRENCY_SYMBOL}`;
}

// calculator pour dettes 
function computePayment(totalAmount, paymentMode, inputAmount) {

  let amount_paid = totalAmount;

  if (paymentMode === "partial") {

    if (inputAmount === "" || inputAmount === null || inputAmount === undefined) {
      throw new Error("Montant requis");
    }

    const val = Number(inputAmount);

    if (isNaN(val)) throw new Error("Montant invalide");
    if (val <= 0 || val >= totalAmount) {
      throw new Error("Montant partiel incorrect");
    }

    amount_paid = val;
  }

  const amount_remaining = totalAmount - amount_paid;

  return {
    payment_status: amount_remaining === 0 ? "paid" : "partial",
    amount_paid,
    amount_remaining,
    hasDebt: amount_remaining > 0
  };
}

// --- onLine ---
async function processSaleOnline(data) {

  const {
    cart,
    userId,
    name,
    sellerId,
    payment,
    saleDate,
    totalAmount,
    totalProfit,
    offlineActionId,
    deviceId
  } = data;

  const finalSellerId = sellerId || userId;

  const saleRef = doc(collection(db, "sales"));

  // 🔒 anti double sync offline
  if (offlineActionId) {

    const q = query(
      collection(db, "sales"),
      where("offlineActionId", "==", offlineActionId)
    );

    const existing = await getDocs(q);

    if (!existing.empty) {
      alert("⚠️ Vente déjà synchronisée");
      return null;
    }
  }

  // =========================
  // 0. VALIDATION EXPIRATION (avant transaction)
  // =========================
  const config = await getAppConfig();
  const expirationOn = isExpirationEnabled(config);
  const saleAsOfDate = new Date(saleDate);

  const productMeta = {};
  const saleMovementsByProduct = {};

  for (const item of cart) {
    const snap = await getDoc(doc(db, "products", item.productId));
    productMeta[item.productId] = snap.exists() ? snap.data() : {};
  }

  if (expirationOn) {
    for (const item of cart) {
      if (!productMeta[item.productId]?.hasExpiration) continue;

      const movSnap = await getDocs(
        query(
          collection(db, "stock_movements"),
          where("productId", "==", item.productId)
        )
      );

      saleMovementsByProduct[item.productId] = movSnap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));

      const sellable = getSellableQty(
        saleMovementsByProduct[item.productId],
        item.productId,
        saleAsOfDate
      );

      if (item.qty > sellable) {
        if (sellable <= 0) {
          throw new Error(
            `${productMeta[item.productId]?.name || "Produit"} : stock expiré`
          );
        }
        throw new Error(
          `${productMeta[item.productId]?.name || "Produit"} : stock vendable insuffisant (${sellable})`
        );
      }

      allocateFifo(
        item.productId,
        item.qty,
        saleMovementsByProduct[item.productId],
        { excludeExpired: true, asOfDate: saleAsOfDate }
      );
    }
  }

  // =========================
  // 1. STOCK (SEULE PARTIE CRITIQUE)
  // =========================
  await runTransaction(db, async (tx) => {

  const productSnapshots = [];

  // 1. READS ONLY
  for (const item of cart) {

    const ref = doc(db, "products", item.productId);

    const snap = await tx.get(ref);

    productSnapshots.push({
      item,
      ref,
      snap
    });
  }

  // 2. WRITES ONLY
  for (const data of productSnapshots) {

    const {
      item,
      ref,
      snap
    } = data;

    if (!snap.exists()) {
      throw new Error("Produit supprimé");
    }

    const stock =
      snap.data().stock_current || 0;

    if (stock < item.qty) {
      throw new Error("Stock insuffisant");
    }

    tx.update(ref, {
      stock_current: stock - item.qty
    });
  }

  tx.set(saleRef, {
  sellerId: finalSellerId,
  clientName: name,
  total_amount: totalAmount,
  total_profit: totalProfit,
  offlineActionId: offlineActionId || null,
  deviceId: deviceId || null,
  syncSource: offlineActionId ? "offline-sync" : "online",
  status: "active",
  ...payment,
  createdAt: Timestamp.fromMillis(saleDate)
});

});

  const itemsBatch = [];
  const movementsBatch = [];
  const productsToRefresh = new Set();

  for (const item of cart) {
    const product = productMeta[item.productId];
    const useFifo = expirationOn && product?.hasExpiration;

    if (!useFifo) {
      const itemRef = doc(collection(db, "sale_items"));
      itemsBatch.push(setDoc(itemRef, {
        saleId: saleRef.id,
        productId: item.productId,
        quantity: item.qty,
        price: item.price,
        price_min: item.price_min,
        profit: (item.price - item.price_buy) * item.qty,
        createdAt: Timestamp.fromMillis(saleDate)
      }));

      const moveRef = doc(collection(db, "stock_movements"));
      movementsBatch.push(setDoc(moveRef, {
        productId: item.productId,
        type: "OUT",
        quantity: item.qty,
        reason: "sale",
        referenceId: saleRef.id,
        createdBy: finalSellerId,
        createdAt: Timestamp.fromMillis(saleDate)
      }));

      continue;
    }

    const allocations = allocateFifo(
      item.productId,
      item.qty,
      saleMovementsByProduct[item.productId] || [],
      { excludeExpired: true, asOfDate: saleAsOfDate }
    );

    for (const allocation of allocations) {
      const itemRef = doc(collection(db, "sale_items"));
      const itemPayload = {
        saleId: saleRef.id,
        productId: item.productId,
        quantity: allocation.qty,
        price: item.price,
        price_min: item.price_min,
        profit: (item.price - item.price_buy) * allocation.qty,
        createdAt: Timestamp.fromMillis(saleDate)
      };

      if (allocation.expirationDate) {
        itemPayload.expirationDate = allocation.expirationDate;
      }

      itemsBatch.push(setDoc(itemRef, itemPayload));

      const moveRef = doc(collection(db, "stock_movements"));
      const movePayload = {
        productId: item.productId,
        type: "OUT",
        quantity: allocation.qty,
        reason: "sale",
        referenceId: saleRef.id,
        createdBy: finalSellerId,
        createdAt: Timestamp.fromMillis(saleDate)
      };

      if (allocation.expirationDate) {
        movePayload.expirationDate = allocation.expirationDate;
      }

      if (allocation.batchId) {
        movePayload.batchId = allocation.batchId;
      }

      movementsBatch.push(setDoc(moveRef, movePayload));
    }

    productsToRefresh.add(item.productId);
  }

  await Promise.all([...itemsBatch, ...movementsBatch]);

  for (const productId of productsToRefresh) {
    const movSnap = await getDocs(
      query(
        collection(db, "stock_movements"),
        where("productId", "==", productId)
      )
    );

    const movements = movSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    await refreshProductExpirationCache(productId, movements);
  }

  // =========================
  // 4. DEBT (SI PARTIEL)
  // =========================
  if (payment.payment_status === "partial") {

    const debtRef = doc(collection(db, "debts"));

    await setDoc(debtRef, {
      category: "debt",
      reason: "debt",
      name: name,
      amount: payment.amount_remaining,
      amount_total: totalAmount,
      amount_paid: payment.amount_paid,
      amount_remaining: payment.amount_remaining,
      status: "partial",
      isSystemCorrection: false,
      relatedSaleId: saleRef.id,
      DueDate: Timestamp.fromMillis(saleDate + 7 * 86400000),
      createdAt: Timestamp.fromMillis(saleDate),
      updatedAt: Timestamp.fromMillis(saleDate),
      createdBy: finalSellerId
    });
  }

  await writeLog({
    userId: finalSellerId,
    action: "sale_create",
    targetId: saleRef.id,
    details: {
      totalAmount,
      totalProfit,
      paymentStatus: payment.payment_status,
      clientName: name,
      itemCount: cart.length,
      syncSource: offlineActionId ? "offline-sync" : "online"
    }
  });

  // =========================
  // RETURN
  // =========================
  return saleRef.id;
}

// --- SELL (ANTI DOUBLE) ---
bindActionButton(sellBtn, async () => {

  if (!cart.length) return;

  try {

    await checkUser(currentUserId);

    // ⚡ UNE SEULE LOOP (optimisation importante)
    let totalAmount = 0;
    let totalProfit = 0;

    for (const item of cart) {
      totalAmount += item.qty * item.price;
      totalProfit += (item.price - item.price_buy) * item.qty;
    }

    const paymentMode = paymentType.value;

    const name = (clientNameInput?.value || "").trim();
    if (!name) {
      alert("Le nom du client est obligatoire");
      clientNameInput?.focus();
      return;
    }

    const payment = computePayment(
      totalAmount,
      paymentMode,
      amountPaidInput.value
    );

    let saleDate;

    try {
      saleDate = getSaleDate();
    } catch (e) {
      alert(e.message);
      return;
    }

    const payload = {
      cart: structuredClone(cart),
      sellerId: currentUserId,
      name,
      payment,
      saleDate,
      totalAmount,
      totalProfit
    };

    // ======================
    // OFFLINE MODE (UNCHANGED LOGIC)
    // ======================
    if (isOffline()) {

      addToQueue({
        type: "SALE",
        data: payload
      });

      // ⚡ UI RESET AVANT PDF (UX plus rapide)
      const receiptData = {
        saleId: `OFFLINE-${Date.now()}`,
        name,
        items: cart.map(i => ({
          name: i.name,
          qty: i.qty,
          price: i.price
        })),
        total: totalAmount,
        amountPaid: payment.amount_paid,
        remaining: payment.amount_remaining,
        paymentMode: payment.payment_status,
        date: new Date(saleDate),
        offline: true
      };

      cart = [];
      updateCartUI();

      try {
        await generateReceipt(receiptData);
      } catch (err) {
        console.warn("Receipt offline failed:", err);
      }

      showOfflineWarning();
      showSyncToast("📦 Vente enregistrée hors ligne", "warning");

      return;
    }

    // ======================
    // ONLINE MODE
    // ======================
    const saleId = await processSaleOnline(payload);

    if (!saleId) return;

    // ⚡ reset cart PLUS TÔT (UX fluide)
    const receiptItems = cart.map(i => ({
      name: i.name,
      qty: i.qty,
      price: i.price
    }));

    cart = [];
    updateCartUI();

    try {
      await generateReceipt({
        saleId,
        name,
        items: receiptItems,
        total: totalAmount,
        amountPaid: payment.amount_paid,
        remaining: payment.amount_remaining,
        paymentMode: payment.payment_status,
        date: new Date(saleDate)
      });
    } catch (err) {
      console.warn("Receipt failed:", err);
    }

    showSyncToast("📦 Vente ok", "warning");

  } catch (e) {
    alert(e.message);
  }
});

// --- INIT ---
onAuthStateChanged(auth, async (user) => {
  if (!user) return location.replace("login.html");

  currentUserId = user.uid;

  try {
      await checkUser(currentUserId);
      await loadCurrencyConfig();
      await loadProducts();
      await syncQueue({SALE: processSaleOnline});
  } catch(e){
  alert(e.message);
    }
});
setupNetworkListeners(async () => {

  setTimeout(() => {
  syncQueue({SALE: processSaleOnline});
  }, 500);
});

registerServiceWorker();

setupInstallButton();
function resetPaymentUI() {
  amountPaidInput.value = "";
  amountPaidInput.style.display = "none";
  }
 
