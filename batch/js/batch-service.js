import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  runTransaction
} from "../../js/firebase.js";

import {
  BATCH_COLLECTIONS,
  BATCH_STATUS,
  round2,
  sanitizeText,
  parsePositiveNumber,
  parsePositiveInt
} from "./batch-utils.js";

/* ================================
   VALIDATION
================================ */

export async function validateBatchId(batchId) {
  if (!batchId || typeof batchId !== "string") {
    throw new Error("Identifiant de lot invalide.");
  }

  const ref = doc(db, BATCH_COLLECTIONS.BATCHES, batchId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    throw new Error("Lot introuvable.");
  }

  const data = { id: snap.id, ...snap.data() };

  if (data.status === BATCH_STATUS.CANCELLED) {
    throw new Error("Ce lot est désactivé.");
  }

  if (data.status === BATCH_STATUS.DEPLETED || data.quantity_remaining <= 0) {
    throw new Error("Ce lot est épuisé.");
  }

  return data;
}

async function countMovementsForBatch(batchId) {
  const snap = await getDocs(
    query(collection(db, BATCH_COLLECTIONS.MOVEMENTS), where("batchId", "==", batchId))
  );
  return snap.size;
}

async function countBatchesForProduct(productId) {
  const snap = await getDocs(
    query(collection(db, BATCH_COLLECTIONS.BATCHES), where("productId", "==", productId))
  );
  return snap.size;
}

/* ================================
   BATCH PRODUCTS (catalogue isolé)
================================ */

