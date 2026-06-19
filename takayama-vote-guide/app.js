/* =====================================================================
 * 高山市長選挙 投票マッチング — アプリ本体
 * QUESTIONS / CANDIDATES は data.js で定義
 * ===================================================================== */
(function () {
  "use strict";

  // 5段階の選択肢（value は -2〜+2）
  const SCALE = [
    { value: 2, label: "賛成" },
    { value: 1, label: "どちらかといえば賛成" },
    { value: 0, label: "どちらともいえない" },
    { value: -1, label: "どちらかといえば反対" },
    { value: -2, label: "反対" },
  ];

  // 回答状態: answers[questionId] = { value: number|null, important: bool, skipped: bool }
  const answers = {};
  QUESTIONS.forEach((q) => {
    answers[q.id] = { value: null, important: false, skipped: false };
  });

  let current = 0; // 現在の設問インデックス

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const screens = {
    intro: $("screen-intro"),
    quiz: $("screen-quiz"),
    result: $("screen-result"),
  };

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // サンプルデータ警告は、実データに差し替えたら data.js 側でフラグ管理してもよい
  // ---- 設問描画 ----
  function renderQuestion() {
    const q = QUESTIONS[current];
    const a = answers[q.id];

    $("qCategory").textContent = q.category;
    $("qText").textContent = q.text;
    $("qDetail").textContent = q.detail || "";

    $("progressTotal").textContent = QUESTIONS.length;
    $("progressNum").textContent = current + 1;
    $("progressFill").style.width =
      ((current) / QUESTIONS.length) * 100 + "%";

    // 選択肢
    const opts = $("options");
    opts.innerHTML = "";
    SCALE.forEach((s) => {
      const btn = document.createElement("button");
      btn.className = "opt" + (a.value === s.value && !a.skipped ? " selected" : "");
      btn.innerHTML = `<span class="dot"></span><span>${s.label}</span>`;
      btn.addEventListener("click", () => {
        a.value = s.value;
        a.skipped = false;
        renderQuestion();
        // 少し待ってから自動で次へ
        setTimeout(next, 180);
      });
      opts.appendChild(btn);
    });

    // 重視チェック
    $("importanceChk").checked = a.important;

    // 前へボタンの無効化
    $("prevBtn").disabled = current === 0;
    $("prevBtn").style.visibility = current === 0 ? "hidden" : "visible";
  }

  function next() {
    if (current < QUESTIONS.length - 1) {
      current++;
      renderQuestion();
    } else {
      showResult();
    }
  }

  function prev() {
    if (current > 0) {
      current--;
      renderQuestion();
    }
  }

  function skip() {
    const a = answers[QUESTIONS[current].id];
    a.skipped = true;
    a.value = null;
    next();
  }

  // ---- マッチング計算 ----
  // 各候補ごとに、回答済み設問について「一致度(0〜1)」を重み付き平均
  function computeScores() {
    return CANDIDATES.map((cand) => {
      let weightedSum = 0;
      let weightTotal = 0;
      let answered = 0;
      QUESTIONS.forEach((q) => {
        const a = answers[q.id];
        if (a.skipped || a.value === null) return;
        answered++;
        const cStance = q.id in cand.stances ? cand.stances[q.id] : 0;
        // 距離 0〜4 → 一致度 1〜0
        const agreement = 1 - Math.abs(a.value - cStance) / 4;
        const weight = a.important ? 2 : 1;
        weightedSum += agreement * weight;
        weightTotal += weight;
      });
      const pct = weightTotal === 0 ? 0 : Math.round((weightedSum / weightTotal) * 100);
      return { cand, pct, answered };
    }).sort((x, y) => y.pct - x.pct);
  }

  // ---- 結果描画 ----
  function showResult() {
    $("progressFill").style.width = "100%";
    const scores = computeScores();
    const answeredCount = scores.length ? scores[0].answered : 0;

    const list = $("resultList");
    list.innerHTML = "";

    if (answeredCount === 0) {
      list.innerHTML =
        '<p>回答が記録されていません。少なくとも1問にお答えください。</p>';
    } else {
      scores.forEach((s, i) => {
        const item = document.createElement("div");
        item.className = "result-item" + (i === 0 ? " top" : "");
        item.innerHTML = `
          <span class="result-rank">${i + 1}位</span>
          <div class="result-head">
            <h3 class="result-name" style="color:${s.cand.color}">${s.cand.name}</h3>
            <span class="match-pct" style="color:${s.cand.color}">${s.pct}<small>%</small></span>
          </div>
          <div class="result-catch">${s.cand.catchphrase || ""}</div>
          <div class="match-bar"><span style="width:${s.pct}%;background:${s.cand.color}"></span></div>
          <p class="result-summary">${s.cand.summary || ""}</p>
        `;
        list.appendChild(item);
      });
    }

    renderDetailTable(scores);
    show("result");
  }

  // 質問ごとの比較表
  function renderDetailTable(scores) {
    const wrap = $("detailTable");
    const labelOf = (v) => {
      if (v === null) return "—";
      const f = SCALE.find((s) => s.value === v);
      return f ? f.label : String(v);
    };
    const cellClass = (you, cand) => {
      if (you === null) return "";
      const d = Math.abs(you - cand);
      if (d <= 1) return "cell-agree";
      if (d <= 2) return "cell-mid";
      return "cell-disagree";
    };

    let html = '<table class="detail"><thead><tr><th class="q">質問</th><th class="you">あなた</th>';
    scores.forEach((s) => {
      html += `<th style="color:${s.cand.color}">${s.cand.name.replace("（サンプル）", "")}</th>`;
    });
    html += "</tr></thead><tbody>";

    QUESTIONS.forEach((q) => {
      const a = answers[q.id];
      const you = a.skipped ? null : a.value;
      html += `<tr><th class="q">${q.text}${a.important ? " ★" : ""}</th>`;
      html += `<td class="you">${a.skipped ? "スキップ" : labelOf(you)}</td>`;
      scores.forEach((s) => {
        const c = q.id in s.cand.stances ? s.cand.stances[q.id] : 0;
        html += `<td class="${cellClass(you, c)}">${labelOf(c)}</td>`;
      });
      html += "</tr>";
    });
    html += "</tbody></table>";
    wrap.innerHTML = html;
  }

  // ---- 結果コピー ----
  function copyResult() {
    const scores = computeScores();
    const lines = ["【高山市長選挙 投票マッチング 結果（サンプルデータ）】"];
    scores.forEach((s, i) => {
      lines.push(`${i + 1}位 ${s.cand.name} … ${s.pct}%`);
    });
    lines.push("※考え方の近さの目安です。投票は公式情報をご確認のうえご自身で。");
    const text = lines.join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => alert("結果をコピーしました。"))
      .catch(() => alert(text));
  }

  function restart() {
    QUESTIONS.forEach((q) => {
      answers[q.id] = { value: null, important: false, skipped: false };
    });
    current = 0;
    renderQuestion();
    show("quiz");
  }

  // ---- イベント ----
  $("startBtn").addEventListener("click", () => {
    renderQuestion();
    show("quiz");
  });
  $("prevBtn").addEventListener("click", prev);
  $("skipBtn").addEventListener("click", skip);
  $("importanceChk").addEventListener("change", (e) => {
    answers[QUESTIONS[current].id].important = e.target.checked;
  });
  $("restartBtn").addEventListener("click", restart);
  $("shareBtn").addEventListener("click", copyResult);

  // 初期表示
  show("intro");
})();
