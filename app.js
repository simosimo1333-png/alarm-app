const clockEl = document.getElementById('clock');
const alarmTimeEl = document.getElementById('alarm-time');
const setBtn = document.getElementById('set-btn');
const alarmList = document.getElementById('alarm-list');
const ringingEl = document.getElementById('ringing');
const stopBtn = document.getElementById('stop-btn');

let alarms = [];
let ringingAlarm = null;
let audioCtx = null;
let alarmNodes = [];

function pad(n) {
  return String(n).padStart(2, '0');
}

function getNow() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tick() {
  const d = new Date();
  clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const now = getNow();
  alarms.forEach(alarm => {
    if (!alarm.triggered && alarm.time === now) {
      alarm.triggered = true;
      startRinging();
    }
  });
}

function startRinging() {
  ringingEl.classList.remove('hidden');

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  playBeep();
}

function playBeep() {
  if (!audioCtx) return;
  const freqs = [880, 1100, 880, 1100];
  let t = audioCtx.currentTime;
  freqs.forEach(freq => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.3);
    alarmNodes.push(osc);
    t += 0.35;
  });

  ringingAlarm = setTimeout(playBeep, freqs.length * 350 + 400);
}

function stopRinging() {
  clearTimeout(ringingAlarm);
  alarmNodes.forEach(n => { try { n.stop(); } catch(e) {} });
  alarmNodes = [];
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  ringingEl.classList.add('hidden');
}

function renderAlarms() {
  alarmList.innerHTML = '';
  alarms.forEach((alarm, i) => {
    const item = document.createElement('div');
    item.className = 'alarm-item';
    item.innerHTML = `
      <span>${alarm.time}</span>
      <button class="delete-btn" data-i="${i}">🗑</button>
    `;
    alarmList.appendChild(item);
  });
}

setBtn.addEventListener('click', () => {
  const time = alarmTimeEl.value;
  if (!time) return;
  alarms.push({ time, triggered: false });
  alarmTimeEl.value = '';
  renderAlarms();
});

alarmList.addEventListener('click', e => {
  if (e.target.classList.contains('delete-btn')) {
    const i = Number(e.target.dataset.i);
    alarms.splice(i, 1);
    renderAlarms();
  }
});

stopBtn.addEventListener('click', stopRinging);

setInterval(tick, 1000);
tick();
