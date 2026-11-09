/* ===========================================================================
   BLOOM & BREW CAFÉ — DATABASE LAYER (MySQL via PHP API)
   All data lives in the MySQL database "bloom_brew_pos" (see database/schema.sql).
   The browser talks to it through api/store.php and api/login.php.
   =========================================================================== */

const API_BASE = "api/";

async function apiRequest(path, options) {
  let res;
  try {
    res = await fetch(API_BASE + path, options);
  } catch (err) {
    throw new Error("Cannot reach the server. Start it with start-server.bat (see README).");
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error("Server returned an invalid response (HTTP " + res.status + "). Is PHP running?");
  }
  if (!res.ok) {
    const e = new Error((data && data.error) || "Request failed (HTTP " + res.status + ")");
    e.status = res.status;
    throw e;
  }
  return data;
}

function storeGet(store, key) {
  let url = "store.php?store=" + encodeURIComponent(store);
  if (key !== undefined) url += "&key=" + encodeURIComponent(key);
  return apiRequest(url, { method: "GET" });
}

function storePost(store, body) {
  return apiRequest("store.php?store=" + encodeURIComponent(store), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DB = {
  getAll(store) { return storeGet(store); },
  get(store, key) { return storeGet(store, key); },
  put(store, value) { return storePost(store, { action: "put", value }); },
  putAll(store, values) { return storePost(store, { action: "putAll", values }); },
  delete(store, key) { return storePost(store, { action: "delete", key }); },
  clear(store) { return storePost(store, { action: "clear" }); },
};

// ---------------------------------------------------------------------------
// Staff login — checked against the MySQL "users" table (bcrypt passwords).
// Resolves to {username, name, role} or null when the credentials are wrong.
// ---------------------------------------------------------------------------
async function loginStaff(username, password) {
  try {
    const data = await apiRequest("login.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return data.user;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
const SEED_MENU = [
  // Coffee (11) — 50 cups daily limit each
  { id: "m1", name: "Americano", price: 45, cat: "Coffee", image: "images/americano.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }] },
  { id: "m2", name: "Cafe Latte", price: 55, cat: "Coffee", image: "images/cafe-latte.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Whole Milk", use: 0.15 }] },
  { id: "m3", name: "Vanilla Latte", price: 59, cat: "Coffee", image: "images/vanilla-latte.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Whole Milk", use: 0.15 }, { name: "Vanilla Syrup", use: 0.03 }] },
  { id: "m4", name: "Hazelnut Latte", price: 59, cat: "Coffee", image: "images/hazelnut-latte.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Whole Milk", use: 0.15 }, { name: "Hazelnut Syrup", use: 0.03 }] },
  { id: "m5", name: "Spanish Latte", price: 59, cat: "Coffee", image: "images/spanish-latte.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Whole Milk", use: 0.12 }, { name: "Condensed Milk", use: 0.03 }] },
  { id: "m6", name: "Caramel Macchiato", price: 59, cat: "Coffee", image: "images/caramel-macchiato.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Whole Milk", use: 0.15 }, { name: "Caramel Sauce", use: 0.03 }] },
  { id: "m7", name: "Salted Caramel", price: 59, cat: "Coffee", image: "images/salted-caramel.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Whole Milk", use: 0.15 }, { name: "Caramel Sauce", use: 0.03 }] },
  { id: "m8", name: "White Mocha", price: 59, cat: "Coffee", image: "images/white-mocha.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Whole Milk", use: 0.15 }, { name: "White Choco Sauce", use: 0.03 }] },
  { id: "m9", name: "Cafe Mocha", price: 59, cat: "Coffee", image: "images/cafe-mocha.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Whole Milk", use: 0.15 }, { name: "Choco Sauce", use: 0.03 }] },
  { id: "m10", name: "Coffee Matcha", price: 59, cat: "Coffee", image: "images/coffe-matcha.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Matcha Powder", use: 0.05 }, { name: "Whole Milk", use: 0.12 }] },
  { id: "m11", name: "Hazelnut Mocha", price: 59, cat: "Coffee", image: "images/hazelnut-mocha.png", maxDaily: 20, ingredients: [{ name: "Espresso Beans", use: 0.04 }, { name: "Whole Milk", use: 0.15 }, { name: "Hazelnut Syrup", use: 0.02 }, { name: "Choco Sauce", use: 0.02 }] },
  // Ice Shaken (4) — 50 cups daily limit each
  { id: "m12", name: "Chocolate", price: 55, cat: "Ice Shaken", image: "images/Chocolate.png", maxDaily: 20, ingredients: [{ name: "Choco Sauce", use: 0.05 }, { name: "Whole Milk", use: 0.15 }] },
  { id: "m13", name: "Toffee Nut", price: 55, cat: "Ice Shaken", image: "images/toffee-nut.png", maxDaily: 20, ingredients: [{ name: "Toffee Nut Syrup", use: 0.04 }, { name: "Whole Milk", use: 0.15 }] },
  { id: "m14", name: "Black Tea", price: 55, cat: "Ice Shaken", image: "images/black-tea.png", maxDaily: 20, ingredients: [{ name: "Black Tea", use: 0.1 }] },
  { id: "m15", name: "Hibiscus Tea", price: 59, cat: "Ice Shaken", image: "images/hibiscus-tea.png", maxDaily: 20, ingredients: [{ name: "Hibiscus Tea", use: 0.1 }] },
  // Non-Coffee (7) — 50 cups daily limit each
  { id: "m16", name: "Matcha Latte", price: 25, cat: "Non-Coffee", image: "images/matcha-latte.png", maxDaily: 20, ingredients: [{ name: "Matcha Powder", use: 0.05 }, { name: "Whole Milk", use: 0.2 }] },
  { id: "m17", name: "Tangerine Tea", price: 25, cat: "Non-Coffee", image: "images/tangerine-tea.png", maxDaily: 20, ingredients: [{ name: "Tangerine Syrup", use: 0.04 }] },
  { id: "m18", name: "Iced Chocolate", price: 35, cat: "Non-Coffee", image: "images/iced-chocolate.png", maxDaily: 20, ingredients: [{ name: "Choco Sauce", use: 0.05 }, { name: "Whole Milk", use: 0.2 }] },
  { id: "m19", name: "Creamy Pandan", price: 35, cat: "Non-Coffee", image: "images/creamy-pandan.png", maxDaily: 20, ingredients: [{ name: "Pandan Syrup", use: 0.04 }, { name: "Whole Milk", use: 0.2 }] },
  { id: "m20", name: "Lychee", price: 35, cat: "Non-Coffee", image: "images/lychee.png", maxDaily: 20, ingredients: [{ name: "Lychee Syrup", use: 0.04 }] },
  { id: "m21", name: "Red Velvet", price: 35, cat: "Non-Coffee", image: "images/red-velvet.png", maxDaily: 20, ingredients: [{ name: "Red Velvet Powder", use: 0.04 }, { name: "Whole Milk", use: 0.2 }] },
  { id: "m22", name: "Cranberry", price: 35, cat: "Non-Coffee", image: "images/cranberry.png", maxDaily: 20, ingredients: [{ name: "Cranberry Syrup", use: 0.04 }] },
  // Snacks (11) — 50 pieces daily limit each
  { id: "m23", name: "Ube Crinkles", price: 59, cat: "Snacks", image: "images/ube-crinkels.png", maxDaily: 20, ingredients: [{ name: "Ube Crinkles", use: 1 }] },
  { id: "m24", name: "Oatmeal Cookies", price: 39, cat: "Snacks", image: "images/oatmeal-cookies.png", maxDaily: 20, ingredients: [{ name: "Oatmeal Cookies", use: 1 }] },
  { id: "m25", name: "Mixed Nuts", price: 69, cat: "Snacks", image: "images/mixed-nuts.png", maxDaily: 20, ingredients: [{ name: "Mixed Nuts", use: 1 }] },
  { id: "m26", name: "Cheesecake Bar", price: 79, cat: "Snacks", image: "images/cheesecake-bar.png", maxDaily: 20, ingredients: [{ name: "Cheesecake Bar", use: 1 }] },
  { id: "m27", name: "Avocado Toast", price: 99, cat: "Snacks", image: "images/avocado-toast.png", maxDaily: 20, ingredients: [{ name: "Avocado Toast", use: 1 }] },
  { id: "m28", name: "Empanada", price: 79, cat: "Snacks", image: "images/empanada.png", maxDaily: 20, ingredients: [{ name: "Empanada", use: 1 }] },
  { id: "m29", name: "Ensaimada", price: 79, cat: "Snacks", image: "images/ensaimada.png", maxDaily: 20, ingredients: [{ name: "Ensaimada", use: 1 }] },
  { id: "m30", name: "Tuna Melt", price: 89, cat: "Snacks", image: "images/tuna-melt.png", maxDaily: 20, ingredients: [{ name: "Tuna Melt", use: 1 }] },
  { id: "m31", name: "Hotdog", price: 69, cat: "Snacks", image: "images/hotdog.png", maxDaily: 20, ingredients: [{ name: "Hotdog", use: 1 }] },
  { id: "m32", name: "Pasta Carbonara", price: 129, cat: "Snacks", image: "images/pasta-carbonara.png", maxDaily: 20, ingredients: [{ name: "Pasta Carbonara", use: 1 }] },
  { id: "m33", name: "Fries", price: 99, cat: "Snacks", image: "images/fries.png", maxDaily: 20, ingredients: [{ name: "Fries", use: 0.15 }] },
];

