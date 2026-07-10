const calcBtn = document.getElementById("calcBtn");

if (!calcBtn) {
  // Page sans bouton calculatrice
} else {

let calcOpened = false;
let calcTargetInput = null;

function isInsideCalculator(el) {
  return Boolean(el?.closest?.(".sf-calc-box"));
}

function isCalcInjectableInput(el) {
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled) {
    return false;
  }

  if (isInsideCalculator(el)) {
    return false;
  }

  if (el.dataset.calcReject === "true") {
    return false;
  }

  if (el.type === "number" || el.type === "text" || el.type === "" || el.type === "tel") {
    return true;
  }

  return el.dataset.calcAccept === "true";
}

document.addEventListener("focusin", (event) => {
  const el = event.target;

  if (isCalcInjectableInput(el)) {
    calcTargetInput = el;
  }
});

function formatCalcResult(result) {
  if (
    result === "Erreur" ||
    result === undefined ||
    result === null ||
    Number.isNaN(result) ||
    !Number.isFinite(result)
  ) {
    return "Erreur";
  }

  const num = Number(result);
  return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
}

function resolveCalcTarget() {
  if (calcTargetInput && document.contains(calcTargetInput) && isCalcInjectableInput(calcTargetInput)) {
    return calcTargetInput;
  }

  const configuredTarget = calcBtn.dataset.calcTarget;
  if (configuredTarget) {
    const configured = document.getElementById(configuredTarget);
    if (configured && isCalcInjectableInput(configured)) {
      return configured;
    }
  }

  const amountPaid = document.getElementById("amountPaid");
  if (amountPaid && isCalcInjectableInput(amountPaid)) {
    return amountPaid;
  }

  return null;
}

function applyCalcResult(value) {
  if (value === "Erreur" || value === "" || value === undefined || value === null) {
    return;
  }

  const target = resolveCalcTarget();
  if (!target) return;

  target.value = String(value);
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

/* =========================
OVERLAY
========================= */

const overlay = document.createElement("div");

overlay.className = "sf-calc-overlay";

Object.assign(overlay.style, {
  position: "fixed",
  inset: "0",
  zIndex: "12000",
  display: "none",
  pointerEvents: "none"
});

document.body.appendChild(overlay);

/* =========================
BOX
========================= */

const box = document.createElement("div");

box.className = "sf-calc-box";

Object.assign(box.style, {
  position: "fixed",
  right: "14px",
  width: "290px",
  maxWidth: "90vw",
  background: "#fff",
  borderRadius: "14px",
  boxShadow: "0 10px 35px rgba(0,0,0,.18)",
  overflow: "hidden",
  pointerEvents: "auto",
  border: "1px solid #ddd",
  zIndex: "12050"
});

overlay.appendChild(box);

function positionCalcBox() {
  const btnRect = calcBtn.getBoundingClientRect();
  box.style.top = `${btnRect.bottom + 10}px`;
}

/* =========================
HEADER
========================= */

const calcHeader = document.createElement("div");

Object.assign(calcHeader.style, {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  background: "#0B3D2E",
  color: "#fff",
  fontWeight: "600"
});

const title = document.createElement("span");
title.textContent = "Calculatrice";

const closeBtn = document.createElement("button");
closeBtn.type = "button";
closeBtn.textContent = "✕";

Object.assign(closeBtn.style, {
  border: "none",
  background: "transparent",
  color: "#fff",
  cursor: "pointer",
  fontSize: "16px"
});

calcHeader.appendChild(title);
calcHeader.appendChild(closeBtn);
box.appendChild(calcHeader);

/* =========================
TABS
========================= */

const tabs = document.createElement("div");

Object.assign(tabs.style, {
  display: "flex",
  gap: "6px",
  padding: "8px",
  background: "#f5f5f5"
});

const calcTab = document.createElement("button");
calcTab.type = "button";
const rateTab = document.createElement("button");
rateTab.type = "button";

calcTab.textContent = "Calcul";
rateTab.textContent = "Taux";

[calcTab, rateTab].forEach(btn => {
  Object.assign(btn.style, {
    flex: "1",
    padding: "9px",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
    fontWeight: "600",
    fontSize: "13px"
  });
});

calcTab.style.background = "#0B3D2E";
calcTab.style.color = "#fff";
rateTab.style.background = "#eee";

tabs.appendChild(calcTab);
tabs.appendChild(rateTab);
box.appendChild(tabs);

/* =========================
CONTENT
========================= */

const content = document.createElement("div");
content.style.padding = "10px";
box.appendChild(content);

/* =========================
CALCUL VIEW
========================= */

const calcView = document.createElement("div");

const display = document.createElement("input");
display.readOnly = true;

Object.assign(display.style, {
  width: "100%",
  padding: "12px",
  fontSize: "18px",
  border: "1px solid #ddd",
  borderRadius: "10px",
  marginBottom: "10px"
});

calcView.appendChild(display);

const grid = document.createElement("div");

Object.assign(grid.style, {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "7px"
});

const keys = [
  "7", "8", "9", "÷",
  "4", "5", "6", "×",
  "1", "2", "3", "-",
  "0", ".", "=", "+",
  "C"
];

let expression = "";

function safeCalculate(expr) {
  const sanitized = expr
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .trim();

  if (!sanitized || !/^[0-9+\-*/.() ]+$/.test(sanitized)) {
    return "Erreur";
  }

  try {
    return evaluateExpression(sanitized);
  } catch {
    return "Erreur";
  }
}

function evaluateExpression(source) {
  let index = 0;

  function peek() {
    return source[index] || "";
  }

  function consume(expected) {
    if (expected && source[index] !== expected) {
      throw new Error("invalid expression");
    }
    return source[index++];
  }

  function skipSpaces() {
    while (peek() === " ") index += 1;
  }

  function parsePrimary() {
    skipSpaces();

    if (peek() === "-") {
      consume("-");
      return -parsePrimary();
    }

    if (peek() === "+") {
      consume("+");
      return parsePrimary();
    }

    if (peek() === "(") {
      consume("(");
      const value = parseAddSub();
      skipSpaces();
      consume(")");
      return value;
    }

    let start = index;
    while (/[0-9.]/.test(peek())) {
      index += 1;
    }

    if (start === index) {
      throw new Error("invalid number");
    }

    const value = Number(source.slice(start, index));
    if (Number.isNaN(value)) {
      throw new Error("invalid number");
    }

    return value;
  }

  function parseMulDiv() {
    let value = parsePrimary();

    while (true) {
      skipSpaces();
      const op = peek();

      if (op !== "*" && op !== "/") {
        return value;
      }

      consume(op);
      const right = parsePrimary();

      if (op === "*") {
        value *= right;
      } else {
        if (right === 0) throw new Error("division by zero");
        value /= right;
      }
    }
  }

  function parseAddSub() {
    let value = parseMulDiv();

    while (true) {
      skipSpaces();
      const op = peek();

      if (op !== "+" && op !== "-") {
        return value;
      }

      consume(op);
      const right = parseMulDiv();
      value = op === "+" ? value + right : value - right;
    }
  }

  const result = parseAddSub();
  skipSpaces();

  if (index !== source.length) {
    throw new Error("trailing input");
  }

  if (!Number.isFinite(result)) {
    throw new Error("invalid result");
  }

  return result;
}

keys.forEach(key => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = key;

  Object.assign(btn.style, {
    padding: "12px",
    border: "none",
    borderRadius: "10px",
    background: "#eee",
    cursor: "pointer",
    fontSize: "15px"
  });

  btn.addEventListener("click", () => {
    if (key === "C") {
      expression = "";
    } else if (key === "=") {
      expression = formatCalcResult(safeCalculate(expression));
      applyCalcResult(expression);
    } else {
      expression += key;
    }

    display.value = expression;
  });

  grid.appendChild(btn);
});

