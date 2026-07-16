// 業務ルールの純粋関数(DOM非依存)。画面(app.js)とテストの両方から使う。

export const STATUS_ORDER = ['確定', '◎', '○', '△'];

// その日の状態別人数と、自分が入れているかを集計。
// filterOrg: 'all' | orgId、meId: number|null
export function aggregateDay(day, { members, requests }, filterOrg, meId) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const counts = { '確定': 0, '◎': 0, '○': 0, '△': 0 };
  let mine = false;
  for (const r of requests) {
    if (r.day !== day) continue;
    const m = byId.get(r.member_id);
    if (!m) continue;
    if (filterOrg !== 'all' && m.org_id !== Number(filterOrg)) continue;
    if (counts[r.status] != null) counts[r.status]++;
    if (meId && r.member_id === meId) mine = true;
  }
  return { counts, mine };
}

// その日の警告(課ごとに判定)。文字列配列で返す。
// ルール:
//  ① 同じ課で「課長」と「係長」の両方に、その日の休み希望(候補含む)がある
//  ② 同じ課で「係員」が全員、その日の休み希望(候補含む)がある(在席0人)
export function computeWarnings(day, { organizations, members, requests }) {
  const warns = [];
  const reqSet = new Set(requests.filter((r) => r.day === day).map((r) => r.member_id));
  const has = (id) => reqSet.has(id);

  const byOrg = new Map();
  for (const m of members) {
    if (!byOrg.has(m.org_id)) byOrg.set(m.org_id, []);
    byOrg.get(m.org_id).push(m);
  }

  for (const o of organizations) {
    const mem = byOrg.get(o.id) || [];
    if (!mem.length) continue;

    const kacho = mem.some((m) => m.role === '課長' && has(m.id));
    const kakari = mem.some((m) => m.role === '係長' && has(m.id));
    if (kacho && kakari) warns.push(`${o.name}: 課長と係長の休みが重なっています`);

    const staff = mem.filter((m) => m.role === '係員');
    if (staff.length && staff.every((m) => has(m.id))) {
      warns.push(`${o.name}: 係員が全員休み希望です(在席0人)`);
    }
  }
  return warns;
}

// 残り日数(確定した休みだけを数える)
export function remainingDays(meId, requests, maxConfirmedDays) {
  if (!meId) return null;
  const used = requests.filter((r) => r.member_id === meId && r.status === '確定').length;
  return { used, left: maxConfirmedDays - used, max: maxConfirmedDays };
}

// その日にかかる業務予定
export function eventsForDay(day, events) {
  return events.filter((e) => day >= e.start_date && day <= e.end_date);
}