const SEED_INVENTORY = [
  { name: "Espresso Beans", category: "Coffee", stock: 3.0, unit: "kg", lowThreshold: 0.8 },
  { name: "Whole Milk", category: "Dairy", stock: 15.0, unit: "L", lowThreshold: 3.0 },
  { name: "Vanilla Syrup", category: "Syrup", stock: 0.8, unit: "L", lowThreshold: 0.15 },
  { name: "Hazelnut Syrup", category: "Syrup", stock: 1.0, unit: "L", lowThreshold: 0.15 },
  { name: "Caramel Sauce", category: "Sauce", stock: 1.0, unit: "L", lowThreshold: 0.15 },
  { name: "Choco Sauce", category: "Sauce", stock: 2.0, unit: "L", lowThreshold: 0.3 },
  { name: "White Choco Sauce", category: "Sauce", stock: 0.8, unit: "L", lowThreshold: 0.15 },
  { name: "Condensed Milk", category: "Dairy", stock: 0.8, unit: "L", lowThreshold: 0.15 },
  { name: "Matcha Powder", category: "Powder", stock: 1.0, unit: "kg", lowThreshold: 0.2 },
  { name: "Toffee Nut Syrup", category: "Syrup", stock: 0.8, unit: "L", lowThreshold: 0.15 },
  { name: "Black Tea", category: "Tea", stock: 2.0, unit: "L", lowThreshold: 0.5 },
  { name: "Hibiscus Tea", category: "Tea", stock: 2.0, unit: "L", lowThreshold: 0.5 },
  { name: "Tangerine Syrup", category: "Syrup", stock: 0.8, unit: "L", lowThreshold: 0.15 },
  { name: "Pandan Syrup", category: "Syrup", stock: 0.8, unit: "L", lowThreshold: 0.15 },
  { name: "Lychee Syrup", category: "Syrup", stock: 0.8, unit: "L", lowThreshold: 0.15 },
  { name: "Red Velvet Powder", category: "Powder", stock: 0.8, unit: "kg", lowThreshold: 0.15 },
  { name: "Cranberry Syrup", category: "Syrup", stock: 0.8, unit: "L", lowThreshold: 0.15 },
  { name: "Ube Crinkles", category: "Pastry", stock: 20, unit: "pcs", lowThreshold: 5 },
  { name: "Oatmeal Cookies", category: "Pastry", stock: 20, unit: "pcs", lowThreshold: 5 },
  { name: "Mixed Nuts", category: "Snack", stock: 20, unit: "packs", lowThreshold: 5 },
  { name: "Cheesecake Bar", category: "Pastry", stock: 20, unit: "pcs", lowThreshold: 5 },
  { name: "Avocado Toast", category: "Food", stock: 15, unit: "pcs", lowThreshold: 4 },
  { name: "Empanada", category: "Food", stock: 20, unit: "pcs", lowThreshold: 5 },
  { name: "Ensaimada", category: "Pastry", stock: 15, unit: "pcs", lowThreshold: 4 },
  { name: "Tuna Melt", category: "Food", stock: 12, unit: "pcs", lowThreshold: 3 },
  { name: "Hotdog", category: "Food", stock: 20, unit: "pcs", lowThreshold: 5 },
  { name: "Pasta Carbonara", category: "Food", stock: 12, unit: "pcs", lowThreshold: 3 },
  { name: "Fries", category: "Frozen", stock: 3.0, unit: "kg", lowThreshold: 0.5 },
];

