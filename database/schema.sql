-- ===========================================================================
-- BLOOM & BREW CAFÉ — MySQL / MariaDB SCHEMA
-- Import with phpMyAdmin (Import tab) or:
--   C:\xampp\mysql\bin\mysql.exe -u root < database\schema.sql
-- Menu items, inventory and settings are seeded automatically by the app
-- on first load (see seedIfEmpty() in db.js).
-- ===========================================================================

CREATE DATABASE IF NOT EXISTS bloom_brew_pos
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bloom_brew_pos;

-- Staff accounts used by the login page (passwords are bcrypt hashes)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  role          VARCHAR(30)  NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS menu_items (
  id          VARCHAR(20)   PRIMARY KEY,
  name        VARCHAR(100)  NOT NULL,
  price       DECIMAL(10,2) NOT NULL DEFAULT 0,
  category    VARCHAR(50)   NOT NULL,
  image       VARCHAR(255),
  max_daily   INT           NOT NULL DEFAULT 0,
  ingredients LONGTEXT      COMMENT 'JSON array of {name, use}',
  extra       LONGTEXT      COMMENT 'JSON of any other fields'
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory (
  name          VARCHAR(100)  PRIMARY KEY,
  category      VARCHAR(50),
  stock         DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit          VARCHAR(20),
  low_threshold DECIMAL(12,3) NOT NULL DEFAULT 0,
  extra         LONGTEXT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS orders (
  id          VARCHAR(20)   PRIMARY KEY,
  items       LONGTEXT      COMMENT 'JSON array of {id, name, price, qty}',
  subtotal    DECIMAL(10,2) NOT NULL DEFAULT 0,
  tax         DECIMAL(10,2) NOT NULL DEFAULT 0,
  total       DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment     LONGTEXT      COMMENT 'JSON {method, tendered, change}',
  table_label VARCHAR(30),
  order_type  VARCHAR(20),
  cashier     VARCHAR(100),
  status      VARCHAR(30)   NOT NULL,
  created_at  DATETIME(3)   NOT NULL COMMENT 'UTC',
  time_label  VARCHAR(20),
  extra       LONGTEXT,
  INDEX idx_orders_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS approvals (
  id          VARCHAR(100)  PRIMARY KEY,
  type        VARCHAR(10)   NOT NULL COMMENT 'low | out',
  ingredient  VARCHAR(100)  NOT NULL,
  stock       DECIMAL(12,3),
  unit        VARCHAR(20),
  time        VARCHAR(50),
  status      VARCHAR(20)   NOT NULL COMMENT 'needed | approved',
  approved_at VARCHAR(50),
  extra       LONGTEXT
) ENGINE=InnoDB;

-- Key/value settings (taxRate, orderCounter, seeded)
CREATE TABLE IF NOT EXISTS meta (
  `key`   VARCHAR(50) PRIMARY KEY,
  `value` LONGTEXT    COMMENT 'JSON value'
) ENGINE=InnoDB;

-- Default staff accounts:  nicole / cashier123   manager / manager123
INSERT IGNORE INTO users (username, password_hash, name, role) VALUES
  ('nicole',  '$2y$10$3L6mTDtYbtrC0VKebXguvOSjwoYOMkkTSzSG5waYKzZvIzHSKVTP2', 'Nicole Melican', 'Cashier'),
  ('manager', '$2y$10$vz8Pus6Upl0WFusNmt515OCWOBbQQlk3W4H5412LogEdT/3uUtQCW', 'Cafe Manager',   'Manager');
