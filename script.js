/* ===========================================================================
   BLOOM & BREW CAFÉ — POS SCRIPT
   =========================================================================== */

let MENU = [];
let menuById = {};
let activeCat = "All";
let searchTerm = "";
const cart = [];
const ITEMS_PER_PAGE = 12;
let menuPage = 1;
let dashPage = 1;
let taxRate = 0.0825;
let bootDone = false;
let tableNumber = 1;

// Global handler: when a menu item image fails to load, replace with placeholder
document.addEventListener("error", function (e) {
  if (e.target.tagName === "IMG" && e.target.classList.contains("item-img")) {
    var div = document.createElement("div");
    div.className = "item-img item-img--placeholder";
    div.dataset.cat = e.target.dataset.cat;
    var idx = parseInt(e.target.dataset.idx || "0", 10);
    var positions = ["20% 20%", "50% 30%", "80% 20%", "15% 70%", "50% 60%", "85% 70%", "30% 45%", "65% 45%", "10% 50%", "90% 50%", "40% 80%", "70% 15%"];
    div.style.backgroundPosition = positions[idx % positions.length];
    e.target.replaceWith(div);
  }
}, true);

// --- 0. Boot ----------------------------------------------------------------
const bootPromise = (async function boot() {
  try {
    await seedIfEmpty();
    MENU = await DB.getAll("menuItems");
    menuById = Object.fromEntries(MENU.map((m) => [m.id, m]));

    const taxRow = await DB.get("meta", "taxRate");
    if (taxRow) taxRate = taxRow.value;
    updateTaxLabels();

    renderMenu();
    renderCart();
    await refreshApprovalBadge();
    await autoSelectNextTable();
    bootDone = true;

    if (currentUser && sessionStorage.getItem("posActive") === "true") {
      showPOS(sessionStorage.getItem("currentPage") || "orders");
    }
  } catch (err) {
    console.error("Boot failed:", err);
    alert("Could not load data from the MySQL database.\n\n" + err.message);
  }
})();

// --- Session / logged-in user -----------------------------------------------
var currentUser = loadSessionUser();

function loadSessionUser() {
  try {
    var raw = sessionStorage.getItem("posUser");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function getInitials(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(function (w) { return w[0].toUpperCase(); })
    .join("");
}

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortName(name) {
  var parts = String(name || "").split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  return parts[0] + " " + parts[parts.length - 1][0] + ".";
}

function renderCurrentUser() {
  if (!currentUser) return;
  var initials = getInitials(currentUser.name);
  document.getElementById("sidebar-user-avatar").textContent = initials;
  document.getElementById("sidebar-user-name").textContent = currentUser.name;
  document.getElementById("sidebar-user-role").textContent = currentUser.role;
  document.getElementById("exit-user-avatar").textContent = initials;
  document.getElementById("exit-user-name").textContent = currentUser.name;
  document.getElementById("exit-user-role").textContent = currentUser.role;
}

function showPOS(page) {
  renderCurrentUser();
  document.getElementById("landing-page").classList.add("hidden");
  document.getElementById("login-page").classList.add("hidden");
  document.getElementById("pos-app").classList.remove("hidden");
  sessionStorage.setItem("posActive", "true");
  showPage(page || "orders");
}

function showLogin() {
  document.getElementById("landing-page").classList.add("hidden");
  document.getElementById("pos-app").classList.add("hidden");
  document.getElementById("login-page").classList.remove("hidden");
  document.getElementById("login-error").textContent = "";
  document.getElementById("login-form").reset();
  document.getElementById("login-username").focus();
}

// --- Landing page -----------------------------------------------------------
document.getElementById("enter-pos-btn").addEventListener("click", async () => {
  if (!bootDone) await bootPromise;
  if (currentUser) {
    showPOS("orders");
  } else {
    showLogin();
  }
});

// --- Login page -------------------------------------------------------------
document.getElementById("login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  var username = document.getElementById("login-username").value;
  var password = document.getElementById("login-password").value;
  var errorEl = document.getElementById("login-error");

  if (!username.trim() || !password) {
    errorEl.textContent = "Please enter your username and password.";
    return;
  }

  var user;
  try {
    user = await loginStaff(username, password);
  } catch (err) {
    errorEl.textContent = err.message;
    return;
  }
  if (!user) {
    errorEl.textContent = "Incorrect username or password.";
    document.getElementById("login-password").value = "";
    document.getElementById("login-password").focus();
    return;
  }

  if (!bootDone) await bootPromise;
  currentUser = user;
  sessionStorage.setItem("posUser", JSON.stringify(user));
  showPOS("orders");
});

document.getElementById("login-toggle").addEventListener("click", function () {
  var input = document.getElementById("login-password");
  var show = input.type === "password";
  input.type = show ? "text" : "password";
  this.textContent = show ? "Hide" : "Show";
  this.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

document.getElementById("login-back").addEventListener("click", function () {
  document.getElementById("login-page").classList.add("hidden");
  document.getElementById("landing-page").classList.remove("hidden");
});

// --- Order type (Dine In / Take Out) -----------------------------------------
let orderType = "Dine In";
const MAX_TABLES = 10;

document.getElementById("btn-dine-in").addEventListener("click", function () {
  orderType = "Dine In";
  document.getElementById("btn-dine-in").classList.add("active");
  document.getElementById("btn-take-out").classList.remove("active");
  document.getElementById("order-type-label").textContent = "Dine In";
  document.getElementById("table-selector").style.display = "flex";
  updateTableDisplay();
});
document.getElementById("btn-take-out").addEventListener("click", function () {
  orderType = "Take Out";
  document.getElementById("btn-take-out").classList.add("active");
  document.getElementById("btn-dine-in").classList.remove("active");
  document.getElementById("order-type-label").textContent = "Take Out";
  document.getElementById("table-selector").style.display = "none";
});

// --- Table number stepper + occupancy ----------------------------------------
async function getOccupiedTables() {
  var orders = await DB.getAll("orders");
  var occupied = new Set();
  orders.forEach(function (o) {
    if (o.status !== "completed" && o.table && o.table.startsWith("Table ")) {
      var num = parseInt(o.table.replace("Table ", ""), 10);
      if (!isNaN(num)) occupied.add(num);
    }
  });
  return occupied;
}

async function getFirstAvailableTable() {
  var occupied = await getOccupiedTables();
  for (var i = 1; i <= MAX_TABLES; i++) {
    if (!occupied.has(i)) return i;
  }
  return null;
}

async function updateTableDisplay() {
  var occupied = await getOccupiedTables();
  document.getElementById("table-label").textContent = "Table " + tableNumber;
  var statusEl = document.getElementById("table-status");
  if (occupied.has(tableNumber)) {
    statusEl.textContent = "Occupied";
    statusEl.className = "table-status occupied";
  } else {
    statusEl.textContent = "Available";
    statusEl.className = "table-status available";
  }
}

async function autoSelectNextTable() {
  var next = await getFirstAvailableTable();
  if (next !== null) {
    tableNumber = next;
  }
  await updateTableDisplay();
}

document.getElementById("table-dec").addEventListener("click", async function () {
  if (tableNumber > 1) { tableNumber--; await updateTableDisplay(); }
});
document.getElementById("table-inc").addEventListener("click", async function () {
  if (tableNumber < MAX_TABLES) { tableNumber++; await updateTableDisplay(); }
});

async function assignWaitingOrders() {
  var orders = await DB.getAll("orders");
  var waiting = orders
    .filter(function (o) { return o.table === "Waiting" && o.status !== "completed"; })
    .sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
  if (waiting.length === 0) return;

  var occupied = await getOccupiedTables();
  for (var i = 0; i < waiting.length; i++) {
    var freeTable = null;
    for (var t = 1; t <= MAX_TABLES; t++) {
      if (!occupied.has(t)) { freeTable = t; break; }
    }
    if (freeTable === null) break;
    waiting[i].table = "Table " + freeTable;
    await DB.put("orders", waiting[i]);
    occupied.add(freeTable);
  }
  await updateTableDisplay();
}

// --- Mobile sidebar toggle --------------------------------------------------
const sidebar = document.getElementById("sidebar");
const backdrop = document.getElementById("sidebar-backdrop");

function openSidebar() {
  sidebar.classList.add("open");
  backdrop.classList.add("visible");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  backdrop.classList.remove("visible");
}

document.getElementById("hamburger-btn").addEventListener("click", () => {
  sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
});

backdrop.addEventListener("click", closeSidebar);

// --- Exit modal (cashier name click) ----------------------------------------
const exitModal = document.getElementById("exit-modal");

document.getElementById("user-btn").addEventListener("click", () => {
  exitModal.classList.add("visible");
});

document.getElementById("exit-cancel-btn").addEventListener("click", () => {
  exitModal.classList.remove("visible");
});

exitModal.addEventListener("click", (e) => {
  if (e.target === exitModal) exitModal.classList.remove("visible");
});

document.getElementById("exit-btn").addEventListener("click", () => {
  exitModal.classList.remove("visible");
  closeSidebar();
  currentUser = null;
  sessionStorage.removeItem("posUser");
  sessionStorage.removeItem("posActive");
  sessionStorage.removeItem("currentPage");
  showLogin();
});

function updateTaxLabels() {
  const pct = (taxRate * 100).toFixed(2).replace(/\.?0+$/, "");
  const label = "Tax (" + pct + "%)";
  const el1 = document.getElementById("tax-label");
  const el2 = document.getElementById("detail-tax-label");
  if (el1) el1.textContent = label;
  if (el2) el2.textContent = label;
}

// --- 1. Sidebar navigation --------------------------------------------------
const navButtons = document.querySelectorAll(".nav-item, .back-link");
function showPage(pageId) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("visible"));
  const target = document.getElementById("page-" + pageId);
  if (target) target.classList.add("visible");

  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.page === pageId);
  });

  sessionStorage.setItem("currentPage", pageId);

  if (pageId === "dashboard") renderDashboard();
  if (pageId === "kitchen") { renderKitchen(); clearBadge("kitchen-badge"); }
  if (pageId === "inventory") { renderInventory(); clearBadge("inventory-badge"); }
  if (pageId === "approval") renderApprovals();
  if (pageId === "settings") renderSettings();
}
navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    showPage(btn.dataset.page);
    closeSidebar();
  });
});

