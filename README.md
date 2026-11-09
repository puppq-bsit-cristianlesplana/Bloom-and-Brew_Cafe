# Bloom and Brew Cafe — POS System

A fully functional cafe point-of-sale and restaurant management system built with **HTML, CSS and JavaScript** on the front end, a small **PHP API**, and a **MySQL (MariaDB) database**. Staff sign in on a login page before using the POS.

---

## Files

| File         | Purpose |
|--------------|---------|
| `index.html` | Complete UI markup — landing page, sidebar, all 6 modules, and all modals |
| `style.css`  | All styling — responsive design, sidebar, cards, modals, gradients |
| `db.js`      | Data layer — calls the PHP API, seed data, and business logic |
| `api/`       | PHP API — `store.php` (reads/writes the tables), `login.php` (staff login), `config.php` (MySQL connection settings) |
| `database/schema.sql` | Creates the `bloom_brew_pos` database, its tables, and the default staff accounts |
| `start-server.bat` | Starts the local PHP server at http://localhost:8000 |
| `script.js`  | Application logic — navigation, cart, checkout, rendering, and all feature handlers |
| `images/`    | Product photos, logo, favicon, and SVG icons |

---

## System Workflow

The POS implements a complete order-to-kitchen-to-inventory workflow:

1. **Order Entry** — Cashier selects Dine In or Take Out, picks a table (for dine-in), selects menu items, chooses Iced/Hot for coffee, builds the cart
2. **Stock Validation** — Items with out-of-stock ingredients are marked "Unavailable" and cannot be ordered; low-stock items show remaining servings
3. **Checkout** — System computes subtotal, configurable tax, and total; cashier enters cash tendered
4. **Send to Kitchen** — Confirmed order is saved to the database and appears in Kitchen Queue with a countdown timer
5. **Table Management** — Occupied tables are tracked; new orders auto-select the next available table; if all tables are full, orders are tagged "Waiting"
6. **Inventory Deduction** — Ingredients used in the order are automatically deducted from stock
7. **Low Stock Alerts** — If any ingredient drops below threshold, a Manager Approval alert is created
8. **Restock Approval** — Manager views stock details and approves the restock, which replenishes inventory and re-enables affected menu items
9. **Auto-Complete** — Dine-in orders auto-complete after 3 minutes (demo mode), freeing the table for waiting orders

---

## Modules

### 1. Landing Page
- Branded starter screen with cafe logo and tagline
- "Enter POS System" button transitions to the main interface
- Warm gradient background (yellow glow + orange glow)
- Session persistence using `sessionStorage` — refreshing stays in the POS; closing the tab/browser returns to the landing page
- Exit via cashier name modal returns to the landing page

### 2. Orders (New Order)
- **Dine In / Take Out Toggle** — Switch between order types; Take Out hides the table selector
- **Table Selector** — Stepper (1–10) with Available/Occupied status indicator; auto-selects next available table after each order
- **Waiting System** — If all tables are occupied, dine-in orders are tagged "Waiting" and auto-assigned when a table frees up
- **Menu Grid** — 4-column grid with product photos, names, and prices
- **Stock Limits** — Items with low stock show a "X left" tag; unavailable items are grayed out with an "Unavailable" tag and cannot be ordered
- **Order Limits** — Cart respects stock limits; items become disabled when the maximum orderable quantity is reached
- **Category Filters** — All, Coffee, Ice Shaken, Non-Coffee, Snacks
- **Search** — Real-time text search across all menu items
- **Pagination** — 12 items per page (4x3 grid) with page navigation
- **Iced/Hot Picker** — Coffee items show a modal to choose Iced (+P5) or Hot
- **Cart** — Live updating cart with quantity steppers (+/-), subtotal, tax, and total
- **Hold Order** — Save current cart for later; badge shows count of held orders
- **Order History** — Modal with two tabs:
  - *Completed Orders* — All past orders with details; click to view
  - *Held Orders* — Resume or discard saved carts
- **Checkout** — Cash payment modal with quick-cash suggestions and live change calculation
- **Clear Cart** — Remove all items from the current order

