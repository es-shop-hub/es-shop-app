import { bindActionButton } from "../utils/buttonManager.js";
import {
  createPdfContext,
  drawReportHeader,
  drawSectionTitle,
  drawKpiGrid,
  drawTable,
  savePdf,
  moneyFromMeta,
  n
} from "./pdf-core.js";

export async function exportBatchStatsPdf(payload) {
  if (!payload) return;
  const ctx = await createPdfContext({
    ...payload.meta,
    reportTitle: "Rapport Stats lots"
  });
  drawReportHeader(ctx);

  const k = payload.kpis || {};
  drawSectionTitle(ctx, "Synthèse lots");
  drawKpiGrid(ctx, [
    { label: "Encaissé (période)", value: moneyFromMeta(ctx.meta, k.collected) },
    { label: "Coût consommé", value: moneyFromMeta(ctx.meta, k.costConsumed) },
    { label: "Marge période", value: moneyFromMeta(ctx.meta, k.margin) },
    { label: "Qté sortie", value: String(k.qtyOut ?? 0) },
    { label: "Stock restant", value: String(k.stockRemaining ?? 0) }
  ]);

  drawSectionTitle(ctx, "Par produit");
  drawTable(
    ctx,
    [
      { key: "name", label: "Produit", width: 70 },
      { key: "collected", label: "Encaissé", width: 40, align: "right" },
      { key: "margin", label: "Marge", width: 40, align: "right" },
      { key: "stock", label: "Stock", width: 32, align: "right" }
    ],
    (payload.byProduct || []).slice(0, 30).map(p => ({
      name: p.name || p.productName || "—",
      collected: moneyFromMeta(ctx.meta, p.collected),
      margin: moneyFromMeta(ctx.meta, p.margin),
      stock: String(p.stock_remaining ?? p.stockRemaining ?? p.stock ?? 0)
    })),
    30
  );

  drawSectionTitle(ctx, "Par lot");
  drawTable(
    ctx,
    [
      { key: "label", label: "Lot", width: 70 },
      { key: "collected", label: "Encaissé", width: 40, align: "right" },
      { key: "margin", label: "Marge", width: 40, align: "right" },
      { key: "remaining", label: "Restant", width: 32, align: "right" }
    ],
    (payload.byBatch || []).slice(0, 30).map(b => ({
      label: b.productName || b.label || b.batchLabel || b.batchId || b.id || "—",
      collected: moneyFromMeta(ctx.meta, b.collected),
      margin: moneyFromMeta(ctx.meta, b.margin),
      remaining: String(b.quantity_remaining ?? b.remaining ?? 0)
    })),
    30
  );

  savePdf(ctx, `${ctx.meta.shopName || "stockflow"}-stats-lots`);
}

export function initBatchStatsPdfButton(getPayload) {
  const btn = document.getElementById("pdfBtn");
  if (!btn) return;
  bindActionButton(btn, async () => {
    const payload = getPayload?.();
    if (!payload) return;
    await exportBatchStatsPdf(payload);
  });
}

export function buildBatchStatsPdfPayload(stats, meta, periodLabel) {
  const s = stats || {};
  return {
    meta: {
      shopName: meta?.shopName || "StockFlow",
      shopAddress: meta?.shopAddress || "",
      shopPhone: meta?.shopPhone || "",
      currencySymbol: meta?.currencySymbol || "$",
      logoUrl: meta?.logoUrl || "",
      periodLabel: periodLabel || "Lots",
      generatedAt: new Date().toISOString()
    },
    kpis: {
      collected: n(s.totalCollected),
      costConsumed: n(s.totalCostConsumed),
      margin: n(s.totalMargin),
      qtyOut: n(s.totalQtyOut),
      stockRemaining: n(s.totalStockRemaining)
    },
    byProduct: s.byProduct || [],
    byBatch: s.byBatch || []
  };
}