// --- 2. New Order: menu + cart ----------------------------------------------
function getFilteredMenu() {
  return MENU
    .filter((m) => activeCat === "All" || m.cat === activeCat)
    .filter((m) => m.name.toLowerCase().includes(searchTerm.toLowerCase()));
}

function itemImgHtml(item, cls, idx) {
  return '<img class="' + cls + ' item-img" src="' + item.image + '" alt="' + item.name + '" data-cat="' + item.cat + '" data-idx="' + (idx || 0) + '">';
}

function getCartIngredientUsage() {
  var usage = {};
  cart.forEach(function (c) {
    var baseId = c.id.replace(/-iced$|-hot$/, "");
    var menuItem = menuById[baseId];
    if (!menuItem || !menuItem.ingredients) return;
    menuItem.ingredients.forEach(function (ing) {
      if (!usage[ing.name]) usage[ing.name] = 0;
      usage[ing.name] += ing.use * c.qty;
    });
  });
  return usage;
}

async function getItemStockLimits() {
  var inventory = await DB.getAll("inventory");
  var invByName = {};
  inventory.forEach(function (r) { invByName[r.name] = r; });

  var cartUsage = getCartIngredientUsage();

  var effectiveStock = {};
  Object.keys(invByName).forEach(function (name) {
    var dbStock = invByName[name].stock;
    var used = cartUsage[name] || 0;
    effectiveStock[name] = Math.max(0, +(dbStock - used).toFixed(3));
  });

  var limits = {};
  MENU.forEach(function (item) {
    if (!item.ingredients) { limits[item.id] = Infinity; return; }
    var minServings = Infinity;
    for (var j = 0; j < item.ingredients.length; j++) {
      var ing = item.ingredients[j];
      var stock = effectiveStock[ing.name];
      if (stock === undefined || stock <= 0) { minServings = 0; break; }
      if (ing.use > 0) {
        var servings = Math.floor(stock / ing.use);
        if (servings < minServings) minServings = servings;
      }
    }
    limits[item.id] = minServings;
  });
  return limits;
}

var _menuRenderCounter = 0;
async function renderMenu() {
  var renderId = ++_menuRenderCounter;
  var stockLimits = await getItemStockLimits();
  if (renderId !== _menuRenderCounter) return;
  const filtered = getFilteredMenu();
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  if (menuPage > totalPages) menuPage = totalPages;
  const start = (menuPage - 1) * ITEMS_PER_PAGE;
  const pageItems = filtered.slice(start, start + ITEMS_PER_PAGE);

  const grid = document.getElementById("menu-grid");
  grid.innerHTML = "";
  pageItems.forEach((item, i) => {
    var remaining = stockLimits[item.id] || 0;
    var isUnavailable = remaining <= 0;

    const card = document.createElement("button");
    card.className = "menu-item" + (isUnavailable ? " menu-item-unavailable" : "");
    card.type = "button";
    if (isUnavailable) card.disabled = true;

    var tagHtml = "";
    if (isUnavailable) {
      tagHtml = '<span class="unavailable-tag">Unavailable</span>';
    } else if (remaining <= 5) {
      tagHtml = '<span class="stock-limit-tag">' + remaining + ' left</span>';
    }

    card.innerHTML =
      '<div class="menu-item-img-wrap">' +
        itemImgHtml(item, "menu-item-img", start + i) +
        tagHtml +
      '</div>' +
      '<div class="menu-item-name">' + item.name + '</div>' +
      '<div class="menu-item-row">' +
        '<span class="menu-item-price">₱' + item.price.toFixed(2) + '</span>' +
        (isUnavailable ? '' : '<span class="menu-item-add">+</span>') +
      '</div>';
    if (!isUnavailable) {
      card.addEventListener("click", () => addToCart(item));
    }
    grid.appendChild(card);
  });

  renderPagination("menu-pagination", menuPage, totalPages, (p) => { menuPage = p; renderMenu(); });
}

