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

const auth = getAuth();
let currentUserId = null;
let products = [];
let batches = [];
let productsMap = {};
let editingProductId = null;
let editingBatchId = null;

const els = {
  productsList: document.getElementById("productsList"),
  batchesList: document.getElementById("batchesList"),
  productSelect: document.getElementById("batchProductSelect"),
  saleBatchSelect: document.getElementById("saleBatchSelect"),
  productName: document.getElementById("productName"),
  productNote: document.getElementById("productNote"),
  batchQty: document.getElementById("batchQty"),
  batchCost: document.getElementById("batchCost"),
  saleQty: document.getElementById("saleQty"),
  saleAmount: document.getElementById("saleAmount"),
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
  div.style.cssText = "display:flex;height:100vh;align-items:center;justify-content:center;background:#111;color:#fff;font-size:18px;";
  div.textContent = "⛔ Accès refusé — connectez-vous.";
  document.body.appendChild(div);
}

function rebuildProductsMap() {
  productsMap = {};
  products.forEach(p => {
    productsMap[p.id] = p;
  });
}

function createOption(value, label, disabled = false) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  opt.disabled = disabled;
  return opt;
}

function fillProductSelects() {
  if (els.productSelect) {
    els.productSelect.replaceChildren();
    els.productSelect.appendChild(createOption("", "— Choisir un produit —", true));

    products
      .filter(p => p.isActive !== false)
      .forEach(p => {
        els.productSelect.appendChild(createOption(p.id, p.name));
      });
  }
}

function fillSaleBatchSelect() {
  if (!els.saleBatchSelect) return;

  els.saleBatchSelect.replaceChildren();
  els.saleBatchSelect.appendChild(createOption("", "— Choisir un lot —", true));

  batches
    .filter(b => b.status === "active" && b.quantity_remaining > 0)
    .forEach(b => {
      const name = productsMap[b.productId]?.name || b.productId;
      const label = `${name} — reste ${b.quantity_remaining} (coût/u ${formatMoney(b.cost_unit_avg)})`;
      els.saleBatchSelect.appendChild(createOption(b.id, label));
    });
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
    toggleBtn.textContent = product.isActive === false ? "Activer" : "Désactiver";
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

  if (!batches.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Aucun lot enregistré.";
    els.batchesList.appendChild(empty);
    return;
  }

  batches.forEach(batch => {
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
    fillProductSelects();
    fillSaleBatchSelect();
    renderProducts();
    renderBatches();
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
  if (els.editBatchQty) els.editBatchQty.value = String(batch.quantity_initial || "");
  if (els.editBatchCost) els.editBatchCost.value = String(batch.cost_total || "");
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
  if (!window.confirm(`Supprimer « ${product.name} » ? Cette action est définitive.`)) return;

  try {
    await deleteBatchProduct(product.id);
    showToast("Produit supprimé.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleCreateBatch() {
  try {
    await createBatch(
      {
        productId: els.productSelect?.value,
        quantityInitial: els.batchQty?.value,
        costTotal: els.batchCost?.value
      },
      currentUserId
    );
    if (els.batchQty) els.batchQty.value = "";
    if (els.batchCost) els.batchCost.value = "";
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
  if (!window.confirm("Désactiver ce lot ? Aucune vente ne pourra être enregistrée dessus.")) return;

  try {
    await cancelBatch(batch.id, currentUserId);
    showToast("Lot désactivé.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleDeleteBatch(batch) {
  if (!window.confirm("Supprimer ce lot ? Uniquement possible sans ventes enregistrées.")) return;

  try {
    await deleteBatch(batch.id);
    showToast("Lot supprimé.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function handleRecordSale() {
  try {
    await recordBatchSale(
      {
        batchId: els.saleBatchSelect?.value,
        quantityOut: els.saleQty?.value,
        amountCollected: els.saleAmount?.value,
        reason: els.saleReason?.value || "sale"
      },
      currentUserId
    );
    if (els.saleQty) els.saleQty.value = "";
    if (els.saleAmount) els.saleAmount.value = "";
    showToast("Vente enregistrée.", "success");
    await refreshAll();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function bindEvents() {
  bindActionButton(document.getElementById("createProductBtn"), handleCreateProduct);
  bindActionButton(document.getElementById("createBatchBtn"), handleCreateBatch);
  bindActionButton(document.getElementById("recordSaleBtn"), handleRecordSale);

  bindActionButton(document.getElementById("editProductSaveBtn"), handleSaveProductEdit);
  document.getElementById("editProductCancelBtn")?.addEventListener("click", () => {
    closeModal("editProductModal");
    editingProductId = null;
  });

  bindActionButton(document.getElementById("editBatchSaveBtn"), handleSaveBatchEdit);
  document.getElementById("editBatchCancelBtn")?.addEventListener("click", () => {
    closeModal("editBatchModal");
    editingBatchId = null;
  });

  ["editProductModal", "editBatchModal"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", e => {
      if (e.target.id === id) closeModal(id);
    });
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
