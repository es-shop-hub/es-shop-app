import {
  db,
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  query,
  where,
  limit,
  Timestamp
} from "./firebase.js";

const CLIENTS_COL = "clients";
const REWARDS_COL = "client_rewards";
const NAME_MAX = 80;

export function sanitizeClientName(value, max = NAME_MAX) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

export function normalizeClientNameKey(name) {
  const cleaned = sanitizeClientName(name);
  if (!cleaned) return "";
  return cleaned
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Upsert registre clients lié à sales.clientName (nameKey).
 * @returns {Promise<{ clientId: string, name: string, nameKey: string, created: boolean }|null>}
 */
export async function upsertClientByName(rawName, userId, options = {}) {
  const name = sanitizeClientName(rawName);
  const nameKey = normalizeClientNameKey(name);
  if (!nameKey) return null;

  const phone =
    typeof options.phone === "string"
      ? options.phone.trim().slice(0, 40)
      : "";
  const note =
    typeof options.note === "string"
      ? options.note.trim().slice(0, 200)
      : "";
  const lastSaleAt = options.lastSaleAt || Timestamp.now();
  const now = Timestamp.now();

  const snap = await getDocs(
    query(
      collection(db, CLIENTS_COL),
      where("nameKey", "==", nameKey),
      limit(1)
    )
  );

  if (!snap.empty) {
    const existing = snap.docs[0];
    const patch = {
      name,
      updatedAt: now,
      lastSaleAt
    };
    if (phone) patch.phone = phone;
    if (note) patch.note = note;
    await updateDoc(doc(db, CLIENTS_COL, existing.id), patch);
    return {
      clientId: existing.id,
      name,
      nameKey,
      created: false
    };
  }

  const payload = {
    name,
    nameKey,
    phone: phone || "",
    note: note || "",
    isActive: true,
    lastSaleAt,
    createdAt: now,
    updatedAt: now,
    createdBy: userId || ""
  };

  const ref = await addDoc(collection(db, CLIENTS_COL), payload);
  return {
    clientId: ref.id,
    name,
    nameKey,
    created: true
  };
}

export async function loadClients() {
  const snap = await getDocs(collection(db, CLIENTS_COL));
  return snap.docs.map(d => ({ id: d.id, clientId: d.id, ...d.data() }));
}

export async function loadClientRewards(monthKey) {
  let q = collection(db, REWARDS_COL);
  if (monthKey) {
    q = query(collection(db, REWARDS_COL), where("monthKey", "==", monthKey));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, rewardId: d.id, ...d.data() }));
}

export async function createClientReward(data, userId) {
  const clientName = sanitizeClientName(data.clientName);
  if (!clientName) throw new Error("Nom client requis.");

  const amount = round2(data.amount);
  if (!(amount > 0)) throw new Error("Montant récompense invalide.");

  const monthKey =
    typeof data.monthKey === "string" && /^\d{4}-\d{2}$/.test(data.monthKey)
      ? data.monthKey
      : (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        })();

  const payload = {
    clientId: data.clientId || null,
    clientName,
    monthKey,
    amount,
    percentUsed:
      data.percentUsed == null ? null : round2(data.percentUsed),
    clientSalesTotal: round2(data.clientSalesTotal || 0),
    note: typeof data.note === "string" ? data.note.trim().slice(0, 200) : "",
    status: "active",
    createdAt: Timestamp.now(),
    createdBy: userId || ""
  };

  const ref = await addDoc(collection(db, REWARDS_COL), payload);
  return { id: ref.id, ...payload };
}

export { CLIENTS_COL, REWARDS_COL };