var tempModal = document.getElementById("temp-modal");
var pendingTempItem = null;

document.getElementById("temp-modal-close").addEventListener("click", function () {
  tempModal.classList.remove("visible");
  pendingTempItem = null;
});
tempModal.addEventListener("click", function (e) {
  if (e.target === tempModal) { tempModal.classList.remove("visible"); pendingTempItem = null; }
});

document.getElementById("temp-btn-iced").addEventListener("click", function () {
  if (!pendingTempItem) return;
  addToCartWithVariant(pendingTempItem, "Iced", 5);
  tempModal.classList.remove("visible");
  pendingTempItem = null;
});
document.getElementById("temp-btn-hot").addEventListener("click", function () {
  if (!pendingTempItem) return;
  addToCartWithVariant(pendingTempItem, "Hot", 0);
  tempModal.classList.remove("visible");
  pendingTempItem = null;
});

function addToCart(item) {
  if (item.cat === "Coffee") {
    pendingTempItem = item;
    document.getElementById("temp-modal-item-name").textContent = item.name;
    tempModal.classList.add("visible");
    return;
  }
  addToCartDirect(item.id, item.name, item.price);
}

function addToCartWithVariant(item, variant, extra) {
  var cartId = item.id + "-" + variant.toLowerCase();
  var cartName = item.name + " (" + variant + ")";
  addToCartDirect(cartId, cartName, item.price + extra);
}

function addToCartDirect(id, name, price) {
  const existing = cart.find((c) => c.id === id);
  if (existing) existing.qty += 1;
  else cart.push({ id: id, name: name, price: price, qty: 1 });
  renderCart();
  renderMenu();
}

function changeQty(id, delta) {
  const line = cart.find((c) => c.id === id);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) cart.splice(cart.indexOf(line), 1);
  renderCart();
  renderMenu();
}

function cartTotals() {
  const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;
  return { subtotal, tax, total };
}

function renderCart() {
  const container = document.getElementById("order-items");
  container.innerHTML = "";
  cart.forEach((line) => {
    const row = document.createElement("div");
    row.className = "order-line";
    row.innerHTML =
      '<span class="order-line-name">' + line.name + '</span>' +
      '<span class="qty-stepper">' +
        '<button data-delta="-1" type="button">−</button>' +
        '<span>' + line.qty + '</span>' +
        '<button data-delta="1" type="button">+</button>' +
      '</span>' +
      '<span class="order-line-price">₱' + (line.price * line.qty).toFixed(2) + '</span>';
    row.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => changeQty(line.id, parseInt(btn.dataset.delta, 10)));
    });
    container.appendChild(row);
  });

  const { subtotal, tax, total } = cartTotals();
  document.getElementById("subtotal").textContent = "₱" + subtotal.toFixed(2);
  document.getElementById("tax").textContent = "₱" + tax.toFixed(2);
  document.getElementById("grand-total").textContent = "₱" + total.toFixed(2);
  document.getElementById("checkout-total").textContent = "₱" + total.toFixed(2);

  const hint = document.getElementById("cart-hint");
  hint.textContent = cart.length === 0 ? "Add items from the menu to start an order." : cart.reduce((n, c) => n + c.qty, 0) + " item(s) in this order.";
}

document.querySelectorAll(".category-pills .pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll(".category-pills .pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    activeCat = pill.dataset.cat;
    menuPage = 1;
    renderMenu();
  });
});

document.getElementById("menu-search").addEventListener("input", (e) => {
  searchTerm = e.target.value;
  menuPage = 1;
  renderMenu();
});

document.getElementById("clear-order").addEventListener("click", () => {
  cart.length = 0;
  renderCart();
  renderMenu();
});

// --- 3. Checkout + Cash Payment modal ---------------------------------------
const modal = document.getElementById("payment-modal");
const tenderedInput = document.getElementById("cash-tendered");
const modalError = document.getElementById("modal-error");

document.getElementById("checkout-btn").addEventListener("click", () => {
  if (cart.length === 0) return;
  const { total } = cartTotals();
  document.getElementById("modal-total").textContent = "₱" + total.toFixed(2);
  document.getElementById("modal-change").textContent = "₱0.00";
  tenderedInput.value = "";
  modalError.textContent = "";
  renderQuickCash(total);
  modal.classList.add("visible");
  tenderedInput.focus();
});

