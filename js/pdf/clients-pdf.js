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

export async function exportClientsPdf(payload) {
  if (!payload) return;
  const ctx = await createPdfContext({
    ...payload.meta,
    reportTitle: "Rapport Clients"
  });
  drawReportHeader(ctx);

  const k = payload.kpis || {};
  drawSectionTitle(ctx, "Synthèse");
  drawKpiGrid(ctx, [
    { label: "Clients (filtre)", value: String(k.clientsCount ?? 0) },
    { label: "Récurrents", value: String(k.recurringCount ?? 0) },
    { label: "CA période", value: moneyFromMeta(ctx.meta, k.periodCa) },
    { label: "Profit période", value: moneyFromMeta(ctx.meta, k.periodProfit) },
    { label: "Récompenses", value: moneyFromMeta(ctx.meta, k.rewardsTotal) }
  ]);

  drawSectionTitle(ctx, "Top clients");
  drawTable(
    ctx,
    [
      { key: "name", label: "Client", width: 55 },
      { key: "sales", label: "Ventes", width: 25, align: "right" },
      { key: "ca", label: "CA", width: 35, align: "right" },
      { key: "profit", label: "Profit", width: 35, align: "right" },
      { key: "last", label: "Dernière vente", width: 32 }
    ],
    (payload.clients || []).slice(0, 40).map(c => ({
      name: (c.name || "—") + (c.isRecurring ? " ★" : ""),
      sales: String(c.salesCount ?? 0),
      ca: moneyFromMeta(ctx.meta, c.ca),
      profit: moneyFromMeta(ctx.meta, c.profit),
      last: formatDateShort(c.lastSaleAt)
    })),
    40
  );

  savePdf(ctx, `${ctx.meta.shopName || "stockflow"}-clients`);
}

export function initClientsPdfButton(getPayload) {
  const btn = document.getElementById("pdfBtn");
  if (!btn) return;
  bindActionButton(btn, async () => {
    const payload = getPayload?.();
    if (!payload) return;
    await exportClientsPdf(payload);
  });
}

export function buildClientsPdfPayload(state, meta, extras = {}) {
  const view = state?.filteredAggregates || [];
  const withSales = view.filter(a => n(a.salesCount) > 0);
  return {
    meta: {
      shopName: meta?.shopName || "StockFlow",
      shopAddress: meta?.shopAddress || "",
      shopPhone: meta?.shopPhone || "",
      currencySymbol: meta?.currencySymbol || meta?.currency || "$",
      logoUrl: meta?.logoUrl || "",
      periodLabel: extras.periodLabel || meta?.periodLabel || "Période",
      generatedAt: new Date().toISOString()
    },
    kpis: {
      clientsCount: view.length,
      recurringCount: view.filter(a => a.isRecurring).length,
      periodCa: withSales.reduce((s, a) => s + n(a.ca), 0),
      periodProfit: extras.periodProfit ?? state?.totalPeriodProfit ?? 0,
      rewardsTotal: extras.rewardsTotal ?? 0
    },
    clients: withSales
  };
}
