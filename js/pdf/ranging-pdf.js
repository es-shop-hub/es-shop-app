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

export async function exportRangingPdf(payload) {
  if (!payload) return;
  const ctx = await createPdfContext({
    ...payload.meta,
    reportTitle: "Rapport Ranking produits"
  });
  drawReportHeader(ctx);

  const k = payload.kpis || {};
  drawSectionTitle(ctx, "Synthèse");
  drawKpiGrid(ctx, [
    { label: "Produits vendus", value: String(k.soldCount ?? 0) },
    { label: "Qté totale", value: String(k.totalQuantity ?? 0) },
    { label: "CA", value: moneyFromMeta(ctx.meta, k.totalRevenue) },
    { label: "Profit", value: moneyFromMeta(ctx.meta, k.totalProfit) },
    { label: "Alertes stock", value: String(k.lowStockCount ?? 0) }
  ]);

  drawSectionTitle(ctx, "Top volume");
  drawTable(
    ctx,
    [
      { key: "name", label: "Produit", width: 70 },
      { key: "qty", label: "Qté", width: 25, align: "right" },
      { key: "revenue", label: "CA", width: 40, align: "right" },
      { key: "profit", label: "Profit", width: 35, align: "right" },
      { key: "margin", label: "Marge %", width: 22, align: "right" }
    ],
    (payload.byQuantity || []).slice(0, 15).map(p => ({
      name: p.name || "—",
      qty: String(p.quantity ?? 0),
      revenue: moneyFromMeta(ctx.meta, p.revenue),
      profit: moneyFromMeta(ctx.meta, p.profit),
      margin: `${n(p.marginRate)}%`
    })),
    15
  );

  drawSectionTitle(ctx, "Top marge");
  drawTable(
    ctx,
    [
      { key: "name", label: "Produit", width: 70 },
      { key: "margin", label: "Marge %", width: 30, align: "right" },
      { key: "profit", label: "Profit", width: 40, align: "right" },
      { key: "revenue", label: "CA", width: 42, align: "right" }
    ],
    (payload.byMargin || []).slice(0, 15).map(p => ({
      name: p.name || "—",
      margin: `${n(p.marginRate)}%`,
      profit: moneyFromMeta(ctx.meta, p.profit),
      revenue: moneyFromMeta(ctx.meta, p.revenue)
    })),
    15
  );

  drawSectionTitle(ctx, "Stock faible");
  drawTable(
    ctx,
    [
      { key: "name", label: "Produit", width: 100 },
      { key: "stock", label: "Stock", width: 40, align: "right" },
      { key: "threshold", label: "Seuil", width: 42, align: "right" }
    ],
    (payload.lowStock || []).slice(0, 20).map(p => ({
      name: p.name || "—",
      stock: String(p.stockCurrent ?? p.stock ?? 0),
      threshold: String(p.stockThreshold ?? p.alert ?? "—")
    })),
    20
  );

  savePdf(ctx, `${ctx.meta.shopName || "stockflow"}-ranking`);
}

export function initRangingPdfButton(getPayload) {
  const btn = document.getElementById("pdfBtn");
  if (!btn) return;
  bindActionButton(btn, async () => {
    const payload = getPayload?.();
    if (!payload) return;
    await exportRangingPdf(payload);
  });
}