document.getElementById("modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
function closeModal() { modal.classList.remove("visible"); }

function renderQuickCash(total) {
  const row = document.getElementById("quick-cash-row");
  row.innerHTML = "";
  const roundedUp = Math.ceil(total / 50) * 50;
  const amounts = [...new Set([total, roundedUp, roundedUp + 100, roundedUp + 200])];
  amounts.forEach((amt) => {
    const btn = document.createElement("button");
    btn.className = "quick-cash-btn";
    btn.type = "button";
    btn.textContent = "₱" + amt.toFixed(0);
    btn.addEventListener("click", () => { tenderedInput.value = amt.toFixed(2); updateChange(); });
    row.appendChild(btn);
  });
}

function updateChange() {
  const { total } = cartTotals();
  const tendered = parseFloat(tenderedInput.value) || 0;
  const change = tendered - total;
  document.getElementById("modal-change").textContent = "₱" + Math.max(0, change).toFixed(2);
  modalError.textContent = tendered > 0 && change < 0 ? "Amount tendered is less than the total due." : "";
}
tenderedInput.addEventListener("input", updateChange);

document.getElementById("confirm-payment-btn").addEventListener("click", async () => {
  const { subtotal, tax, total } = cartTotals();
  const tendered = parseFloat(tenderedInput.value) || 0;

  if (tendered < total) {
    modalError.textContent = "Amount tendered is less than the total due.";
    return;
  }

  const change = +(tendered - total).toFixed(2);

  var tLabel;
  if (orderType === "Take Out") {
    tLabel = "Take Out";
  } else {
    var occupied = await getOccupiedTables();
    if (occupied.has(tableNumber)) {
      if (occupied.size >= MAX_TABLES) {
        tLabel = "Waiting";
      } else {
        var next = await getFirstAvailableTable();
        if (next !== null) {
          tableNumber = next;
          await updateTableDisplay();
        }
        tLabel = "Table " + tableNumber;
      }
    } else {
      tLabel = "Table " + tableNumber;
    }
  }

  const order = await createOrder({
    items: cart.map((c) => ({ id: c.id, name: c.name, price: c.price, qty: c.qty })),
    subtotal, tax, total,
    payment: { method: "Cash", tendered, change },
    tableLabel: tLabel,
    orderType: orderType,
    cashier: currentUser ? currentUser.name : "",
    cashierUsername: currentUser ? currentUser.username : null,
  });

  await deductInventoryForOrder(order.items, menuById);

  cart.length = 0;
  renderCart();
  closeModal();
  await refreshApprovalBadge();
  await refreshKitchenBadge();
  await refreshInventoryBadge();

  if (orderType === "Dine In") await autoSelectNextTable();

  showOrderDetail(order.id);
});

// --- 4. Order Details -------------------------------------------------------
let currentDetailOrderId = null;

async function showOrderDetail(orderId) {
  const order = await DB.get("orders", orderId);
  if (!order) return;
  currentDetailOrderId = orderId;

  document.getElementById("detail-order-id").textContent = order.id;
  document.getElementById("detail-table").textContent = order.table;
  var typeIcon = order.orderType === "Take Out" ? "🥡 Take Out" : "🍽 Dine In";
  document.getElementById("detail-order-type").textContent = typeIcon;
  document.getElementById("detail-datetime").textContent = new Date(order.createdAt).toLocaleString("en-PH", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });

  const statusLabel = { sent_to_kitchen: "Sent to Kitchen", preparing: "In Preparation", ready: "Ready to Serve", completed: "Completed" };
  const pill = document.getElementById("detail-status-pill");
  pill.textContent = statusLabel[order.status] || order.status;
  pill.className = "status-pill status-progress";

  const body = document.getElementById("detail-items-body");
  body.innerHTML = "";
  order.items.forEach((line) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + line.name + "</td>" +
      "<td>" + line.qty + "</td>" +
      "<td>₱" + line.price.toFixed(2) + "</td>" +
      "<td>₱" + (line.price * line.qty).toFixed(2) + "</td>";
    body.appendChild(tr);
  });

  document.getElementById("detail-subtotal").textContent = "₱" + order.subtotal.toFixed(2);
  document.getElementById("detail-tax").textContent = "₱" + order.tax.toFixed(2);
  document.getElementById("detail-total").textContent = "₱" + order.total.toFixed(2);

  const paymentPill = document.getElementById("detail-payment-pill");
  paymentPill.textContent = "Paid (Cash)";
  paymentPill.className = "status-pill status-paid";
  document.getElementById("detail-payment-info").textContent =
    "Cash tendered ₱" + order.payment.tendered.toFixed(2) + " · Change ₱" + order.payment.change.toFixed(2);

  const orderOfStatus = ["sent_to_kitchen", "preparing", "ready", "completed"];
  const currentIdx = orderOfStatus.indexOf(order.status);
  const steps = [
    { label: "Order Received" },
    { label: "Sent to Kitchen" },
    { label: "In Preparation" },
    { label: "Ready to Serve" },
    { label: "Completed" },
  ];

  const timeline = document.getElementById("detail-status-timeline");
  timeline.innerHTML = "";
  steps.forEach((step, i) => {
    const mappedIdx = i <= 1 ? 0 : i - 1;
    const done = mappedIdx < currentIdx || (i <= 1 && currentIdx >= 0);
    const active = mappedIdx === currentIdx && i > 1;
    const li = document.createElement("li");
    li.className = done ? "done" : active ? "active" : "";
    li.innerHTML = '<span class="dot">' + (i + 1) + '</span> ' + step.label + ' <span class="time">' + (done || active ? order.timeLabel : "Pending") + '</span> ' + (done ? '<span class="check">✓</span>' : "");
    timeline.appendChild(li);
  });

  showPage("detail");
}

// --- 5. Kitchen Queue -------------------------------------------------------
let kitchenFilter = "All";
let kitchenSort = "newest";

async function renderKitchen() {
  const orders = await DB.getAll("orders");
  if (kitchenSort === "newest") {
    orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else {
    orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  document.getElementById("count-all").textContent = orders.filter((o) => o.status !== "completed").length;
  document.getElementById("count-new").textContent = orders.filter((o) => o.status === "sent_to_kitchen").length;
  document.getElementById("count-prep").textContent = orders.filter((o) => o.status === "preparing").length;
  document.getElementById("count-ready").textContent = orders.filter((o) => o.status === "ready").length;
  document.getElementById("kitchen-updated").textContent = new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

  const grid = document.getElementById("kitchen-grid");
  grid.innerHTML = "";

  orders
    .filter((o) => o.status !== "completed")
    .filter((o) => kitchenFilter === "All" || o.status === kitchenFilter)
    .forEach((o) => {
      const card = document.createElement("div");
      card.className = "kitchen-card" + (o.status === "sent_to_kitchen" ? " new" : o.status === "ready" ? " ready" : "");
      const itemsHtml = o.items.map((i) => "<li>" + i.name + " x" + i.qty + "</li>").join("");

      let actionHtml = "";
      if (o.status === "sent_to_kitchen") {
        actionHtml = '<button class="btn btn-start" data-order="' + o.id + '" data-next="preparing" type="button">Start</button>';
      } else if (o.status === "preparing") {
        const mins = Math.max(0, Math.round((Date.now() - new Date(o.createdAt)) / 60000));
        actionHtml = '<span class="kitchen-elapsed">⏱ ' + mins + ' min elapsed</span><button class="btn btn-start" data-order="' + o.id + '" data-next="ready" type="button">Mark Ready</button>';
      } else if (o.status === "ready") {
        actionHtml = '<div class="ready-tag">Ready</div><button class="btn btn-serve" data-order="' + o.id + '" data-next="completed" type="button">Serve</button>';
      }

      var tableTag = o.table === "Waiting"
        ? '<span class="kitchen-waiting-tag">Waiting</span>'
        : o.table;
      var typeTag = o.orderType === "Take Out" ? " · 🥡 Take Out" : "";

      var timerHtml = "";
      if (o.orderType !== "Take Out") {
        var elapsedMs = Date.now() - new Date(o.createdAt).getTime();
        var remainMs = Math.max(0, DINE_IN_DURATION_MS - elapsedMs);
        var remainMin = Math.floor(remainMs / 60000);
        var remainSec = Math.floor((remainMs % 60000) / 1000);
        timerHtml = '<div class="kitchen-timer' + (remainMs <= 30000 ? ' kitchen-timer-warn' : '') + '">⏳ ' + remainMin + ':' + (remainSec < 10 ? '0' : '') + remainSec + ' left</div>';
      }

      card.innerHTML =
        '<div class="kitchen-card-head"><span>#' + o.id + '</span><span class="time">' + o.timeLabel + '</span></div>' +
        '<div class="kitchen-card-meta">' + tableTag + typeTag + '</div>' +
        timerHtml +
        '<ul class="kitchen-card-items">' + itemsHtml + '</ul>' +
        '<div class="kitchen-card-customer">Cashier: ' + escapeHtml(shortName(o.cashier) || "—") + '</div>' +
        actionHtml;
      card.querySelectorAll("button[data-order]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          var updated = await updateOrderStatus(btn.dataset.order, btn.dataset.next);
          if (updated && updated.status === "completed") await assignWaitingOrders();
          renderKitchen();
        });
      });
      card.addEventListener("click", () => showOrderDetail(o.id));
      grid.appendChild(card);
    });
}

