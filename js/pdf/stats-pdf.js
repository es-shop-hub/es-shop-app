import { bindActionButton } from "../utils/buttonManager.js";
import {
  createPdfContext,
  drawReportHeader,
  drawSectionTitle,
  drawKpiGrid,
  drawTable,
  drawNote,
  savePdf,
  moneyFromMeta,
  formatDateShort,
  n
} from "./pdf-core.js";

let provider = null;

export function initStatsPdf(providerFn) {
  provider = typeof providerFn === "function" ? providerFn : null;
}

export async function exportStatsPdf(payload) {
  const data = payload || provider?.();
  if (!data) return;

  const symbol = data.meta?.currencySymbol || data.meta?.currency || "$";
  const ctx = await createPdfContext({
    ...data.meta,
    currencySymbol: symbol,
    reportTitle: "Rapport Statistiques",
    periodLabel: data.meta?.filterSummary || data.meta?.filterPeriod || ""
  });

  drawReportHeader(ctx);

  const k = data.kpis || {};
  drawSectionTitle(ctx, "Synthèse exécutive");
  drawKpiGrid(ctx, [
    { label: "Chiffre d'affaires", value: moneyFromMeta(ctx.meta, k.totalSales) },
    { label: "Profit brut", value: moneyFromMeta(ctx.meta, k.totalProfit) },
    { label: "Dépenses totales", value: moneyFromMeta(ctx.meta, k.totalExpenses) },
    { label: "Pertes", value: moneyFromMeta(ctx.meta, k.totalLosses) },
    { label: "Dettes restantes", value: moneyFromMeta(ctx.meta, k.totalDebtRemaining) },
    { label: "Résultat net", value: moneyFromMeta(ctx.meta, k.netProfit) },
    {
      label: "Bénéfice opérationnel",
      value: moneyFromMeta(ctx.meta, k.operationalNetProfit)
    },
    {
      label: "Valeur stock (indicatif)",
      value: moneyFromMeta(ctx.meta, k.stockValue)
    }
  ]);

  drawSectionTitle(ctx, "Finance opérationnelle");
  drawKpiGrid(ctx, [
    {
      label: "Marge ventes (brut)",
      value: moneyFromMeta(ctx.meta, k.grossProfitFromItems)
    },
    {
      label: "Dépenses opérationnelles",
      value: moneyFromMeta(ctx.meta, k.operatingExpenses)
    },
    {
      label: "Exclu — investissements",
      value: moneyFromMeta(ctx.meta, k.excludedInvestment)
    },
    {
      label: "Exclu — réinvestissements",
      value: moneyFromMeta(ctx.meta, k.excludedReinvestment)
    }
  ]);
  drawNote(
    ctx,
    "Bénéfice net opérationnel = marge ventes − dépenses (hors invest./réinvest.) − pertes."
  );

  const batch = data.batch || {};
  if (batch.collected != null || batch.benefitDisplay != null) {
    drawSectionTitle(ctx, "Totaux classique / batch");
    drawKpiGrid(ctx, [
      {
        label: "Encaissé batch",
        value: moneyFromMeta(ctx.meta, batch.collected)
      },
      {
        label: "Bénéfice batch affiché",
        value: moneyFromMeta(ctx.meta, batch.benefitDisplay)
      },
      {
        label: "Stock restant batch (qté)",
        value: String(batch.stockRemaining ?? "—")
      },
      {
        label: "CA classique",
        value: moneyFromMeta(ctx.meta, batch.classicCa)
      }
    ]);
  }

  drawSectionTitle(ctx, "Ventes récentes");
  drawTable(
    ctx,
    [
      { key: "date", label: "Date", width: 32 },
      { key: "client", label: "Client", width: 45 },
      { key: "amount", label: "Montant", width: 35, align: "right" },
      { key: "profit", label: "Profit", width: 35, align: "right" },
      { key: "status", label: "Paiement", width: 35 }
    ],
    (data.sales || []).slice(0, 25).map(s => ({
      date: formatDateShort(s.createdAt),
      client: s.clientName || "—",
      amount: moneyFromMeta(ctx.meta, s.amount),
      profit: moneyFromMeta(ctx.meta, s.profit),
      status: s.payment_status || "—"
    }))
  );

  drawSectionTitle(ctx, "Dettes ouvertes");
  drawTable(
    ctx,
    [
      { key: "name", label: "Client / fournisseur", width: 70 },
      { key: "remaining", label: "Restant", width: 45, align: "right" },
      { key: "status", label: "Statut", width: 67 }
    ],
    (data.debts || [])
      .filter(d => n(d.remaining) > 0)
      .slice(0, 30)
      .map(d => ({
        name: d.name || "—",
        remaining: moneyFromMeta(ctx.meta, d.remaining),
        status: d.status || "—"
      }))
  );

  drawSectionTitle(ctx, "Pertes");
  drawTable(
    ctx,
    [
      { key: "reason", label: "Raison", width: 110 },
      { key: "amount", label: "Montant", width: 72, align: "right" }
    ],
    (data.losses || []).slice(0, 25).map(l => ({
      reason: l.reason || l.category || "Perte",
      amount: moneyFromMeta(ctx.meta, l.amount)
    }))
  );

  drawSectionTitle(ctx, "Alertes stock");
  drawTable(
    ctx,
    [
      { key: "name", label: "Produit", width: 120 },
      { key: "stock", label: "Stock", width: 62, align: "right" }
    ],
    (data.products || [])
      .filter(p => n(p.stock) <= (n(p.alert) || 5))
      .slice(0, 30)
      .map(p => ({
        name: p.name || "—",
        stock: String(p.stock)
      }))
  );

  const shop = ctx.meta.shopName || "StockFlow";
  savePdf(ctx, `${shop}-rapport-stats`);
}

export function initStatsPdfButton(providerFn) {
  if (providerFn) initStatsPdf(providerFn);
  const btn = document.getElementById("pdfBtn");
  if (!btn) return;
  bindActionButton(btn, () => exportStatsPdf());
}

/** Compat anciennes signatures download.js */
export function initPdfExport(providerFn) {
  initStatsPdf(providerFn);
}

export function initPdfExportButton() {
  initStatsPdfButton();
}
