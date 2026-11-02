import { getAuth, onAuthStateChanged } from "../../js/auth.js";
import {
  loadBatchProducts,
  createBatchProduct,
  updateBatchProduct,
  toggleBatchProductActive,
  deleteBatchProduct,
  loadBatches,
  createBatch,
  updateBatch,
  cancelBatch,
  deleteBatch,
  recordBatchSale
} from "./batch-service.js";
import {
  showToast,
  setStatus,
  openModal,
  closeModal,
  formatMoney,
  formatDate,
  statusBadge
} from "./batch-utils.js";
import { bindActionButton } from "../../js/utils/buttonManager.js";
import { upsertClientByName } from "../../js/clients-service.js";

const auth = getAuth();
let currentUserId = null;
let products = [];
let batches = [];
let productsMap = {};
let editingProductId = null;
let editingBatchId = null;

let selectedProductId = null;
let selectedSaleBatchId = null;
let showDepleted = false;

const els = {
  productsList: document.getElementById("productsList"),
  batchesList: document.getElementById("batchesList"),
  batchListSearch: document.getElementById("batchListSearch"),
  showDepletedBtn: document.getElementById("showDepletedBtn"),
  batchProductSearch: document.getElementById("batchProductSearch"),
  batchProductList: document.getElementById("batchProductList"),
  batchProductSelectedLabel: document.getElementById("batchProductSelectedLabel"),
  batchProductClearBtn: document.getElementById("batchProductClearBtn"),
  createBatchBtn: document.getElementById("createBatchBtn"),
  saleBatchSearch: document.getElementById("saleBatchSearch"),
  saleBatchList: document.getElementById("saleBatchList"),
  saleBatchSelectedLabel: document.getElementById("saleBatchSelectedLabel"),
  saleBatchClearBtn: document.getElementById("saleBatchClearBtn"),
  recordSaleBtn: document.getElementById("recordSaleBtn"),
  productName: document.getElementById("productName"),
  productNote: document.getElementById("productNote"),
  batchQty: document.getElementById("batchQty"),
  batchCost: document.getElementById("batchCost"),
  saleQty: document.getElementById("saleQty"),
  saleAmount: document.getElementById("saleAmount"),
  saleClientName: document.getElementById("saleClientName"),
  saleReason: document.getElementById("saleReason"),
  editProductName: document.getElementById("editProductName"),
  editProductNote: document.getElementById("editProductNote"),
  editProductError: document.getElementById("editProductError"),
  editBatchQty: document.getElementById("editBatchQty"),
  editBatchCost: document.getElementById("editBatchCost"),
  editBatchError: document.getElementById("editBatchError")
};

function blockAccess() {
  document.body.replaceChildren();
  const div = document.createElement("div");
  div.style.cssText =
    "display:flex;height:100vh;align-items:center;justify-content:center;background:#111;color:#fff;font-size:18px;";
  div.textContent = "⛔ Accès refusé — connectez-vous.";
  document.body.appendChild(div);
}