### 3. Order Details
- Full order summary — order ID, order type (Dine In/Take Out), table, cashier, date/time, customer
- Itemized list with quantities, unit prices, and amounts
- Payment status — cash tendered, change given
- Order status timeline — tracks progress through all stages
- **Print Receipt** — Opens a formatted receipt in a new window with order type and table number; triggers print
- **Move Status** — Advance order to the next workflow step (Sent > Preparing > Ready > Completed)
- **Cancel Order** — Remove incomplete orders permanently; frees table for waiting orders

### 4. Kitchen Queue
- Displays all active (non-completed) orders as cards
- Color-coded: yellow border for new orders, green for ready
- **Countdown Timer** — Dine-in orders show live remaining time (turns red under 30 seconds)
- **Order Type Display** — Shows Dine In or Take Out icon per order
- **Waiting Tag** — Orders without a table show a red "Waiting" badge
- **Filter Pills** — All, New, Preparing, Ready with live counts
- **Sort** — Newest First or Oldest First dropdown
- **Refresh** — SVG icon refresh button; kitchen auto-refreshes every 5 seconds
- **Action Buttons** — Start, Mark Ready, Serve to advance each order
- **Auto-Complete** — Dine-in orders automatically complete after 3 minutes (demo), freeing the table
- **Notification Badge** — Sidebar shows count of new kitchen orders; clears on visit
- Click any order card to view its full details

### 5. Inventory
- Table view of all ingredients with name, category, stock, unit, and status
- **Status Indicators** — In Stock (green), Low Stock (yellow), Out of Stock (red)
- **Filter Pills** — All Items, Low Stock, Out of Stock
- **Add Item** — Modal form to add new inventory items with name, category, stock, unit, and threshold
- **Notification Badge** — Sidebar shows count of low/out-of-stock items; clears on visit
- Stock levels update automatically when orders are placed
- Menu items become available again after restock approval

### 6. Manager Approval
- Lists all low-stock and out-of-stock alerts
- **Filter Tabs** — Approval Needed, Approved
- **View Details** — Modal showing ingredient details: current stock level with visual bar, low threshold, category, reason for alert, and all affected menu items with per-order usage and remaining servings
- **Approve Restock** — One-click approval that replenishes inventory to 2.5x the threshold level; immediately re-enables unavailable menu items
- **Refresh** — SVG icon button; reloads alerts and updates all sidebar badges
- **Badge Count** — Shows number of pending approvals in sidebar and page header

### 7. Dashboard
- **Stats Cards** — Total Orders, Total Revenue, Pending in Kitchen, Low Stock Items
- **Menu Items Grid** — All products with photos, names, categories, and prices; unavailable items shown with "Unavailable" tag
- **Order Button** — Quick-add item to cart and navigate to Orders page (disabled for unavailable items)
- **Pagination** — 12 items per page with navigation

### 8. Settings
- **Tax Rate** — Configurable tax percentage; updates all calculations and labels instantly
- **Menu Prices** — Edit prices for all menu items; saves to database
- **Reset Stock** — Restore all inventory to default levels; keeps orders and prices; re-enables menu items
- **Reset All Data** — Factory reset; clears everything and reseeds from defaults

---

## Database Schema

MySQL database `bloom_brew_pos` with six tables (defined in `database/schema.sql`):

| Table        | Key    | Contents |
|--------------|--------|----------|
| `users`      | `username` | Staff login accounts — bcrypt password hash, name, role |
| `menu_items` | `id`   | Name, price, category, image path, and ingredient usage per item |
| `inventory`  | `name` | Stock level, unit, category, and low-stock threshold per ingredient |
| `orders`     | `id`   | Items, totals, payment info, order type, table, cashier, status, timestamps |
| `approvals`  | `id`   | Low-stock/out-of-stock alerts and their approval status |
| `meta`       | `key`  | System settings — order counter, tax rate, seeded flag |

### Key Database Functions
- `seedIfEmpty()` — Seeds menu, inventory, tax rate, and order counter on first run
- `createOrder()` — Assigns order ID, saves order with status, order type, and table
- `updateOrderStatus()` — Moves order through the workflow stages
- `deductInventoryForOrder()` — Subtracts ingredient usage; creates alerts if below threshold
- `approveRestock()` — Marks alert approved; replenishes ingredient stock
- `resetStockOnly()` — Resets inventory without affecting orders or settings
- `resetDatabase()` — Full factory reset

