import {
  db,
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  Timestamp,
  increment,
  writeLog
} from "../../js/firebase.js";
import { getAuth, onAuthStateChanged } from "../../js/auth.js";
import { bindActionButton } from "../../js/utils/buttonManager.js";

const auth = getAuth();
let currentUserId = null;
let currentUserRole = "seller";
let allDemands = [];

const statusFilter = document.getElementById("statusFilter");
const refreshBtn = document.getElementById("refreshBtn");
const demandsBody = document.getElementById("demandsBody");
const emptyState = document.getElementById("emptyState");

const kpiActiveCount = document.getElementById("kpiActiveCount");
const kpiTopCount = document.getElementById("kpiTopCount");
const kpiTopLabel = document.getElementById("kpiTopLabel");
const kpiWeekCount = document.getElementById("kpiWeekCount");

function sanitizeText(value, max = 140) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function toDateSafe(value) {
  return value?.toDate?.() || null;
}

function formatDate(value) {
  const d = toDateSafe(value);
  if (!d) return "-";
  return d.toLocaleString("fr-FR");
}

function statusClass(status) {
  if (status === "fulfilled") return "status status-fulfilled";
  if (status === "ignored") return "status status-ignored";
  return "status status-active";
}

function statusLabel(status) {
  if (status === "fulfilled") return "Rempli";
  if (status === "ignored") return "Ignoré";
  return "Actif";
}

async function checkUser(uid) {
  if (!uid) throw new Error("UID invalide");
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) throw new Error("Utilisateur introuvable");
  const userData = userSnap.data();
  if (!userData?.isActive) throw new Error("Compte désactivé");
  currentUserRole = userData.role || "seller";
  return userData;
}

function getFilteredDemands() {
  const status = statusFilter?.value || "all";
  if (status === "all") return [...allDemands];
  return allDemands.filter(item => (item.status || "active") === status);
}

function updateKpis() {
  const activeOnly = allDemands.filter(item => (item.status || "active") === "active");
  const top = [...allDemands].sort((a, b) => Number(b.requestCount || 0) - Number(a.requestCount || 0))[0];
  const nowMs = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekCount = allDemands.filter(item => {
    const d = toDateSafe(item.lastRequestedAt);
    return d && (nowMs - d.getTime()) <= weekMs;
  }).length;

  if (kpiActiveCount) kpiActiveCount.textContent = String(activeOnly.length);
  if (kpiTopCount) kpiTopCount.textContent = String(Number(top?.requestCount || 0));
  if (kpiTopLabel) kpiTopLabel.textContent = sanitizeText(top?.label || "-", 80);
  if (kpiWeekCount) kpiWeekCount.textContent = String(weekCount);
}

function renderRows(rows) {
  demandsBody.replaceChildren();
  const frag = document.createDocumentFragment();

  rows.forEach(item => {
    const tr = document.createElement("tr");
    tr.dataset.id = item.id;

    const tdLabel = document.createElement("td");
    tdLabel.textContent = sanitizeText(item.label || "Produit sans nom", 120);

    const tdNote = document.createElement("td");
    tdNote.textContent = sanitizeText(item.note || "-", 180);

    const tdCount = document.createElement("td");
    tdCount.textContent = String(Number(item.requestCount || 0));

    const tdStatus = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = statusClass(item.status || "active");
    badge.textContent = statusLabel(item.status || "active");
    tdStatus.appendChild(badge);

    const tdDate = document.createElement("td");
    tdDate.textContent = formatDate(item.lastRequestedAt);

    const tdActions = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "actions";

    const incBtn = document.createElement("button");
    incBtn.type = "button";
    incBtn.className = "btn-row btn-inc";
    incBtn.dataset.action = "inc";
    incBtn.dataset.id = item.id;
    incBtn.textContent = "+1";
    actions.appendChild(incBtn);

    if (currentUserRole === "admin") {
      const fulfillBtn = document.createElement("button");
      fulfillBtn.type = "button";
      fulfillBtn.className = "btn-row btn-fulfill";
      fulfillBtn.dataset.action = "fulfilled";
      fulfillBtn.dataset.id = item.id;
      fulfillBtn.textContent = "Rempli";
      actions.appendChild(fulfillBtn);

      const ignoreBtn = document.createElement("button");
      ignoreBtn.type = "button";
      ignoreBtn.className = "btn-row btn-ignore";
      ignoreBtn.dataset.action = "ignored";
      ignoreBtn.dataset.id = item.id;
      ignoreBtn.textContent = "Ignorer";
      actions.appendChild(ignoreBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-row btn-delete";
      deleteBtn.dataset.action = "delete";
      deleteBtn.dataset.id = item.id;
      deleteBtn.textContent = "Supprimer";
      actions.appendChild(deleteBtn);
    }

    tdActions.appendChild(actions);

    tr.appendChild(tdLabel);
    tr.appendChild(tdNote);
    tr.appendChild(tdCount);
    tr.appendChild(tdStatus);
    tr.appendChild(tdDate);
    tr.appendChild(tdActions);
    frag.appendChild(tr);
  });

  demandsBody.appendChild(frag);
}

function render() {
  updateKpis();
  const rows = getFilteredDemands().sort((a, b) => Number(b.requestCount || 0) - Number(a.requestCount || 0));
  renderRows(rows);
  if (emptyState) emptyState.hidden = rows.length > 0;
}

async function loadDemands() {
  const snap = await getDocs(collection(db, "product_demands"));
  allDemands = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  render();
}

async function handleAction(action, id) {
  if (!id || !action) return;
  const ref = doc(db, "product_demands", id);
  const now = Timestamp.now();

  if (action === "inc") {
    await updateDoc(ref, {
      requestCount: increment(1),
      lastRequestedAt: now,
      updatedAt: now
    });
    await writeLog({ userId: currentUserId, action: "increment_product_demand", demandId: id });
    await loadDemands();
    return;
  }

  if (currentUserRole !== "admin") {
    alert("Action réservée à l'admin.");
    return;
  }

  if (action === "fulfilled" || action === "ignored") {
    await updateDoc(ref, { status: action, updatedAt: now });
    await writeLog({ userId: currentUserId, action: "update_product_demand_status", demandId: id, status: action });
    await loadDemands();
    return;
  }

  if (action === "delete") {
    const ok = window.confirm("Supprimer définitivement cette demande ?");
    if (!ok) return;
    await deleteDoc(ref);
    await writeLog({ userId: currentUserId, action: "delete_product_demand", demandId: id });
    await loadDemands();
  }
}

if (statusFilter) {
  statusFilter.addEventListener("change", () => render());
}

bindActionButton(refreshBtn, async () => {
  try {
    await loadDemands();
  } catch (err) {
    console.error(err);
    alert(err?.message || "Erreur de chargement");
  }
});

if (demandsBody) {
  demandsBody.addEventListener("click", event => {
    const btn = event.target?.closest?.("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action || "";
    const id = btn.dataset.id || "";
    void handleAction(action, id).catch(err => {
      console.error(err);
      alert(err?.message || "Erreur action demande");
    });
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
    await loadDemands();
  } catch (err) {
    console.error(err);
    alert(err?.message || "Erreur");
  }
});
