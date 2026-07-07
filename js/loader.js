// stats.js v1 milite role
import { db, collection, getDocs, getDoc, doc } from "./firebase.js";
import { getAuth, onAuthStateChanged } from "./auth.js";

import { jsPDF } from "https://esm.sh/jspdf@2.5.1";
import html2canvas from "https://esm.sh/html2canvas@1.4.1";
import { getAppConfig } from "./appConfig.js";
import { bindActionButton } from "./utils/buttonManager.js";

const el = (id) => document.getElementById(id);
const n = (v) => Number(v) || 0;

function setText(id, text) {
  const node = el(id);
  if (node) node.textContent = text;
}

/* =========================
   DEBUG
========================= */
let debugTimer;

function debug(msg) {
  const box = el("debug");
  if (!box) return;

  box.textContent = msg;

  clearTimeout(debugTimer);
  debugTimer = setTimeout(() => {
    box.textContent = "";
  }, 60000);
}

/* =========================
   STATE
========================= */
let ready = false;
let CURRENCY_SYMBOL = "$";
let SHOP_NAME = "SHOP";

/* =========================
   AUTH
========================= */
const auth = getAuth();
let currentUser = null;

async function loadConfig() {
  try {
    const cfg = await getAppConfig();
    CURRENCY_SYMBOL =
      cfg?.currencySymbol || "$";
    SHOP_NAME =
      cfg?.shopName || "SHOP";
  } catch (err) {
    console.error(err);
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  const snap = await getDoc(doc(db, "users", user.uid));
  currentUser = snap.data();
   
   await loadConfig();
  debug("🔄 Chargement...");
  await load();
});

/* =========================
   LOAD
========================= */
async function load() {
  try {

    const [salesSnap, expSnap, debtsSnap, lossesSnap, stockSnap, prodSnap] = await Promise.all([
      getDocs(collection(db, "sales")),
      getDocs(collection(db, "expenses")),
      getDocs(collection(db, "debts")),
      getDocs(collection(db, "losses")),
      getDocs(collection(db, "stock_movements")),
      getDocs(collection(db, "products"))
    ]);

    const sales = salesSnap.docs.map(d => d.data() || {});
    const expenses = expSnap.docs.map(d => d.data() || {});
    const debts = debtsSnap.docs.map(d => d.data() || {});
    const losses = lossesSnap.docs.map(d => d.data() || {});
    const stock = stockSnap.docs.map(d => d.data() || {});
    const products = prodSnap.docs.map(d => d.data() || {});

    render(sales, expenses, debts, losses, stock, products);

    ready = true;
    const pdfBtn = el("pdfBtn");
    if (pdfBtn) pdfBtn.disabled = false;

    debug("✅ Dashboard prêt");

  } catch (e) {
    debug("❌ " + e.message);
  }
}

