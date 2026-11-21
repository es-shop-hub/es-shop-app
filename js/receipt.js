// receipt.js — ticket thermique (largeur papier, hauteur dynamique)
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

import { getAppConfig } from "./appConfig.js";

/* ================================
   CONFIGURATION
================================ */
let SHOP_NAME = "";
let SHOP_ADDRESS = "";
let SHOP_PHONE = "";
let CURRENCY_SYMBOL = "$";
let logoUrl = "shopLogo.png";

let configLoaded = null;

async function ensureConfig() {
  if (!configLoaded) {
    configLoaded = await getAppConfig(true);
    SHOP_NAME = configLoaded.shopName || "shop";
    SHOP_ADDRESS = configLoaded.shopAddress || "-";
    SHOP_PHONE = configLoaded.shopPhone || "-";
    logoUrl = configLoaded.logoUrl || "shopLogo.png";
    CURRENCY_SYMBOL = configLoaded.currencySymbol || "$";
  }
  return configLoaded;
}

/*
  Largeur papier thermique de référence (80 mm ≈ 226 pt).
  Tout le layout est proportionnel à cette largeur ; la hauteur
  grandit avec le contenu (pas de page fixe).
  58 mm ≈ 164 pt si besoin d’un autre papier.
*/
const THERMAL_PAPER_WIDTH_PT = 226;

const FONT_FAMILY = "courier";
const FONT_SIZE_SHOP = 13;
const FONT_SIZE_RECEIPT = 9;
const FONT_SIZE_NORMAL = 8;
const FONT_SIZE_SMALL = 7;
const FONT_SIZE_TOTAL = 11;
const ITEM_LINE_HEIGHT = 10;

/**
 * Layout relatif à la largeur papier — colonnes Produit | Qté | PU | Total.
 */
function buildLayout(paperWidth) {
  const width = Number(paperWidth) > 0 ? Number(paperWidth) : THERMAL_PAPER_WIDTH_PT;
  const margin = Math.max(6, Math.round(width * 0.035));
  const left = margin;
  const right = width - margin;
  const content = right - left;

  // Colonnes numériques visibles (align right), espacées sans chevaucher le nom
  const colTotal = right;
  const colPu = left + content * 0.78;
  const colQty = left + content * 0.58;
  const productNameMaxWidth = Math.max(40, colQty - left - 8);
  const clientNameMaxWidth = Math.max(36, content * 0.4);

  return {
    width,
    margin,
    left,
    right,
    center: width / 2,
    colQty,
    colPu,
    colTotal,
    productNameMaxWidth,
    clientNameMaxWidth
  };
}

/* ================================
   CHARGEMENT IMAGE
================================ */

async function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/* ================================
   FORMAT DATE
================================ */

function formatDate(date) {
  const d = new Date(date);
  return (
    d.toLocaleDateString("fr-FR") +
    " " +
    d.toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit"
    })
  );
}

/* ================================
   NORMALISATION
================================ */

function normalizeItems(items = []) {
  return items.map((item) => ({
    name: item.name || "Produit",
    qty: Number(item.qty ?? item.quantity ?? 0),
    price: Number(item.price ?? 0)
  }));
}

/* ================================
   TEXTE
================================ */

