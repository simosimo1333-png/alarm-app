// logic.js の業務ルール検証。実行: node test/logic.test.mjs
import { aggregateDay, computeWarnings, remainingDays, eventsForDay } from '../assets/logic.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  NG  ', name); }
}
function eq(name, a, b) { check(`${name} (=${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b)); }

// 組織: 課A(1) / 課B(2)
const organizations = [
  { id: 1, name: '課A' },
  { id: 2, name: '課B' },
];
// メンバー
const members = [
  { id: 11, org_id: 1, name: 'A課長', role: '課長' },
  { id: 12, org_id: 1, name: 'A係長', role: '係長' },
  { id: 13, org_id: 1, name: 'A係員1', role: '係員' },
  { id: 14, org_id: 1, name: 'A係員2', role: '係員' },
  { id: 21, org_id: 2, name: 'B課長', role: '課長' },
  { id: 22, org_id: 2, name: 'B係長', role: '係長' },
  { id: 23, org_id: 2, name: 'B係員1', role: '係員' },
];
const req = (member_id, day, status = '◎', memo = '') => ({ member_id, day, status, memo });

console.log('■ 警告①: 同じ課で課長と係長が重なる → 警告');
eq('A課長+A係長',
  computeWarnings('2026-08-10', { organizations, members, requests: [req(11, '2026-08-10'), req(12, '2026-08-10')] }),
  ['課A: 課長と係長の休みが重なっています']);

console.log('■ 警告①: 課長だけ → 警告なし');
eq('A課長のみ',
  computeWarnings('2026-08-10', { organizations, members, requests: [req(11, '2026-08-10')] }), []);

console.log('■ 警告①: 課をまたぐ(A課長+B係長) → 警告なし(同一課内のみ)');
eq('A課長+B係長',
  computeWarnings('2026-08-10', { organizations, members, requests: [req(11, '2026-08-10'), req(22, '2026-08-10')] }), []);

console.log('■ 警告①: 候補△でも重なりは警告(候補含む)');
eq('A課長△+A係長△',
  computeWarnings('2026-08-10', { organizations, members, requests: [req(11, '2026-08-10', '△'), req(12, '2026-08-10', '△')] }),
  ['課A: 課長と係長の休みが重なっています']);

console.log('■ 警告②: 課Aの係員が全員(13,14)休み → 在席0警告');
eq('係員全員休み',
  computeWarnings('2026-08-11', { organizations, members, requests: [req(13, '2026-08-11'), req(14, '2026-08-11')] }),
  ['課A: 係員が全員休み希望です(在席0人)']);

console.log('■ 警告②: 係員の一部だけ(13のみ)休み → 警告なし');
eq('係員一部',
  computeWarnings('2026-08-11', { organizations, members, requests: [req(13, '2026-08-11')] }), []);

console.log('■ 警告②: 課長・係長は係員数に数えない(11,12休みでも係員は在席)');
eq('課長係長だけ休み→在席0にならない',
  computeWarnings('2026-08-12', { organizations, members, requests: [req(11, '2026-08-12'), req(12, '2026-08-12')] }),
  ['課A: 課長と係長の休みが重なっています']); // ①は出るが②は出ない

console.log('■ 警告: 両方同時(課長係長重複 かつ 係員全員)→ 2件');
eq('両方',
  computeWarnings('2026-08-13', { organizations, members, requests: [
    req(11, '2026-08-13'), req(12, '2026-08-13'), req(13, '2026-08-13'), req(14, '2026-08-13')] }),
  ['課A: 課長と係長の休みが重なっています', '課A: 係員が全員休み希望です(在席0人)']);

console.log('■ 集計: 状態別人数とフィルタ');
const aggData = { members, requests: [
  req(11, '2026-08-14', '確定'), req(12, '2026-08-14', '◎'), req(13, '2026-08-14', '○'), req(23, '2026-08-14', '△')] };
eq('全員フィルタの人数', aggregateDay('2026-08-14', aggData, 'all', null).counts, { '確定': 1, '◎': 1, '○': 1, '△': 1 });
eq('課Aフィルタの人数', aggregateDay('2026-08-14', aggData, 1, null).counts, { '確定': 1, '◎': 1, '○': 1, '△': 0 });
eq('mineフラグ(meId=13)', aggregateDay('2026-08-14', aggData, 'all', 13).mine, true);
eq('mineフラグ(meId=99)', aggregateDay('2026-08-14', aggData, 'all', 99).mine, false);

console.log('■ 残り日数: 確定だけを数える(候補は数えない)');
const remReq = [req(13, '2026-08-01', '確定'), req(13, '2026-08-02', '確定'), req(13, '2026-08-03', '◎'), req(13, '2026-08-04', '○')];
eq('確定2件 → 残り1', remainingDays(13, remReq, 3), { used: 2, left: 1, max: 3 });
eq('meId無し → null', remainingDays(null, remReq, 3), null);

console.log('■ 業務予定: 期間内は含む(境界含む)');
const events = [{ id: 1, title: 'A社締切', org_id: 1, start_date: '2026-08-05', end_date: '2026-08-07' }];
eq('開始日', eventsForDay('2026-08-05', events).length, 1);
eq('終了日', eventsForDay('2026-08-07', events).length, 1);
eq('範囲外', eventsForDay('2026-08-08', events).length, 0);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
