import { bindActionButton } from "../utils/buttonManager.js";
import {
  createPdfContext,
  drawReportHeader,
  drawSectionTitle,
  drawKpiGrid,
  drawTable,
  savePdf,
  moneyFromMeta,
  formatDateShort,
  n
} from "./pdf-core.js";

export async function exportVendusPdf(payload) {
  if (!payload) return;
  const ctx = await createPdfContext({
    ...payload.meta,
    reportTitle: "Rapport Vendus"
  });
  drawReportHeader(ctx);

  const k = payload.kpis || {};
  drawSectionTitle(ctx, "Synthèse");
  drawKpiGrid(ctx, [
    { label: "Lignes", value: String(k.rowCount ?? 0) },
    { label: "Quantité vendue", value: String(k.soldCount ?? 0) },
    { label: "CA", value: moneyFromMeta(ctx.meta, k.salesTotal) },
    { label: "Profit net", value: moneyFromMeta(ctx.meta, k.netProfit) },
    { label: "Dettes liées", value: moneyFromMeta(ctx.meta, k.debtRemaining) }
  ]);

  drawSectionTitle(ctx, "Détail des ventes");
  drawTable(
    ctx,
    [
      { key: "date", label: "Date", width: 28 },
      { key: "product", label: "Produit", width: 48 },
      { key: "client", label: "Client", width: 36 },
      { key: "total", label: "Total", width: 30, align: "right" },
      { key: "profit", label: "Profit", width: 28, align: "right" },
      { key: "status", label: "Statut", width: 22 }
    ],
    (payload.rows || []).slice(0, 60).map(r => ({
      date: formatDateShort(r.createdAt),
      product: r.productName || "—",
      client: r.clientName || "—",
      total: moneyFromMeta(ctx.meta, r.total),
      profit: moneyFromMeta(ctx.meta, r.profit),
      status: r.saleStatus === "cancelled" ? "Annulée" : r.paymentStatus || "—"
    })),
    60
  );

  savePdf(ctx, `${ctx.meta.shopName || "stockflow"}-vendus`);
}

export function initVendusPdfButton(getPayload) {
  const btn = document.getElementById("pdfBtn");
  if (!btn) return;
  bindActionButton(btn, async () => {
    const payload = getPayload?.();
    if (!payload) return;
    await exportVendusPdf(payload);
  });
}

export function buildVendusPdfFromState(state, meta) {
  const rows = state?.rows || [];
  const active = rows.filter(r => r.saleStatus !== "cancelled");
  const soldCount = active.reduce((s, r) => s + n(r.quantity), 0);
  const salesTotal = active.reduce((s, r) => s + n(r.total), 0);
  const netProfit = active.reduce((s, r) => s + n(r.profit), 0);
  const debtBySale = new Map();
  active.forEach(r => {
    if (n(r.amountRemaining) > 0) {
      debtBySale.set(r.saleId, n(r.amountRemaining));
    }
  });
  let debtRemaining = 0;
  debtBySale.forEach(v => {
    debtRemaining += v;
  });

  return {
    meta: {
      shopName: meta?.shopName || "StockFlow",
      shopAddress: meta?.shopAddress || "",
      shopPhone: meta?.shopPhone || "",
      currencySymbol: meta?.currencySymbol || meta?.currency || "$",
      logoUrl: meta?.logoUrl || "",
      periodLabel: meta?.periodLabel || "Période filtrée",
      generatedAt: new Date().toISOString()
    },
    kpis: {
      rowCount: rows.length,
      soldCount,
      salesTotal,
      netProfit,
      debtRemaining
    },
    rows
  };
}
