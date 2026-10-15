import {
  state,
  $,
  n,
  formatMoney,
  clearNode,
  getDate,
  loadPreviousPeriodData
} from "./stats.js";
function setText(id, text) {
  const el = $(id);
  if (el) {
    el.textContent = text;
  }
}

function getPurchaseTotal(purchase) {
  const fromDoc = n(purchase?.total_cost ?? purchase?.totalCost ?? purchase?.total);
  if (fromDoc > 0) {
    return fromDoc;
  }

  const purchaseId = purchase?.id;
  if (!purchaseId) {
    return 0;
  }

  return state.purchaseItems
    .filter(i => (i.purchaseId || i.purchase_id) === purchaseId)
    .reduce(
      (sum, i) =>
        sum + n(i.quantity) * n(i.price ?? i.unitPrice ?? i.purchase_price),
      0
    );
}

export async function render(chartApi) {
  const sales = state.sales;
  const expenses = state.expenses;
  const losses = state.losses;

  state.chartReady = true;

  window.statsData = {
    sales,
    expenses,
    debts: state.debts,
    losses,
    products: state.products,
    stockMovements: state.stockMovements,
    batchMovements: state.batchMovements || [],
    batchBatches: state.batchBatches || [],
    batchStats: state.batchStats,
    currency: state.currency,
    previousPeriod: null
  };

  let previousPeriod = {
    sales: [],
    expenses: [],
    losses: []
  };

  try {
    previousPeriod = await loadPreviousPeriodData();
  } catch (error) {
    console.error("loadPreviousPeriodData:", error);
  }

  if (window.statsData) {
    window.statsData.previousPeriod = previousPeriod;
  }

  renderKPIs(
    sales,
    expenses,
    losses,
    previousPeriod.sales,
    previousPeriod.expenses,
    previousPeriod.losses
  );

  renderOperationalFinance(sales, expenses, losses);

  renderFinancialHealth(sales, expenses, losses);
  renderStockHealth();
  renderDebts();
  renderProducts();

  if (state.chartReady && chartApi?.renderChart) {
    chartApi.renderChart();
  }
}

function sumExpensesByCategory(expenses, category) {
  return expenses
    .filter(e => e.category === category)
    .reduce((s, e) => s + n(e.amount), 0);
}

function sumOperatingExpenses(expenses) {
  return expenses
    .filter(e => e.category !== "investment" && e.category !== "reinvestment")
    .reduce((s, e) => s + n(e.amount), 0);
}

function calcGrossProfitFromSales(sales) {
  const saleIds = new Set(sales.map(s => s.id));

  return state.saleItems
    .filter(i => saleIds.has(i.saleId))
    .reduce((sum, i) => sum + n(i.profit), 0);
}

function calcActiveLossesTotal(losses) {
  return losses
    .filter(e => e.isSystemCorrection !== true && e.status !== "cancelled")
    .reduce((sum, e) => sum + n(e.amount), 0);
}

function renderOperationalFinance(sales, expenses, losses) {
  const grossProfit = calcGrossProfitFromSales(sales);
  const operatingExpenses = sumOperatingExpenses(expenses);
  const investmentTotal = sumExpensesByCategory(expenses, "investment");
  const reinvestmentTotal = sumExpensesByCategory(expenses, "reinvestment");
  const lossesTotal = calcActiveLossesTotal(losses);
  const operationalNetProfit = grossProfit - operatingExpenses - lossesTotal;

  const saleIds = new Set(sales.map(s => s.id));
  const totalSales = state.saleItems
    .filter(i => saleIds.has(i.saleId))
    .reduce((sum, i) => sum + n(i.price) * n(i.quantity), 0);

  const operationalMargin = totalSales > 0
    ? (operationalNetProfit / totalSales) * 100
    : 0;

  setText("opGrossProfitValue", formatMoney(grossProfit));
  setText("opExpensesValue", formatMoney(operatingExpenses));
  setText("opLossesValue", formatMoney(lossesTotal));
  setText("opExcludedInvestmentValue", formatMoney(investmentTotal));
  setText("opExcludedReinvestmentValue", formatMoney(reinvestmentTotal));
  setText("opNetProfitValue", formatMoney(operationalNetProfit));

  const noteEl = $("opFinanceNote");
  if (noteEl) {
    noteEl.textContent =
      `Bénéfice net opérationnel = marge ventes − dépenses hors invest./réinvest. − pertes. ` +
      `Marge opérationnelle : ${operationalMargin.toFixed(1)}%.`;
  }
}

function calcPotentialMinProfit(products) {
  return products.reduce((sum, p) => {
    const buy = n(p.price_buy);
    const minPrice = n(p.price_min) || n(p.price_sell) || buy;
    const stock = n(p.stock_current);
    return sum + Math.max(0, minPrice - buy) * stock;
  }, 0);
}