const DEFAULT_TAX_RATE = 0.0825;

async function seedIfEmpty() {
  const metaRow = await DB.get("meta", "seeded");
  if (metaRow && metaRow.value) return;

  await DB.putAll("menuItems", SEED_MENU);
  await DB.putAll("inventory", SEED_INVENTORY);
  await DB.put("meta", { key: "seeded", value: true });
  await DB.put("meta", { key: "orderCounter", value: 10023 });
  await DB.put("meta", { key: "taxRate", value: DEFAULT_TAX_RATE });
}

async function nextOrderId() {
  const row = await DB.get("meta", "orderCounter");
  const next = (row ? row.value : 10023) + 1;
  await DB.put("meta", { key: "orderCounter", value: next });
  return "ORD-" + next;
}

async function resetDatabase() {
  await DB.clear("menuItems");
  await DB.clear("inventory");
  await DB.clear("orders");
  await DB.clear("approvals");
  await DB.clear("meta");
  await seedIfEmpty();
}

async function resetStockOnly() {
  await DB.clear("inventory");
  await DB.clear("approvals");
  await DB.putAll("inventory", SEED_INVENTORY);
}

async function deductInventoryForOrder(orderLines, menuById) {
  const inventory = await DB.getAll("inventory");
  const invByName = Object.fromEntries(inventory.map((i) => [i.name, i]));
  const lowNow = [];

  for (const line of orderLines) {
    const baseId = line.id.replace(/-iced$|-hot$/, "");
    const menuItem = menuById[baseId] || menuById[line.id];
    if (!menuItem) continue;
    for (const ing of menuItem.ingredients) {
      const row = invByName[ing.name];
      if (!row) continue;
      row.stock = Math.max(0, +(row.stock - ing.use * line.qty).toFixed(3));
      if (row.stock < row.lowThreshold && !lowNow.includes(ing.name)) {
        lowNow.push(ing.name);
      }
    }
  }

  await DB.putAll("inventory", Object.values(invByName));

  for (const ingName of lowNow) {
    const row = invByName[ingName];
    const id = "alert-" + ingName.replace(/\s+/g, "_").toLowerCase();
    await DB.put("approvals", {
      id,
      type: row.stock <= 0 ? "out" : "low",
      ingredient: ingName,
      stock: row.stock,
      unit: row.unit,
      time: new Date().toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }),
      status: "needed",
    });
  }

  return lowNow;
}

async function createOrder({ items, subtotal, tax, total, payment, tableLabel, orderType, cashier }) {
  const id = await nextOrderId();
  const order = {
    id,
    items,
    subtotal, tax, total,
    payment,
    table: tableLabel || "Walk-in",
    orderType: orderType || "Dine In",
    cashier: cashier || "",
    status: "sent_to_kitchen",
    createdAt: new Date().toISOString(),
    timeLabel: new Date().toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" }),
  };
  await DB.put("orders", order);
  return order;
}

async function updateOrderStatus(orderId, status) {
  const order = await DB.get("orders", orderId);
  if (!order) return null;
  order.status = status;
  await DB.put("orders", order);
  return order;
}

async function approveRestock(alertId) {
  const alert = await DB.get("approvals", alertId);
  if (!alert) return;
  alert.status = "approved";
  alert.approvedAt = new Date().toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  await DB.put("approvals", alert);

  const row = await DB.get("inventory", alert.ingredient);
  if (row) {
    row.stock = +(row.lowThreshold * 2.5).toFixed(2);
    await DB.put("inventory", row);
  }
}
