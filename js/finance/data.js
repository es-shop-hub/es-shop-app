import {
  db,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  where,
  Timestamp
} from "../firebase.js";
import { COLLECTIONS, mapDocs } from "./collections.js";

function itemTime(item) {
  if (item.createdAt?.toDate) {
    return item.createdAt.toDate().getTime();
  }
  if (item.createdAt?.seconds) {
    return item.createdAt.seconds * 1000;
  }
  return 0;
}

function filterByRangeClient(items, dateRange) {
  if (!dateRange?.start && !dateRange?.end) {
    return items;
  }

  const startMs = dateRange.start?.toDate?.()?.getTime() ?? null;
  const endMs = dateRange.end?.toDate?.()?.getTime() ?? null;

  return items.filter(item => {
    const t = itemTime(item);
    if (!t) return false;
    if (startMs !== null && t < startMs) return false;
    if (endMs !== null && t > endMs) return false;
    return true;
  });
}

function sortByCreatedDesc(items) {
  return [...items].sort((a, b) => itemTime(b) - itemTime(a));
}

export async function loadFinanceByCollection(collectionName, dateRange = null) {
  console.log("[finance/data] load", collectionName, dateRange ? "filtered" : "all");

  try {
    const constraints = [];

    if (dateRange?.start) {
      constraints.push(where("createdAt", ">=", dateRange.start));
    }

    if (dateRange?.end) {
      constraints.push(where("createdAt", "<=", dateRange.end));
    }

    constraints.push(orderBy("createdAt", "desc"));

    const snap = await getDocs(
      query(collection(db, collectionName), ...constraints)
    );

    const items = mapDocs(snap);
    console.log("[finance/data] loaded", collectionName, items.length);
    return items;
  } catch (err) {
    console.warn("[finance/data] query fallback", collectionName, err?.code || err?.message);

    const snap = await getDocs(collection(db, collectionName));
    let items = sortByCreatedDesc(mapDocs(snap));
    items = filterByRangeClient(items, dateRange);

    console.log("[finance/data] fallback loaded", collectionName, items.length);
    return items;
  }
}

export async function loadAllFinance(dateRange = null) {
  const [expenses, debts, losses] = await Promise.all([
    loadFinanceByCollection(COLLECTIONS.expenses, dateRange),
    loadFinanceByCollection(COLLECTIONS.debts, dateRange),
    loadFinanceByCollection(COLLECTIONS.losses, dateRange)
  ]);

  return { expenses, debts, losses };
}

export function dateRangeFromInputs(startValue, endValue) {
  if (!startValue && !endValue) return null;

  const range = {};

  if (startValue) {
    range.start = Timestamp.fromDate(new Date(startValue));
  }

  if (endValue) {
    const end = new Date(endValue);
    end.setHours(23, 59, 59, 999);
    range.end = Timestamp.fromDate(end);
  }

  return range;
}

/** Montant réinvestissement = (NS - AS) × prix unitaire si NS > AS */
export function computeStockIncreaseFundingAmount(stockBefore, stockAfter, unitPrice) {
  const before = Number(stockBefore) || 0;
  const after = Number(stockAfter) || 0;
  const price = Number(unitPrice) || 0;
  const diff = after - before;

  if (diff <= 0 || price <= 0) {
    return 0;
  }

  return diff * price;
}

export async function recordStockFundingExpense({
  category,
  amount,
  reason,
  relatedTo = null,
  relatedPurchaseId = null,
  note = "",
  createdBy,
  createdAt
}) {
  const value = Number(amount) || 0;

  if (value <= 0 || !createdBy) {
    return;
  }

  const ts = createdAt || Timestamp.now();

  await addDoc(collection(db, COLLECTIONS.expenses), {
    reason,
    category,
    type: "auto",
    amount: value,
    relatedTo,
    relatedPurchaseId,
    note: note || "",
    status: "active",
    isSystemCorrection: false,
    createdBy,
    createdAt: ts,
    updatedAt: ts
  });
}
