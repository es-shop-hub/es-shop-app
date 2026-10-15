// js/offline.js
// VERSION FINALE PRO SAFE + GENERIC + ANTI DOUBLE SYNC vrai offline 

import { db } from "./firebase.js";

/* =========================
   CONFIG
========================= */

export const QUEUE_KEY = "offline_queue_v1";
export const DEVICE_KEY = "offline_device_id";

let deferredPrompt = null;
let offlineBanner = null;
let isSyncing = false;
let syncToast = null;

const SYNC_LOCK_KEY = "offline_sync_lock_v1";
const SYNC_LOCK_TTL_MS = 90000;

function getTabSyncId() {
  const key = "offline_sync_tab_id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function tryAcquireLocalSyncLock() {
  const now = Date.now();
  const owner = `${getDeviceId()}:${getTabSyncId()}`;

  try {
    const raw = localStorage.getItem(SYNC_LOCK_KEY);
    if (raw) {
      const lock = JSON.parse(raw);
      if (
        lock?.expiresAt > now &&
        lock?.owner &&
        lock.owner !== owner
      ) {
        return false;
      }
    }

    localStorage.setItem(
      SYNC_LOCK_KEY,
      JSON.stringify({ owner, expiresAt: now + SYNC_LOCK_TTL_MS })
    );

    const verify = JSON.parse(localStorage.getItem(SYNC_LOCK_KEY) || "{}");
    return verify?.owner === owner;
  } catch (err) {
    console.warn("sync lock:", err);
    return true;
  }
}

function releaseLocalSyncLock() {
  try {
    const owner = `${getDeviceId()}:${getTabSyncId()}`;
    const raw = localStorage.getItem(SYNC_LOCK_KEY);
    if (!raw) return;
    const lock = JSON.parse(raw);
    if (lock?.owner === owner) {
      localStorage.removeItem(SYNC_LOCK_KEY);
    }
  } catch (_) {
    /* ignore */
  }
}

/* =========================
   DEVICE ID
========================= */

export function getDeviceId() {

  let id = localStorage.getItem(DEVICE_KEY);

  if (!id) {

    id = crypto.randomUUID();

    localStorage.setItem(DEVICE_KEY, id);

  }

  return id;

}

/* =========================
   FIREBASE OFFLINE
========================= */

export async function initOfflinePersistence(enableIndexedDbPersistence) {

  try {

    await enableIndexedDbPersistence(db);

    console.log("✅ Firestore offline actif");

  } catch (err) {

    console.warn("⚠️ Offline persistence fallback:", err?.code || err);

  }

}

/* =========================
   NETWORK
========================= */

export function isOffline() {
  return !navigator.onLine;
}

export function setupNetworkListeners(onBackOnline = null) {

  window.addEventListener("online", async () => {

    console.log("🌐 Internet restauré");

    updateNetworkBadge(true);

    hideOfflineWarning();

    if (typeof onBackOnline === "function") {

      try {

        await onBackOnline();

      } catch (err) {

        console.error("❌ Sync online erreur:", err);

      }

    }

  });

  window.addEventListener("offline", () => {

    console.warn("📴 Hors ligne");

    updateNetworkBadge(false);

    showOfflineWarning();

  });

  updateNetworkBadge(navigator.onLine);

}

/* =========================
   NETWORK UI
========================= */

export function updateNetworkBadge(isOnline) {

  const status = document.getElementById("status");

  if (!status) return;

  status.textContent = isOnline
    ? "● Online"
    : "● Offline";

  status.style.color = isOnline
    ? "green"
    : "red";

}

/* =========================
   OFFLINE WARNING
========================= */

