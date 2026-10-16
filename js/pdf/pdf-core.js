// Kit PDF pro StockFlow — primitives partagées (jsPDF)
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

export const PDF_COLORS = {
  primary: [11, 61, 46],
  gold: [212, 175, 55],
  text: [17, 17, 17],
  muted: [102, 102, 102],
  line: [220, 220, 220],
  zebra: [248, 249, 251],
  white: [255, 255, 255],
  danger: [217, 45, 32]
};

export function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function formatMoney(v, symbol = "$") {
  return `${Math.round(n(v)).toLocaleString("fr-FR")} ${symbol}`;
}

export function formatDate(value) {
  if (!value) return "—";
  const d =
    value instanceof Date
      ? value
      : value?.toDate
        ? value.toDate()
        : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR");
}

export function formatDateShort(value) {
  if (!value) return "—";
  const d =
    value instanceof Date
      ? value
      : value?.toDate
        ? value.toDate()
        : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
}

export async function loadImageAsDataUrl(url) {
  if (!url) return null;
  return new Promise(resolve => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * @param {object} meta
 * @returns {Promise<{doc: import('jspdf').jsPDF, y: number, meta: object, margin: number, contentWidth: number, logoDataUrl: string|null}>}
 */
export async function createPdfContext(meta = {}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  const logoDataUrl = await loadImageAsDataUrl(meta.logoUrl || "");
  return {
    doc,
    y: 18,
    meta: {
      shopName: meta.shopName || "StockFlow",
      shopAddress: meta.shopAddress || "",
      shopPhone: meta.shopPhone || "",
      currencySymbol: meta.currencySymbol || meta.currency || "$",
      periodLabel: meta.periodLabel || meta.filterSummary || meta.filterPeriod || "",
      reportTitle: meta.reportTitle || "Rapport",
      generatedAt: meta.generatedAt || new Date().toISOString(),
      logoUrl: meta.logoUrl || "",
      ...meta
    },
    margin,
    contentWidth: 210 - margin * 2,
    logoDataUrl,
    pageBottom: 278
  };
}

export function ensureSpace(ctx, needed = 12) {
  if (ctx.y + needed <= ctx.pageBottom) return;
  ctx.doc.addPage();
  drawHeaderBand(ctx, false);
  ctx.y = 42;
}

function drawHeaderBand(ctx, firstPage) {
  const { doc, margin, meta, logoDataUrl } = ctx;
  const bandH = firstPage ? 28 : 18;

  doc.setFillColor(...PDF_COLORS.primary);
  doc.rect(0, 0, 210, bandH, "F");
  doc.setFillColor(...PDF_COLORS.gold);
  doc.rect(0, bandH, 210, 1.2, "F");

  doc.setTextColor(...PDF_COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(firstPage ? 14 : 11);
  doc.text(String(meta.reportTitle || "Rapport").substring(0, 60), margin + (logoDataUrl && firstPage ? 22 : 0), firstPage ? 11 : 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const shopLine = [
    meta.shopName,
    meta.shopPhone,
    meta.shopAddress
  ]
    .filter(Boolean)
    .join("  ·  ");
  doc.text(shopLine.substring(0, 95), margin + (logoDataUrl && firstPage ? 22 : 0), firstPage ? 17 : 13);

  if (firstPage) {
    const period = meta.periodLabel || "";
    if (period) {
      doc.setFont("helvetica", "bold");
      doc.text(String(period).substring(0, 90), margin + (logoDataUrl ? 22 : 0), 23);
    }
    doc.setFont("helvetica", "normal");
    doc.text(
      `Généré le ${formatDate(meta.generatedAt)}`,
      margin + (logoDataUrl ? 22 : 0),
      27.5
    );
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, "PNG", margin, 5, 16, 16);
      } catch (_) {
        /* ignore */
      }
    }
  }

  doc.setTextColor(...PDF_COLORS.text);
  ctx.y = bandH + 10;
}

export function drawReportHeader(ctx) {
  drawHeaderBand(ctx, true);
  docConfidentialBadge(ctx);
}

function docConfidentialBadge(ctx) {
  const { doc, margin } = ctx;
  doc.setFontSize(8);
  doc.setTextColor(...PDF_COLORS.muted);
  doc.setFont("helvetica", "italic");
  doc.text("Document confidentiel — usage interne uniquement", margin, ctx.y);
  ctx.y += 8;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...PDF_COLORS.text);
}

export function drawSectionTitle(ctx, title) {
  ensureSpace(ctx, 14);
  const { doc, margin, contentWidth } = ctx;
  doc.setFillColor(...PDF_COLORS.primary);
  doc.rect(margin, ctx.y - 4, 2.2, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...PDF_COLORS.primary);
  doc.text(String(title), margin + 5, ctx.y + 2);
  doc.setDrawColor(...PDF_COLORS.line);
  doc.line(margin, ctx.y + 5, margin + contentWidth, ctx.y + 5);
  ctx.y += 12;
  doc.setTextColor(...PDF_COLORS.text);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
}

/**
 * @param {Array<{label: string, value: string}>} items
 */