function rebuildProductsMap() {
  productsMap = {};
  products.forEach(p => {
    productsMap[p.id] = p;
  });
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isDepletedBatch(batch) {
  return (
    batch.status === "depleted" ||
    Number(batch.quantity_remaining) <= 0
  );
}

function getActiveProducts() {
  return products.filter(p => p.isActive !== false);
}

function getSellableBatches() {
  return batches.filter(
    b => b.status === "active" && Number(b.quantity_remaining) > 0
  );
}

function syncActionButtons() {
  if (els.createBatchBtn) {
    els.createBatchBtn.disabled = !selectedProductId;
  }
  if (els.recordSaleBtn) {
    els.recordSaleBtn.disabled = !selectedSaleBatchId;
  }
}

function setProductSelection(productId) {
  selectedProductId = productId || null;
  const product = selectedProductId
    ? productsMap[selectedProductId]
    : null;

  if (els.batchProductSelectedLabel) {
    els.batchProductSelectedLabel.textContent = product
      ? product.name || selectedProductId
      : "Aucun";
    els.batchProductSelectedLabel.classList.toggle("is-empty", !product);
  }
  if (els.batchProductClearBtn) {
    els.batchProductClearBtn.hidden = !product;
  }
  if (els.batchProductSearch && product) {
    els.batchProductSearch.value = "";
  }
  syncActionButtons();
  renderProductPickerList();
}

function setSaleBatchSelection(batchId) {
  selectedSaleBatchId = batchId || null;
  const batch = selectedSaleBatchId
    ? batches.find(b => b.id === selectedSaleBatchId)
    : null;
  const name = batch
    ? productsMap[batch.productId]?.name || batch.productId
    : null;

  if (els.saleBatchSelectedLabel) {
    els.saleBatchSelectedLabel.textContent = batch
      ? `${name} — reste ${batch.quantity_remaining}`
      : "Aucun";
    els.saleBatchSelectedLabel.classList.toggle("is-empty", !batch);
  }
  if (els.saleBatchClearBtn) {
    els.saleBatchClearBtn.hidden = !batch;
  }
  if (els.saleBatchSearch && batch) {
    els.saleBatchSearch.value = "";
  }
  syncActionButtons();
  renderSaleBatchPickerList();
}

function renderProductPickerList() {
  const box = els.batchProductList;
  if (!box) return;
  box.replaceChildren();

  const term = normalizeSearch(els.batchProductSearch?.value || "");
  let list = getActiveProducts();

  if (term) {
    list = list.filter(p => {
      const hay = normalizeSearch(`${p.name || ""} ${p.note || ""} ${p.id}`);
      return hay.includes(term);
    });
  }

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = term
      ? "Aucun produit trouvé."
      : "Aucun produit actif.";
    box.appendChild(empty);
    return;
  }

  list.forEach(product => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-item";
    btn.setAttribute("role", "option");
    if (product.id === selectedProductId) {
      btn.classList.add("is-active");
    }

    const title = document.createElement("span");
    title.textContent = product.name || product.id;
    btn.appendChild(title);

    if (product.note) {
      const sub = document.createElement("span");
      sub.className = "picker-item-sub";
      sub.textContent = product.note;
      btn.appendChild(sub);
    }

    btn.addEventListener("click", () => {
      setProductSelection(product.id);
    });
    box.appendChild(btn);
  });
}

function renderSaleBatchPickerList() {
  const box = els.saleBatchList;
  if (!box) return;
  box.replaceChildren();

  const term = normalizeSearch(els.saleBatchSearch?.value || "");
  let list = getSellableBatches();

  if (term) {
    list = list.filter(b => {
      const name = productsMap[b.productId]?.name || "";
      const hay = normalizeSearch(`${name} ${b.id} ${b.productId}`);
      return hay.includes(term);
    });
  }

  if (!list.length) {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = term
      ? "Aucun lot trouvé."
      : "Aucun lot actif avec stock.";
    box.appendChild(empty);
    return;
  }

  list.forEach(batch => {
    const name = productsMap[batch.productId]?.name || batch.productId;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "picker-item";
    btn.setAttribute("role", "option");
    if (batch.id === selectedSaleBatchId) {
      btn.classList.add("is-active");
    }

    const title = document.createElement("span");
    title.textContent = `${name} — Lot ${batch.id.slice(0, 8)}…`;
    btn.appendChild(title);

    const sub = document.createElement("span");
    sub.className = "picker-item-sub";
    sub.textContent = `Reste ${batch.quantity_remaining} • coût/u ${formatMoney(batch.cost_unit_avg)}`;
    btn.appendChild(sub);

    btn.addEventListener("click", () => {
      setSaleBatchSelection(batch.id);
    });
    box.appendChild(btn);
  });
}