export async function loadBatchProducts() {
  const snap = await getDocs(
    query(collection(db, BATCH_COLLECTIONS.PRODUCTS), orderBy("name"))
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createBatchProduct({ name, note }, userId) {
  const cleanName = sanitizeText(name, 80);
  if (!cleanName) throw new Error("Nom du produit requis.");

  const now = Timestamp.now();
  const ref = await addDoc(collection(db, BATCH_COLLECTIONS.PRODUCTS), {
    name: cleanName,
    note: sanitizeText(note || "", 200),
    isActive: true,
    createdAt: now,
    updatedAt: now,
    createdBy: userId
  });

  return ref.id;
}

export async function updateBatchProduct(productId, { name, note }, userId) {
  if (!productId) throw new Error("Produit invalide.");

  const cleanName = sanitizeText(name, 80);
  if (!cleanName) throw new Error("Nom du produit requis.");

  await updateDoc(doc(db, BATCH_COLLECTIONS.PRODUCTS, productId), {
    name: cleanName,
    note: sanitizeText(note || "", 200),
    updatedAt: Timestamp.now(),
    updatedBy: userId
  });
}

export async function toggleBatchProductActive(productId, isActive, userId) {
  if (!productId) throw new Error("Produit invalide.");

  await updateDoc(doc(db, BATCH_COLLECTIONS.PRODUCTS, productId), {
    isActive: Boolean(isActive),
    updatedAt: Timestamp.now(),
    updatedBy: userId
  });
}

export async function deleteBatchProduct(productId) {
  if (!productId) throw new Error("Produit invalide.");

  const batchCount = await countBatchesForProduct(productId);
  if (batchCount > 0) {
    throw new Error("Impossible de supprimer : des lots existent pour ce produit.");
  }

  await deleteDoc(doc(db, BATCH_COLLECTIONS.PRODUCTS, productId));
}

/* ================================
   LOTS (product_batches)
================================ */

export async function loadBatches() {
  const snap = await getDocs(
    query(collection(db, BATCH_COLLECTIONS.BATCHES), orderBy("createdAt", "desc"))
  );
  return snap.docs.map(d => ({ id: d.id, batchId: d.id, ...d.data() }));
}

export async function createBatch({ productId, quantityInitial, costTotal }, userId) {
  if (!productId) throw new Error("Produit requis.");

  const qty = parsePositiveInt(quantityInitial);
  const cost = parsePositiveNumber(costTotal);
  if (!qty) throw new Error("Quantité initiale invalide.");
  if (cost === null) throw new Error("Coût total invalide.");

  const productSnap = await getDoc(doc(db, BATCH_COLLECTIONS.PRODUCTS, productId));
  if (!productSnap.exists()) throw new Error("Produit introuvable.");
  if (productSnap.data().isActive === false) throw new Error("Produit désactivé.");

  const costUnitAvg = round2(cost / qty);
  const now = Timestamp.now();

  const ref = await addDoc(collection(db, BATCH_COLLECTIONS.BATCHES), {
    productId,
    quantity_initial: qty,
    quantity_remaining: qty,
    cost_total: cost,
    cost_unit_avg: costUnitAvg,
    status: BATCH_STATUS.ACTIVE,
    createdAt: now,
    createdBy: userId
  });

  return ref.id;
}

export async function updateBatch(batchId, { quantityInitial, costTotal }, userId) {
  const batch = await validateBatchId(batchId);

  const movementCount = await countMovementsForBatch(batchId);
  if (movementCount > 0) {
    throw new Error("Modification impossible : des mouvements existent déjà.");
  }

  const qty = parsePositiveInt(quantityInitial);
  const cost = parsePositiveNumber(costTotal);
  if (!qty) throw new Error("Quantité initiale invalide.");
  if (cost === null) throw new Error("Coût total invalide.");

  const costUnitAvg = round2(cost / qty);

  await updateDoc(doc(db, BATCH_COLLECTIONS.BATCHES, batchId), {
    quantity_initial: qty,
    quantity_remaining: qty,
    cost_total: cost,
    cost_unit_avg: costUnitAvg,
    status: BATCH_STATUS.ACTIVE,
    updatedAt: Timestamp.now(),
    updatedBy: userId
  });

  return { ...batch, quantity_initial: qty, quantity_remaining: qty, cost_total: cost, cost_unit_avg: costUnitAvg };
}

export async function cancelBatch(batchId, userId) {
  if (!batchId) throw new Error("Lot invalide.");

  const batchRef = doc(db, BATCH_COLLECTIONS.BATCHES, batchId);
  const snap = await getDoc(batchRef);

  if (!snap.exists()) throw new Error("Lot introuvable.");
  if (snap.data().status === BATCH_STATUS.CANCELLED) {
    throw new Error("Ce lot est déjà désactivé.");
  }

  await updateDoc(batchRef, {
    status: BATCH_STATUS.CANCELLED,
    updatedAt: Timestamp.now(),
    updatedBy: userId
  });
}

export async function deleteBatch(batchId) {
  if (!batchId) throw new Error("Lot invalide.");

  const movementCount = await countMovementsForBatch(batchId);
  if (movementCount > 0) {
    throw new Error("Impossible de supprimer : des ventes sont enregistrées sur ce lot.");
  }

  await deleteDoc(doc(db, BATCH_COLLECTIONS.BATCHES, batchId));
}

/* ================================
   VENTE FRACTIONNÉE (transaction)
================================ */

export async function recordBatchSale({
  batchId,
  quantityOut,
  amountCollected,
  reason = "sale",
  clientName = ""
}, userId) {
  const qtyOut = parsePositiveInt(quantityOut);
  const amount = parsePositiveNumber(amountCollected, { allowZero: true });
  const cleanReason = sanitizeText(reason, 40) || "sale";
  const cleanClientName = sanitizeText(clientName || "", 80);

  if (!batchId) throw new Error("Lot requis.");
  if (!qtyOut) throw new Error("Quantité vendue invalide.");
  if (amount === null) throw new Error("Montant encaissé invalide.");
  if (!cleanClientName) throw new Error("Nom client requis.");

  const batchRef = doc(db, BATCH_COLLECTIONS.BATCHES, batchId);
  const movementsRef = collection(db, BATCH_COLLECTIONS.MOVEMENTS);

  const movementId = await runTransaction(db, async (transaction) => {
    const batchSnap = await transaction.get(batchRef);

    if (!batchSnap.exists()) {
      throw new Error("Lot introuvable.");
    }

    const batch = batchSnap.data();

    if (batch.status === BATCH_STATUS.CANCELLED) {
      throw new Error("Ce lot est désactivé.");
    }

    if (batch.status === BATCH_STATUS.DEPLETED || batch.quantity_remaining <= 0) {
      throw new Error("Ce lot est épuisé.");
    }

    if (qtyOut > batch.quantity_remaining) {
      throw new Error(`Stock insuffisant. Reste : ${batch.quantity_remaining}.`);
    }

    const costPortion = round2(qtyOut * batch.cost_unit_avg);
    const profitReal = round2(amount - costPortion);
    const newRemaining = batch.quantity_remaining - qtyOut;
    const newStatus = newRemaining <= 0 ? BATCH_STATUS.DEPLETED : BATCH_STATUS.ACTIVE;

    transaction.update(batchRef, {
      quantity_remaining: newRemaining,
      status: newStatus,
      updatedAt: Timestamp.now()
    });

    const movementDocRef = doc(movementsRef);
    transaction.set(movementDocRef, {
      batchId,
      productId: batch.productId,
      quantity_out: qtyOut,
      amount_collected: amount,
      profit_real: profitReal,
      reason: cleanReason,
      clientName: cleanClientName,
      createdAt: Timestamp.now(),
      createdBy: userId
    });

    return movementDocRef.id;
  });

  return movementId;
}

/* ================================
   LECTURES STATS
================================ */

export async function loadBatchMovements(filters = {}) {
  const snap = await getDocs(
    query(collection(db, BATCH_COLLECTIONS.MOVEMENTS), orderBy("createdAt", "desc"))
  );

  let rows = snap.docs.map(d => ({ id: d.id, movementId: d.id, ...d.data() }));

  if (filters.productId) {
    rows = rows.filter(m => m.productId === filters.productId);
  }

  if (filters.batchId) {
    rows = rows.filter(m => m.batchId === filters.batchId);
  }

  return rows;
}

export function aggregateBatchStats(batches, movements, productsMap) {
  let totalMargin = 0;
  let totalCollected = 0;
  let totalQtyOut = 0;
  let totalStockRemaining = 0;
  let totalCostConsumed = 0;
  let totalCostEngaged = 0;

  const byProduct = {};
  const byBatch = {};

  batches.forEach(batch => {
    if (batch.status === BATCH_STATUS.CANCELLED) return;

    const qtyRem = batch.quantity_remaining || 0;
    const costUnit = Number(batch.cost_unit_avg) || 0;
    const costEngaged = round2(qtyRem * costUnit);

    totalStockRemaining += qtyRem;
    totalCostEngaged = round2(totalCostEngaged + costEngaged);

    byBatch[batch.id] = {
      batchId: batch.id,
      productId: batch.productId,
      productName: productsMap[batch.productId]?.name || batch.productId,
      quantity_initial: batch.quantity_initial,
      quantity_remaining: qtyRem,
      cost_total: batch.cost_total,
      cost_unit_avg: costUnit,
      status: batch.status,
      margin: 0,
      collected: 0,
      qty_out: 0,
      costConsumed: 0,
      costEngaged,
      benefitRaw: 0,
      benefitDisplay: 0
    };

    if (!byProduct[batch.productId]) {
      byProduct[batch.productId] = {
        productId: batch.productId,
        productName: productsMap[batch.productId]?.name || batch.productId,
        stock_remaining: 0,
        margin: 0,
        collected: 0,
        qty_out: 0,
        batch_count: 0
      };
    }

    byProduct[batch.productId].stock_remaining += qtyRem;
    byProduct[batch.productId].batch_count += 1;
  });

  movements.forEach(m => {
    const margin = round2(m.profit_real || 0);
    const collected = round2(m.amount_collected || 0);
    const qty = m.quantity_out || 0;

    totalMargin = round2(totalMargin + margin);
    totalCollected = round2(totalCollected + collected);
    totalQtyOut += qty;

    if (byBatch[m.batchId]) {
      const batchRow = byBatch[m.batchId];
      batchRow.margin = round2(batchRow.margin + margin);
      batchRow.collected = round2(batchRow.collected + collected);
      batchRow.qty_out += qty;
      batchRow.costConsumed = round2(
        batchRow.qty_out * (Number(batchRow.cost_unit_avg) || 0)
      );
    }

    if (!byProduct[m.productId]) {
      byProduct[m.productId] = {
        productId: m.productId,
        productName: productsMap[m.productId]?.name || m.productId,
        stock_remaining: 0,
        margin: 0,
        collected: 0,
        qty_out: 0,
        batch_count: 0
      };
    }

    byProduct[m.productId].margin = round2(byProduct[m.productId].margin + margin);
    byProduct[m.productId].collected = round2(byProduct[m.productId].collected + collected);
    byProduct[m.productId].qty_out += qty;
  });

  Object.values(byBatch).forEach(row => {
    if (!row.costConsumed && row.qty_out) {
      row.costConsumed = round2(
        row.qty_out * (Number(row.cost_unit_avg) || 0)
      );
    }
    totalCostConsumed = round2(totalCostConsumed + (row.costConsumed || 0));
    const costTotalLot = round2(
      (row.costConsumed || 0) + (row.costEngaged || 0)
    );
    row.benefitRaw = round2((row.collected || 0) - costTotalLot);
    row.benefitDisplay = Math.max(0, row.benefitRaw);
  });

  const totalCostLot = round2(totalCostConsumed + totalCostEngaged);
  const benefitRaw = round2(totalCollected - totalCostLot);
  const benefitDisplay = Math.max(0, benefitRaw);

  return {
    totalMargin,
    totalCollected,
    totalQtyOut,
    totalStockRemaining,
    totalCostConsumed,
    totalCostEngaged,
    benefitRaw,
    benefitDisplay,
    stockValue: totalCostEngaged,
    byProduct: Object.values(byProduct).sort((a, b) => b.margin - a.margin),
    byBatch: Object.values(byBatch).sort(
      (a, b) => b.benefitDisplay - a.benefitDisplay
    )
  };
}
