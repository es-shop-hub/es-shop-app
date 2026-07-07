// settings.js
import {
  db,
  collection,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  writeLog
} from "./firebase.js";

import {
  getAuth,
  onAuthStateChanged
} from "./auth.js";
import { bindActionButton } from "./utils/buttonManager.js";

const auth = getAuth();

/* =========================
   GLOBAL
========================= */

let currentUserId = null;
let currentUserRole = null;

const usersCollection = collection(db, "users");

/* =========================
   DOM
========================= */

const usersTableBody =
  document.querySelector("#usersTable tbody");

const loadingState =
  document.getElementById("loadingState");

const emptyState =
  document.getElementById("emptyState");

const confirmModal = document.getElementById("confirmModal");
const confirmModalTitle = document.getElementById("confirmModalTitle");
const confirmModalMessage = document.getElementById("confirmModalMessage");

let confirmResolver = null;

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

/* =========================
   UTILS
========================= */

function sanitizeText(value, max = 80) {

  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function showLoading(show = true) {

  if (!loadingState) return;

  loadingState.style.display =
    show ? "flex" : "none";
}

function showEmpty(show = false) {

  if (!emptyState) return;

  emptyState.style.display =
    show ? "block" : "none";
}

function showMessage(message = "") {

  const existing =
    document.getElementById("debugMessage");

  if (existing) {
    existing.remove();
  }

  const div =
    document.createElement("div");

  div.id = "debugMessage";

  div.textContent = message;

  div.style.position = "fixed";
  div.style.left = "50%";
  div.style.bottom = "85px";
  div.style.transform = "translateX(-50%)";

  div.style.padding = "12px 16px";

  div.style.background = "#111";
  div.style.color = "#fff";

  div.style.borderRadius = "12px";

  div.style.fontSize = "13px";
  div.style.fontWeight = "600";

  div.style.zIndex = "999999";

  div.style.boxShadow =
    "0 4px 18px rgba(0,0,0,0.25)";

  div.style.opacity = "0";
  div.style.transition =
    "opacity .25s ease";

  document.body.appendChild(div);

  requestAnimationFrame(() => {
    div.style.opacity = "1";
  });

  setTimeout(() => {

    div.style.opacity = "0";

    setTimeout(() => {
      div.remove();
    }, 250);

  }, 2500);
}

function createButton(label, className) {

  const btn =
    document.createElement("button");

  btn.type = "button";

  btn.textContent = label;

  btn.className = className;

  return btn;
}

function createBadge(role) {

  const span =
    document.createElement("span");

  span.textContent = role;

  span.className = "role-badge";

  if (role === "admin") {
    span.classList.add("admin");
  } else {
    span.classList.add("seller");
  }

  return span;
}

/* =========================
   config 
========================= */
async function loadAppConfig() {
  try {
    const configRef = doc(db, "appConfig", "main");
    const snap = await getDoc(configRef);

    if (!snap.exists()) {
      await setDoc(configRef, {
        shopName: "Shop",
        shopAddress: "",
        shopPhone: "",
        currency: "Franc Congolais",
        currencySymbol: "FC",
        logoUrl: "",
        lowStockLimit: 10,
        enableOffline: true,
        enableExpiration: false,
        expirationAlertDays: 30,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      return loadAppConfig();
    }

    const data = snap.data();

    /* =========================
       DISPLAY TABLE (READ ONLY)
    ========================= */
    document.getElementById("shopNameValue").textContent = data.shopName || "-";
    document.getElementById("shopAddressValue").textContent = data.shopAddress || "-";
    document.getElementById("shopPhoneValue").textContent = data.shopPhone || "-";
    document.getElementById("currencyValue").textContent = data.currency || "-";
    document.getElementById("currencySymbolValue").textContent = data.currencySymbol || "-";
    document.getElementById("lowStockValue").textContent = data.lowStockLimit || 0;
    document.getElementById("offlineValue").textContent = data.enableOffline ? "Activé" : "Désactivé";
    document.getElementById("expirationValue").textContent = data.enableExpiration ? "Activé" : "Désactivé";
    document.getElementById("expirationAlertValue").textContent = String(data.expirationAlertDays ?? 30);

    /* =========================
       CREATE EDIT UI (JS ONLY)
    ========================= */

    let old = document.getElementById("configEditBox");
    if (old) old.remove();

    const box = document.createElement("div");
    box.id = "configEditBox";

    box.style.marginTop = "20px";
    box.style.padding = "16px";
    box.style.border = "1px solid #ddd";
    box.style.borderRadius = "12px";
    box.style.background = "#fff";

    box.innerHTML = `
      <h3>✏️ Modifier configuration</h3>

      <label>Nom boutique</label>
      <input id="cfg_shopName" type="text">

      <label>Adresse</label>
      <input id="cfg_shopAddress" type="text">

      <label>Téléphone</label>
      <input id="cfg_shopPhone" type="text">

      <label>Logo URL</label>
      <input id="cfg_logoUrl" type="text">

      <label>Devise (verrouillée)</label>
      <input id="cfg_currency" type="text" disabled>

      <label>Symbole (verrouillé)</label>
      <input id="cfg_currencySymbol" type="text" disabled>

      <label>Stock faible</label>
      <input id="cfg_lowStock" type="number">

      <label>
        <input id="cfg_offline" type="checkbox">
        Mode offline
      </label>

      <label>
        <input id="cfg_enableExpiration" type="checkbox">
        Gestion expiration produits
      </label>

      <div id="cfg_expirationAlertWrap">
        <label for="cfg_expirationAlertDays">Alerte expiration (jours avant)</label>
        <input id="cfg_expirationAlertDays" type="number" min="1" step="1">
      </div>

      <button id="saveConfigBtn"
        style="
          margin-top:15px;
          padding:10px 14px;
          background:#0B3D2E;
          color:#fff;
          border:none;
          border-radius:10px;
          font-weight:700;
          cursor:pointer;
        ">
        💾 Sauvegarder
      </button>
    `;

    document.getElementById("configSection")?.appendChild(box);

    /* =========================
       PREFILL INPUTS
    ========================= */

    document.getElementById("cfg_shopName").value = data.shopName || "";
    document.getElementById("cfg_shopAddress").value = data.shopAddress || "";
    document.getElementById("cfg_shopPhone").value = data.shopPhone || "";
    document.getElementById("cfg_logoUrl").value = data.logoUrl || "";

    document.getElementById("cfg_currency").value = data.currency || "";
    document.getElementById("cfg_currencySymbol").value = data.currencySymbol || "";

    document.getElementById("cfg_lowStock").value = data.lowStockLimit ?? 10;
    document.getElementById("cfg_offline").checked = !!data.enableOffline;
    document.getElementById("cfg_enableExpiration").checked = !!data.enableExpiration;
    document.getElementById("cfg_expirationAlertDays").value = data.expirationAlertDays ?? 30;

    const expirationAlertWrap = document.getElementById("cfg_expirationAlertWrap");
    const enableExpirationInput = document.getElementById("cfg_enableExpiration");

    const syncExpirationAlertVisibility = () => {
      if (expirationAlertWrap) {
        expirationAlertWrap.style.display = enableExpirationInput?.checked ? "block" : "none";
      }
    };

    syncExpirationAlertVisibility();
    enableExpirationInput?.addEventListener("change", syncExpirationAlertVisibility);

    /* =========================
       BIND SAVE
    ========================= */

    const saveConfigBtn = document.getElementById("saveConfigBtn");
    bindActionButton(saveConfigBtn, updateAppConfig);

  } catch (err) {
    console.error(err);
    showMessage("Erreur configuration");
  }
}

  //modifer config
  async function updateAppConfig() {
  try {
    const configRef = doc(db, "appConfig", "main");
    const snap = await getDoc(configRef);

    if (!snap.exists()) {
      showMessage("Config introuvable");
      return;
    }

    const data = snap.data();

    const ok = await showConfirmModal(
      "Confirmation",
      "Confirmer la modification ?"
    );
    if (!ok) return;

    /* =========================
       READ INPUTS
    ========================= */

    const shopName = document.getElementById("cfg_shopName").value.trim();
    const shopAddress = document.getElementById("cfg_shopAddress").value.trim();
    const shopPhone = document.getElementById("cfg_shopPhone").value.trim();
    const logoUrl = document.getElementById("cfg_logoUrl").value.trim();

    const lowStockLimit = Number(document.getElementById("cfg_lowStock").value || 0);
    const enableOffline = document.getElementById("cfg_offline").checked;
    const enableExpiration = document.getElementById("cfg_enableExpiration").checked;
    const expirationAlertDays = Math.max(
      1,
      Number(document.getElementById("cfg_expirationAlertDays").value || 30)
    );

    /* =========================
       UPDATE FIREBASE
       (currency LOCKED)
    ========================= */

    await updateDoc(configRef, {
      shopName,
      shopAddress,
      shopPhone,
      logoUrl,

      lowStockLimit,
      enableOffline,
      enableExpiration,
      expirationAlertDays,

      // 🔒 NEVER CHANGE
      currency: data.currency,
      currencySymbol: data.currencySymbol,

      updatedAt: serverTimestamp()
    });

    await writeLog({
      userId: currentUserId,
      action: "config_update",
      targetId: "main",
      details: {
        shopName,
        enableOffline,
        enableExpiration,
        expirationAlertDays
      }
    });

    showMessage("Configuration mise à jour");

    await loadAppConfig();

  } catch (err) {
    console.error(err);
    showMessage("❌ Erreur update config");
  }
}

/* =========================
   AUTH
========================= */

onAuthStateChanged(auth, async (user) => {

  if (!user) {

    window.location.href =
      "login.html";

    return;
  }

  currentUserId = user.uid;

  try {

    const userRef =
      doc(db, "users", currentUserId);

    const userSnap =
      await getDoc(userRef);

    if (!userSnap.exists()) {

      alert("Utilisateur introuvable");

      return;
    }

    const userData =
      userSnap.data();

    currentUserRole =
      userData.role;

    if (
      currentUserRole !== "admin"
    ) {

      document.body.replaceChildren();

      const denied =
        document.createElement("div");

      denied.style.minHeight = "100vh";

      denied.style.display = "flex";
      denied.style.justifyContent =
        "center";
      denied.style.alignItems =
        "center";

      denied.style.background = "#111";
      denied.style.color = "#fff";

      denied.style.fontSize = "20px";
      denied.style.fontWeight = "700";

      denied.textContent =
        "⛔ Accès refusé";

      document.body.appendChild(denied);

      return;
    }

    loadUsers();

  } catch (err) {

    console.error(err);

    alert(
      "Erreur chargement utilisateur"
    );
  }

});

/* =========================
   LOAD USERS
========================= */

async function loadUsers() {

  try {

    showLoading(true);  

    usersTableBody.replaceChildren();  

    const snapshot =  
      await getDocs(usersCollection);  

    if (snapshot.empty) {  

      showEmpty(true);  

      showLoading(false);  

      return;  
    }  

    showEmpty(false);  

    snapshot.forEach((docSnap) => {  

      const data = docSnap.data();  
      const userId = docSnap.id;  
      const tr = document.createElement("tr");  

      /* ---------- NAME ---------- */  
      const nameTd = document.createElement("td");  
      nameTd.textContent = sanitizeText(data.name || "-");  

      /* ---------- EMAIL ---------- */  
      const emailTd = document.createElement("td");  
      emailTd.textContent = sanitizeText(data.email || "-");  

      /* ---------- ROLE ---------- */  
      const roleTd = document.createElement("td");  
      roleTd.appendChild(createBadge(data.role || "seller"));  

      /* ---------- STATUS ---------- */  
      const statusTd = document.createElement("td");  
      const status = document.createElement("span");  
      status.className = "status-badge";  

      if (data.isActive === false) {  
        status.textContent = "Désactivé";  
        status.classList.add("inactive");  
      } else {  
        status.textContent = "Actif";  
        status.classList.add("active");  
      }  
      statusTd.appendChild(status);  

      /* ---------- ACTIONS ---------- */  
      const actionsTd = document.createElement("td");  
      actionsTd.className = "actions";  

      /* ROLE BUTTON */  
      const roleBtn = createButton("Changer rôle", "btn-action");  
      bindActionButton(roleBtn, async () => {
        try {
          const nextRole = data.role === "admin" ? "seller" : "admin";
          await updateDoc(doc(db, "users", userId), {
            role: nextRole,
            updatedAt: serverTimestamp()
          });
          await writeLog({
            userId: currentUserId,
            action: "user_role_update",
            targetId: userId,
            details: { nextRole }
          });
          showMessage("Rôle mis à jour");
          loadUsers();
        } catch (err) {
          console.error(err);
          alert("Erreur modification rôle");
        }
      });

      /* STATUS BUTTON */  
      const statusBtn = createButton(
        data.isActive === false ? "Activer" : "Désactiver",
        data.isActive === false ? "btn-success" : "btn-warning"
      );  
      bindActionButton(statusBtn, async () => {
        try {
          await updateDoc(doc(db, "users", userId), {
            isActive: data.isActive === false,
            updatedAt: serverTimestamp()
          });
          await writeLog({
            userId: currentUserId,
            action: "user_status_update",
            targetId: userId,
            details: { isActive: data.isActive === false }
          });
          showMessage("Utilisateur mis à jour");
          loadUsers();
        } catch (err) {
          console.error(err);
          alert("Erreur statut utilisateur");
        }
      });

      /* DELETE BUTTON */  
      const deleteBtn = createButton("Supprimer", "btn-danger");
      bindActionButton(deleteBtn, async () => {
        if (userId === currentUserId) {
          alert("Impossible de supprimer ton compte");
          return;
        }
        const confirmDelete = await showConfirmModal(
          "Supprimer utilisateur",
          "Supprimer cet utilisateur ?"
        );
        if (!confirmDelete) return;

        try {
          const metaRef = doc(db, "system", "meta");
          const metaSnap = await getDoc(metaRef);
          const currentCount = metaSnap.exists()
            ? Number(metaSnap.data().usersCount) || 0
            : 0;

          await deleteDoc(doc(db, "users", userId));

          if (metaSnap.exists() && currentCount > 0) {
            await updateDoc(metaRef, {
              usersCount: currentCount - 1
            });
          }

          await writeLog({
            userId: currentUserId,
            action: "user_delete",
            targetId: userId
          });
          showMessage("Utilisateur supprimé");
          loadUsers();
        } catch (err) {
          console.error(err);
          alert("Erreur suppression");
        }
      });  

      actionsTd.appendChild(roleBtn);  
      actionsTd.appendChild(statusBtn);  
      actionsTd.appendChild(deleteBtn);  

      /* ---------- APPEND ---------- */  
      tr.appendChild(nameTd);  
      tr.appendChild(emailTd);   // <-- ajouté
      tr.appendChild(roleTd);  
      tr.appendChild(statusTd);  
      tr.appendChild(actionsTd); // <-- ordre corrigé

      usersTableBody.appendChild(tr);  
    });
    loadAppConfig();
  } catch (err) {
    console.error(err);  
    alert("Erreur chargement utilisateurs");

  } finally {
    showLoading(false);
  }

}