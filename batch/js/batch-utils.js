/** Utilitaires isolés — module Batch */

export const BATCH_COLLECTIONS = {
  PRODUCTS: "batch_products",
  BATCHES: "product_batches",
  MOVEMENTS: "batch_movements"
};

export const BATCH_STATUS = {
  ACTIVE: "active",
  DEPLETED: "depleted",
  CANCELLED: "cancelled"
};

export function round2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

export function sanitizeText(value, maxLen = 120) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

export function parsePositiveNumber(value, { allowZero = false } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (allowZero) {
    return num >= 0 ? round2(num) : null;
  }
  return num > 0 ? round2(num) : null;
}

export function parsePositiveInt(value) {
  const num = Number.parseInt(String(value), 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

export function formatMoney(value, symbol = "") {
  const amount = round2(value);
  const formatted = amount.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return symbol ? `${formatted} ${symbol}` : formatted;
}

export function formatDate(ts) {
  if (!ts) return "—";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** Labels FR pour batch_movements.reason */
export function formatBatchReason(reason) {
  const key = String(reason || "sale").toLowerCase();
  const map = {
    sale: "Vente",
    sample: "Échantillon",
    promo: "Promotion",
    loss: "Perte",
    perte: "Perte"
  };
  return map[key] || String(reason || "Vente");
}

export function showToast(message, type = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.className = "toast show";
  if (type === "error") el.classList.add("error");
  if (type === "success") el.classList.add("success");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    el.classList.remove("show", "error", "success");
  }, 3200);
}

export function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

export function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
  }
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }
}

export function statusBadge(status) {
  const map = {
    active: { label: "Actif", cls: "badge-active" },
    depleted: { label: "Épuisé", cls: "badge-depleted" },
    cancelled: { label: "Annulé", cls: "badge-cancelled" }
  };
  return map[status] || { label: status || "—", cls: "badge-depleted" };
}
