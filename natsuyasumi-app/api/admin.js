// POST /api/admin — 管理操作の窓口。action で分岐。
// 最初の setup 以外はすべて管理用PIN(adminPin)が必要。
import { sql, hasDatabase } from '../lib/db.js';
import { hashPin, verifyPin, isValidPinFormat } from '../lib/auth.js';
import { readJsonBody, sendJson, sendDbMissing } from '../lib/http.js';
import { ensureSchema, seedDefaults, getSettings } from '../lib/schema.js';

const ROLES = new Set(['課長', '係長', '係員']);
const ORG_KINDS = new Set(['部', '課', '係']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!hasDatabase()) return sendDbMissing(res);

  const body = await readJsonBody(req);
  const action = String(body.action ?? '');
  const adminPin = String(body.adminPin ?? '');

  try {
    // --- 初期セットアップ(テーブル作成 + 初期データ) ---
    if (action === 'setup') {
      if (!isValidPinFormat(adminPin)) {
        return sendJson(res, 400, { ok: false, error: 'BAD_PIN', message: '管理用PINは4桁の数字で設定してください。' });
      }
      await ensureSchema();
      const existing = await getSettings();
      if (existing && existing.admin_pin_hash) {
        // 既に初期化済み。再実行は管理PINが一致する場合のみ許可(冪等・保護)。
        if (!verifyPin(adminPin, existing.admin_pin_hash)) {
          return sendJson(res, 401, { ok: false, error: 'ALREADY_SETUP', message: '既に初期化済みです。管理用PINが一致しません。' });
        }
        return sendJson(res, 200, { ok: true, alreadySetup: true });
      }
      await seedDefaults(hashPin(adminPin));
      return sendJson(res, 200, { ok: true, setup: true });
    }

    // --- ここから先は管理PIN必須 ---
    const settings = await getSettings();
    if (!settings || !settings.admin_pin_hash) {
      return sendJson(res, 409, { ok: false, error: 'NOT_SETUP', message: 'まだ初期化されていません。' });
    }
    if (!verifyPin(adminPin, settings.admin_pin_hash)) {
      return sendJson(res, 401, { ok: false, error: 'ADMIN_PIN_MISMATCH', message: '管理用PINが違います。' });
    }

    switch (action) {
      case 'ping':
        return sendJson(res, 200, { ok: true });

      case 'addMember': {
        const { orgId, name, role, pin } = body;
        if (!Number.isInteger(Number(orgId))) return bad(res, '課(組織)を選んでください。');
        if (!String(name || '').trim()) return bad(res, '名前を入力してください。');
        if (!ROLES.has(role)) return bad(res, '役職が不正です。');
        let pinHash = null;
        if (pin != null && String(pin) !== '') {
          if (!isValidPinFormat(String(pin))) return bad(res, 'PINは4桁の数字にしてください。');
          pinHash = hashPin(String(pin));
        }
        const rows = await sql`
          INSERT INTO members (org_id, name, role, pin_hash, sort)
          VALUES (${Number(orgId)}, ${String(name).trim()}, ${role}, ${pinHash},
                  COALESCE((SELECT MAX(sort)+1 FROM members WHERE org_id = ${Number(orgId)}), 0))
          RETURNING id`;
        return sendJson(res, 200, { ok: true, id: rows[0].id });
      }

      case 'updateMember': {
        const id = Number(body.memberId);
        if (!Number.isInteger(id)) return bad(res, 'メンバーが不正です。');
        const name = body.name != null ? String(body.name).trim() : null;
        const role = body.role != null ? String(body.role) : null;
        const orgId = body.orgId != null ? Number(body.orgId) : null;
        if (role != null && !ROLES.has(role)) return bad(res, '役職が不正です。');
        await sql`
          UPDATE members SET
            name   = COALESCE(${name}, name),
            role   = COALESCE(${role}, role),
            org_id = COALESCE(${orgId}, org_id)
          WHERE id = ${id}`;
        return sendJson(res, 200, { ok: true });
      }

      case 'setMemberPin': {
        const id = Number(body.memberId);
        const newPin = String(body.newPin ?? '');
        if (!Number.isInteger(id)) return bad(res, 'メンバーが不正です。');
        if (!isValidPinFormat(newPin)) return bad(res, 'PINは4桁の数字にしてください。');
        await sql`UPDATE members SET pin_hash = ${hashPin(newPin)} WHERE id = ${id}`;
        return sendJson(res, 200, { ok: true });
      }

      case 'deleteMember': {
        const id = Number(body.memberId);
        if (!Number.isInteger(id)) return bad(res, 'メンバーが不正です。');
        await sql`DELETE FROM members WHERE id = ${id}`;
        return sendJson(res, 200, { ok: true });
      }

      case 'addEvent': {
        const orgId = body.orgId != null && body.orgId !== '' ? Number(body.orgId) : null;
        const title = String(body.title ?? '').trim();
        const startDate = String(body.startDate ?? '');
        const endDate = String(body.endDate ?? '') || startDate;
        if (!title) return bad(res, 'タイトルを入力してください。');
        if (!isDate(startDate) || !isDate(endDate)) return bad(res, '日付が不正です。');
        const rows = await sql`
          INSERT INTO events (org_id, title, start_date, end_date)
          VALUES (${orgId}, ${title}, ${startDate}, ${endDate}) RETURNING id`;
        return sendJson(res, 200, { ok: true, id: rows[0].id });
      }

      case 'deleteEvent': {
        const id = Number(body.eventId);
        if (!Number.isInteger(id)) return bad(res, '業務予定が不正です。');
        await sql`DELETE FROM events WHERE id = ${id}`;
        return sendJson(res, 200, { ok: true });
      }

      case 'updateSettings': {
        const year = Number(body.year);
        const periodStart = String(body.periodStart ?? '');
        const periodEnd = String(body.periodEnd ?? '');
        const maxDays = Number(body.maxConfirmedDays);
        if (!Number.isInteger(year)) return bad(res, '年度が不正です。');
        if (!isDate(periodStart) || !isDate(periodEnd)) return bad(res, '期間が不正です。');
        if (periodEnd < periodStart) return bad(res, '終了日は開始日以降にしてください。');
        if (!Number.isInteger(maxDays) || maxDays < 1) return bad(res, '上限日数が不正です。');
        await sql`
          UPDATE settings SET year = ${year}, period_start = ${periodStart},
            period_end = ${periodEnd}, max_confirmed_days = ${maxDays} WHERE id = 1`;
        return sendJson(res, 200, { ok: true });
      }

      case 'changeAdminPin': {
        const newPin = String(body.newPin ?? '');
        if (!isValidPinFormat(newPin)) return bad(res, '管理用PINは4桁の数字にしてください。');
        await sql`UPDATE settings SET admin_pin_hash = ${hashPin(newPin)} WHERE id = 1`;
        return sendJson(res, 200, { ok: true });
      }

      // --- 組織(将来の 部>課>係 拡張。今は課の追加・改名・削除に使える) ---
      case 'addOrg': {
        const name = String(body.name ?? '').trim();
        const kind = String(body.kind ?? '課');
        const parentId = body.parentId != null && body.parentId !== '' ? Number(body.parentId) : null;
        if (!name) return bad(res, '組織名を入力してください。');
        if (!ORG_KINDS.has(kind)) return bad(res, '種別が不正です(部/課/係)。');
        const rows = await sql`
          INSERT INTO organizations (name, kind, parent_id, sort)
          VALUES (${name}, ${kind}, ${parentId},
                  COALESCE((SELECT MAX(sort)+1 FROM organizations), 0)) RETURNING id`;
        return sendJson(res, 200, { ok: true, id: rows[0].id });
      }

      case 'updateOrg': {
        const id = Number(body.orgId);
        if (!Number.isInteger(id)) return bad(res, '組織が不正です。');
        const name = body.name != null ? String(body.name).trim() : null;
        await sql`UPDATE organizations SET name = COALESCE(${name}, name) WHERE id = ${id}`;
        return sendJson(res, 200, { ok: true });
      }

      case 'deleteOrg': {
        const id = Number(body.orgId);
        if (!Number.isInteger(id)) return bad(res, '組織が不正です。');
        const cnt = await sql`SELECT COUNT(*)::int AS n FROM members WHERE org_id = ${id}`;
        if (cnt[0].n > 0) return bad(res, 'この組織にメンバーがいます。先にメンバーを移動/削除してください。');
        await sql`DELETE FROM organizations WHERE id = ${id}`;
        return sendJson(res, 200, { ok: true });
      }

      default:
        return sendJson(res, 400, { ok: false, error: 'UNKNOWN_ACTION', message: `不明な操作です: ${action}` });
    }
  } catch (err) {
    console.error('POST /api/admin failed:', err);
    return sendJson(res, 500, { ok: false, error: 'SERVER_ERROR', message: String(err.message || err) });
  }
}

function bad(res, message) {
  return sendJson(res, 400, { ok: false, error: 'BAD_REQUEST', message });
}
function isDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
