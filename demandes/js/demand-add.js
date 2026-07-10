import {
  db,
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
  increment,
  writeLog
} from "../../js/firebase.js";

import { getAuth, onAuthStateChanged } from "../../js/auth.js";
import { bindActionButton } from "../../js/utils/buttonManager.js";

const demandLabel = document.getElementById("demandLabel");
const demandNote = document.getElementById("demandNote");
const saveDemandBtn = document.getElementById("saveDemandBtn");
const feedback = document.getElementById("feedback");
const catalogWarning = document.getElementById("catalogWarning");
const demandsList = document.getElementById("demandsList");
const refreshDemandsBtn = document.getElementById("refreshDemandsBtn");
const editDemandModal = document.getElementById("editDemandModal");
const editDemandLabel = document.getElementById("editDemandLabel");
const editDemandNote = document.getElementById("editDemandNote");
const editDemandSaveBtn = document.getElementById("editDemandSaveBtn");
const editDemandCancelBtn = document.getElementById("editDemandCancelBtn");

const auth = getAuth();
let currentUserId = null;
let productsIndex = [];
let activeDemands = [];
let editingDemandId = null;

function sanitizeText(value, max = 120) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function normalizeLabelKey(label) {
  return sanitizeText(label, 120)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function setFeedback(message, type = "") {
  if (!feedback) return;
  feedback.textContent = message || "";
  feedback.className = type ? type : "";
}

function showCatalogWarning(message) {
  if (!catalogWarning) return;
  if (!message) {
    catalogWarning.style.display = "none";
    catalogWarning.textContent = "";
    return;
  }
  catalogWarning.style.display = "block";
  catalogWarning.textContent = message;
}

function toDateSafe(value) {
  return value?.toDate?.() || null;
}

function formatDate(value) {
  const d = toDateSafe(value);
  if (!d) return "-";
  return d.toLocaleString("fr-FR");
}

function closeEditModal() {
  editingDemandId = null;
  if (editDemandLabel) editDemandLabel.value = "";
  if (editDemandNote) editDemandNote.value = "";
  if (editDemandModal) {
    editDemandModal.classList.remove("show");
    editDemandModal.setAttribute("aria-hidden", "true");
  }
}

function openEditModal(demand) {
  if (!demand || !editDemandModal) return;
  editingDemandId = demand.id;
  if (editDemandLabel) editDemandLabel.value = demand.label || "";
  if (editDemandNote) editDemandNote.value = demand.note || "";
  editDemandModal.classList.add("show");
  editDemandModal.setAttribute("aria-hidden", "false");
  editDemandLabel?.focus();
}

async function checkUser(uid) {
  if (!uid) throw new Error("UID invalide");
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) throw new Error("Utilisateur introuvable");
  const userData = userSnap.data();
  if (!userData?.isActive) throw new Error("Compte désactivé");
  return userData;
}

async function loadProductsIndex() {
  const snap = await getDocs(collection(db, "products"));
  productsIndex = [];
  snap.forEach(docSnap => {
    const data = docSnap.data();
    if (data?.isActive === false) return;
    const name = sanitizeText(data?.name || "");
    if (!name) return;
    productsIndex.push({
      id: docSnap.id,
      name,
      key: normalizeLabelKey(name)
    });
  });
}

function findCatalogMatch(labelKey) {
  if (!labelKey) return null;
  const exact = productsIndex.find(item => item.key === labelKey);
  if (exact) return exact;
  return productsIndex.find(item => item.key.includes(labelKey) || labelKey.includes(item.key)) || null;
}

async function findActiveDemand(labelKey) {
  const snap = await getDocs(
    query(
      collection(db, "product_demands"),
      where("labelKey", "==", labelKey),
      where("status", "==", "active")
    )
  );
  if (snap.empty) return null;
  const found = snap.docs[0];
  return { id: found.id, ...found.data() };
}

async function findActiveDemandByKey(labelKey, excludeId = null) {
  const snap = await getDocs(
    query(
      collection(db, "product_demands"),
      where("labelKey", "==", labelKey),
      where("status", "==", "active")
    )
  );
  const match = snap.docs.find(docSnap => docSnap.id !== excludeId);
  if (!match) return null;
  return { id: match.id, ...match.data() };
}

