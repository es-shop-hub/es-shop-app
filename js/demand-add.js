import {
  db,
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  query,
  where,
  Timestamp,
  increment,
  writeLog
} from "./firebase.js";

import { getAuth, onAuthStateChanged } from "./auth.js";
import { bindFormAction } from "./utils/buttonManager.js";

const demandForm = document.getElementById("demandForm");
const demandLabel = document.getElementById("demandLabel");
const demandNote = document.getElementById("demandNote");
const saveDemandBtn = document.getElementById("saveDemandBtn");
const feedback = document.getElementById("feedback");
const catalogWarning = document.getElementById("catalogWarning");

const auth = getAuth();
let currentUserId = null;
let productsIndex = [];

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

async function checkUser(uid) {
  if (!uid) throw new Error("UID invalide");

  const userSnap = await getDoc(doc(db, "users", uid));

  if (!userSnap.exists()) {
    throw new Error("Utilisateur introuvable");
  }

  const userData = userSnap.data();

  if (!userData?.isActive) {
    throw new Error("Compte désactivé");
  }

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

  return productsIndex.find(item => {
    return item.key.includes(labelKey) || labelKey.includes(item.key);
  }) || null;
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

  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...docSnap.data() };
}

async function saveDemand() {
  const label = sanitizeText(demandLabel?.value || "");
  const note = sanitizeText(demandNote?.value || "", 240);
  const labelKey = normalizeLabelKey(label);

  if (!label) {
    setFeedback("Le nom du produit est obligatoire.", "error");
    return;
  }

  if (!labelKey) {
    setFeedback("Nom du produit invalide.", "error");
    return;
  }

  const catalogMatch = findCatalogMatch(labelKey);
  showCatalogWarning(
    catalogMatch
      ? `Attention : un produit similaire existe déjà (« ${catalogMatch.name} »).`
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

    const count = Number(existing.requestCount || 0) + 1;

    await writeLog({
      action: "increment_product_demand",
      userId: currentUserId,
      demandId: existing.id,
      label,
      requestCount: count
    });

    setFeedback(`Demande incrémentée : « ${label} » (×${count}).`, "success");
    if (demandLabel) demandLabel.value = "";
    if (demandNote) demandNote.value = "";
    return;
  }

  const docRef = await addDoc(collection(db, "product_demands"), {
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
    demandId: docRef.id,
    label
  });

  setFeedback(`Demande enregistrée : « ${label} ».`, "success");
  if (demandLabel) demandLabel.value = "";
  if (demandNote) demandNote.value = "";
  showCatalogWarning("");
}

bindFormAction(demandForm, async () => {
  setFeedback("");

  try {
    await saveDemand();
  } catch (err) {
    console.error(err);
    setFeedback(err?.message || "Erreur lors de l'enregistrement.", "error");
  }
}, saveDemandBtn);

if (demandLabel) {
  demandLabel.addEventListener("input", () => {
    const labelKey = normalizeLabelKey(demandLabel.value || "");
    const match = findCatalogMatch(labelKey);
    showCatalogWarning(
      match
        ? `Attention : un produit similaire existe déjà (« ${match.name} »).`
        : ""
    );
  });
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    alert("Connexion requise");
    window.location.replace("login.html");
    return;
  }

  try {
    await checkUser(user.uid);
    currentUserId = user.uid;
    await loadProductsIndex();
  } catch (err) {
    console.error(err);
    alert(err?.message || "Erreur");
  }
});