calcView.appendChild(grid);

/* =========================
RATE VIEW
========================= */

const rateView = document.createElement("div");
rateView.style.display = "none";

const rateInput = document.createElement("input");
const usdInput = document.createElement("input");
const fcInput = document.createElement("input");

[rateInput, usdInput, fcInput].forEach(input => {
  Object.assign(input.style, {
    width: "100%",
    padding: "11px",
    border: "1px solid #ddd",
    borderRadius: "10px",
    marginBottom: "10px"
  });

  input.inputMode = "decimal";
});

rateInput.placeholder = "Taux USD → FC";
usdInput.placeholder = "USD";
fcInput.placeholder = "FC";

rateInput.value = localStorage.getItem("sf_rate") || "";

rateInput.addEventListener("input", () => {
  localStorage.setItem("sf_rate", rateInput.value);
});

usdInput.addEventListener("input", () => {
  const rate = Number(rateInput.value);
  if (!rate) return;

  fcInput.value = Math.round(Number(usdInput.value || 0) * rate);
});

fcInput.addEventListener("input", () => {
  const rate = Number(rateInput.value);
  if (!rate) return;

  usdInput.value = (Number(fcInput.value || 0) / rate).toFixed(2);
});

rateView.appendChild(rateInput);
rateView.appendChild(usdInput);
rateView.appendChild(fcInput);

content.appendChild(calcView);
content.appendChild(rateView);

calcTab.addEventListener("click", () => {
  calcView.style.display = "block";
  rateView.style.display = "none";
  calcTab.style.background = "#0B3D2E";
  calcTab.style.color = "#fff";
  rateTab.style.background = "#eee";
  rateTab.style.color = "#111";
});

rateTab.addEventListener("click", () => {
  calcView.style.display = "none";
  rateView.style.display = "block";
  rateTab.style.background = "#0B3D2E";
  rateTab.style.color = "#fff";
  calcTab.style.background = "#eee";
  calcTab.style.color = "#111";
});

function openCalc() {
  positionCalcBox();
  overlay.style.display = "block";
  calcOpened = true;
  calcBtn.setAttribute("aria-expanded", "true");
}

function closeCalc() {
  overlay.style.display = "none";
  calcOpened = false;
  calcBtn.setAttribute("aria-expanded", "false");
}

calcBtn.addEventListener("click", event => {
  event.stopPropagation();
  calcOpened ? closeCalc() : openCalc();
});

closeBtn.addEventListener("click", closeCalc);

box.addEventListener("pointerdown", event => {
  event.stopPropagation();
});

document.addEventListener("pointerdown", event => {
  if (!calcOpened) return;

  const clickedBox = box.contains(event.target);
  const clickedBtn = calcBtn.contains(event.target);

  if (clickedBox || clickedBtn) return;

  closeCalc();
});

}