### Auto-Reset
The database auto-clears stale data when the `DB_VERSION` is bumped. No manual console commands needed — the `localStorage`-based version check handles it automatically on page load.

---

## Sidebar Navigation

- **Logo** — Cafe branding at the top
- **Nav Items** — Dashboard, Orders, Kitchen, Inventory, Manager Approval, Settings
- **SVG Icons** — Custom icons for each module (grid, list, food, cup, edit, gear)
- **Active State** — Dark navy background with white text and icon
- **Inactive State** — Blue text with blue border on hover
- **Notification Badges** — Red badges on Kitchen, Inventory, and Manager Approval
- **Cashier Profile** — Click to open exit modal with "Exit to Home" button
- **Sticky Position** — Sidebar stays fixed while content scrolls
- **Responsive** — Collapses to slide-out menu with labels and cashier name on mobile

---

## Responsive Design

| Breakpoint | Behavior |
|------------|----------|
| Desktop (>1024px) | Full sidebar with text labels, 4-column grids |
| Tablet (<=1024px) | Narrower sidebar, 3-column grids |
| Mobile (<=768px) | Top bar with hamburger + logo; sidebar as 200px slide-out with labels and cashier name |
| Phone (<=480px) | 2-column grids, stacked layouts, compact headers |

---

## Menu Categories

| Category | Items | Price Range |
|----------|-------|-------------|
| Coffee | 11 drinks (Americano, Cafe Latte, Vanilla Latte, etc.) | P45–P59 |
| Ice Shaken | 4 drinks (Chocolate, Toffee Nut, Black Tea, Hibiscus Tea) | P55–P59 |
| Non-Coffee | 7 drinks (Matcha Latte, Tangerine Tea, Iced Chocolate, etc.) | P25–P35 |
| Snacks | 11 items (Ube Crinkles, Avocado Toast, Pasta Carbonara, etc.) | P39–P129 |

**Total: 33 menu items**

---

## Table Management

- 10 tables available (Table 1 through Table 10)
- Table selector with +/- stepper and real-time Available/Occupied status
- After placing a dine-in order, the system auto-selects the next available table
- If all tables are occupied, the order is tagged "Waiting"
- When a table frees up (order completed, auto-completed, or cancelled), the oldest waiting order is automatically assigned to the freed table
- Take Out orders bypass table management entirely

---

## Dine-In Timer (Demo Mode)

- Dine-in orders auto-complete after **3 minutes** to simulate customer turnover
- Kitchen cards show a live countdown timer that updates every 5 seconds
- Timer turns red when under 30 seconds remaining
- On auto-complete, the table is freed and waiting orders are assigned
- Take Out orders have no timer

---

## Session Persistence

The app uses `sessionStorage` for page state (persists across refreshes, clears on tab close):
- `posActive` — Whether the POS is entered (skips landing page on refresh)
- `currentPage` — Which module was last active (restores on refresh)
- Clicking "Exit to Home" clears both, returning to the landing page

Held orders use `localStorage` so they persist even after closing the browser.

---

## Running the System

Requires **XAMPP** (PHP + MySQL).

1. Open the **XAMPP Control Panel** and start **MySQL**.
2. Create the database — in phpMyAdmin (http://localhost/phpmyadmin) use the **Import** tab on `database/schema.sql`, or run:
   `C:\xampp\mysql\bin\mysql.exe -u root < database\schema.sql`
3. Double-click **`start-server.bat`** and open **http://localhost:8000**.
4. Log in with a default account:

| Username  | Password     | Role    |
|-----------|--------------|---------|
| `nicole`  | `cashier123` | Cashier |
| `manager` | `manager123` | Manager |

Menu items, inventory and settings are seeded automatically the first time the app loads. MySQL connection settings are in `api/config.php`.

Opening `index.html` directly (or via GitHub Pages) no longer works — the page needs the PHP server to reach MySQL.

---

## Resetting Data

**From Settings page:**
- "Reset Stock" — Restores inventory to defaults; keeps orders and prices
- "Reset All" — Full factory reset to original state

---

## Known Limitations

- Cash is the only payment method (by design for this POS scope)
- The login only gates the screen — the PHP API itself does not check who is signed in
- Held orders use localStorage (per browser), not MySQL
- Dine-in timer is set to 3 minutes for demo purposes (configurable in code)
- No receipt printing to physical thermal printers (browser print only)
