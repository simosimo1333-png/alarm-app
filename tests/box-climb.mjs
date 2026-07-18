import { chromium } from 'playwright';
const SCRATCH = '/tmp/claude-0/-home-user-alarm-app/7a4abfc4-78e7-58ed-a646-22083753c0a0/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// 箱庭レイアウトの よじ登り必須ポイント: start=手前 / yaw=壁へ向く向き / ok(p)=突破判定
const PI = Math.PI;
const POINTS = {
  0: [
    { name: 'niwa-hei(1.45m)', start: [17.0, 0.75, 38], yaw: -PI / 2, ok: p => p[0] > 19.4 },
    { name: 'ishigaki(1.45m)', start: [35.6, 0.75, 31.6], yaw: -PI / 2, ok: p => p[0] > 38.2 },
    { name: 'takadai(1.5m)', start: [55, 0.65, 36.9], yaw: PI, ok: p => p[2] > 38.8 && p[1] > 1.8 },
  ],
  1: [
    { name: 'container1(1.5m)', start: [0, 3.75, 18.5], yaw: PI, ok: p => p[2] > 22.4 && p[1] > 3.3 },
    { name: 'container2(1.5m)', start: [24.6, 10.8, -10.6], yaw: 0, ok: p => p[2] < -13.4 && p[1] > 10.9 },
    { name: 'goal-takadai(1.5m)', start: [-1.5, 10.8, -13], yaw: PI / 2, ok: p => p[0] < -3.4 && p[1] > 12.0 },
  ],
  2: [
    { name: 'kuzure-jouheki(1.5m)', start: [0, 0.75, 15.6], yaw: PI, ok: p => p[2] > 18.6 },
    { name: 'kidan-2dan(1.5+1.3m)', start: [51.8, 4.9, 55], yaw: -PI / 2, ok: p => p[0] > 56.4 && p[1] > 4.3, mid: p => p[1] > 6.0 && p[0] > 53.4 },
    { name: 'tou-kuzurekabe(1.5m)', start: [56, 4.8, 40.8], yaw: 0, ok: p => p[2] < 38.3 && p[1] > 4.3 },
  ],
};

for (let course = 0; course < 3; course++) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto('http://127.0.0.1:8899/fallflat.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate((c) => document.querySelectorAll('#course-row button')[c].click(), course);
  await page.waitForTimeout(500);
  await page.click('#solo-btn');
  await page.waitForTimeout(2000);

  for (let pi = 0; pi < POINTS[course].length; pi++) {
    const pt = POINTS[course][pi];

    // ---- (a) ジャンプだけでは越えられない ----
    await page.evaluate(([s, yw]) => {
      const d = window.__dbg.dolls.get(0);
      d.limpUntil = 0; d.staggerUntil = 0;
      window.__dbg.tp(...s); window.__dbg.setYaw(yw); window.__dbg.setPitch(0.2); window.__dbg.setGrab(false);
    }, [pt.start, pt.yaw]);
    await page.waitForTimeout(400);
    await page.keyboard.down('w');
    let jumped = false;
    for (let i = 0; i < 10 && !jumped; i++) {
      if (i % 2 === 0) await page.evaluate(() => window.__dbg.jump());
      await page.waitForTimeout(450);
      const p = await page.evaluate(() => window.__dbg.pos());
      jumped = pt.ok(p);
      if (p[1] < pt.start[1] - 2.5) {
        await page.evaluate(([s, yw]) => { window.__dbg.tp(...s); window.__dbg.setYaw(yw); }, [pt.start, pt.yaw]);
      }
    }
    await page.keyboard.up('w');
    const jumpBlocked = !jumped;

    // ---- (b) つかんでよじ登れる（上を見て掴む → 下を見て前進） ----
    let climbed = false, everGrabbed = false;
    for (let att = 0; att < 6 && !climbed; att++) {
      await page.evaluate(([s, yw]) => {
        const d = window.__dbg.dolls.get(0);
        d.limpUntil = 0; d.staggerUntil = 0;
        window.__dbg.tp(...s);
        window.__dbg.setYaw(yw);
        window.__dbg.setPitch(-0.45);
        window.__dbg.setGrab(true);
      }, [pt.start, pt.yaw]);
      await page.waitForTimeout(500);
      await page.keyboard.down('w');
      await page.waitForTimeout(350);
      await page.evaluate(() => window.__dbg.jump());
      await page.waitForTimeout(700);
      await page.evaluate(() => window.__dbg.setPitch(0.9));
      let cycled = false;
      for (let i = 0; i < 18 && !climbed; i++) {
        await page.waitForTimeout(350);
        const st = await page.evaluate(() => {
          const d = window.__dbg.dolls.get(0);
          return { p: window.__dbg.pos(), g: d.sides.some(s => !!s.grabC) };
        });
        if (st.g) everGrabbed = true;
        climbed = pt.ok(st.p);
        if (!climbed && pt.mid && !cycled && pt.mid(st.p)) {
          cycled = true;
          await page.evaluate(() => { window.__dbg.setPitch(-0.45); window.__dbg.setGrab(true); });
          await page.waitForTimeout(450);
          await page.evaluate(() => window.__dbg.jump());
          await page.waitForTimeout(650);
          await page.evaluate(() => window.__dbg.setPitch(0.9));
        }
        if (st.p[1] < pt.start[1] - 2.5) break;
      }
      await page.keyboard.up('w');
      await page.evaluate(() => window.__dbg.setGrab(false));
      await page.waitForTimeout(200);
    }
    if (climbed) await page.screenshot({ path: `${SCRATCH}/box-climb-c${course + 1}-${pi + 1}.png` });
    console.log(`C${course + 1} ${pt.name}: jump-blocked=${jumpBlocked} climb=${climbed} grabbed=${everGrabbed}`,
      (jumpBlocked && climbed) ? 'PASS' : 'FAIL');
  }
  console.log(`C${course + 1} errors:`, errs.length);
  errs.slice(0, 4).forEach(e => console.log('  ', e));
  await page.close();
}
await browser.close();
console.log('DONE');
