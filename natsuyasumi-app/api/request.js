// POST /api/request — 本人の休み希望を1件登録/変更/削除する。
// body: { memberId, pin, day: "YYYY-MM-DD", status: "◎"|"○"|"△"|"確定"|"none", memo? }
// PIN を照合し、本人の希望だけを更新できる。「確定」は合計上限日数まで。
import { sql, hasDatabase } from '../lib/db.js';
import { verifyPin } from '../lib/auth.js';
import { readJsonBody, sendJson, sendDbMissing } from '../lib/http.js';

const VALID_STATUS = new Set(['◎', '○', '△', '確定']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  if (!hasDatabase()) return sendDbMissing(res);

  const body = await readJsonBody(req);
  const memberId = Number(body.memberId);
  const pin = String(body.pin ?? '');
  const day = String(body.day ?? '');
  const status = String(body.status ?? '');
  const memo = String(body.memo ?? '').slice(0, 200);

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return sendJson(res, 400, { ok: false, error: 'BAD_REQUEST', message: 'メンバーが不正です。' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return sendJson(res, 400, { ok: false, error: 'BAD_REQUEST', message: '日付が不正です。' });
  }
  const isDelete = status === 'none' || status === '';
  if (!isDelete && !VALID_STATUS.has(status)) {
    return sendJson(res, 400, { ok: false, error: 'BAD_REQUEST', message: '状態が不正です。' });
  }

  try {
    const members = await sql`SELECT id, name, pin_hash FROM members WHERE id = ${memberId}`;
    const member = members[0];
    if (!member) {
      return sendJson(res, 404, { ok: false, error: 'NOT_FOUND', message: 'メンバーが見つかりません。' });
    }
    if (!member.pin_hash) {
      return sendJson(res, 403, { ok: false, error: 'PIN_NOT_SET', message: 'このメンバーはPIN未設定です。管理画面で設定してください。' });
    }
    if (!verifyPin(pin, member.pin_hash)) {
      return sendJson(res, 401, { ok: false, error: 'PIN_MISMATCH', message: 'PINが違います。' });
    }

    // 対象期間内かチェック
    const s = (await sql`SELECT period_start, period_end, max_confirmed_days FROM settings WHERE id = 1`)[0];
    if (s) {
      const start = toISO(s.period_start), end = toISO(s.period_end);
      if (day < start || day > end) {
        return sendJson(res, 400, { ok: false, error: 'OUT_OF_PERIOD', message: `対象期間(${start}〜${end})の外です。` });
      }
    }
    const maxDays = s ? s.max_confirmed_days : 3;

    if (isDelete) {
      await sql`DELETE FROM leave_requests WHERE member_id = ${memberId} AND day = ${day}`;
      return sendJson(res, 200, { ok: true, deleted: true });
    }

    // 「確定」にする場合、上限チェック(この日を除いた確定件数 + 1 <= 上限)
    if (status === '確定') {
      const cnt = await sql`
        SELECT COUNT(*)::int AS n FROM leave_requests
        WHERE member_id = ${memberId} AND status = '確定' AND day <> ${day}`;
      if (cnt[0].n + 1 > maxDays) {
        return sendJson(res, 409, {
          ok: false, error: 'LIMIT_EXCEEDED',
          message: `確定できる休みは${maxDays}日までです(現在 ${cnt[0].n} 日確定済み)。`,
        });
      }
    }

    await sql`
      INSERT INTO leave_requests (member_id, day, status, memo)
      VALUES (${memberId}, ${day}, ${status}, ${memo})
      ON CONFLICT (member_id, day)
      DO UPDATE SET status = EXCLUDED.status, memo = EXCLUDED.memo`;

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('POST /api/request failed:', err);
    return sendJson(res, 500, { ok: false, error: 'SERVER_ERROR', message: String(err.message || err) });
  }
}

function toISO(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}