export function drawKpiGrid(ctx, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;

  const cols = 2;
  const gap = 4;
  const cardW = (ctx.contentWidth - gap) / cols;
  const cardH = 16;

  list.forEach((item, index) => {
    if (index % cols === 0) {
      ensureSpace(ctx, cardH + 4);
    }
    const col = index % cols;
    const x = ctx.margin + col * (cardW + gap);
    const y = ctx.y;

    ctx.doc.setDrawColor(...PDF_COLORS.line);
    ctx.doc.setFillColor(...PDF_COLORS.white);
    ctx.doc.roundedRect(x, y, cardW, cardH, 2, 2, "FD");

    ctx.doc.setFont("helvetica", "normal");
    ctx.doc.setFontSize(7.5);
    ctx.doc.setTextColor(...PDF_COLORS.muted);
    ctx.doc.text(String(item.label || "").substring(0, 40), x + 3, y + 5);

    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(11);
    ctx.doc.setTextColor(...PDF_COLORS.text);
    ctx.doc.text(String(item.value ?? "—").substring(0, 28), x + 3, y + 12);

    if (col === cols - 1 || index === list.length - 1) {
      ctx.y += cardH + 3;
    }
  });

  if (list.length % cols !== 0) {
    /* y already advanced on last item of incomplete row via branch above when index===last */
  }
  ctx.y += 2;
  ctx.doc.setTextColor(...PDF_COLORS.text);
}

/**
 * @param {Array<{key: string, label: string, width: number, align?: string}>} columns
 * @param {Array<object>} rows
 */
export function drawTable(ctx, columns, rows, maxRows = 40) {
  const cols = Array.isArray(columns) ? columns : [];
  const data = (Array.isArray(rows) ? rows : []).slice(0, maxRows);
  if (!cols.length) return;

  const rowH = 7;
  const headerH = 8;

  const drawHeader = () => {
    ensureSpace(ctx, headerH + 4);
    let x = ctx.margin;
    ctx.doc.setFillColor(...PDF_COLORS.primary);
    ctx.doc.rect(ctx.margin, ctx.y - 3, ctx.contentWidth, headerH, "F");
    ctx.doc.setFont("helvetica", "bold");
    ctx.doc.setFontSize(8);
    ctx.doc.setTextColor(...PDF_COLORS.white);
    cols.forEach(col => {
      const label = String(col.label || "").substring(0, 28);
      const align = col.align || "left";
      if (align === "right") {
        ctx.doc.text(label, x + col.width - 1, ctx.y + 2, { align: "right" });
      } else {
        ctx.doc.text(label, x + 1, ctx.y + 2);
      }
      x += col.width;
    });
    ctx.y += headerH;
    ctx.doc.setTextColor(...PDF_COLORS.text);
    ctx.doc.setFont("helvetica", "normal");
  };

  drawHeader();

  data.forEach((row, i) => {
    ensureSpace(ctx, rowH + 2);
    if (ctx.y < 50 && i > 0) {
      drawHeader();
    }
    if (i % 2 === 0) {
      ctx.doc.setFillColor(...PDF_COLORS.zebra);
      ctx.doc.rect(ctx.margin, ctx.y - 3, ctx.contentWidth, rowH, "F");
    }
    let x = ctx.margin;
    ctx.doc.setFontSize(8);
    ctx.doc.setTextColor(...PDF_COLORS.text);
    cols.forEach(col => {
      const raw = row[col.key];
      const text = String(raw ?? "—").substring(0, 42);
      const align = col.align || "left";
      if (align === "right") {
        ctx.doc.text(text, x + col.width - 1, ctx.y + 1.5, { align: "right" });
      } else {
        ctx.doc.text(text, x + 1, ctx.y + 1.5);
      }
      x += col.width;
    });
    ctx.y += rowH;
  });

  if (!data.length) {
    ensureSpace(ctx, 10);
    ctx.doc.setFontSize(9);
    ctx.doc.setTextColor(...PDF_COLORS.muted);
    ctx.doc.text("Aucune donnée pour cette période.", ctx.margin, ctx.y);
    ctx.y += 8;
    ctx.doc.setTextColor(...PDF_COLORS.text);
  }

  ctx.y += 4;
}

export function drawNote(ctx, text) {
  if (!text) return;
  ensureSpace(ctx, 14);
  ctx.doc.setFont("helvetica", "italic");
  ctx.doc.setFontSize(8);
  ctx.doc.setTextColor(...PDF_COLORS.muted);
  const lines = ctx.doc.splitTextToSize(String(text), ctx.contentWidth);
  ctx.doc.text(lines, ctx.margin, ctx.y);
  ctx.y += lines.length * 4 + 4;
  ctx.doc.setFont("helvetica", "normal");
  ctx.doc.setTextColor(...PDF_COLORS.text);
}

export function applyFooters(ctx) {
  const { doc, meta, margin } = ctx;
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...PDF_COLORS.line);
    doc.line(margin, 285, 210 - margin, 285);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.muted);
    const shop = meta.shopName || "StockFlow";
    doc.text(`${shop} · Rapport confidentiel`, margin, 290);
    doc.text(`Page ${i} / ${total}`, 210 - margin, 290, { align: "right" });
  }
  doc.setTextColor(...PDF_COLORS.text);
}

export function savePdf(ctx, filenameBase) {
  applyFooters(ctx);
  const safe = String(filenameBase || "rapport")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 60);
  ctx.doc.save(`${safe || "rapport"}.pdf`);
}

export function moneyFromMeta(meta, value) {
  return formatMoney(value, meta?.currencySymbol || "$");
}
