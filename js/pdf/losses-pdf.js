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

export async function exportLossesPdf(payload) {
  if (!payload) return;
  const ctx = await createPdfContext({
    ...payload.meta,
    reportTitle: "Rapport Pertes"
  });
  drawReportHeader(ctx);

  const k = payload.kpis || {};
  drawSectionTitle(ctx, "Synthèse");
  drawKpiGrid(ctx, [
    { label: "Nombre", value: String(k.count ?? 0) },
    { label: "Total", value: moneyFromMeta(ctx.meta, k.total) },
    { label: "Produit", value: moneyFromMeta(ctx.meta, k.productTotal) },
    { label: "Argent", value: moneyFromMeta(ctx.meta, k.moneyTotal) }
  ]);

  drawSectionTitle(ctx, "Liste des pertes");
  drawTable(
    ctx,
    [
      { key: "date", label: "Date", width: 30 },
      { key: "reason", label: "Raison", width: 70 },
      { key: "type", label: "Type", width: 35 },
      { key: "amount", label: "Montant", width: 47, align: "right" }
    ],
    (payload.rows || []).slice(0, 50).map(l => ({
      date: formatDateShort(l.date || l.createdAt),
      reason: l.reason || "—",
      type: l.lossType || l.type || l.category || "—",
      amount: moneyFromMeta(ctx.meta, l.amount)
    })),
    50
  );

  savePdf(ctx, `${ctx.meta.shopName || "stockflow"}-pertes`);
}

export function initLossesPdfButton(getPayload) {
  const btn = document.getElementById("pdfBtn");
  if (!btn) return;
  bindActionButton(btn, async () => {
    const payload = getPayload?.();
    if (!payload) return;
    await exportLossesPdf(payload);
  });
}

export function buildLossesPdfPayload(rows, meta, periodLabel) {
  const list = (Array.isArray(rows) ? rows : []).filter(
    l => l.isSystemCorrection !== true && l.status !== "cancelled"
  );
  const total = list.reduce((s, l) => s + n(l.amount), 0);
  const productTotal = list
    .filter(l => (l.lossType || l.type) === "product" || l.productId)
    .reduce((s, l) => s + n(l.amount), 0);
  return {
    meta: {
      shopName: meta?.shopName || "StockFlow",
      shopAddress: meta?.shopAddress || "",
      shopPhone: meta?.shopPhone || "",
      currencySymbol: meta?.currencySymbol || "FC",
      logoUrl: meta?.logoUrl || "",
      periodLabel: periodLabel || "Filtres actifs",
      generatedAt: new Date().toISOString()
    },
    kpis: {
      count: list.length,
      total,
      productTotal,
      moneyTotal: total - productTotal
    },
    rows: list
  };
}