export function showOfflineWarning() {

  if (offlineBanner) return;

  const div = document.createElement("div");

  div.setAttribute("id", "offline-banner");

  div.textContent =
  "⚠️ Mode hors ligne actif : vérifiez qu’aucune autre caisse n’effectue des ventes afin d’éviter des erreurs de stock lors de la synchronisation.";
    
    const header =
  document.querySelector("header") ||
  document.querySelector(".header");

const headerHeight =
  header?.offsetHeight || 50;

div.style.position = "fixed";

div.style.top =
  `${headerHeight + 8}px`;

div.style.left = "50%";
div.style.transform = "translateX(-50%)";

div.style.maxWidth = "420px";
div.style.width = "calc(100% - 24px)";

div.style.padding =
  "12px 16px";

div.style.background =
  "rgba(243,156,18,0.96)";

div.style.color = "#111";

div.style.borderRadius = "14px";

div.style.fontSize = "13px";

div.style.fontWeight = "700";

div.style.lineHeight = "1.4";

div.style.boxShadow =
  "0 6px 18px rgba(0,0,0,0.18)";

div.style.zIndex = "99999";

div.style.pointerEvents = "none";

div.style.borderLeft =
  "5px solid #fff";

div.style.backdropFilter =
  "blur(6px)";

div.style.textAlign = "center";

/* ===== BLINK CONTROLLED (VISIBLE / REPOS) ===== */
let visible = true;

setInterval(() => {

  visible = !visible;

  div.style.opacity = visible ? "1" : "0.75";

}, 900);

/* ===== MICRO FLOAT (pas agressif) ===== */
div.animate(
  [
    { transform: "translateX(-50%) translateY(0px)" },
    { transform: "translateX(-50%) translateY(-2px)" },
    { transform: "translateX(-50%) translateY(0px)" }
  ],
  {
    duration: 1800,
    iterations: Infinity
  }
);
  
  document.body.appendChild(div);

  offlineBanner = div;

}

export function hideOfflineWarning() {

  if (!offlineBanner) return;

  offlineBanner.remove();

  offlineBanner = null;

}

export function showSyncToast(message, type = "info") {

  if (syncToast) {

    syncToast.remove();

    syncToast = null;

  }

  const div =
    document.createElement("div");

  div.setAttribute(
    "id",
    "sync-toast"
  );

  div.textContent = message;

  div.style.position = "fixed";

  div.style.bottom = "18px";

  div.style.left = "50%";

  div.style.transform =
    "translateX(-50%)";

  div.style.maxWidth = "420px";

  div.style.width =
    "calc(100% - 24px)";

  div.style.padding =
    "12px 16px";

  div.style.borderRadius =
    "14px";

  div.style.fontSize = "13px";

  div.style.fontWeight = "700";

  div.style.lineHeight = "1.4";

  div.style.textAlign = "center";

  div.style.zIndex = "999999";

  div.style.boxShadow =
    "0 6px 18px rgba(0,0,0,0.18)";

  div.style.backdropFilter =
    "blur(6px)";

  div.style.transition =
    "opacity 0.25s ease";

  if (type === "success") {

    div.style.background =
      "rgba(46,204,113,0.96)";

    div.style.color = "#fff";

  } else if (type === "error") {

    div.style.background =
      "rgba(231,76,60,0.96)";

    div.style.color = "#fff";

  } else if (type === "warning") {

    div.style.background =
      "rgba(243,156,18,0.96)";

    div.style.color = "#111";

  } else {

    div.style.background =
      "rgba(52,152,219,0.96)";

    div.style.color = "#fff";

  }

  document.body.appendChild(div);

  syncToast = div;

  setTimeout(() => {

    div.style.opacity = "0";

    setTimeout(() => {

      if (div.parentNode) {
        div.remove();
      }

      if (syncToast === div) {
        syncToast = null;
      }

    }, 250);

  }, 3200);

}

/* =========================
   OFFLINE PRODUCT SECURITY
========================= */

export function validateOfflineProduct(product) {

  if (!isOffline()) return true;

  const offlineBlocked = product?.offlineBlocked ?? false;

  const minOfflineStock = Number(
    product?.minOfflineStock ?? 5
  );

  const stock = Number(
    product?.stock_current ?? 0
  );

  if (offlineBlocked) {

    throw new Error(
      `Produit interdit offline (${product.name})`
    );

  }

  if (stock <= minOfflineStock) {

    throw new Error(
      `Stock faible offline (${product.name})`
    );

  }

  return true;

}

/* =========================
   LOCAL QUEUE
========================= */

export function getQueue() {

  try {

    const raw = localStorage.getItem(QUEUE_KEY);

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch (err) {

    console.error("❌ Queue corrompue:", err);

    return [];

  }

}

export function saveQueue(queue) {

  try {

    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify(queue)
    );

  } catch (err) {

    console.error("❌ Save queue erreur:", err);

  }

}

export function clearQueue() {

  localStorage.removeItem(QUEUE_KEY);

}

