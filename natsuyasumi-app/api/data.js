// GET /api/data — カレンダー描画に必要なデータを一括で返す。
// PIN ハッシュは返さない(pin_set フラグだけ返す)。
import { sql, hasDatabase } from '../lib/db.js';
import { sendJson, sendDbMissing } from '../lib/http.js';

export default async function handler(req, res) {
  if (!hasDatabase()) return sendDbMissing(res);

  try {
    const settings = await sql`SELECT * FROM settings WHERE id = 1`;
    if (settings.length === 0) {
      // テーブルはあるが初期化前
      return sendJson(res, 200, { ok: true, ready: false });
    }

    const [organizations, members, requests, events] = await Promise.all([
      sql`SELECT id, name, kind, parent_id, sort FROM organizations ORDER BY sort, id`,
      sql`SELECT id, org_id, name, role, sort, (pin_hash IS NOT NULL) AS pin_set
            FROM members ORDER BY sort, id`,
      sql`SELECT id, member_id, to_char(day, 'YYYY-MM-DD') AS day, status, memo
            FROM leave_requests`,
      sql`SELECT id, org_id, title,
                 to_char(start_date, 'YYYY-MM-DD') AS start_date,
                 to_char(end_date,   'YYYY-MM-DD') AS end_date
            FROM events ORDER BY start_date`,
    ]);

    const s = settings[0];
    return sendJson(res, 200, {
      ok: true,
      ready: true,
      settings: {
        year: s.year,
        periodStart: toISO(s.period_start),
        periodEnd: toISO(s.period_end),
        maxConfirmedDays: s.max_confirmed_days,
      },
      organizations,
      members,
      requests,
      events,
    });
  } catch (err) {
    // テーブル未作成(初回)などはセットアップ待ちとして扱う
    if (isMissingTable(err)) {
      return sendJson(res, 200, { ok: true, ready: false });
    }
    console.error('GET /api/data failed:', err);
    return sendJson(res, 500, { ok: false, error: 'SERVER_ERROR', message: String(err.message || err) });
  }
}

function isMissingTable(err) {
  const msg = String(err && err.message || err);
  return err?.code === '42P01' || /relation .* does not exist/i.test(msg);
}

function toISO(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return new Date(d).toISOString().slice(0, 10);
}
