// テーブル定義と初期データ。setup API から呼ぶ。
// すべて IF NOT EXISTS なので、何度実行しても安全(冪等)。
import { sql } from './db.js';

export async function ensureSchema() {
  // 組織: 将来の「部 > 課 > 係」階層に備え parent_id を持たせる。
  await sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id        SERIAL PRIMARY KEY,
      name      TEXT NOT NULL,
      kind      TEXT NOT NULL DEFAULT '課',     -- 部 / 課 / 係
      parent_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      sort      INTEGER NOT NULL DEFAULT 0
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS members (
      id       SERIAL PRIMARY KEY,
      org_id   INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name     TEXT NOT NULL,
      role     TEXT NOT NULL DEFAULT '係員',    -- 課長 / 係長 / 係員
      pin_hash TEXT,
      sort     INTEGER NOT NULL DEFAULT 0
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id        SERIAL PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      day       DATE NOT NULL,
      status    TEXT NOT NULL,                  -- ◎ / ○ / △ / 確定
      memo      TEXT NOT NULL DEFAULT '',
      UNIQUE (member_id, day)
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id         SERIAL PRIMARY KEY,
      org_id     INTEGER REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = 全体
      title      TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date   DATE NOT NULL
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      id                  INTEGER PRIMARY KEY DEFAULT 1,
      year                INTEGER NOT NULL,
      period_start        DATE NOT NULL,
      period_end          DATE NOT NULL,
      max_confirmed_days  INTEGER NOT NULL DEFAULT 3,
      admin_pin_hash      TEXT
    )`;
}

// 初期データ: settings 1行 と 課A/課B。既にあれば何もしない。
export async function seedDefaults(adminPinHash) {
  const existing = await sql`SELECT id FROM settings WHERE id = 1`;
  if (existing.length === 0) {
    await sql`
      INSERT INTO settings (id, year, period_start, period_end, max_confirmed_days, admin_pin_hash)
      VALUES (1, 2026, '2026-07-01', '2026-10-31', 3, ${adminPinHash})`;
  }

  const orgs = await sql`SELECT id FROM organizations`;
  if (orgs.length === 0) {
    await sql`INSERT INTO organizations (name, kind, parent_id, sort) VALUES ('課A', '課', NULL, 1)`;
    await sql`INSERT INTO organizations (name, kind, parent_id, sort) VALUES ('課B', '課', NULL, 2)`;
  }
}

export async function getSettings() {
  const rows = await sql`SELECT * FROM settings WHERE id = 1`;
  return rows[0] || null;
}