/* =========================
   QUEUE ACTION
========================= */

export function addToQueue(action) {

  if (!action || typeof action !== "object") {
    throw new Error("Action invalide");
  }

  const queue = getQueue();

  const finalAction = {
    id: crypto.randomUUID(),
    deviceId: getDeviceId(),
    retryCount: 0,
    queuedAt: Date.now(),
    synced: false,
    ...action
  };

  queue.push(finalAction);

  saveQueue(queue);

  console.log("📦 Offline queue:", finalAction.type);

  return finalAction.id;

}


/* =========================
   SYNC
========================= */
async function runSyncQueue(handlers = {}) {
  await new Promise(r => setTimeout(r, 1000));

  const queue = getQueue();

  if (!Array.isArray(queue) || !queue.length) {
    console.log("✅ Queue vide");
    return;
  }

  console.log(`🔄 Sync ${queue.length} action(s)`);

  const remaining = [];

  for (const action of queue) {
    try {
      if (!action || typeof action !== "object") {
        continue;
      }

      const handler = handlers[action.type];

      if (typeof handler !== "function") {
        throw new Error(`Handler manquant: ${action.type}`);
      }

      if (action.retryCount && action.retryCount >= 5) {
        console.warn(`⛔ Action ignorée (max retries): ${action.type}`, action.id);
        showSyncToast(
          `⛔ Sync abandonnée : ${action.type}`,
          "error"
        );
        continue;
      }

      await handler({
        ...action.data,
        offlineActionId: action.id,
        deviceId: action.deviceId
      });

      console.log(`✅ Sync OK: ${action.type}`);
      showSyncToast(`✅ Sync OK : ${action.type}`, "success");
    } catch (err) {
      console.error("❌ Sync erreur:", err);
      showSyncToast(`❌ Sync erreur : ${action.type}`, "error");

      remaining.push({
        ...action,
        retryCount: (action.retryCount || 0) + 1,
        lastRetryAt: Date.now(),
        lastError: err?.message || "Erreur inconnue"
      });
    }
  }

  saveQueue(remaining);
}

export async function syncQueue(handlers = {}) {
  if (isOffline()) {
    console.warn("📴 Sync annulé offline");
    return;
  }

  if (isSyncing) {
    console.warn("⚠️ Sync déjà en cours (onglet)");
    return;
  }

  const runWithLock = async () => {
    if (!tryAcquireLocalSyncLock()) {
      console.warn("⚠️ Sync déjà en cours (autre onglet)");
      return;
    }

    isSyncing = true;
    try {
      await runSyncQueue(handlers);
    } finally {
      isSyncing = false;
      releaseLocalSyncLock();
    }
  };

  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    try {
      let acquired = false;

      await navigator.locks.request(
        "stockflow-offline-sync",
        { ifAvailable: true },
        async lock => {
          if (!lock) return;
          acquired = true;
          await runWithLock();
        }
      );

      if (!acquired) {
        console.warn("⚠️ Sync déjà en cours (autre onglet / Web Lock)");
      }
      return;
    } catch (err) {
      console.warn("navigator.locks fallback:", err);
    }
  }

  await runWithLock();
}

/* =========================
   SERVICE WORKER
========================= */

export async function registerServiceWorker() {

  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const swUrl = new URL(
      "service-worker.js",
      window.location.href
    );
    await navigator.serviceWorker.register(
      swUrl.pathname
    );

    console.log("✅ Service Worker actif");

  } catch (err) {

    console.error("❌ SW erreur:", err);

  }

}

/* =========================
   INSTALL BUTTON
========================= */

export function setupInstallButton(
  buttonId = "installBtn"
) {

  const btn = document.getElementById(buttonId);

  if (!btn) return;

  window.addEventListener(
    "beforeinstallprompt",
    (e) => {

      e.preventDefault();

      deferredPrompt = e;

      btn.hidden = false;

    }
  );

  btn.addEventListener(
    "click",
    async () => {

      if (!deferredPrompt) return;

      deferredPrompt.prompt();

      const choice =
        await deferredPrompt.userChoice;

      if (choice?.outcome === "accepted") {

        btn.hidden = true;

      }

      deferredPrompt = null;

    }
  );

  window.addEventListener(
    "appinstalled",
    () => {

      btn.hidden = true;

    }
  );

}