function refreshPickers() {
  if (
    selectedProductId &&
    !getActiveProducts().some(p => p.id === selectedProductId)
  ) {
    selectedProductId = null;
  }
  if (
    selectedSaleBatchId &&
    !getSellableBatches().some(b => b.id === selectedSaleBatchId)
  ) {
    selectedSaleBatchId = null;
  }
  setProductSelection(selectedProductId);
  setSaleBatchSelection(selectedSaleBatchId);
}

function batchMatchesListSearch(batch, term) {
  if (!term) return true;
  const name = productsMap[batch.productId]?.name || "";
  const hay = normalizeSearch(`${name} ${batch.id} ${batch.productId}`);
  return hay.includes(term);
}

function getVisibleBatchesForList() {
  const term = normalizeSearch(els.batchListSearch?.value || "");
  return batches.filter(batch => {
    const depleted = isDepletedBatch(batch);
    const matches = batchMatchesListSearch(batch, term);

    if (!matches) return false;
    if (!depleted) return true;
    if (showDepleted) return true;
    if (term) return true;
    return false;
  });
}

function syncDepletedButton() {
  if (!els.showDepletedBtn) return;
  els.showDepletedBtn.textContent = showDepleted
    ? "Masquer lots épuisés"
    : "Afficher lots épuisés";
}

function renderProducts() {
  if (!els.productsList) return;
  els.productsList.replaceChildren();

  if (!products.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Aucun type de produit. Créez-en un ci-dessous.";
    els.productsList.appendChild(empty);
    return;
  }

  products.forEach(product => {
    const row = document.createElement("div");
    row.className = "item-row";

    const info = document.createElement("div");
    info.className = "item-info";

    const title = document.createElement("strong");
    title.textContent = product.name;

    if (product.isActive === false) {
      const badge = document.createElement("span");
      badge.className = "badge badge-inactive";
      badge.textContent = "Désactivé";
      title.appendChild(badge);
    }

    const sub = document.createElement("small");
    sub.textContent = product.note ? product.note : `ID : ${product.id}`;

    info.append(title, sub);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-accent btn-sm";
    editBtn.textContent = "Modifier";
    editBtn.addEventListener("click", () => openEditProductModal(product));

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "btn btn-warning btn-sm";
    toggleBtn.textContent =
      product.isActive === false ? "Activer" : "Désactiver";
    bindActionButton(toggleBtn, () => handleToggleProduct(product));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-danger btn-sm";
    deleteBtn.textContent = "Supprimer";
    bindActionButton(deleteBtn, () => handleDeleteProduct(product));

    actions.append(editBtn, toggleBtn, deleteBtn);
    row.append(info, actions);
    els.productsList.appendChild(row);
  });
}

