import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// コースごとのよじ登り必須ポイント: start=[x,y,z], ok(pos)=登頂判定, wall=AABB(透過検査用)
const COURSES = [
  { idx: 0, points: [
    { name: 'C1塀z56', start: [0, 0.7, 54.4], ok: p => p[2] > 56.1 && p[1] > 0.4 || (p[1] > 1.95 && p[2] > 55.6), wall: { min: [-9, 0, 55.75], max: [9, 1.45, 56.25] } },
    { name: 'C1石垣z74.6', start: [0, 0.7, 72.9], ok: p => (p[2] > 74.95 && p[1] > 0.4) || (p[1] > 1.95 && p[2] > 74.2), wall: { min: [-7, 0, 74.3], max: [7, 1.45, 74.9] } },
    { name: 'C1高台z91', start: [0, 0.7, 89.6], ok: p => p[2] > 91.2 && p[1] > 1.95, wall: { min: [-6, 0, 91], max: [6, 1.5, 95] } },
  ] },
  { idx: 1, points: [
    { name: 'C2コンテナz21', start: [0, 3.7, 18.5], ok: p => (p[1] > 4.9 && p[2] > 20) || (p[2] > 22.3 && p[1] > 3.3), wall: { min: [-3.5, 3.0, 19.8], max: [3.5, 4.5, 22.2] } },
    { name: 'C2コンテナz83.4', start: [0, 10.9, 80.9], ok: p => (p[1] > 12.1 && p[2] > 82.4) || (p[2] > 84.7 && p[1] > 10.4), wall: { min: [-3.5, 10.2, 82.2], max: [3.5, 11.7, 84.6] } },
    { name: 'C2ゴール高台z111.4', start: [0, 10.9, 110.0], ok: p => p[2] > 111.6 && p[1] > 12.1, wall: { min: [-3.5, 10.2, 111.4], max: [3.5, 11.7, 115.4] } },
  ] },
  { idx: 2, points: [
    { name: 'C3城壁z17.5', start: [0, 0.7, 15.7], ok: p => (p[2] > 18.0 && p[1] > 0.4) || (p[1] > 1.95 && p[2] > 17.1), wall: { min: [-8, 0, 17.05], max: [8, 1.5, 17.95] } },
    { name: 'C3基壇一段z103', start: [0, 4.9, 101.6], ok: p => p[1] > 6.0 && p[2] > 103.1, wall: { min: [-9, 4.2, 103.0], max: [9, 5.6, 106.2] } },
    { name: 'C3基壇二段z104.6', start: null /* 一段めの上から続行 */, ok: p => p[1] > 7.3 && p[2] > 104.7, wall: { min: [-9, 5.6, 104.6], max: [9, 6.9, 106.2] } },
    { name: 'C3くずれ壁z114.4', start: [0, 4.9, 112.9], ok: p => (p[2] > 114.9 && p[1] > 4.6) || (p[1] > 6.15 && p[2] > 114.1), wall: { min: [-8, 4.2, 114.0], max: [8, 5.7, 114.8] } },
  ] },
];

async function newGame(courseIdx, shots) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.errs = [];
  page.on('pageerror', e => page.errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') page.errs.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
  await page.waitForTimeout(1700);
  await page.evaluate((i) => document.querySelectorAll('#course-row button')[i].click(), courseIdx);
  await page.waitForTimeout(400);
  await page.click('#solo-btn');
  await page.waitForTimeout(2300);
  // テレポート(1ステップ>0.5m)・壁AABB侵入の計測フック
  await page.evaluate(() => {
    const d = window.__dbg.dolls.get(0);
    window.__tp = { maxStep: 0, inWall: 0, walls: [], skip: 0, steps: 0 };
    const origPlace = d.place.bind(d);
    d.place = (sky) => { window.__tp.skip = 3; return origPlace(sky); }; // リスポーンの正規テレポートは除外
    let px = null, py = 0, pz = 0;
    const orig = d.control.bind(d);
    d.control = function () {
      orig();
      window.__tp.steps++;
      const p = d.torso.position;
      if (window.__tp.skip > 0) { window.__tp.skip--; px = p.x; py = p.y; pz = p.z; return; }
      if (px !== null) {
        const dd = Math.hypot(p.x - px, p.y - py, p.z - pz);
        if (dd > window.__tp.maxStep) window.__tp.maxStep = dd;
      }
      px = p.x; py = p.y; pz = p.z;
      for (const w of window.__tp.walls) {
        if (p.x > w.min[0] + 0.05 && p.x < w.max[0] - 0.05
          && p.y > w.min[1] + 0.05 && p.y < w.max[1] - 0.05
          && p.z > w.min[2] + 0.05 && p.z < w.max[2] - 0.05) window.__tp.inWall++;
      }
    };
  });
  return page;
}