document.querySelectorAll(".queue-filter-pills .pill[data-filter]").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll(".queue-filter-pills .pill[data-filter]").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    kitchenFilter = pill.dataset.filter;
    renderKitchen();
  });
});

// --- 6. Inventory -----------------------------------------------------------
let invFilter = "All";
const statusClass = { "In Stock": "status-instock", "Low Stock": "status-lowstock", "Out of Stock": "status-outofstock" };

function statusOf(row) {
  if (row.stock <= 0) return "Out of Stock";
  if (row.stock < row.lowThreshold) return "Low Stock";
  return "In Stock";
}

async function renderInventory() {
  const rows = await DB.getAll("inventory");
  document.getElementById("count-low").textContent = rows.filter((r) => statusOf(r) === "Low Stock").length;
  document.getElementById("count-out").textContent = rows.filter((r) => statusOf(r) === "Out of Stock").length;

  const body = document.getElementById("inventory-body");
  body.innerHTML = "";
  rows
    .filter((r) => invFilter === "All" || statusOf(r) === invFilter)
    .forEach((r) => {
      const status = statusOf(r);
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + r.name + "</td>" +
        "<td>" + r.category + "</td>" +
        "<td>" + r.stock.toFixed(2) + "</td>" +
        "<td>" + r.unit + "</td>" +
        '<td><span class="status-pill ' + statusClass[status] + '">' + status + "</span></td>";
      body.appendChild(tr);
    });
}

document.querySelectorAll("#page-inventory .pill").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll("#page-inventory .pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    invFilter = pill.dataset.invfilter;
    renderInventory();
  });
});

// --- 7. Manager Approval ----------------------------------------------------
let appFilter = "needed";

async function refreshApprovalBadge() {
  const alerts = await DB.getAll("approvals");
  const needed = alerts.filter((a) => a.status === "needed").length;
  const badge = document.getElementById("approval-badge");
  badge.textContent = needed;
  badge.classList.toggle("hidden", needed <= 0);
}

async function renderApprovals() {
  const alerts = await DB.getAll("approvals");
  document.getElementById("count-needed").textContent = alerts.filter((a) => a.status === "needed").length;
  document.getElementById("count-approved").textContent = alerts.filter((a) => a.status === "approved").length;
  document.getElementById("approval-page-badge").textContent = alerts.filter((a) => a.status === "needed").length;

  const list = document.getElementById("approval-list");
  list.innerHTML = "";

  alerts
    .filter((a) => a.status === appFilter)
    .forEach((a) => {
      const card = document.createElement("div");
      card.className = "approval-card " + a.type;
      const title = a.type === "out" ? "⛔ Out of Stock Alert" : "⚠ Low Stock Alert";
      const text = a.type === "out"
        ? '<p class="approval-text">' + a.ingredient + ' is out of stock.</p>'
        : '<p class="approval-text">' + a.ingredient + ' is running low (' + a.stock.toFixed(2) + ' ' + a.unit + ' available).</p>';

      const actionsHtml = a.status === "needed"
        ? '<div class="approval-actions">' +
            '<button class="btn btn-outline" data-viewdetail="' + a.ingredient + '" type="button">View Details</button>' +
            '<button class="btn btn-approve" data-approve="' + a.id + '" type="button">Approve Restock</button>' +
          '</div>'
        : '<p class="approval-done">✓ Approved ' + (a.approvedAt || "") + '</p>';

      card.innerHTML =
        '<div class="approval-head">' +
          '<span class="approval-title">' + title + '</span>' +
          '<span class="approval-time">' + a.time + '</span>' +
        '</div>' +
        text + actionsHtml;
      const approveBtn = card.querySelector("[data-approve]");
      if (approveBtn) {
        approveBtn.addEventListener("click", async () => {
          await approveRestock(a.id, currentUser ? currentUser.username : null);
          renderApprovals();
          renderInventory();
          renderMenu();
          refreshApprovalBadge();
        });
      }
      var detailBtn = card.querySelector("[data-viewdetail]");
      if (detailBtn) {
        detailBtn.addEventListener("click", function () {
          showStockDetailModal(a);
        });
      }
      list.appendChild(card);
    });
}

// --- Stock Details Modal ----------------------------------------------------
var stockDetailModal = document.getElementById("stock-detail-modal");

document.getElementById("stock-detail-close").addEventListener("click", function () {
  stockDetailModal.classList.remove("visible");
});
stockDetailModal.addEventListener("click", function (e) {
  if (e.target === stockDetailModal) stockDetailModal.classList.remove("visible");
});

async function showStockDetailModal(alert) {
  var inv = await DB.get("inventory", alert.ingredient);
  var isOut = alert.type === "out" || (inv && inv.stock <= 0);
  var statusLabel = isOut ? "Out of Stock" : "Low Stock";
  var statusClass = isOut ? "out" : "low";

  document.getElementById("stock-detail-title").textContent = alert.ingredient + " — " + statusLabel;

  var body = document.getElementById("stock-detail-body");
  var html = "";

  if (inv) {
    var pct = inv.lowThreshold > 0 ? Math.min(100, Math.round((inv.stock / (inv.lowThreshold * 2.5)) * 100)) : 0;
    var barColor = isOut ? "var(--danger)" : pct < 40 ? "var(--warning)" : "var(--success)";

    html += '<div class="stock-detail-summary">';
    html += '<strong>' + inv.name + '</strong><br>';
    html += 'Current Stock: <strong class="stock-detail-stock ' + statusClass + '">' + inv.stock.toFixed(2) + ' ' + inv.unit + '</strong><br>';
    html += 'Low Threshold: ' + inv.lowThreshold.toFixed(2) + ' ' + inv.unit + '<br>';
    html += 'Category: ' + inv.category;
    html += '<div class="stock-detail-bar"><div class="stock-detail-bar-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div>';
    html += '</div>';

    if (isOut) {
      html += '<p style="color:var(--danger);font-size:13px;font-weight:600;margin:0 0 10px;">⛔ This ingredient is completely depleted. Menu items using it cannot be prepared until restocked.</p>';
    } else {
      html += '<p style="color:var(--warning);font-size:13px;font-weight:600;margin:0 0 10px;">⚠ Stock is below the minimum threshold (' + inv.lowThreshold.toFixed(2) + ' ' + inv.unit + '). Restock soon to avoid running out.</p>';
    }
  }

  var affected = MENU.filter(function (m) {
    return m.ingredients && m.ingredients.some(function (ing) { return ing.name === alert.ingredient; });
  });

  if (affected.length > 0) {
    html += '<div class="stock-detail-menu-title">Affected Menu Items (' + affected.length + ')</div>';
    affected.forEach(function (m) {
      var usage = m.ingredients.find(function (ing) { return ing.name === alert.ingredient; });
      html += '<div class="stock-detail-item">';
      html += '<span class="stock-detail-name">' + m.name + ' <span style="color:var(--text-tertiary);font-weight:400;">(' + m.cat + ')</span></span>';
      html += '<span class="stock-detail-values">';
      html += '<span>Uses ' + usage.use + ' ' + (inv ? inv.unit : '') + '/order</span>';
      if (inv && inv.stock > 0 && usage.use > 0) {
        var servings = Math.floor(inv.stock / usage.use);
        html += '<br><span style="font-size:11px;color:var(--text-tertiary);">' + servings + ' serving(s) left</span>';
      }
      html += '</span></div>';
    });
  }

  body.innerHTML = html;
  stockDetailModal.classList.add("visible");
}