function renderBatches() {
  if (!els.batchesList) return;
  els.batchesList.replaceChildren();

  const visible = getVisibleBatchesForList();

  if (!batches.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Aucun lot enregistré.";
    els.batchesList.appendChild(empty);
    return;
  }

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = showDepleted
      ? "Aucun lot pour cette recherche."
      : "Aucun lot actif. Activez « Afficher lots épuisés » ou cherchez un lot.";
    els.batchesList.appendChild(empty);
    return;
  }

  visible.forEach(batch => {
    const row = document.createElement("div");
    row.className = "item-row";

    const info = document.createElement("div");
    info.className = "item-info";

    const badgeInfo = statusBadge(batch.status);
    const productName = productsMap[batch.productId]?.name || batch.productId;

    const title = document.createElement("strong");
    title.textContent = `${productName} — Lot ${batch.id.slice(0, 8)}…`;

    const badge = document.createElement("span");
    badge.className = `badge ${badgeInfo.cls}`;
    badge.textContent = badgeInfo.label;
    title.appendChild(badge);

    const sub = document.createElement("small");
    sub.textContent = [
      `Stock : ${batch.quantity_remaining}/${batch.quantity_initial}`,
      `Coût total : ${formatMoney(batch.cost_total)}`,
      `Coût/u : ${formatMoney(batch.cost_unit_avg)}`,
      `Créé : ${formatDate(batch.createdAt)}`
    ].join(" • ");

    info.append(title, sub);

    const actions = document.createElement("div");
    actions.className = "item-actions";

    if (batch.status === "active") {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn btn-accent btn-sm";
      editBtn.textContent = "Modifier";
      editBtn.addEventListener("click", () => openEditBatchModal(batch));
      actions.appendChild(editBtn);
    }

    if (batch.status !== "cancelled") {
      const disableBtn = document.createElement("button");
      disableBtn.type = "button";
      disableBtn.className = "btn btn-warning btn-sm";
      disableBtn.textContent = "Désactiver";
      bindActionButton(disableBtn, () => handleCancelBatch(batch));
      actions.appendChild(disableBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-danger btn-sm";
    deleteBtn.textContent = "Supprimer";
    bindActionButton(deleteBtn, () => handleDeleteBatch(batch));
    actions.appendChild(deleteBtn);

    row.append(info, actions);
    els.batchesList.appendChild(row);
  });
}

async function refreshAll() {
  setStatus("● Chargement…");
  try {
    products = await loadBatchProducts();
    batches = await loadBatches();
    rebuildProductsMap();
    renderProducts();
    renderBatches();
    refreshPickers();
    syncDepletedButton();
    setStatus("● Online");
  } catch (err) {
    console.error(err);
    setStatus("● Erreur");
    showToast(err.message || "Erreur de chargement.", "error");
  }
}

function openEditProductModal(product) {
  editingProductId = product.id;
  if (els.editProductName) els.editProductName.value = product.name || "";
  if (els.editProductNote) els.editProductNote.value = product.note || "";
  if (els.editProductError) els.editProductError.textContent = "";
  openModal("editProductModal");
}

function openEditBatchModal(batch) {
  editingBatchId = batch.id;
  if (els.editBatchQty) {
    els.editBatchQty.value = String(batch.quantity_initial || "");
  }
  if (els.editBatchCost) {
    els.editBatchCost.value = String(batch.cost_total || "");
  }
  if (els.editBatchError) els.editBatchError.textContent = "";
  openModal("editBatchModal");
}

async function handleCreateProduct() {
  try {
    await createBatchProduct(
      { name: els.productName?.value, note: els.productNote?.value },
      currentUserId
    );
    if (els.productName) els.productName.value = "";
    if (els.productNote) els.productNote.value = "";
    showToast("Produit créé.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleSaveProductEdit() {
  if (!editingProductId) return;
  if (els.editProductError) els.editProductError.textContent = "";

  try {
    await updateBatchProduct(
      editingProductId,
      { name: els.editProductName?.value, note: els.editProductNote?.value },
      currentUserId
    );
    closeModal("editProductModal");
    editingProductId = null;
    showToast("Produit mis à jour.", "success");
    await refreshAll();
  } catch (err) {
    if (els.editProductError) els.editProductError.textContent = err.message;
    else showToast(err.message, "error");
  }
}

async function handleToggleProduct(product) {
  const nextActive = product.isActive === false;
  const msg = nextActive
    ? "Réactiver ce produit ?"
    : "Désactiver ce produit ? Il ne sera plus proposé à la création de lots.";

  if (!window.confirm(msg)) return;

  try {
    await toggleBatchProductActive(product.id, nextActive, currentUserId);
    showToast(nextActive ? "Produit activé." : "Produit désactivé.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleDeleteProduct(product) {
  if (
    !window.confirm(
      `Supprimer « ${product.name} » ? Cette action est définitive.`
    )
  ) {
    return;
  }

  try {
    await deleteBatchProduct(product.id);
    showToast("Produit supprimé.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleCreateBatch() {
  if (!selectedProductId) {
    showToast("Choisissez un produit (pas « Aucun »).", "error");
    return;
  }

  try {
    await createBatch(
      {
        productId: selectedProductId,
        quantityInitial: els.batchQty?.value,
        costTotal: els.batchCost?.value
      },
      currentUserId
    );
    if (els.batchQty) els.batchQty.value = "";
    if (els.batchCost) els.batchCost.value = "";
    setProductSelection(null);
    showToast("Lot créé.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleSaveBatchEdit() {
  if (!editingBatchId) return;
  if (els.editBatchError) els.editBatchError.textContent = "";

  try {
    await updateBatch(
      editingBatchId,
      {
        quantityInitial: els.editBatchQty?.value,
        costTotal: els.editBatchCost?.value
      },
      currentUserId
    );
    closeModal("editBatchModal");
    editingBatchId = null;
    showToast("Lot mis à jour.", "success");
    await refreshAll();
  } catch (err) {
    if (els.editBatchError) els.editBatchError.textContent = err.message;
    else showToast(err.message, "error");
  }
}

async function handleCancelBatch(batch) {
  if (
    !window.confirm(
      "Désactiver ce lot ? Aucune vente ne pourra être enregistrée dessus."
    )
  ) {
    return;
  }

  try {
    await cancelBatch(batch.id, currentUserId);
    showToast("Lot désactivé.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleDeleteBatch(batch) {
  if (
    !window.confirm(
      "Supprimer ce lot ? Uniquement possible sans ventes enregistrées."
    )
  ) {
    return;
  }

  try {
    await deleteBatch(batch.id);
    showToast("Lot supprimé.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleRecordSale() {
  if (!selectedSaleBatchId) {
    showToast("Choisissez un lot (pas « Aucun »).", "error");
    return;
  }

  try {
    const clientName = (els.saleClientName?.value || "").trim();
    if (!clientName) {
      throw new Error("Nom client requis.");
    }
    await recordBatchSale(
      {
        batchId: selectedSaleBatchId,
        quantityOut: els.saleQty?.value,
        amountCollected: els.saleAmount?.value,
        reason: els.saleReason?.value || "sale",
        clientName
      },
      currentUserId
    );
    try {
      await upsertClientByName(clientName, currentUserId);
    } catch (err) {
      console.warn("upsertClientByName:", err);
    }
    if (els.saleQty) els.saleQty.value = "";
    if (els.saleAmount) els.saleAmount.value = "";
    if (els.saleClientName) els.saleClientName.value = "";
    setSaleBatchSelection(null);
    showToast("Vente enregistrée.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function bindEvents() {
  bindActionButton(document.getElementById("createProductBtn"), handleCreateProduct);
  bindActionButton(els.createBatchBtn, handleCreateBatch);
  bindActionButton(els.recordSaleBtn, handleRecordSale);

  bindActionButton(
    document.getElementById("editProductSaveBtn"),
    handleSaveProductEdit
  );
  document.getElementById("editProductCancelBtn")?.addEventListener("click", () => {
    closeModal("editProductModal");
    editingProductId = null;
  });

  bindActionButton(
    document.getElementById("editBatchSaveBtn"),
    handleSaveBatchEdit
  );
  document.getElementById("editBatchCancelBtn")?.addEventListener("click", () => {
    closeModal("editBatchModal");
    editingBatchId = null;
  });

  ["editProductModal", "editBatchModal"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", e => {
      if (e.target.id === id) closeModal(id);
    });
  });

  els.batchProductSearch?.addEventListener("input", () => {
    renderProductPickerList();
  });
  els.batchProductClearBtn?.addEventListener("click", () => {
    setProductSelection(null);
  });

  els.saleBatchSearch?.addEventListener("input", () => {
    renderSaleBatchPickerList();
  });
  els.saleBatchClearBtn?.addEventListener("click", () => {
    setSaleBatchSelection(null);
  });

  els.batchListSearch?.addEventListener("input", () => {
    renderBatches();
  });
  els.showDepletedBtn?.addEventListener("click", () => {
    showDepleted = !showDepleted;
    syncDepletedButton();
    renderBatches();
  });
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    blockAccess();
    return;
  }
  currentUserId = user.uid;
  bindEvents();
  await refreshAll();
});
