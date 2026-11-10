-- ===========================================================================
-- BLOOM & BREW CAFÉ — MySQL / MariaDB SCHEMA (Third Normal Form)
--
-- Import with phpMyAdmin (Import tab) or:
--   C:\xampp\mysql\bin\mysql.exe -u root < database\schema.sql
--
-- WARNING: this script DROPS and recreates the bloom_brew_pos database.
--
-- Menu items, ingredients, recipes and settings are seeded automatically by
-- the app on first load (seedIfEmpty() in db.js).
--
-- Normalization notes
--   * Every column holds a single atomic value (no lists / JSON)        -> 1NF
--   * Every non-key column depends on the whole primary key             -> 2NF
--     (composite key only in menu_item_ingredients; qty_used needs both parts)
--   * No non-key column depends on another non-key column               -> 3NF
--     Values that can be calculated are NOT stored, they are derived:
--       - order subtotal  = SUM(order_items.qty * order_items.unit_price)
--       - order total     = subtotal + orders.tax_amount
--       - payment change  = amount_tendered - total
--       - alert type      = 'out' when stock_at_alert <= 0, else 'low'
--       - unit / names    = read from ingredients / menu_items / users by FK
--     See the view v_order_totals.
-- ===========================================================================

DROP DATABASE IF EXISTS bloom_brew_pos;
CREATE DATABASE bloom_brew_pos CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bloom_brew_pos;

-- ---------------------------------------------------------------------------
-- Staff accounts (login). Passwords are bcrypt hashes.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  role          ENUM('Cashier','Manager') NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Lookup tables
-- ---------------------------------------------------------------------------
CREATE TABLE menu_categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE ingredient_categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Menu & inventory
-- ---------------------------------------------------------------------------
CREATE TABLE menu_items (
  menu_item_id VARCHAR(20)   PRIMARY KEY,           -- e.g. 'm1'
  name         VARCHAR(100)  NOT NULL,
  price        DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  category_id  INT           NOT NULL,
  image_path   VARCHAR(255),
  max_daily    INT           NOT NULL DEFAULT 0,
  FOREIGN KEY (category_id) REFERENCES menu_categories(category_id)
) ENGINE=InnoDB;

CREATE TABLE ingredients (
  ingredient_id INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL UNIQUE,
  category_id   INT           NOT NULL,
  stock         DECIMAL(12,3) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  unit          VARCHAR(20)   NOT NULL,
  low_threshold DECIMAL(12,3) NOT NULL DEFAULT 0,
  FOREIGN KEY (category_id) REFERENCES ingredient_categories(category_id)
) ENGINE=InnoDB;

-- Recipe: how much of each ingredient one serving of a menu item uses
CREATE TABLE menu_item_ingredients (
  menu_item_id  VARCHAR(20)   NOT NULL,
  ingredient_id INT           NOT NULL,
  qty_used      DECIMAL(10,3) NOT NULL CHECK (qty_used > 0),
  PRIMARY KEY (menu_item_id, ingredient_id),
  FOREIGN KEY (menu_item_id)  REFERENCES menu_items(menu_item_id) ON DELETE CASCADE,
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  order_id    VARCHAR(20)   PRIMARY KEY,            -- e.g. 'ORD-10024'
  user_id     INT           NULL,                   -- cashier who took the order
  order_type  ENUM('Dine In','Take Out') NOT NULL,
  table_label VARCHAR(30)   NOT NULL,               -- 'Table 3', 'Waiting', 'Walk-in'
  status      ENUM('sent_to_kitchen','preparing','ready','completed') NOT NULL,
  tax_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,     -- tax charged at time of sale
  created_at  DATETIME(3)   NOT NULL,               -- UTC
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_orders_status (status),
  INDEX idx_orders_created (created_at)
) ENGINE=InnoDB;

-- One row per product line in an order.
-- unit_price is the price at the time of sale (menu prices can change later).
CREATE TABLE order_items (
  order_item_id INT AUTO_INCREMENT PRIMARY KEY,
  order_id      VARCHAR(20)   NOT NULL,
  menu_item_id  VARCHAR(20)   NOT NULL,
  variant       ENUM('Iced','Hot') NULL,            -- coffee temperature, NULL otherwise
  qty           INT           NOT NULL CHECK (qty > 0),
  unit_price    DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id)     REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(menu_item_id),
  UNIQUE KEY uq_order_line (order_id, menu_item_id, variant)
) ENGINE=InnoDB;

CREATE TABLE payments (
  payment_id      INT AUTO_INCREMENT PRIMARY KEY,
  order_id        VARCHAR(20)   NOT NULL UNIQUE,
  method          VARCHAR(20)   NOT NULL DEFAULT 'Cash',
  amount_tendered DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Low-stock alerts awaiting manager approval (one active alert per ingredient)
-- ---------------------------------------------------------------------------
CREATE TABLE restock_approvals (
  approval_id    INT AUTO_INCREMENT PRIMARY KEY,
  ingredient_id  INT           NOT NULL UNIQUE,
  stock_at_alert DECIMAL(12,3) NOT NULL,
  status         ENUM('needed','approved') NOT NULL DEFAULT 'needed',
  created_at     DATETIME      NOT NULL,            -- UTC
  approved_by    INT           NULL,
  approved_at    DATETIME      NULL,                -- UTC
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by)   REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- System settings (taxRate, orderCounter, seeded) — one value per key
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  setting_key   VARCHAR(50)  PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Derived order totals (calculated, never stored)
-- ---------------------------------------------------------------------------
CREATE VIEW v_order_totals AS
SELECT o.order_id,
       COALESCE(SUM(oi.qty * oi.unit_price), 0)                                   AS subtotal,
       o.tax_amount                                                               AS tax,
       COALESCE(SUM(oi.qty * oi.unit_price), 0) + o.tax_amount                    AS total,
       p.method,
       p.amount_tendered,
       p.amount_tendered - (COALESCE(SUM(oi.qty * oi.unit_price), 0) + o.tax_amount) AS change_given
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.order_id
LEFT JOIN payments p     ON p.order_id  = o.order_id
GROUP BY o.order_id, o.tax_amount, p.method, p.amount_tendered;

-- ---------------------------------------------------------------------------
-- Default staff accounts:  nicole / cashier123   manager / manager123
-- ---------------------------------------------------------------------------
INSERT INTO users (username, password_hash, full_name, role) VALUES
  ('nicole',  '$2y$10$3L6mTDtYbtrC0VKebXguvOSjwoYOMkkTSzSG5waYKzZvIzHSKVTP2', 'Nicole Melican', 'Cashier'),
  ('manager', '$2y$10$vz8Pus6Upl0WFusNmt515OCWOBbQQlk3W4H5412LogEdT/3uUtQCW', 'Cafe Manager',   'Manager');
