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

export async function exportDebtsPdf(payload) {
  if (!payload) return;
  const ctx = await createPdfContext({
    ...payload.meta,
    reportTitle: "Rapport Dettes"
  });
  drawReportHeader(ctx);

  const k = payload.kpis || {};
  drawSectionTitle(ctx, "Synthèse");
  drawKpiGrid(ctx, [
    { label: "Nombre", value: String(k.count ?? 0) },
    { label: "Total dû", value: moneyFromMeta(ctx.meta, k.total) },
    { label: "Payé", value: moneyFromMeta(ctx.meta, k.paid) },
    { label: "Restant", value: moneyFromMeta(ctx.meta, k.remaining) },
    { label: "En retard", value: String(k.overdueCount ?? 0) }
  ]);

  drawSectionTitle(ctx, "Dettes");
  drawTable(
    ctx,
    [
      { key: "name", label: "Nom", width: 50 },
      { key: "type", label: "Type", width: 28 },
      { key: "remaining", label: "Restant", width: 35, align: "right" },
      { key: "status", label: "Statut", width: 30 },
      { key: "due", label: "Échéance", width: 39 }
    ],
    (payload.rows || []).slice(0, 50).map(d => ({
      name: d.name || "—",
      type: d.debtType || d.type || "—",
      remaining: moneyFromMeta(ctx.meta, d.amount_remaining ?? d.remaining),
      status: d.status || "—",
      due: formatDateShort(d.dueDate || d.due_date)
    })),
    50
  );

  savePdf(ctx, `${ctx.meta.shopName || "stockflow"}-dettes`);
}

export function initDebtsPdfButton(getPayload) {
  const btn = document.getElementById("pdfBtn");
  if (!btn) return;
  bindActionButton(btn, async () => {
    const payload = getPayload?.();
    if (!payload) return;
    await exportDebtsPdf(payload);
  });
}

export function buildDebtsPdfPayload(rows, meta, periodLabel) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.reduce((s, d) => s + n(d.amount_total ?? d.total), 0);
  const paid = list.reduce((s, d) => s + n(d.amount_paid ?? d.paid), 0);
  const remaining = list.reduce(
    (s, d) => s + n(d.amount_remaining ?? d.remaining),
    0
  );
  const now = Date.now();
  const overdueCount = list.filter(d => {
    const rem = n(d.amount_remaining ?? d.remaining);
    if (rem <= 0) return false;
    const due = d.dueDate?.toDate
      ? d.dueDate.toDate()
      : d.dueDate
        ? new Date(d.dueDate)
        : null;
    return due && due.getTime() < now;
  }).length;

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
    kpis: { count: list.length, total, paid, remaining, overdueCount },
    rows: list
  };
}