document.querySelectorAll("#page-approval .pill[data-appfilter]").forEach((pill) => {
  pill.addEventListener("click", () => {
    document.querySelectorAll("#page-approval .pill[data-appfilter]").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    appFilter = pill.dataset.appfilter;
    renderApprovals();
  });
});

document.getElementById("approval-refresh").addEventListener("click", async function () {
  await renderApprovals();
  await refreshApprovalBadge();
  await refreshInventoryBadge();
  renderInventory();
});

// --- 8. Notification badges -------------------------------------------------
function setBadge(id, count) {
  const badge = document.getElementById(id);
  if (!badge) return;
  badge.textContent = count;
  badge.classList.toggle("hidden", count <= 0);
}

function clearBadge(id) { setBadge(id, 0); }

async function refreshKitchenBadge() {
  const orders = await DB.getAll("orders");
  setBadge("kitchen-badge", orders.filter((o) => o.status === "sent_to_kitchen").length);
}

async function refreshInventoryBadge() {
  const rows = await DB.getAll("inventory");
  setBadge("inventory-badge", rows.filter((r) => r.stock < r.lowThreshold).length);
}

// --- 9. Pagination ----------------------------------------------------------
function renderPagination(containerId, currentPage, totalPages, onPageChange) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  if (totalPages <= 1) return;

  const prev = document.createElement("button");
  prev.className = "page-btn";
  prev.type = "button";
  prev.textContent = "←";
  prev.disabled = currentPage <= 1;
  prev.addEventListener("click", () => onPageChange(currentPage - 1));
  container.appendChild(prev);

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement("button");
    btn.className = "page-btn" + (i === currentPage ? " active" : "");
    btn.type = "button";
    btn.textContent = i;
    btn.addEventListener("click", () => onPageChange(i));
    container.appendChild(btn);
  }

  const next = document.createElement("button");
  next.className = "page-btn";
  next.type = "button";
  next.textContent = "→";
  next.disabled = currentPage >= totalPages;
  next.addEventListener("click", () => onPageChange(currentPage + 1));
  container.appendChild(next);
}

// --- 10. Dashboard ----------------------------------------------------------
async function renderDashboard() {
  const orders = await DB.getAll("orders");
  const inventory = await DB.getAll("inventory");

  const statsContainer = document.getElementById("dashboard-stats");
  statsContainer.innerHTML =
    '<div class="stat-card"><div class="stat-label">Total Orders</div><div class="stat-value">' + orders.length + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Total Revenue</div><div class="stat-value">₱' + orders.reduce((s, o) => s + o.total, 0).toFixed(2) + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Pending in Kitchen</div><div class="stat-value">' + orders.filter((o) => o.status === "sent_to_kitchen").length + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">Low Stock Items</div><div class="stat-value">' + inventory.filter((r) => r.stock < r.lowThreshold).length + '</div></div>';

  const totalDashPages = Math.max(1, Math.ceil(MENU.length / ITEMS_PER_PAGE));
  if (dashPage > totalDashPages) dashPage = totalDashPages;
  const start = (dashPage - 1) * ITEMS_PER_PAGE;
  const pageItems = MENU.slice(start, start + ITEMS_PER_PAGE);

  var stockLimits = await getItemStockLimits();
  const grid = document.getElementById("dashboard-menu-grid");
  grid.innerHTML = "";
  pageItems.forEach((item, i) => {
    var limit = stockLimits[item.id] || 0;
    var isUnavailable = limit <= 0;
    const card = document.createElement("div");
    card.className = "dashboard-item-card" + (isUnavailable ? " menu-item-unavailable" : "");
    card.innerHTML =
      '<div class="menu-item-img-wrap">' +
        itemImgHtml(item, "dashboard-item-img", start + i) +
        (isUnavailable ? '<span class="unavailable-tag">Unavailable</span>' : '') +
      '</div>' +
      '<div class="dashboard-item-info">' +
        '<div class="dashboard-item-name">' + item.name + '</div>' +
        '<div class="dashboard-item-cat">' + item.cat + '</div>' +
        '<div class="dashboard-item-price">₱' + item.price.toFixed(2) + '</div>' +
      '</div>' +
      (isUnavailable
        ? '<button class="btn btn-outline dashboard-order-btn" type="button" disabled>Unavailable</button>'
        : '<button class="btn btn-primary dashboard-order-btn" type="button">Order</button>');
    if (!isUnavailable) {
      card.querySelector(".dashboard-order-btn").addEventListener("click", () => {
        addToCart(item);
        showPage("orders");
      });
    }
    grid.appendChild(card);
  });

  renderPagination("dashboard-pagination", dashPage, totalDashPages, (p) => { dashPage = p; renderDashboard(); });
}

// --- 11. Settings -----------------------------------------------------------
function renderSettings() {
  const taxInput = document.getElementById("settings-tax");
  taxInput.value = (taxRate * 100).toFixed(2);

  const body = document.getElementById("settings-prices-body");
  body.innerHTML = "";
  MENU.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" + item.name + "</td>" +
      "<td>" + item.cat + "</td>" +
      '<td><input type="number" class="settings-input settings-price-input" data-id="' + item.id + '" value="' + item.price.toFixed(2) + '" min="0" step="0.01"></td>';
    body.appendChild(tr);
  });
}

document.getElementById("save-tax-btn").addEventListener("click", async () => {
  const val = parseFloat(document.getElementById("settings-tax").value);
  if (isNaN(val) || val < 0 || val > 100) return;
  taxRate = val / 100;
  await DB.put("meta", { key: "taxRate", value: taxRate });
  updateTaxLabels();
  renderCart();
  alert("Tax rate saved: " + val + "%");
});