function fitTextToWidth(doc, text, maxWidth) {
  const value = String(text || "");
  if (!value) return "";
  if (doc.getTextWidth(value) <= maxWidth) return value;

  let result = value;
  while (result.length > 1 && doc.getTextWidth(`${result}…`) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function wrapProductName(doc, text, maxWidth) {
  const value = String(text || "Produit");
  return doc.splitTextToSize(value, maxWidth);
}

function estimateProductLineCount(name, productNameMaxWidth) {
  const value = String(name || "Produit");
  const charsPerLine = Math.max(1, Math.floor(productNameMaxWidth / 5));
  return Math.max(1, Math.ceil(value.length / charsPerLine));
}

function itemBlockHeight(lineCount) {
  return Math.max(14, lineCount * ITEM_LINE_HEIGHT + 4);
}

function drawSeparator(doc, layout, y) {
  doc.setLineWidth(0.3);
  doc.line(layout.left, y, layout.right, y);
}

function calculateHeight(items, layout) {
  const list = Array.isArray(items) ? items : [];
  const itemsHeight = list.reduce((sum, item) => {
    return (
      sum +
      itemBlockHeight(
        estimateProductLineCount(item?.name, layout.productNameMaxWidth)
      )
    );
  }, 0);

  // header boutique + infos + table + paiement + footer QR — hauteur dynamique
  return Math.max(300, 270 + itemsHeight + 50);
}

/* ================================
   DESSIN TICKET
================================ */

function drawReceipt(doc, data, logo, layout) {
  let y = 10;
  const { left, right, center, colQty, colPu, colTotal } = layout;

  /* ---------- HEADER BOUTIQUE (toujours, prioritaire visuellement) ---------- */
  doc.setFont(FONT_FAMILY, "bold");
  doc.setFontSize(FONT_SIZE_SHOP);

  if (logo) {
    const logoSize = Math.min(38, Math.round(layout.width * 0.17));
    const logoX = left;
    const logoY = y;
    const textX = logoX + logoSize + 8;
    const shopMax = Math.max(40, right - textX);

    doc.addImage(logo, "PNG", logoX, logoY, logoSize, logoSize, undefined, "FAST");

    doc.text(
      fitTextToWidth(doc, SHOP_NAME, shopMax),
      textX,
      logoY + 12
    );

    doc.setFont(FONT_FAMILY, "normal");
    doc.setFontSize(FONT_SIZE_SMALL);
    doc.text(
      fitTextToWidth(doc, SHOP_ADDRESS, shopMax),
      textX,
      logoY + 22
    );
    doc.text(
      fitTextToWidth(doc, `Tel : ${SHOP_PHONE}`, shopMax),
      textX,
      logoY + 32
    );

    y += logoSize + 10;
  } else {
    doc.text(
      fitTextToWidth(doc, SHOP_NAME, right - left),
      center,
      y,
      { align: "center" }
    );
    y += 14;

    doc.setFont(FONT_FAMILY, "normal");
    doc.setFontSize(FONT_SIZE_SMALL);
    doc.text(
      fitTextToWidth(doc, SHOP_ADDRESS, right - left),
      center,
      y,
      { align: "center" }
    );
    y += 10;
    doc.text(
      fitTextToWidth(doc, `Tel : ${SHOP_PHONE}`, right - left),
      center,
      y,
      { align: "center" }
    );
    y += 12;
  }

  /* ---------- INFOS REÇU (titre plus petit que le nom boutique) ---------- */
  doc.setFont(FONT_FAMILY, "bold");
  doc.setFontSize(FONT_SIZE_RECEIPT);
  doc.text("REÇU", left, y);

  doc.setFont(FONT_FAMILY, "normal");
  doc.setFontSize(FONT_SIZE_NORMAL);
  doc.text(
    fitTextToWidth(doc, String(data.saleId || ""), layout.clientNameMaxWidth),
    right,
    y,
    { align: "right" }
  );

  y += 11;

  doc.text("Date", left, y);
  doc.text(formatDate(data.date), right, y, { align: "right" });

  y += 11;

  doc.text("Client", left, y);
  doc.text(
    fitTextToWidth(
      doc,
      data.name || "Client direct",
      layout.clientNameMaxWidth
    ),
    right,
    y,
    { align: "right" }
  );

  y += 12;

  if (data.offline) {
    doc.setFont(FONT_FAMILY, "bold");
    doc.text("0", center, y, { align: "center" });
    doc.setFont(FONT_FAMILY, "normal");
    y += 12;
  }

  drawSeparator(doc, layout, y);
  y += 12;

  /* ---------- TABLE : Produit | Qté | PU | Total (tous visibles) ---------- */
  doc.setFont(FONT_FAMILY, "bold");
  doc.setFontSize(FONT_SIZE_NORMAL);

  doc.text("Produit", left, y);
  doc.text("Qté", colQty, y, { align: "right" });
  doc.text("PU", colPu, y, { align: "right" });
  doc.text("Total", colTotal, y, { align: "right" });

  y += 8;
  drawSeparator(doc, layout, y);
  y += 11;

  doc.setFont(FONT_FAMILY, "normal");

  data.items.forEach((item) => {
    const lineTotal = item.qty * item.price;
    const nameLines = wrapProductName(
      doc,
      item.name,
      layout.productNameMaxWidth
    );

    doc.text(nameLines, left, y);
    doc.text(String(item.qty), colQty, y, { align: "right" });
    doc.text(item.price.toFixed(0), colPu, y, { align: "right" });
    doc.text(lineTotal.toFixed(0), colTotal, y, { align: "right" });

    y += itemBlockHeight(nameLines.length);
  });

  drawSeparator(doc, layout, y);
  y += 14;

  /* ---------- TOTAL ---------- */
  doc.setFont(FONT_FAMILY, "bold");
  doc.setFontSize(FONT_SIZE_TOTAL);
  doc.text(
    `TOTAL : ${data.total.toFixed(0)} ${CURRENCY_SYMBOL}`,
    right,
    y,
    { align: "right" }
  );

  y += 14;
  drawSeparator(doc, layout, y);
  y += 14;

  /* ---------- PAIEMENT ---------- */
  doc.setFontSize(FONT_SIZE_NORMAL);
  doc.setFont(FONT_FAMILY, "normal");

  const paid = Number(data.amountPaid || data.total);
  const remaining = Number(data.remaining || 0);
  const status = data.paymentMode === "partial" ? "PARTIEL" : "PAYÉ";

  doc.text(`Payé : ${paid.toFixed(0)} ${CURRENCY_SYMBOL}`, left, y);
  y += 10;
  doc.text(`Reste : ${remaining.toFixed(0)} ${CURRENCY_SYMBOL}`, left, y);
  y += 10;
  doc.text(`Statut : ${status}`, left, y);
  y += 14;

  drawSeparator(doc, layout, y);
  y += 14;

  /* ---------- FOOTER + QR ---------- */
  const qrSize = Math.min(34, Math.round(layout.width * 0.15));
  const qrX = right - qrSize;
  const qrY = y - 2;
  const pixel = 2;

  doc.setFillColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  const qr = [
    "1111111000111111",
    "1000001000100001",
    "1011101000101111",
    "1011101000101111",
    "1011101000101111",
    "1000001000100001",
    "1111111000111111",
    "0000000000000000",
    "1110001110101011",
    "0011010011110010",
    "1110111010011101",
    "1001000110101001",
    "1111111000001111",
    "1000001000111001",
    "1011101000101111",
    "1111111000111111"
  ];

  qr.forEach((row, r) => {
    row.split("").forEach((c, x) => {
      if (c === "1") {
        doc.rect(qrX + x * pixel, qrY + r * pixel, pixel, pixel, "F");
      }
    });
  });

  doc.setFont(FONT_FAMILY, "normal");
  doc.setFontSize(FONT_SIZE_SMALL);
  doc.text("Merci pour votre achat", left, y + 8);
  doc.text("ES-SHOP", left, y + 18);

  const footerLineY = qrY + 16 * pixel + 10;
  drawSeparator(doc, layout, footerLineY);
}

/* ================================
   EXPORT PRINCIPAL
================================ */

export async function generateReceipt(rawData) {
  await ensureConfig();

  if (!rawData || !rawData.items) {
    console.error("Données invalides");
    return;
  }

  const items = normalizeItems(rawData.items);
  const total = Number(
    rawData.total ??
      items.reduce((sum, item) => sum + item.qty * item.price, 0)
  );

  const data = {
    ...rawData,
    items,
    total
  };

  const layout = buildLayout(THERMAL_PAPER_WIDTH_PT);
  const ticketHeight = calculateHeight(data.items, layout);

  const doc = new jsPDF({
    unit: "pt",
    format: [layout.width, ticketHeight]
  });

  const logo = await loadImage(logoUrl);
  drawReceipt(doc, data, logo, layout);

  doc.setProperties({
    title: `Reçu ${data.saleId}`,
    creator: "ES-SHOP POS",
    subject: "Ticket de vente"
  });

  doc.save(`recu_${data.saleId}.pdf`);
}