function renderFinancialHealth(sales, expenses, losses) {
  const investmentTotal = sumExpensesByCategory(expenses, "investment");
  const reinvestmentTotal = sumExpensesByCategory(expenses, "reinvestment");

  const operatingExpenses = sumOperatingExpenses(expenses);

  const expensesTotal = expenses.reduce((s, e) => s + n(e.amount), 0);

  const lossesTotal =
    losses
      .filter(e => e.isSystemCorrection !== true && e.status !== "cancelled")
      .reduce((s, e) => s + n(e.amount), 0);

  const debtsTotal =
    state.debts
      .filter(e => e.status !== "paid" && e.status !== "cancelled")
      .reduce((s, e) => s + n(e.amount_remaining), 0);

  const cashReceived =
    sales.reduce((s, v) => s + n(v.amount_paid), 0);

  const purchaseTotal =
    state.purchases.reduce(
      (s, p) => s + getPurchaseTotal(p),
      0
    );

  const grossProfit =
    state.saleItems.reduce((s, i) => s + n(i.profit), 0);

  const potentialMinProfit = calcPotentialMinProfit(state.products);

  const netResult =
    grossProfit
    - expensesTotal
    - lossesTotal;

  setText("expensesValue", formatMoney(operatingExpenses));
  setText("investmentValue", formatMoney(investmentTotal));
  setText("reinvestmentValue", formatMoney(reinvestmentTotal));
  setText("potentialBenefitValue", formatMoney(potentialMinProfit));
  setText("lossesValue", formatMoney(lossesTotal));
  setText("debtsValue", formatMoney(debtsTotal));
  setText("cashReceivedValue", formatMoney(cashReceived));
  setText("purchaseValue", formatMoney(purchaseTotal));
  setText("netResultValue", formatMoney(netResult));
}

function renderStockHealth() {
  const stockValue =
    state.products.reduce((s, p) => {
      const price = n(p.price_buy || p.purchase_price);
      return s + (n(p.stock_current) * price);
    }, 0);

  const blockedStock =
    state.products.filter(p => p.offlineBlocked === true).length;

  const stockOut =
    state.products.filter(p =>
      n(p.stock_current) <= 0
    ).length;

  const soldQty =
    state.saleItems.reduce((s, i) => s + n(i.quantity), 0);

  const stockQty =
    state.products.reduce((s, p) => s + n(p.stock_current), 0);

  const rotation =
    stockQty > 0 ? (soldQty / stockQty).toFixed(2) : "0";

  setText("stockValue", formatMoney(stockValue));
  setText("stockRotation", rotation);
  setText("blockedStock", String(blockedStock));
  setText("stockOutCount", String(stockOut));
}

function renderDebts() {
  const totalRemaining = (state.debts || [])
    .filter(
      debt =>
        debt &&
        debt.status !== "cancelled" &&
        debt.status !== "paid" &&
        n(debt.amount_remaining) > 0
    )
    .reduce((sum, debt) => sum + n(debt.amount_remaining), 0);

  setText("debtsTotalRemaining", formatMoney(totalRemaining));
}