document.getElementById("save-prices-btn").addEventListener("click", async () => {
  const inputs = document.querySelectorAll(".settings-price-input");
  for (const input of inputs) {
    const id = input.dataset.id;
    const newPrice = parseFloat(input.value);
    if (isNaN(newPrice) || newPrice < 0) continue;

    const item = MENU.find((m) => m.id === id);
    if (item) {
      item.price = newPrice;
      await DB.put("menuItems", item);
    }
  }
  menuById = Object.fromEntries(MENU.map((m) => [m.id, m]));
  renderMenu();
  alert("Menu prices saved.");
});

document.getElementById("reset-stock-btn").addEventListener("click", async () => {
  if (!confirm("Reset all inventory to default levels? Orders and menu prices will be kept.")) return;
  await resetStockOnly();
  renderInventory();
  renderMenu();
  renderSettings();
  await refreshApprovalBadge();
  await refreshInventoryBadge();
  alert("Stock reset to defaults.");
});

document.getElementById("reset-all-btn").addEventListener("click", async () => {
  if (!confirm("Reset ALL data? This will clear orders, inventory, prices — everything goes back to factory defaults.")) return;
  await resetDatabase();
  MENU = await DB.getAll("menuItems");
  menuById = Object.fromEntries(MENU.map((m) => [m.id, m]));
  const taxRow = await DB.get("meta", "taxRate");
  if (taxRow) taxRate = taxRow.value;
  updateTaxLabels();
  cart.length = 0;
  renderCart();
  renderMenu();
  renderInventory();
  renderSettings();
  await refreshApprovalBadge();
  await refreshKitchenBadge();
  await refreshInventoryBadge();
  alert("All data reset to factory defaults.");
});

// --- 12. Hold Order ---------------------------------------------------------
let heldOrders = JSON.parse(localStorage.getItem("heldOrders") || "[]");

function updateHoldBadges() {
  const count = heldOrders.length;
  const b1 = document.getElementById("hold-badge");
  const b2 = document.getElementById("hold-badge-modal");
  [b1, b2].forEach(function (b) {
    if (!b) return;
    b.textContent = count;
    b.classList.toggle("hidden", count === 0);
  });
}
updateHoldBadges();

document.getElementById("hold-order-btn").addEventListener("click", function () {
  if (cart.length === 0) { alert("No items in cart to hold."); return; }
  heldOrders.push({
    id: Date.now(),
    table: orderType === "Take Out" ? "Take Out" : "Table " + tableNumber,
    orderType: orderType,
    items: cart.map(function (c) { return { id: c.id, name: c.name, price: c.price, qty: c.qty }; }),
    time: new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
  });
  localStorage.setItem("heldOrders", JSON.stringify(heldOrders));
  cart.length = 0;
  renderCart();
  updateHoldBadges();
  alert("Order held. You can resume it from Order History.");
});

// --- 13. Order History modal ------------------------------------------------
var historyModal = document.getElementById("history-modal");
var historyTab = "completed";

document.getElementById("order-history-btn").addEventListener("click", function () {
  historyTab = "completed";
  renderHistoryModal();
  historyModal.classList.add("visible");
});
document.getElementById("history-close").addEventListener("click", function () {
  historyModal.classList.remove("visible");
});
historyModal.addEventListener("click", function (e) {
  if (e.target === historyModal) historyModal.classList.remove("visible");
});

document.getElementById("tab-completed").addEventListener("click", function () {
  historyTab = "completed";
  document.getElementById("tab-completed").classList.add("active");
  document.getElementById("tab-held").classList.remove("active");
  renderHistoryModal();
});
document.getElementById("tab-held").addEventListener("click", function () {
  historyTab = "held";
  document.getElementById("tab-held").classList.add("active");
  document.getElementById("tab-completed").classList.remove("active");
  renderHistoryModal();
});

async function renderHistoryModal() {
  updateHoldBadges();
  var list = document.getElementById("history-list");
  list.innerHTML = "";

  if (historyTab === "completed") {
    var orders = await DB.getAll("orders");
    orders.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    if (orders.length === 0) {
      list.innerHTML = '<div class="history-empty">No orders yet.</div>';
      return;
    }
    orders.forEach(function (o) {
      var card = document.createElement("div");
      card.className = "history-order";
      var statusLabel = { sent_to_kitchen: "Sent to Kitchen", preparing: "Preparing", ready: "Ready", completed: "Completed" };
      card.innerHTML =
        '<div class="history-order-head"><span>#' + o.id + '</span><span>' + (statusLabel[o.status] || o.status) + '</span></div>' +
        '<div class="history-order-meta">' + o.table + ' · ' + o.timeLabel + ' · ₱' + o.total.toFixed(2) + '</div>' +
        '<div class="history-order-items">' + o.items.map(function (i) { return i.name + " x" + i.qty; }).join(", ") + '</div>';
      card.addEventListener("click", function () {
        historyModal.classList.remove("visible");
        showOrderDetail(o.id);
      });
      list.appendChild(card);
    });
  } else {
    if (heldOrders.length === 0) {
      list.innerHTML = '<div class="history-empty">No held orders.</div>';
      return;
    }
    heldOrders.forEach(function (h, idx) {
      var card = document.createElement("div");
      card.className = "history-order";
      card.innerHTML =
        '<div class="history-order-head"><span>Held #' + (idx + 1) + '</span><span>' + h.time + '</span></div>' +
        '<div class="history-order-meta">' + h.table + '</div>' +
        '<div class="history-order-items">' + h.items.map(function (i) { return i.name + " x" + i.qty; }).join(", ") + '</div>' +
        '<div class="held-order-actions">' +
          '<button class="btn btn-primary" data-resume="' + idx + '" type="button">Resume</button>' +
          '<button class="btn btn-outline" data-discard="' + idx + '" type="button">Discard</button>' +
        '</div>';
      var resumeBtn = card.querySelector("[data-resume]");
      resumeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var held = heldOrders.splice(idx, 1)[0];
        localStorage.setItem("heldOrders", JSON.stringify(heldOrders));
        cart.length = 0;
        held.items.forEach(function (item) { cart.push(item); });
        renderCart();
        updateHoldBadges();
        historyModal.classList.remove("visible");
        showPage("orders");
      });
      var discardBtn = card.querySelector("[data-discard]");
      discardBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("Discard this held order?")) return;
        heldOrders.splice(idx, 1);
        localStorage.setItem("heldOrders", JSON.stringify(heldOrders));
        updateHoldBadges();
        renderHistoryModal();
      });
      list.appendChild(card);
    });
  }
}

// --- 14. Kitchen sort -------------------------------------------------------
document.getElementById("kitchen-sort").addEventListener("change", function () {
  kitchenSort = this.value;
  renderKitchen();
});
document.getElementById("kitchen-refresh-btn").addEventListener("click", function () {
  renderKitchen();
});

// --- 15. Add Inventory Item -------------------------------------------------
var addItemModal = document.getElementById("add-item-modal");

