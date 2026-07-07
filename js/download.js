// download.js v2
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import { bindActionButton } from "./utils/buttonManager.js";

let provider = null;

/* ================= PROVIDER ================= */

export function initPdfExport(providerFn) {
  provider = providerFn;
}

function getData() {
  return provider?.() || null;
}

/* ================= UTILS ================= */

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function money(v,c="FC"){
  return `${Math.round(n(v)).toLocaleString()} ${c}`;
}

function safeArr(a) {
  return Array.isArray(a) ? a : [];
}

function line(doc, label, value, y) {
  doc.text(`${label}: ${value}`, 15, y);
  return y + 7;
}

function section(doc, title, y) {
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(title, 15, y);
  return y + 6;
}

/* ================= BUILD REPORT ================= */
function build(){
  const data = getData();
  if(!data){
    return null;
  }
  const sales = safeArr(data.sales);
  const debts = safeArr(data.debts);
  const losses = safeArr(data.losses);
  const products = safeArr(data.products);

  const stockValue = products.reduce((sum,product)=>{
    return sum + n(product.stock);
  },0);

  return {
    meta:{
      ...data.meta
    },
    kpis:{
      totalSales:
        n(data.kpis?.totalSales),
      totalProfit:
        n(data.kpis?.totalProfit),
      totalExpenses:
        n(data.kpis?.totalExpenses),
      totalLosses:
        n(data.kpis?.totalLosses),
      totalDebtRemaining:
        n(data.kpis?.totalDebtRemaining),
      netProfit:
        n(data.kpis?.netProfit),
      grossProfitFromItems:
        n(data.kpis?.grossProfitFromItems),
      operatingExpenses:
        n(data.kpis?.operatingExpenses),
      excludedInvestment:
        n(data.kpis?.excludedInvestment),
      excludedReinvestment:
        n(data.kpis?.excludedReinvestment),
      operationalNetProfit:
        n(data.kpis?.operationalNetProfit),
      stockValue
    },
    sales,
    debts,
    losses,
    products
  };
}

/* ================= EXPORT PDF ================= */
export function exportStatsPdf() {

  const data = build();
  if (!data) return;

  const doc = new jsPDF();
  let y = 18;

  const currency = data.meta.currencySymbol || data.meta.currency || "FC";

  /* ================= LOGO SAFE (URL -> BASE64) ================= */
  async function loadImage(url) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";

        img.onload = function () {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);

            resolve(canvas.toDataURL("image/png"));
          } catch (e) {
            resolve(null);
          }
        };

        img.onerror = () => resolve(null);
        img.src = url;
      } catch (e) {
        resolve(null);
      }
    });
  }

  function money(v) {
    return `${Math.round(Number(v || 0)).toLocaleString()} ${currency}`;
  }

  function checkPage() {
    if (y > 275) {
      doc.addPage();
      y = 18;
      drawHeader(false);
    }
  }

  let logoDrawn = false;

  async function drawHeader(withLogo = true) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);

    doc.text("StockFlow • Business Report", 38, 14);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");

    doc.text(`Shop: ${data.meta.shopName || "StockFlow"}`, 38, 20);
    doc.text(`Currency: ${currency}`, 38, 25);
    doc.text(`Generated: ${new Date(data.meta.generatedAt).toLocaleString()}`, 38, 30);

    const filterLine = data.meta.filterSummary || data.meta.filterPeriod || "";
    if (filterLine) {
      doc.setFont("helvetica", "bold");
      doc.text(String(filterLine).substring(0, 90), 38, 35);
      doc.setFont("helvetica", "normal");
    }

    doc.line(15, 38, 195, 38);

    if (withLogo && !logoDrawn && data.meta.logoUrl) {
      const img = await loadImage(data.meta.logoUrl);
      if (img) {
        doc.addImage(img, "PNG", 15, 10, 18, 18);
        logoDrawn = true;
      }
    }

    y = 46;
  }

  function section(title) {
    checkPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title, 15, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
  }

  function row(label, value) {
    checkPage();

    doc.setFillColor(245, 245, 245);
    doc.rect(15, y - 4, 180, 6, "F");

    doc.text(String(label).substring(0, 45), 16, y);
    doc.text(String(value), 120, y);

    y += 7;
  }

  /* ================= BUILD ================= */

  return (async () => {

    await drawHeader(true);

    /* KPI */
    section("FINANCIAL OVERVIEW");

    row("Revenue", money(data.kpis.totalSales));
    row("Gross Profit", money(data.kpis.totalProfit));
    row("Expenses", money(data.kpis.totalExpenses));
    row("Losses", money(data.kpis.totalLosses));
    row("Debts", money(data.kpis.totalDebtRemaining));
    row("Net Profit", money(data.kpis.netProfit));

    y += 4;

    section("OPERATIONAL FINANCE");

    row("Gross Profit (sales margin)", money(data.kpis.grossProfitFromItems));
    row("Operating Expenses", money(data.kpis.operatingExpenses));
    row("Excluded Investments", money(data.kpis.excludedInvestment));
    row("Excluded Reinvestments", money(data.kpis.excludedReinvestment));
    row("Operational Net Profit", money(data.kpis.operationalNetProfit));

    y += 4;

    /* INSIGHTS */
    section("BUSINESS INSIGHTS");

    const margin = data.kpis.totalSales
      ? ((data.kpis.netProfit / data.kpis.totalSales) * 100).toFixed(1)
      : "0";

    row("Profit Margin", `${margin}%`);
    row("Stock Value", money(data.kpis.stockValue));

    y += 4;

    /* SALES */
    section("RECENT SALES");

    data.sales.slice(0, 6).forEach(s => {

      const items = (s.items || [])
        .map(i => i.productName)
        .join(", ");

      row(
        items || "Sale",
        `${money(s.amount)} | Profit ${money(s.profit)}`
      );

    });

    y += 4;

    /* DEBTS */
    section("CUSTOMER DEBTS");

    data.debts.slice(0, 6).forEach(d => {
      row(d.name || "Client", `Remaining: ${money(d.remaining)}`);
    });

    y += 4;

    /* LOSSES */
    section("LOSSES");

    data.losses.slice(0, 6).forEach(l => {
      row(l.reason || "Loss", money(l.amount));
    });

    y += 4;

    /* STOCK */
    section("LOW STOCK ALERT");

    data.products
      .filter(p => Number(p.stock) <= (p.alert || 5))
      .slice(0, 8)
      .forEach(p => {
        row(p.name, `Stock: ${p.stock}`);
      });

    /* FOOTER */
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    const footerName = data.meta.shopName || "StockFlow";

    doc.text(`${footerName} • Confidential Business Report`, 15, 290);

    doc.save(`${footerName.toLowerCase().replace(/\s+/g, "-")}-stats-report.pdf`);

  })();
}

/* ================= INIT BUTTON ================= */

export function initPdfExportButton() {
  const btn = document.getElementById("pdfBtn");
  if (!btn) return;

  bindActionButton(btn, exportStatsPdf);
}