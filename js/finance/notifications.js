import {
  db,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot
} from "../firebase.js";
import { COLLECTIONS } from "./collections.js";
import { getDebtDueInfo, n, STALE_DEBT_DAYS } from "./shared.js";
import { bindActionButton } from "../utils/buttonManager.js";

const LOSS_ALERT_MIN = 10000;
const notifiedDebtKeys = new Set();
const notifiedLossIds = new Set();
let latestDebts = [];
let watchersStarted = false;

export function isAppInBackground() {
  return document.visibilityState === "hidden";
}

export function getNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestActivityNotificationPermission() {
  if (!("Notification" in window)) {
    return "unsupported";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  if (Notification.permission === "denied") {
    return "denied";
  }

  return Notification.requestPermission();
}

export async function pushActivityNotification(title, body, tag = "stockflow-activity") {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!isAppInBackground()) return;

  const options = {
    body,
    tag,
    icon: "logo.png",
    badge: "logo.png"
  };

  if ("serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, options);
    return;
  }

  new Notification(title, options);
}

function debtAlertMessage(debt) {
  const info = getDebtDueInfo(debt);
  const amount = n(debt.amount_remaining);

  if (info.level === "overdue") {
    return {
      title: "Dette — retard",
      body: `${info.label} — ${debt.name || "Client"} • ${amount.toLocaleString()} FC`,
      tag: `debt-overdue-${debt.id}`
    };
  }

  if (info.level === "today" || info.level === "soon") {
    return {
      title: "Dette — échéance",
      body: `${info.label} — ${debt.name || "Client"} • ${amount.toLocaleString()} FC`,
      tag: `debt-due-${debt.id}-${info.level}`
    };
  }

  if (info.level === "stale") {
    return {
      title: "Dette — suivi requis",
      body: `${info.label} — ${debt.name || "Client"} • ${amount.toLocaleString()} FC`,
      tag: `debt-stale-${debt.id}`
    };
  }

  return null;
}

function scanDebtsForDueAlerts(debts) {
  debts.forEach(debt => {
    if (debt.status === "paid" || debt.status === "cancelled") return;
    if (n(debt.amount_remaining) <= 0) return;

    const alert = debtAlertMessage(debt);
    if (!alert) return;

    const key = alert.tag;
    if (notifiedDebtKeys.has(key)) return;

    notifiedDebtKeys.add(key);
    pushActivityNotification(alert.title, alert.body, alert.tag);
  });
}

function handleNewDebt(docSnap) {
  const debt = { id: docSnap.id, ...docSnap.data() };
  if (debt.status === "paid" || n(debt.amount_remaining) <= 0) return;

  const key = `debt-new-${debt.id}`;
  if (notifiedDebtKeys.has(key)) return;

  notifiedDebtKeys.add(key);

  pushActivityNotification(
    "Nouvelle Dette",
    `${debt.name || "Client"} • ${n(debt.amount_remaining).toLocaleString()} FC`,
    key
  );
}

function handleNewLoss(docSnap) {
  const loss = { id: docSnap.id, ...docSnap.data() };
  if (loss.isSystemCorrection) return;
  if (notifiedLossIds.has(loss.id)) return;

  notifiedLossIds.add(loss.id);

  const amount = n(loss.amount);
  if (amount < LOSS_ALERT_MIN) return;

  pushActivityNotification(
    "Perte importante",
    `${loss.reason || "Perte"} • ${amount.toLocaleString()} FC`,
    `loss-${loss.id}`
  );
}

export function initFinanceActivityNotifications() {
  if (watchersStarted) return;
  watchersStarted = true;

  const debtsQuery = query(
    collection(db, COLLECTIONS.debts),
    orderBy("createdAt", "desc")
  );

  let firstDebtSnapshot = true;

  onSnapshot(debtsQuery, snap => {
    const debts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    latestDebts = debts;

    if (firstDebtSnapshot) {
      scanDebtsForDueAlerts(debts);
      firstDebtSnapshot = false;
      return;
    }

    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        handleNewDebt(change.doc);
      }
    });

    scanDebtsForDueAlerts(debts);
  });

  const lossesQuery = query(
    collection(db, COLLECTIONS.losses),
    orderBy("createdAt", "desc"),
    limit(20)
  );

  let firstLossSnapshot = true;

  onSnapshot(lossesQuery, snap => {
    if (firstLossSnapshot) {
      snap.docs.forEach(d => notifiedLossIds.add(d.id));
      firstLossSnapshot = false;
      return;
    }

    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        handleNewLoss(change.doc);
      }
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
  });

  setInterval(() => {
    if (Notification.permission !== "granted") return;
    if (!latestDebts.length) return;
    scanDebtsForDueAlerts(latestDebts);
  }, 3600000);
}

export function mountNotificationPermissionBanner(containerId = "notificationBanner") {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.replaceChildren();

  if (!("Notification" in window)) {
    return;
  }

  if (Notification.permission === "granted") {
    initFinanceActivityNotifications();
    return;
  }

  if (Notification.permission === "denied") {
    const p = document.createElement("p");
    p.textContent = "Notifications bloquées dans le navigateur.";
    p.style.fontSize = "13px";
    p.style.color = "#666";
    container.appendChild(p);
    return;
  }

  const box = document.createElement("div");
  box.style.background = "#fff";
  box.style.border = "1px solid #dfe3ea";
  box.style.borderRadius = "10px";
  box.style.padding = "12px";
  box.style.marginBottom = "16px";

  const text = document.createElement("p");
  text.textContent =
    "Activez les Notifications d'Activité pour être alerté (Dette, Perte) lorsque l'application est en arrière-plan.";
  text.style.fontSize = "13px";
  text.style.marginBottom = "10px";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn";
  btn.textContent = "Autoriser les Notifications";
  btn.style.marginTop = "0";

  bindActionButton(btn, async () => {
    const result = await requestActivityNotificationPermission();

    if (result === "granted") {
      initFinanceActivityNotifications();
      container.replaceChildren();
      debugBanner(container, "Notifications activées.");
      return;
    }

    if (result === "denied") {
      debugBanner(container, "Permission refusée.");
    }
  });

  box.appendChild(text);
  box.appendChild(btn);
  container.appendChild(box);
}

function debugBanner(container, message) {
  container.replaceChildren();
  const p = document.createElement("p");
  p.textContent = message;
  p.style.fontSize = "13px";
  p.style.color = "#0B5FFF";
  container.appendChild(p);
}
