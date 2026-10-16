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

export async function exportExpensesPdf(payload) {
  if (!payload) return;
  const ctx = await createPdfContext({
    ...payload.meta,
    reportTitle: "Rapport Dépenses"
  });
  drawReportHeader(ctx);

  const k = payload.kpis || {};
  drawSectionTitle(ctx, "Synthèse");
  drawKpiGrid(ctx, [
    { label: "Nombre", value: String(k.count ?? 0) },
    { label: "Total", value: moneyFromMeta(ctx.meta, k.total) },
    { label: "Opérationnelles", value: moneyFromMeta(ctx.meta, k.operating) },
    { label: "Investissements", value: moneyFromMeta(ctx.meta, k.investment) },
    { label: "Réinvestissements", value: moneyFromMeta(ctx.meta, k.reinvestment) }
  ]);

  drawSectionTitle(ctx, "Liste des dépenses");
  drawTable(
    ctx,
    [
      { key: "date", label: "Date", width: 30 },
      { key: "label", label: "Libellé", width: 60 },
      { key: "category", label: "Catégorie", width: 40 },
      { key: "amount", label: "Montant", width: 52, align: "right" }
    ],
    (payload.rows || []).slice(0, 50).map(e => ({
      date: formatDateShort(e.date || e.createdAt),
      label: e.label || "—",
      category: e.category || "—",
      amount: moneyFromMeta(ctx.meta, e.amount)
    })),
    50
  );

  savePdf(ctx, `${ctx.meta.shopName || "stockflow"}-depenses`);
}

export function initExpensesPdfButton(getPayload) {
  const btn = document.getElementById("pdfBtn");
  if (!btn) return;
  bindActionButton(btn, async () => {
    const payload = getPayload?.();
    if (!payload) return;
    await exportExpensesPdf(payload);
  });
}

export function buildExpensesPdfPayload(rows, meta, periodLabel) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.reduce((s, e) => s + n(e.amount), 0);
  const investment = list
    .filter(e => e.category === "investment")
    .reduce((s, e) => s + n(e.amount), 0);
  const reinvestment = list
    .filter(e => e.category === "reinvestment")
    .reduce((s, e) => s + n(e.amount), 0);
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
      operating: total - investment - reinvestment,
      investment,
      reinvestment
    },
    rows: list
  };
}