function getBatchPeriodStats(sales) {
  const batchStats = state.batchStats || {
    totalCollected: 0,
    benefitDisplay: 0,
    stockValue: 0,
    totalCostEngaged: 0,
    totalQtyOut: 0
  };

  const saleDates = sales.map(s => getDate(s.createdAt)).filter(Boolean);
  let start = null;
  let end = null;
  if (saleDates.length) {
    start = new Date(Math.min(...saleDates.map(d => d.getTime())));
    end = new Date(Math.max(...saleDates.map(d => d.getTime())));
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  const movements = state.batchMovements || [];
  const inPeriod = movements.filter(m => {
    if (!start || !end) return true;
    const d = getDate(m.createdAt);
    if (!d) return false;
    return d >= start && d <= end;
  });

  const collected = inPeriod.reduce(
    (s, m) => s + n(m.amount_collected),
    0
  );
  const qtyOut = inPeriod.reduce((s, m) => s + n(m.quantity_out), 0);
  const stockValue = n(batchStats.stockValue ?? batchStats.totalCostEngaged);
  const costEngaged = stockValue;
  const costConsumed = inPeriod.reduce((s, m) => {
    const batch = (state.batchBatches || []).find(b => b.id === m.batchId);
    const unit = n(batch?.cost_unit_avg);
    return s + unit * n(m.quantity_out);
  }, 0);
  const benefitRaw = collected - (costConsumed + costEngaged);
  const benefitDisplay = Math.max(0, benefitRaw);

  return {
    collected,
    benefitDisplay,
    stockValue,
    qtyOut,
    costConsumed,
    costEngaged
  };
}

function renderKPIs(
  sales,
  expenses,
  losses,
  previousSales = [],
  previousExpenses = [],
  previousLosses = []
) {
  const saleIds = new Set(sales.map(s => s.id));

  const filteredItems =
    state.saleItems.filter(i => saleIds.has(i.saleId));

  const classicSales =
    filteredItems.reduce(
      (s, i) =>
        s + (n(i.price) * n(i.quantity)),
      0
    );

  const classicGrossProfit =
    filteredItems.reduce(
      (s, i) => s + n(i.profit),
      0
    );

  const batchPeriod = getBatchPeriodStats(sales);

  const totalSales = classicSales + batchPeriod.collected;
  const realProfitTotal = classicGrossProfit + batchPeriod.benefitDisplay;

  const expensesNoInvest = expenses
    .filter(e => e.category !== "investment")
    .reduce((sum, e) => sum + n(e.amount), 0);

  const totalLossesPeriod =
    losses
      .filter(e => e.isSystemCorrection !== true && e.status !== "cancelled")
      .reduce((sum, e) => sum + n(e.amount), 0);

  const profitNoInvestTotal =
    realProfitTotal - expensesNoInvest - totalLossesPeriod;

  const classicStockValue = (state.products || []).reduce((s, p) => {
    const price = n(p.price_buy || p.purchase_price);
    return s + n(p.stock_current) * price;
  }, 0);

  const stockTotal = classicStockValue + batchPeriod.stockValue;

  const classicSoldQty = filteredItems.reduce((s, i) => s + n(i.quantity), 0);
  const classicStockQty = (state.products || []).reduce(
    (s, p) => s + n(p.stock_current),
    0
  );
  const batchStockQty = (state.batchBatches || [])
    .filter(b => b.status !== "cancelled")
    .reduce((s, b) => s + n(b.quantity_remaining), 0);

  const soldQtyTotal = classicSoldQty + batchPeriod.qtyOut;
  const stockQtyTotal = classicStockQty + batchStockQty;
  const rotationTotal =
    stockQtyTotal > 0 ? (soldQtyTotal / stockQtyTotal).toFixed(2) : "0";

  const basket =
    sales.length
      ? classicSales / sales.length
      : 0;

  const marginRate =
    classicSales > 0
      ? (classicGrossProfit / classicSales) * 100
      : 0;

  const previousSaleIds = new Set(previousSales.map(s => s.id));

  const previousItems =
    state.saleItems.filter(i => previousSaleIds.has(i.saleId));

  const prevSalesTotal =
    previousItems.reduce(
      (sum, i) => sum + n(i.price) * n(i.quantity),
      0
    );

  const prevGrossProfit =
    previousItems.reduce(
      (sum, i) => sum + n(i.profit),
      0
    );

  const prevExpensesNoInvest =
    previousExpenses
      .filter(e => e.category !== "investment")
      .reduce((sum, e) => sum + n(e.amount), 0);

  const prevLossesTotal =
    previousLosses
      .filter(e => e.isSystemCorrection !== true && e.status !== "cancelled")
      .reduce((sum, e) => sum + n(e.amount), 0);

  const prevProfitTotal = prevGrossProfit;
  const prevProfitNoInvest =
    prevGrossProfit - prevExpensesNoInvest - prevLossesTotal;

  const calcTrend = (current, previous) => {
    if (previous === null || previous === undefined) {
      return null;
    }
    if (previous <= 0) {
      return current > 0 ? null : 0;
    }
    return ((current - previous) / previous) * 100;
  };

  const salesTrendValue = calcTrend(totalSales, prevSalesTotal);
  const profitTrendValue = calcTrend(realProfitTotal, prevProfitTotal);
  const profitNoInvestTrendValue = calcTrend(
    profitNoInvestTotal,
    prevProfitNoInvest
  );

  setText("salesValue", formatMoney(totalSales));
  setText("profitValue", formatMoney(realProfitTotal));
  setText("profitNoInvestValue", formatMoney(profitNoInvestTotal));
  setText("stockTotalValue", formatMoney(stockTotal));
  setText("rotationTotalValue", String(rotationTotal));
  setText(
    "salesBreakdown",
    `Classique ${formatMoney(classicSales)} · Batch ${formatMoney(batchPeriod.collected)}`
  );
  setText(
    "profitBreakdown",
    `Classique ${formatMoney(classicGrossProfit)} · Batch ${formatMoney(batchPeriod.benefitDisplay)}`
  );
  setText(
    "stockTotalBreakdown",
    `Classique ${formatMoney(classicStockValue)} · Batch ${formatMoney(batchPeriod.stockValue)}`
  );

  setText("classicCaValue", formatMoney(classicSales));
  setText("classicProfitValue", formatMoney(classicGrossProfit));
  setText("basketValue", formatMoney(basket));
  setText("marginValue", `${marginRate.toFixed(1)}%`);
  setText("batchCollectedValue", formatMoney(batchPeriod.collected));
  setText("batchBenefitValue", formatMoney(batchPeriod.benefitDisplay));
  setText("batchStockValue", formatMoney(batchPeriod.stockValue));
  setText("classicStockValue", formatMoney(classicStockValue));

  const updateTrend = (id, value) => {
    const el = $(id);
    if (!el) return;

    if (value === null) {
      el.textContent = "—";
      el.className = "kpi-trend";
      return;
    }

    const v = n(value);
    const positive = v >= 0;

    el.textContent = `${positive ? "+" : ""}${v.toFixed(1)}%`;
    el.className = positive
      ? "kpi-trend trend-up"
      : "kpi-trend trend-down";
  };

  updateTrend("salesTrend", salesTrendValue);
  updateTrend("profitTrend", profitTrendValue);
  updateTrend("profitNoInvestTrend", profitNoInvestTrendValue);
}

function renderProducts() {
  clearNode("topProductsList");
  clearNode("deadProductsList");
  clearNode("criticalStockList");

  const topBox = $("topProductsList");
  const deadBox = $("deadProductsList");
  const criticalBox = $("criticalStockList");

  if (!topBox || !deadBox || !criticalBox) {
    return;
  }

  const salesMap = {};

  state.saleItems.forEach(item => {
    const productId =
      item.productId ||
      item.product_id;

    if (!productId) {
      return;
    }

    salesMap[productId] ??= 0;

    salesMap[productId] += n(
      item.quantity ||
      item.qty ||
      item.stock_out
    );
  });

  const productsWithSales = state.products.map(product => ({
    ...product,
    soldQty: salesMap[product.id] || 0
  }));

  const topProducts = [...productsWithSales]
    .filter(p => p.soldQty > 0)
    .sort((a, b) => b.soldQty - a.soldQty)
    .slice(0, 5);

  topProducts.forEach(product => {
    const item = document.createElement("div");
    item.className = "list-item";

    const left = document.createElement("div");
    left.className = "list-left";

    const title = document.createElement("div");
    title.className = "list-title";
    title.textContent = product.name || "Produit";

    const sub = document.createElement("div");
    sub.className = "list-sub";
    sub.textContent = "Quantité vendue";

    const value = document.createElement("div");
    value.className = "list-value";
    value.textContent = String(product.soldQty);

    left.appendChild(title);
    left.appendChild(sub);

    item.appendChild(left);
    item.appendChild(value);

    topBox.appendChild(item);
  });

  const deadProducts = [...productsWithSales]
    .filter(p => p.soldQty <= 0)
    .sort((a, b) => n(b.stock_current) - n(a.stock_current))
    .slice(0, 5);

  deadProducts.forEach(product => {
    const item = document.createElement("div");
    item.className = "list-item";

    const left = document.createElement("div");
    left.className = "list-left";

    const title = document.createElement("div");
    title.className = "list-title";
    title.textContent = product.name || "Produit";

    const sub = document.createElement("div");
    sub.className = "list-sub";
    sub.textContent = "Aucune vente";

    const value = document.createElement("div");
    value.className = "list-value";
    value.textContent = String(n(product.stock_current));

    left.appendChild(title);
    left.appendChild(sub);

    item.appendChild(left);
    item.appendChild(value);

    deadBox.appendChild(item);
  });

  const criticalProducts = state.products
    .filter(product => {
      const alertLevel = n(product.stock_alert) || 5;
      return n(product.stock_current) <= alertLevel;
    })
    .sort(
      (a, b) =>
        n(a.stock_current) -
        n(b.stock_current)
    )
    .slice(0, 5);

  criticalProducts.forEach(product => {
    const item = document.createElement("div");
    item.className = "list-item";

    const left = document.createElement("div");
    left.className = "list-left";

    const title = document.createElement("div");
    title.className = "list-title";
    title.textContent = product.name || "Produit";

    const sub = document.createElement("div");
    sub.className = "list-sub";
    sub.textContent = "Stock critique";

    const value = document.createElement("div");
    value.className = "list-value";
    value.textContent = String(n(product.stock_current));

    left.appendChild(title);
    left.appendChild(sub);

    item.appendChild(left);
    item.appendChild(value);

    criticalBox.appendChild(item);
  });
}