/* =========================
   TEMPORARILY 
========================= */
function getDateSafe(v){
  if(!v) return null;

  if(v.toDate) return v.toDate(); // Firestore Timestamp

  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function isToday(date){
  const d = new Date(date);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isThisWeek(date){
  const d = new Date(date);
  const now = new Date();

  const first = new Date(now.setDate(now.getDate() - now.getDay()));
  const last = new Date(first);
  last.setDate(first.getDate() + 6);

  return d >= first && d <= last;
}

function isThisMonth(date){
  const d = new Date(date);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function isThisYear(date){
  const d = new Date(date);
  const now = new Date();
  return d.getFullYear() === now.getFullYear();
}


function drawChart(data){
  const canvas = document.getElementById("chart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const keys = Object.keys(data).sort();
  const values = keys.map(k => data[k]);

  const max = Math.max(...values, 1);

  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0,0,w,h);

  const stepX = keys.length ? w / keys.length : 1;

  ctx.beginPath();

  values.forEach((v,i)=>{
    const x = i * stepX;
    const y = h - (v/max)*h;

    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });

  ctx.stroke();
  ctx.strokeStyle = "#0B5FFF";
  ctx.lineWidth = 2;
}

/* =========================
   RENDER
========================= */
function render(sales, expenses, debts, losses, stock, products) {

if (!currentUser) return;
if (currentUser?.role === "seller") {
  const today = new Date();

  sales = sales.filter(s => {
    const d = getDateSafe(s.createdAt);
    return d && isToday(d);
  });

  expenses = expenses.filter(e => {
    const d = getDateSafe(e.createdAt);
    return d && isToday(d);
  });

  losses = losses.filter(e => {
    const d = getDateSafe(e.createdAt);
    return d && isToday(d);
  });

  stock = stock.filter(s => {
    const d = getDateSafe(s.createdAt);
    return d && isToday(d);
  });
}

  const stockValue = products.reduce((total, p) => {
    return total + (n(p.price_buy) * n(p.stock_current));
  }, 0);
  
  const caToday = sales.reduce((a,s)=>{
  const d = getDateSafe(s.createdAt);
  if(!d || !isToday(d)) return a;
  return a + n(s.total_amount);
},0);

const caWeek = sales.reduce((a,s)=>{
  const d = getDateSafe(s.createdAt);
  if(!d || !isThisWeek(d)) return a;
  return a + n(s.total_amount);
},0);

const caMonth = sales.reduce((a,s)=>{
  const d = getDateSafe(s.createdAt);
  if(!d || !isThisMonth(d)) return a;
  return a + n(s.total_amount);
},0);

const caYear = sales.reduce((a,s)=>{
  const d = getDateSafe(s.createdAt);
  if(!d || !isThisYear(d)) return a;
  return a + n(s.total_amount);
},0);

const chartData = {};

sales.forEach(s => {
  if(!s.createdAt?.toDate) return;

  const d = s.createdAt.toDate();
  const key = d.toISOString().slice(0,10);

  chartData[key] = (chartData[key] || 0) + n(s.total_amount);
});

  const totalSales = sales.reduce(
  (a, s) =>
    a + n(s.amount_paid ?? s.total_amount),0);

  const totalProfit = sales.reduce((a, s) =>
    a + n(s.total_profit || s.profit)
  , 0);

  const totalExpenses = expenses
    .filter(e => e.isSystemCorrection !== true && e.status !== "cancelled")
    .reduce((a, e) => a + n(e.amount), 0);

  const totalDebts = debts
    .filter(e => e.status !== "cancelled" && e.status !== "paid")
    .reduce((a, e) => a + n(e.amount_remaining), 0);

  const totalLosses = losses
    .filter(e => e.isSystemCorrection !== true && e.status !== "cancelled")
    .reduce((a, e) => a + n(e.amount), 0);

  const stockIn = stock
    .filter(s => s.type === "IN")
    .reduce((a, s) => a + n(s.quantity), 0);

  const stockOut = stock
    .filter(s => s.type === "OUT")
    .reduce((a, s) => a + n(s.quantity), 0);

  const stockTotal = stockIn - stockOut;

  const netReal =  totalProfit -  totalExpenses -   totalLosses;

  setText("stockValue", stockValue + CURRENCY_SYMBOL);
  setText("sales", totalSales + CURRENCY_SYMBOL);
  setText("profit", netReal + CURRENCY_SYMBOL);
  setText("profitIdeal", totalProfit + CURRENCY_SYMBOL);
  setText("losses", totalLosses + CURRENCY_SYMBOL);
  setText("debts", totalDebts + CURRENCY_SYMBOL);
  setText("expenses", totalExpenses + CURRENCY_SYMBOL);
  setText("sold", String(sales.length));
  setText("stockTotal", String(stockTotal));
  setText("products", String(products.length));
  setText("caToday", caToday + CURRENCY_SYMBOL);
  setText("caWeek", caWeek + CURRENCY_SYMBOL);
  setText("caMonth", caMonth + CURRENCY_SYMBOL);
  setText("caYear", caYear + CURRENCY_SYMBOL);
drawChart(chartData);

  debug("✅ OK");
}

/* =========================
   PDF (CLEAN MODULE ONLY)
========================= */
const pdfBtnEl = el("pdfBtn");
if (pdfBtnEl) pdfBtnEl.disabled = true;

function generateId() {
  return "dev" + Date.now().toString(36).toUpperCase();
}

function formatDate() {
  return new Date().toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

bindActionButton(pdfBtnEl, async () => {
    
    if (currentUser?.role !== "admin") {
    alert("Accès refusé");
    return;
  }

  if (!ready) {
    debug("⏳ Chargement...");
    return;
  }

  try {

    const grid = document.querySelector(".grid");
    if (!grid) {
      debug("❌ Grille introuvable");
      return;
    }

    const body = document.body;

    // 🔥 SAVE STATE
    const oldGridWidth = grid.style.width;
    const oldGridMax = grid.style.maxWidth;
    const oldOverflow = body.style.overflow;
    const oldHeight = body.style.height;

    // 🔥 FORCE FULL VIEW (clé PDF propre)
    body.style.overflow = "visible";
    body.style.height = "auto";

    grid.style.width = "1000px";
    grid.style.maxWidth = "1000px";

    // 🔥 attendre repaint DOM
    await new Promise(r => requestAnimationFrame(r));

    const canvas = await html2canvas(grid, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      scrollY: 0
    });

    // 🔁 RESTORE UI
    grid.style.width = oldGridWidth;
    grid.style.maxWidth = oldGridMax;
    body.style.overflow = oldOverflow;
    body.style.height = oldHeight;

    const img = canvas.toDataURL("image/png");

    const pdf = new jsPDF("p", "mm", "a4");

    const id = generateId();
    const date = formatDate();

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("Es-Shop Invoice Report", 14, 18);

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text(`ID: ${id}`, 14, 26);
    pdf.text(`Date: ${date}`, 14, 32);

    pdf.setDrawColor(200);
    pdf.rect(160, 10, 35, 20);
    pdf.text("ES-SHOP", 172, 22);

    const w = 190;
    const h = (canvas.height * w) / canvas.width;

    pdf.addImage(img, "PNG", 10, 40, w, h);

    pdf.setFontSize(8);
    pdf.setTextColor(120);
    pdf.text("Generated by Es-Shop System", 14, 285);

    pdf.save(`es-shop-${id}.pdf`);

    debug("📄 PDF généré");

  } catch (e) {
    debug("❌ PDF: " + e.message);
  }

});