document.getElementById("add-inventory-btn").addEventListener("click", function () {
  document.getElementById("inv-name").value = "";
  document.getElementById("inv-category").value = "";
  document.getElementById("inv-stock").value = "";
  document.getElementById("inv-unit").value = "";
  document.getElementById("inv-threshold").value = "";
  document.getElementById("add-item-error").textContent = "";
  addItemModal.classList.add("visible");
});
document.getElementById("add-item-close").addEventListener("click", function () {
  addItemModal.classList.remove("visible");
});
addItemModal.addEventListener("click", function (e) {
  if (e.target === addItemModal) addItemModal.classList.remove("visible");
});

document.getElementById("add-item-save").addEventListener("click", async function () {
  var name = document.getElementById("inv-name").value.trim();
  var category = document.getElementById("inv-category").value.trim();
  var stock = parseFloat(document.getElementById("inv-stock").value);
  var unit = document.getElementById("inv-unit").value.trim();
  var threshold = parseFloat(document.getElementById("inv-threshold").value);
  var errEl = document.getElementById("add-item-error");

  if (!name || !category || !unit) {
    errEl.textContent = "Name, category, and unit are required.";
    return;
  }
  if (isNaN(stock) || stock < 0) { errEl.textContent = "Enter a valid stock amount."; return; }
  if (isNaN(threshold) || threshold < 0) { errEl.textContent = "Enter a valid threshold."; return; }

  await DB.put("inventory", { name: name, category: category, stock: stock, unit: unit, lowThreshold: threshold });
  addItemModal.classList.remove("visible");
  renderInventory();
  await refreshInventoryBadge();
  alert("Item '" + name + "' added to inventory.");
});

// --- 16. Print Receipt ------------------------------------------------------
document.getElementById("print-order-btn").addEventListener("click", async function () {
  if (!currentDetailOrderId) return;
  var order = await DB.get("orders", currentDetailOrderId);
  if (!order) return;

  var pctLabel = (taxRate * 100).toFixed(2).replace(/\.?0+$/, "");
  var receiptWin = window.open("", "_blank", "width=360,height=600");
  var html = '<html><head><title>Receipt</title>' +
    '<style>body{font-family:monospace;padding:20px;font-size:13px;color:#111}' +
    'h2{text-align:center;margin:0 0 4px}p.sub{text-align:center;margin:0 0 16px;font-size:11px}' +
    'hr{border:none;border-top:1px dashed #999;margin:10px 0}' +
    'table{width:100%;border-collapse:collapse}td{padding:3px 0}' +
    '.r{text-align:right}.b{font-weight:bold}.total{font-size:15px}' +
    '.footer{text-align:center;margin-top:16px;font-size:11px;color:#666}</style></head><body>' +
    '<h2>Bloom and Brew Cafe</h2>' +
    '<p class="sub">Official Receipt</p><hr>' +
    '<p>Order: <b>#' + order.id + '</b></p>' +
    '<p>' + (order.orderType || "Dine In") + ' · ' + order.table + ' · ' + new Date(order.createdAt).toLocaleString("en-PH") + '</p>' +
    '<p>Cashier: ' + escapeHtml(order.cashier || "—") + '</p><hr>' +
    '<table>';
  order.items.forEach(function (item) {
    html += '<tr><td>' + item.name + ' x' + item.qty + '</td><td class="r">₱' + (item.price * item.qty).toFixed(2) + '</td></tr>';
  });
  html += '</table><hr>' +
    '<table>' +
    '<tr><td>Subtotal</td><td class="r">₱' + order.subtotal.toFixed(2) + '</td></tr>' +
    '<tr><td>Tax (' + pctLabel + '%)</td><td class="r">₱' + order.tax.toFixed(2) + '</td></tr>' +
    '<tr class="b total"><td>TOTAL</td><td class="r">₱' + order.total.toFixed(2) + '</td></tr>' +
    '</table><hr>' +
    '<table>' +
    '<tr><td>Cash</td><td class="r">₱' + order.payment.tendered.toFixed(2) + '</td></tr>' +
    '<tr><td>Change</td><td class="r">₱' + order.payment.change.toFixed(2) + '</td></tr>' +
    '</table><hr>' +
    '<p class="footer">Thank you for visiting!<br>Please come again.</p>' +
    '</body></html>';
  receiptWin.document.write(html);
  receiptWin.document.close();
  receiptWin.focus();
  setTimeout(function () { receiptWin.print(); }, 400);
});

// --- 17. Move Status (advance order to next step) ---------------------------
document.getElementById("move-status-btn").addEventListener("click", async function () {
  if (!currentDetailOrderId) return;
  var order = await DB.get("orders", currentDetailOrderId);
  if (!order) return;

  var flow = ["sent_to_kitchen", "preparing", "ready", "completed"];
  var labels = { sent_to_kitchen: "Preparing", preparing: "Ready", ready: "Completed" };
  var idx = flow.indexOf(order.status);

  if (idx < 0 || idx >= flow.length - 1) {
    alert("This order is already completed.");
    return;
  }

  var nextStatus = flow[idx + 1];
  if (!confirm("Move order #" + order.id + " to '" + labels[order.status] + "'?")) return;

  await updateOrderStatus(order.id, nextStatus);
  if (nextStatus === "completed") await assignWaitingOrders();
  await refreshKitchenBadge();
  showOrderDetail(order.id);
});

// --- 18. Cancel Order -------------------------------------------------------
document.getElementById("cancel-order-btn").addEventListener("click", async function () {
  if (!currentDetailOrderId) return;
  var order = await DB.get("orders", currentDetailOrderId);
  if (!order) return;

  if (order.status === "completed") {
    alert("Cannot cancel a completed order.");
    return;
  }

  if (!confirm("Cancel order #" + order.id + "? This will remove it permanently.")) return;

  await DB.delete("orders", order.id);
  await assignWaitingOrders();
  await refreshKitchenBadge();
  showPage("orders");
  alert("Order #" + order.id + " has been cancelled.");
});

// --- 19. Dine-in auto-complete timer (demo: 3 minutes) ----------------------
var DINE_IN_DURATION_MS = 3 * 60 * 1000;

async function checkDineInTimers() {
  var orders = await DB.getAll("orders");
  var now = Date.now();
  var changed = false;

  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (o.status === "completed") continue;
    if (o.orderType === "Take Out") continue;
    var elapsed = now - new Date(o.createdAt).getTime();
    if (elapsed >= DINE_IN_DURATION_MS) {
      await updateOrderStatus(o.id, "completed");
      changed = true;
    }
  }

  if (changed) {
    await assignWaitingOrders();
    await refreshKitchenBadge();
    await updateTableDisplay();
    var currentPage = sessionStorage.getItem("currentPage");
    if (currentPage === "kitchen") renderKitchen();
    if (currentPage === "dashboard") renderDashboard();
  }
}

setInterval(checkDineInTimers, 10000);

setInterval(function () {
  var currentPage = sessionStorage.getItem("currentPage");
  if (currentPage === "kitchen") renderKitchen();
}, 5000);