// よじ登りの文法を実行: 上を見て掴む→(必要ならジャンプ)→下を見て前進。移動入力ストレスつき
async function doClimb(page, pt, opts = {}) {
  await page.evaluate((w) => { window.__tp.walls = [w]; }, pt.wall);
  if (pt.start) {
    await page.evaluate((s) => { window.__tp.skip = 3; window.__dbg.tp(...s); window.__dbg.setYaw(Math.PI); }, pt.start);
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => {
    window.__dbg.setYaw(Math.PI);
    window.__dbg.setPitch(-0.35);
    window.__dbg.setGrab(true);
    window.__dbg.pressKey('KeyW');
  });
  let grabbed = false;
  for (let i = 0; i < 20 && !grabbed; i++) {
    if (i % 5 === 2) await page.evaluate(() => window.__dbg.jump());
    await page.waitForTimeout(300);
    grabbed = await page.evaluate(() => window.__dbg.dolls.get(0).sides.some(s => s.grabC && s.grabC.bodyB.type !== 1));
  }
  const steps0 = await page.evaluate(() => { window.__dbg.setPitch(0.9); return window.__tp.steps; }); // 下を見て前進 → よじ上がり開始
  let ok = false, pos = null, stepsEnd = 0;
  for (let i = 0; i < 34 && !ok; i++) {
    // 移動入力ストレス: 前進しながら左右キーもまぜる（瞬間移動の再現条件）
    if (opts.stress && i % 3 === 1) await page.evaluate((k) => { window.__dbg.pressKey(k); }, i % 6 === 1 ? 'KeyA' : 'KeyD');
    if (opts.stress && i % 3 === 2) await page.evaluate(() => { window.__dbg.releaseKey('KeyA'); window.__dbg.releaseKey('KeyD'); });
    if (opts.shots && i < 8 && i % 2 === 0) await page.screenshot({ path: `${SCRATCH}/climb-smooth-${i / 2 + 1}.png` });
    await page.waitForTimeout(320);
    pos = await page.evaluate(() => window.__dbg.pos());
    ok = pt.ok(pos);
    if (ok) stepsEnd = await page.evaluate(() => window.__tp.steps);
  }
  await page.evaluate(() => {
    window.__dbg.releaseKey('KeyW'); window.__dbg.releaseKey('KeyA'); window.__dbg.releaseKey('KeyD');
    window.__dbg.setGrab(false); window.__dbg.setPitch(0.22);
  });
  await page.waitForTimeout(500);
  const tp = await page.evaluate(() => ({ maxStep: window.__tp.maxStep, inWall: window.__tp.inWall }));
  await page.evaluate(() => { window.__tp.maxStep = 0; window.__tp.inWall = 0; });
  const pass = ok && grabbed && tp.maxStep < 0.5 && tp.inWall === 0;
  const dur = ok ? ((stepsEnd - steps0) / 60).toFixed(1) : '-';
  console.log(`${pt.name}: grabbed=${grabbed} topped=${ok} climbTime=${dur}s pos=${JSON.stringify(pos?.map(n => +n.toFixed(2)))} maxStep=${tp.maxStep.toFixed(3)}m inWall=${tp.inWall} ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

let all = true;
for (const c of COURSES) {
  const page = await newGame(c.idx);
  for (let i = 0; i < c.points.length; i++) {
    const pt = c.points[i];
    const stress = c.idx === 0; // コース1は移動入力ストレスつきで再現条件を兼ねる
    const shots = c.idx === 0 && i === 0;
    all = (await doClimb(page, pt, { stress, shots })) && all;
  }
  console.log(`course${c.idx} errors=${page.errs.length}`);
  page.errs.forEach(e => console.log('  ' + e));
  all = all && page.errs.length === 0;
  await page.close();
}
console.log(`=== CLIMB9 ${all ? 'ALL PASS' : 'SOME FAIL'} ===`);
await browser.close();