async function loadActiveDemands() {
  const snap = await getDocs(collection(db, "product_demands"));
  activeDemands = [];
  snap.forEach(docSnap => {
    const data = docSnap.data();
    if ((data?.status || "active") !== "active") return;
    activeDemands.push({ id: docSnap.id, ...data });
  });
  activeDemands.sort((a, b) => {
    const countDiff = Number(b.requestCount || 0) - Number(a.requestCount || 0);
    if (countDiff !== 0) return countDiff;
    const aTime = toDateSafe(a.lastRequestedAt)?.getTime() || 0;
    const bTime = toDateSafe(b.lastRequestedAt)?.getTime() || 0;
    return bTime - aTime;
  });
}

function renderDemandsList() {
  if (!demandsList) return;
  demandsList.replaceChildren();

  if (!activeDemands.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "Aucune demande active pour le moment.";
    demandsList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  activeDemands.forEach(demand => {
    const item = document.createElement("article");
    item.className = "demand-item";

    const top = document.createElement("div");
    top.className = "demand-item-top";

    const title = document.createElement("div");
    title.className = "demand-item-title";
    title.textContent = demand.label || "-";

    const count = document.createElement("div");
    count.className = "demand-item-count";
    count.textContent = `x${Number(demand.requestCount || 0)}`;

    top.appendChild(title);
    top.appendChild(count);
    item.appendChild(top);

    if (demand.note) {
      const note = document.createElement("div");
      note.className = "demand-item-note";
      note.textContent = demand.note;
      item.appendChild(note);
    }

    const meta = document.createElement("div");
    meta.className = "demand-item-meta";
    meta.textContent = `Dernière demande: ${formatDate(demand.lastRequestedAt)}`;
    item.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "row-actions";

    const incBtn = document.createElement("button");
    incBtn.type = "button";
    incBtn.className = "btn-row btn-inc";
    incBtn.textContent = "+1";
    bindActionButton(incBtn, async () => {
      setFeedback("");
      try {
        await incrementDemand(demand.id);
      } catch (err) {
        console.error(err);
        setFeedback(err?.message || "Erreur lors de l'incrément.", "error");
      }
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-row btn-edit";
    editBtn.textContent = "Modifier";
    editBtn.addEventListener("click", () => openEditModal(demand));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-row btn-delete";
    deleteBtn.textContent = "Supprimer";
    bindActionButton(deleteBtn, async () => {
      setFeedback("");
      try {
        await deleteDemand(demand.id, demand.label);
      } catch (err) {
        console.error(err);
        setFeedback(err?.message || "Erreur lors de la suppression.", "error");
      }
    });

    actions.appendChild(incBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);
    fragment.appendChild(item);
  });

  demandsList.appendChild(fragment);
}

async function incrementDemand(demandId) {
  const demand = activeDemands.find(item => item.id === demandId);
  if (!demand) throw new Error("Demande introuvable");

  const now = Timestamp.now();
  await updateDoc(doc(db, "product_demands", demandId), {
    requestCount: increment(1),
    lastRequestedAt: now,
    updatedAt: now
  });

  const nextCount = Number(demand.requestCount || 0) + 1;
  await writeLog({
    action: "increment_product_demand",
    userId: currentUserId,
    demandId,
    label: demand.label,
    requestCount: nextCount
  });

  await loadActiveDemands();
  renderDemandsList();
  setFeedback(`Demande incrémentée: « ${demand.label} » (x${nextCount}).`, "success");
}

async function updateDemand(demandId) {
  const demand = activeDemands.find(item => item.id === demandId);
  if (!demand) throw new Error("Demande introuvable");

  const label = sanitizeText(editDemandLabel?.value || "");
  const note = sanitizeText(editDemandNote?.value || "", 240);
  const labelKey = normalizeLabelKey(label);

  if (!label || !labelKey) {
    throw new Error("Nom de produit invalide.");
  }

  const duplicate = await findActiveDemandByKey(labelKey, demandId);
  if (duplicate) {
    throw new Error(`Une demande active existe déjà pour « ${duplicate.label} ».`);
  }

  const catalogMatch = findCatalogMatch(labelKey);
  const now = Timestamp.now();

  await updateDoc(doc(db, "product_demands", demandId), {
    label,
    labelKey,
    note,
    relatedProductId: catalogMatch?.id || null,
    updatedAt: now
  });

  await writeLog({
    action: "update_product_demand",
    userId: currentUserId,
    demandId,
    label
  });

  closeEditModal();
  await loadActiveDemands();
  renderDemandsList();
  setFeedback(`Demande modifiée: « ${label} ».`, "success");
}

async function deleteDemand(demandId, label) {
  const confirmed = window.confirm(`Supprimer la demande « ${label || "sans nom"} » ?`);
  if (!confirmed) return;

  await deleteDoc(doc(db, "product_demands", demandId));
  await writeLog({
    action: "delete_product_demand",
    userId: currentUserId,
    demandId,
    label
  });

  await loadActiveDemands();
  renderDemandsList();
  setFeedback(`Demande supprimée: « ${label} ».`, "success");
}

async function saveDemand() {
  const label = sanitizeText(demandLabel?.value || "");
  const note = sanitizeText(demandNote?.value || "", 240);
  const labelKey = normalizeLabelKey(label);

  if (!label || !labelKey) {
    setFeedback("Nom de produit invalide.", "error");
    return;
  }

  const catalogMatch = findCatalogMatch(labelKey);
  showCatalogWarning(
    catalogMatch
      ? `Attention: un produit similaire existe déjà (« ${catalogMatch.name} »).`
      : ""
  );

  const now = Timestamp.now();
  const existing = await findActiveDemand(labelKey);

  if (existing) {
    await updateDoc(doc(db, "product_demands", existing.id), {
      requestCount: increment(1),
      lastRequestedAt: now,
      updatedAt: now,
      note: note || existing.note || ""
    });

    const nextCount = Number(existing.requestCount || 0) + 1;
    await writeLog({
      action: "increment_product_demand",
      userId: currentUserId,
      demandId: existing.id,
      label,
      requestCount: nextCount
    });

    setFeedback(`Demande incrémentée: « ${label} » (x${nextCount}).`, "success");
  } else {
    const created = await addDoc(collection(db, "product_demands"), {
      label,
      labelKey,
      note,
      requestCount: 1,
      status: "active",
      relatedProductId: catalogMatch?.id || null,
      lastRequestedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: currentUserId
    });

    await writeLog({
      action: "create_product_demand",
      userId: currentUserId,
      demandId: created.id,
      label
    });

    setFeedback(`Demande enregistrée: « ${label} ».`, "success");
  }

  if (demandLabel) demandLabel.value = "";
  if (demandNote) demandNote.value = "";
  showCatalogWarning("");
  await loadActiveDemands();
  renderDemandsList();
}

if (demandLabel) {
  demandLabel.addEventListener("input", () => {
    const key = normalizeLabelKey(demandLabel.value || "");
    const match = findCatalogMatch(key);
    showCatalogWarning(
      match ? `Attention: produit similaire détecté (« ${match.name} »).` : ""
    );
  });
}

bindActionButton(saveDemandBtn, async () => {
  setFeedback("");
  try {
    await saveDemand();
  } catch (err) {
    console.error(err);
    setFeedback(err?.message || "Erreur lors de l'enregistrement.", "error");
  }
});

if (refreshDemandsBtn) {
  bindActionButton(refreshDemandsBtn, async () => {
    setFeedback("");
    try {
      await loadActiveDemands();
      renderDemandsList();
      setFeedback("Liste actualisée.", "success");
    } catch (err) {
      console.error(err);
      setFeedback(err?.message || "Erreur lors de l'actualisation.", "error");
    }
  });
}

if (editDemandSaveBtn) {
  bindActionButton(editDemandSaveBtn, async () => {
    if (!editingDemandId) return;
    setFeedback("");
    try {
      await updateDemand(editingDemandId);
    } catch (err) {
      console.error(err);
      setFeedback(err?.message || "Erreur lors de la modification.", "error");
    }
  });
}

if (editDemandCancelBtn) {
  editDemandCancelBtn.addEventListener("click", closeEditModal);
}

if (editDemandModal) {
  editDemandModal.addEventListener("click", event => {
    if (event.target === editDemandModal) closeEditModal();
  });
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    alert("Connexion requise");
    window.location.replace("../login.html");
    return;
  }
  try {
    await checkUser(user.uid);
    currentUserId = user.uid;
    await loadProductsIndex();
    await loadActiveDemands();
    renderDemandsList();
  } catch (err) {
    console.error(err);
    alert(err?.message || "Erreur");
  }
});
