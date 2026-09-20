/* app.js — 主控制器：大厅 / 人机 / 联机 / 残局闯关四场景
 */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const XQ = root.XQ, FX = root.FX, SFX = root.SFX, Stats = root.Stats;

  /* ---------- 全局状态 ---------- */
  const G = {
    mode: 'lobby',          // lobby | pve | pvp | endgame
    st: XQ.stateFromFEN(XQ.START_FEN),
    mySeat: 1,              // 1红 -1黑（人机模式下我的执子）
    aiSeat: -1,
    aiLevel: 2,
    egLevel: 1,             // 残局关卡 id
    notations: [],
    offlineLog: [],        // 线下模式逐着记录（着法/吃子/将军/FEN 快照）
    offlineFinalFEN: null,
    over: false,
    result: null,
    lastMove: null,
    net: null,              // Net 实例
    netRoom: null,
    myName: localStorage.getItem('xq-name') || '',
    thinkToken: 0,          // 作废中的 AI 计算
    suggestToken: 0,        // 作废中的线下支招计算
    pendingConfirm: null,   // 'draw' | 'undo'
    clocks: { red: 900000, black: 900000 },
    clockTimer: null,
    clockWarned: false,
  };

  const board = new Board($('board'));

  /* 手机/窄屏：棋盘整体缩放（点击坐标按缩放后的 rect 归一化，天然兼容） */
  function fitBoard() {
    const wrap = document.getElementById('board-wrap');
    const scaleEl = document.getElementById('board-scale');
    if (!wrap || !scaleEl) return;
    if (window.innerWidth < 660) {
      const s = Math.min(1, (window.innerWidth - 14) / 608);
      scaleEl.style.transform = 'scale(' + s + ')';
      scaleEl.style.transformOrigin = 'top left';
      wrap.style.width = Math.round(608 * s) + 'px';
      wrap.style.height = Math.round(700 * s) + 'px';
    } else {
      scaleEl.style.transform = '';
      wrap.style.width = '';
      wrap.style.height = '';
    }
  }
  window.addEventListener('resize', fitBoard);
  window.addEventListener('orientationchange', fitBoard);

  /* ---------- 工具 ---------- */
  function showScene(name) {
    document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
    $(name === 'lobby' ? 'scene-lobby' : 'scene-game').classList.add('active');
    $('btn-back').style.display = name === 'lobby' ? 'none' : '';
    setTimeout(fitBoard, 0);
    $('mode-tag').textContent = name === 'lobby' ? '大厅' : (G.mode === 'pve' ? '人机对战' : G.mode === 'endgame' ? '残局闯关' : G.mode === 'offline' ? '线下对战' : '局域网联机');
  }

  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  function setPlayerCards() {
    // 我在下方：显示我的执子
    const myRed = G.mySeat === 1;
    $('me-card').className = 'panel player-card ' + (myRed ? 'red' : 'black');
    $('me-avatar').textContent = myRed ? '帅' : '将';
    $('opp-card').className = 'panel player-card ' + (myRed ? 'black' : 'red');
    $('opp-avatar').textContent = myRed ? '将' : '帅';
  }

  function updatePlayerInfo() {
    if (G.mode === 'pve' || G.mode === 'endgame') {
      const lvName = Engine.LEVELS[G.aiLevel].name;
      $('me-name').textContent = '你' + (G.mySeat === 1 ? '（红）' : '（黑）');
      $('me-sub').textContent = '执' + (G.mySeat === 1 ? '红先行' : '黑后行');
      $('opp-name').textContent = 'AI · ' + lvName;
      $('opp-sub').textContent = '棋力：' + '★'.repeat(G.aiLevel) + '☆'.repeat(5 - G.aiLevel);
      $('me-clock').textContent = '∞';
      $('opp-clock').textContent = '∞';
    } else if (G.mode === 'offline') {
      $('me-name').textContent = '你' + (G.mySeat === 1 ? '（红）' : '（黑）');
      $('me-sub').textContent = '执' + (G.mySeat === 1 ? '红先行' : '黑后行') + ' · AI 全力支招';
      $('opp-name').textContent = '线下对手';
      $('opp-sub').textContent = '真实棋友 · 录入其着法';
      $('me-clock').textContent = '∞';
      $('opp-clock').textContent = '∞';
    } else if (G.mode === 'pvp') {
      $('me-name').textContent = (G.myName || '你') + (G.mySeat === 1 ? '（红）' : '（黑）');
    }
  }

  function renderNotation() {
    const el = $('notation');
    if (!G.notations.length) { el.innerHTML = '<div class="no-move">对局尚未开始</div>'; return; }
    let html = '';
    for (let i = 0; i < G.notations.length; i += 2) {
      const n = i / 2 + 1;
      const red = G.notations[i], black = G.notations[i + 1] || '';
      const isLastRed = i === G.notations.length - 1;
      const isLastBlack = i + 1 === G.notations.length - 1;
      html += `<span class="mv${isLastRed ? ' last' : ''}">${n}. ${red}</span>` +
        (black ? `<span class="mv${isLastBlack ? ' last' : ''}">${black}</span>` : '');
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }

  function refreshClocks() {
    const myRed = G.mySeat === 1;
    const meC = myRed ? G.clocks.red : G.clocks.black;
    const opC = myRed ? G.clocks.black : G.clocks.red;
    const noClock = G.mode === 'pve' || G.mode === 'endgame' || G.mode === 'offline';
    $('me-clock').textContent = noClock ? '∞' : fmtClock(meC);
    $('opp-clock').textContent = noClock ? '∞' : fmtClock(opC);
    $('me-clock').classList.toggle('low', G.mode === 'pvp' && meC < 30000);
    $('opp-clock').classList.toggle('low', G.mode === 'pvp' && opC < 30000);
    const turnRed = G.st.turn === 1;
    $('me-clock').classList.toggle('active', (turnRed === myRed) && !G.over);
    $('opp-clock').classList.toggle('active', (turnRed !== myRed) && !G.over);
  }

  function redraw(moveOpts) {
    const checkSq = XQ.inCheck(G.st, G.st.turn)
      ? (G.st.turn === 1 ? G.st.kings[0] : G.st.kings[1]) : null;
    board.setState(G.st, Object.assign({
      flipped: G.mySeat === -1,
      checkSquare: checkSq,
      lastMove: G.lastMove,
    }, moveOpts || {}));
  }

  /* ---------- 对局流程 ---------- */
  function resetGame() {
    G.st = XQ.stateFromFEN(XQ.START_FEN);
    G.notations = [];
    G.over = false; G.result = null; G.lastMove = null; G.mateType = null;
    G.clocks = { red: 900000, black: 900000 };
    G.clockWarned = false;
    FX.clear();
    ['btn-undo', 'btn-resign', 'btn-draw'].forEach(id => $(id).disabled = false);
    $('ai-thinking').classList.remove('on');
    hideConfirm();
    redraw();
    renderNotation();
    refreshClocks();
    maybeAI();
  }

  /* 走一步（本地状态 + UI 反馈）。返回是否成功 */
  function applyMove(from, to, opts) {
    opts = opts || {};
    const m = XQ.encode(from, to);
    const legal = XQ.legalMoves(G.st);
    if (!legal.includes(m)) return false;
    const notation = XQ.moveToChinese(G.st, m);
    const cap = G.st.board[to];
    const mover = (G.st.turn === G.mySeat) ? 'me' : 'opp';
    const fenBefore = (G.mode === 'offline') ? XQ.toFEN(G.st) : null;
    const pieceChar = (G.mode === 'offline') ? XQ.pieceChar(G.st.board[from]) : '';
    XQ.make(G.st, m);
    G.notations.push(notation);
    G.lastMove = { from, to };

    const st1 = XQ.status(G.st);
    const checked = st1.over ? false : XQ.inCheck(G.st, G.st.turn);
    if (G.mode === 'offline') {
      G.offlineLog.push({
        ply: G.notations.length, mover, notation, fenBefore, from, to,
        cap: cap || 0, piece: pieceChar, checked: !!checked,
      });
    }
    redraw({ animate: true, captured: cap });

    // 音效与特效
    const toXY = board.xy(to);
    FX.ripple(toXY);
    if (cap !== 0) setTimeout(() => FX.slash(board.xy(to)), 130);
    SFX.S.drop();
    if (cap !== 0) setTimeout(() => SFX.S.capture(), 140);
    if (st1.over) {
      finishGame(st1.winner, st1.reason, st1.reason === 'checkmate' ? XQ.detectMateType(G.st) : null);
    } else if (checked) {
      setTimeout(() => { FX.banner('将军！', { cls: 'check' }); SFX.S.check(); }, 260);
    }
    renderNotation();
    refreshClocks();
    return true;
  }

  function finishGame(winner, reason, mateType) {
    if (G.over && G.result) return;   // 防重复结算
    G.over = true;
    G.result = { winner, reason };
    G.mateType = mateType || null;
    if (G.mode === 'offline') G.offlineFinalFEN = XQ.toFEN(G.st);
    // 结束后更新界面状态：禁用操作、房间提示、系统消息
    ['btn-undo', 'btn-resign', 'btn-draw'].forEach(id => $(id).disabled = true);
    $('room-code-hint').textContent = '对局已结束';
    $('opp-sub').textContent = '对局结束';
    $('me-sub').textContent = '对局结束';
    const myWin = winner === G.mySeat;

    // 战绩统计
    try {
      if (G.mode === 'pve') Stats.recordPve(G.myName, G.aiLevel, myWin);
      else if (G.mode === 'pvp') Stats.recordPvp(G.myName, myWin ? 'win' : (winner === 0 ? 'draw' : 'lose'));
      else if (G.mode === 'endgame') Stats.recordEndgame(G.myName, G.egLevel, myWin);
    } catch (e) {}

    // 结算面板操作按钮
    const buttons = [];
    if (G.mode === 'pvp') {
      buttons.push({
        text: '⚔ 再来一局', primary: true,
        onClick: () => {
          SFX.S.click();
          if (G.net && G.net.connected) {
            G.net.send({ t: 'rematch' });
            chatSys('已请求再来一局，等待对方确认…');
          }
        },
      });
    } else if (G.mode === 'endgame') {
      buttons.push({
        text: '🔁 重试本关', primary: true,
        onClick: () => { SFX.S.click(); startEndgame(G.egLevel); },
      });
      const next = G.egLevel + 1;
      if (myWin && root.ENDGAMES.get(next)) {
        buttons.push({
          text: '➡ 下一关', primary: true,
          onClick: () => { SFX.S.click(); startEndgame(next); },
        });
      }
    } else if (G.mode === 'offline') {
      buttons.unshift({
        text: '📊 复盘分析', primary: true,
        onClick: () => { SFX.S.click(); offlineReview(); },
      });
      buttons.push({
        text: '⚔ 再来一局', primary: true,
        onClick: () => { SFX.S.click(); startOffline(G.mySeat); },
      });
    } else {
      buttons.push({
        text: '⚔ 再来一局', primary: true,
        onClick: () => { SFX.S.click(); resetGame(); },
      });
    }
    buttons.push({
      text: '🏠 返回大厅',
      onClick: () => { SFX.S.click(); $('btn-back').click(); },
    });

    setTimeout(() => {
      if (reason === 'checkmate') {
        // 绝杀全屏演出（按杀法分类：重炮！！/ 马后炮！！…）
        SFX.S.mate();
        FX.mate(winner, mateType);
        if (mateType) FX.banner(mateType + '！！', { cls: 'check', hold: 1400 });
        setTimeout(() => FX.result(winner, reason, mateType, buttons), 2000);
        setTimeout(() => (myWin ? SFX.S.win() : SFX.S.lose()), 2000);
      } else {
        FX.result(winner, reason, null, buttons);
        if (reason === 'stalemate') FX.banner('困毙', { hold: 1200 });
        myWin ? SFX.S.win() : SFX.S.lose();
      }
    }, 450);
    refreshClocks();
  }

  /* ---------- 人机 ---------- */
  function aiWorkerCall(state, level, timeMs, maxDepth, useBook) {
    return new Promise((resolve, reject) => {
      const w = new Worker('/js/engine-worker.js');
      const token = ++G.thinkToken;   // 每次调用都取新号
      w.onmessage = (e) => {
        w.terminate();
        e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error));
      };
      w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'AI 出错')); };
      w.postMessage({ fen: XQ.toFEN(state), level, id: token, timeMs: timeMs || undefined, noBook: !useBook, maxDepth: maxDepth || undefined });
    });
  }

  async function maybeAI() {
    if ((G.mode !== 'pve' && G.mode !== 'endgame') || G.over) return;
    if (G.st.turn !== G.aiSeat) return;
    $('ai-thinking').classList.add('on');
    board.locked = true;
    try {
      const r = await aiWorkerCall(G.st, G.aiLevel);
      if ((G.mode !== 'pve' && G.mode !== 'endgame') || G.over || G.st.turn !== G.aiSeat) {
        // 局面已变（悔棋/重开/换关）：复位界面状态再退出
        $('ai-thinking').classList.remove('on');
        board.locked = false;
        return;
      }
      $('ai-thinking').classList.remove('on');
      board.locked = false;
      if (!r.move) return;
      applyMove(r.move.from, r.move.to);
      $('ai-info').textContent = r.book ? '开局库' :
        `深度 ${r.depth} · ${r.nodes.toLocaleString()} 节点 · ${(r.ms / 1000).toFixed(1)}s · 评分 ${r.score}`;
    } catch (e) {
      $('ai-thinking').classList.remove('on');
      board.locked = false;
      console.error('AI 出错', e);
    }
  }

  /* ---------- 线下对战辅助 ---------- */
  /* 屏幕棋盘 = 实体棋盘的镜像：
   * 对手回合 → 你点击对手的「起点→落点」录入；
   * 你的回合 → AI 自动算出最强着法（金箭头 + 大字记谱），点击你实际走的着法完成录入。 */
  function setOfflineWait() {
    const el = $('offline-status');
    if (!el) return;
    el.className = 'offline-status wait';
    const turnName = G.st.turn === 1 ? '红方' : '黑方';
    el.textContent = '⌨ 对手回合（' + turnName + '）：点击对手的棋子 → 再点落点，录入这步棋';
    $('offline-suggest').innerHTML = '';
  }

  async function offlineSuggest() {
    if (G.mode !== 'offline' || G.over) return;
    if (replayState) return;   // 回放浏览中：不计算不自动走子
    if (G.st.turn !== G.mySeat) { setOfflineWait(); return; }
    const fen = XQ.toFEN(G.st);
    const token = ++G.suggestToken;
    const auto = $('autopilot') && $('autopilot').checked;
    const el = $('offline-status');
    el.className = 'offline-status thinking';
    el.innerHTML = '<span class="dots">皮卡鱼 NNUE 正在计算最佳着法</span>';
    $('offline-suggest').innerHTML = '';
    board.clearHint();
    const stale = () => (G.mode !== 'offline' || G.over || token !== G.suggestToken || XQ.toFEN(G.st) !== fen);
    const show = (from, to, score, depth, engine, isBook, kind, pv) => {
      if (stale()) return;
      if (auto) {
        /* 自动替用户走子（带动画/音效/记谱） */
        const notation = XQ.moveToChinese(G.st, XQ.encode(from, to));
        if (!applyMove(from, to)) { el.textContent = '自动走子失败'; return; }
        board.clearHint();
        if (!G.over) setOfflineWait();
        const sg = $('offline-suggest');
        sg.innerHTML = '';
        const strong = document.createElement('div');
        strong.className = 'offline-suggest-move';
        strong.textContent = '🤖 已替你走：' + notation;
        const detail = document.createElement('div');
        detail.className = 'offline-suggest-detail';
        if (kind === 'mate' && score > 0) {
          detail.textContent = '【' + engine + '】🎯 发现绝杀：' + score + ' 步将死！';
          if (pv && pv.length) {
            const btn = document.createElement('button');
            btn.className = 'sandbox-open-btn';
            btn.textContent = '⚔ 沙盘推演这条杀招';
            btn.onclick = () => { SFX.S.click(); openSandbox(fen, pv, score); };
            sg.appendChild(detail);
            sg.appendChild(btn);
            return;
          }
        } else {
          detail.textContent = '【' + engine + '】深度 ' + depth + ' · 评分 ' + score + ' · 胜率 ' + winRateText(score) + '% — 已照此在实体棋盘落子';
        }
        sg.appendChild(strong);
        sg.appendChild(detail);
        return;
      }
      board.showHint(from, to, true);
      const notation = XQ.moveToChinese(G.st, XQ.encode(from, to));
      const sg = $('offline-suggest');
      const strong = document.createElement('div');
      strong.className = 'offline-suggest-move';
      if (kind === 'mate' && score > 0) {
        strong.textContent = '🎯 ' + score + ' 步绝杀！';
      } else {
        strong.textContent = '💡 建议走：' + notation;
      }
      const detail = document.createElement('div');
      detail.className = 'offline-suggest-detail';
      if (kind === 'mate' && score > 0) {
        detail.textContent = '【' + engine + '】最佳着法：' + notation + ' — ' + score + ' 步将死对手';
      } else {
        detail.textContent = '【' + engine + '】' + hintScoreText(score) +
          (isBook ? ' · 开局库' : ' · 深度 ' + depth + ' · 评分 ' + score) + ' · 胜率 ' + winRateText(score) + '%';
      }
      sg.appendChild(strong);
      sg.appendChild(detail);
      /* 绝杀检测到 → 沙盘入口 */
      if (kind === 'mate' && pv && pv.length) {
        const btn = document.createElement('button');
        btn.className = 'sandbox-open-btn';
        btn.textContent = '⚔ 沙盘推演这条杀招';
        btn.onclick = () => { SFX.S.click(); openSandbox(fen, pv, score); };
        sg.appendChild(btn);
      }
      el.className = 'offline-status ready';
      el.textContent = '👉 你的回合：照建议走子，并点击你实际选择的着法（先点你的子 → 再点落点）';
    };
    const finish = () => {
      if (stale()) return;
      el.className = 'offline-status ready';
      el.textContent = auto
        ? '⌨ 等待对手走子后录入（他的棋子 → 落点）'
        : '👉 你的回合：照建议走子，并点击你实际选择的着法';
    };
    try {
      // 第一优先：服务器托管的皮卡鱼（NNUE 权重），不可用则静默回退内置引擎
      let pfOK = false;
      try {
        const resp = await fetch('/api/bestmove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen, movetime: 2500 }),
        });
        if (resp.ok) {
          const j = await resp.json();
          if (j.legal && j.from != null && !stale()) {
            setEvalBar(j.score, j.kind, G.mySeat);
            show(j.from, j.to, j.score, j.depth, '皮卡鱼 NNUE', false, j.kind, j.pv);
            pfOK = true;
            finish();
          }
        }
      } catch (e) { /* 服务器未开/引擎缺失 → 走内置 */ }
      if (pfOK || stale()) return;
      // 回退：内置大师档（本地 Worker）
      el.innerHTML = '<span class="dots">内置引擎正在计算着法</span>';
      const r = await aiWorkerCall(G.st, 5, 5000, 20, true);
      if (stale()) return;
      if (!r || !r.move) { el.textContent = '已无合法着法'; return; }
      setEvalBar(r.score, 'cp', G.mySeat);
      show(r.move.from, r.move.to, r.score, r.depth, '内置引擎', r.book);
      finish();
    } catch (e) {
      if (G.mode !== 'offline') return;
      el.className = 'offline-status';
      el.textContent = 'AI 计算出错，点「💡 支招」重试';
    }
  }

  function afterOfflineMove() {
    if (G.over) return;
    if (G.st.turn === G.mySeat) {
      if (replayState) return;   // 回放浏览中：不打断
      if ($('autopilot').checked && G.autopilotPaused) { showPausedUI(); return; }
      offlineSuggest();
    } else setOfflineWait();
  }

  function startOffline(seat) {
    G.mode = 'offline';
    G.mySeat = seat;
    G.aiSeat = 0;
    G.st = XQ.stateFromFEN(XQ.START_FEN);
    G.notations = [];
    G.offlineLog = [];
    G.offlineFinalFEN = null;
    G.over = false; G.result = null; G.lastMove = null; G.mateType = null;
    G.clocks = { red: 900000, black: 900000 };
    G.clockWarned = false;
    G.suggestToken++; G.thinkToken++;
    FX.clear();
    board.clearHint();
    ['btn-undo', 'btn-resign', 'btn-draw'].forEach(id => $(id).disabled = false);
    $('ai-level-panel').style.display = 'none';
    $('net-panel').style.display = 'none';
    $('chat-panel').style.display = 'none';
    $('offline-panel').style.display = '';
    $('eg-bar').classList.remove('show');
    $('btn-draw').style.display = 'none';
    $('btn-resign').style.display = 'none';
    document.querySelectorAll('#confirm-bar').forEach(e => e.classList.remove('show'));
    if ($('autopilot')) $('autopilot').checked = true;   // 每局默认自动替走
    G.autopilotPaused = false;
    $('evalbar').style.display = 'block';
    $('room-code-hint').textContent = '线下对战辅助';
    setPlayerCards();
    updatePlayerInfo();
    showScene('game');
    redraw();
    renderNotation();
    refreshClocks();
    afterOfflineMove();
  }

  /* ---------- 复盘分析：逐着对比皮卡鱼 + 风格画像 ---------- */
  let reviewAbort = false;
  let lastReportText = '';
  let reviewSession = null;   // { fens, log, rows, reportHtml, reportText }
  let replayState = null;     // { p } 回放游标：0=初始局面，N=终局
  const REVIEW_CLS = [
    { max: 15,  key: 'good',     label: '好棋' },
    { max: 60,  key: 'ok',       label: '正常' },
    { max: 150, key: 'inacc',    label: '不够精确' },
    { max: 350, key: 'mistake',  label: '失误' },
    { max: 800, key: 'blunder',  label: '大漏招' },
    { max: 1e9, key: 'blunder2', label: '败着' },
  ];
  function clampEval(e) {
    if (!e) return 0;
    let v = e.score || 0;
    if (e.kind === 'mate') v = v > 0 ? 10000 : -10000;
    return Math.max(-2500, Math.min(2500, v));
  }

  async function offlineReview() {
    if (G.mode !== 'offline' || !G.offlineLog.length) return;
    const log = G.offlineLog.slice();
    const fens = log.map(e => e.fenBefore);
    fens.push(G.offlineFinalFEN || XQ.toFEN(G.st));
    const total = fens.length;
    const movetime = +(localStorage.getItem('xq-review-speed') || 350);
    reviewAbort = false;
    $('review-body').innerHTML = '<div id="review-progress" class="review-progress">正在启动分析…</div>';
    $('dialog-review').classList.add('show');
    const setProg = (i) => {
      const p = $('review-progress');
      if (p) p.innerHTML = '皮卡鱼逐着分析中… 第 ' + i + ' / ' + total + ' 个局面' +
        '<div class="bar-wrap"><div class="bar" style="width:' + Math.round(i / total * 100) + '%"></div></div>';
    };
    const evals = [];
    try {
      for (let i = 0; i < total; i++) {
        if (reviewAbort) return;
        setProg(i);
        const resp = await fetch('/api/bestmove', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen: fens[i], movetime }),
        });
        if (!resp.ok) throw new Error('服务器返回 ' + resp.status);
        evals.push(await resp.json());
      }
    } catch (e) {
      $('review-body').innerHTML = '<div class="review-progress review-error">复盘失败：' + e.message +
        '<br>复盘需要开启服务器（皮卡鱼引擎托管在 node 服务端）。</div>';
      return;
    }
    const report = buildReviewReport(log, evals);
    lastReportText = report.text;
    reviewSession = { fens, log, rows: report.rows, reportHtml: report.html, reportText: report.text };
    $('review-body').innerHTML = report.html;
    drawLossChart(report.rows);
    wireReviewRows();
    /* 已结束的对局自动存档 */
    if (G.over) {
      try {
        const hist = JSON.parse(localStorage.getItem('xq-history') || '[]');
        hist.push({
          ts: Date.now(), seat: G.mySeat,
          result: G.result, mateType: G.mateType || null,
          notation: G.notations.slice(), fens,
          rows: report.rows.map(r => ({ p: r.e.ply, m: r.e.mover, n: r.e.notation, cls: r.cls, label: r.label, loss: r.loss, better: r.better, from: r.e.from, to: r.e.to })),
          sum: report.sum, style, captures: report.captures, checks: report.checks,
          fav: report.fav, avgLoss: report.avgLoss, sloppy: report.sloppy, meCount: report.meCount,
          html: report.html, text: report.text,
        });
        while (hist.length > 40) hist.shift();
        localStorage.setItem('xq-history', JSON.stringify(hist));
      } catch (err) { /* 存储超限忽略 */ }
    }
  }

  function buildReviewReport(log, evals) {
    const meSide = G.mySeat === 1 ? '红' : '黑';
    const rows = [];
    const sum = { good: 0, inacc: 0, mistake: 0, blunder: 0 };
    let meLossSum = 0, meCnt = 0;
    for (let i = 0; i < log.length; i++) {
      const e = log[i];
      const s0 = clampEval(evals[i]);
      const s1 = -clampEval(evals[i + 1]);
      const loss = Math.max(0, s0 - s1);
      const nxt = evals[i + 1];
      let cls, label;
      if (nxt && nxt.kind === 'mate') {
        if (nxt.score > 0) { cls = 'mate'; label = '绝杀！'; }
        else { cls = 'blunder2'; label = '被将死'; }
      } else {
        const bucket = REVIEW_CLS.find(b => loss <= b.max);
        cls = bucket.key; label = bucket.label;
      }
      if (e.mover === 'me') {
        meLossSum += loss; meCnt++;
        if (cls === 'mate' || cls === 'good') sum.good++;
        else if (cls === 'inacc') sum.inacc++;
        else if (cls === 'mistake') sum.mistake++;
        else if (cls === 'blunder' || cls === 'blunder2') sum.blunder++;
      }
      rows.push({ i, e, loss, cls, label, isMe: e.mover === 'me',
        better: (loss > 150 && evals[i] && evals[i].legal && evals[i].notation) ? evals[i].notation : '' });
    }
    /* 风格画像（基于我方全部着法的启发式统计） */
    const meMoves = log.filter(e => e.mover === 'me');
    const captures = meMoves.filter(e => e.cap).length;
    const checks = meMoves.filter(e => e.checked).length;
    let fwd = 0;
    for (const e of meMoves) {
      const dr = (e.from / 9 | 0) - (e.to / 9 | 0);
      if (G.mySeat === 1 ? dr > 0 : dr < 0) fwd++;
    }
    const n = Math.max(1, meMoves.length);
    const aggr = (captures * 2 + checks * 3 + fwd) / n;
    let style = '均衡全面型';
    if (aggr >= 1.6) style = '激进进攻型';
    else if (aggr <= 0.7) style = '稳健防守型';
    const usage = {};
    for (const e of meMoves) usage[e.piece] = (usage[e.piece] || 0) + 1;
    const fav = Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([p, c]) => p + '×' + c).join('　');
    const avgLoss = meCnt ? Math.round(meLossSum / meCnt) : 0;
    const sloppy = meCnt ? Math.round((sum.inacc + sum.mistake + sum.blunder) / meCnt * 100) : 0;
    /* HTML */
    let html = '<div class="review-summary">' +
      '<div class="review-chip"><b>' + sum.good + '</b><small>好棋</small></div>' +
      '<div class="review-chip"><b>' + sum.inacc + '</b><small>不够精确</small></div>' +
      '<div class="review-chip"><b>' + sum.mistake + '</b><small>失误</small></div>' +
      '<div class="review-chip"><b>' + sum.blunder + '</b><small>漏招/败着</small></div>' +
      '<div class="review-chip"><b>' + avgLoss + '</b><small>平均每步损失</small></div>' +
      '<div class="review-chip"><b>' + sloppy + '%</b><small>走偏率</small></div>' +
      '</div>' +
      '<canvas id="loss-chart"></canvas>' +
      '<div class="chart-hint">折线=每步损失走势（红点=你方着法，灰点=对手；黄/橙/红虚线=失误/大漏招/败着阈值）。点击下方任意一行，可在棋盘上回放该局面。</div>' +
      '<div class="review-style">风格画像（' + meSide + '方 · ' + meMoves.length + ' 步，含皮卡鱼代走）：<b>' + style + '</b><br>' +
      '吃子 ' + captures + ' 次 · 将军 ' + checks + ' 次 · 前进着法 ' + Math.round(fwd / n * 100) + '% · 偏好棋子：' + (fav || '—') +
      '</div>' +
      '<div class="review-list">';
    for (const r of rows) {
      const badge = '<span class="rb rb-' + (r.isMe ? r.cls : 'opp') + '">' + (r.isMe ? r.label : '对手 ' + r.label) + '</span>';
      html += '<div class="review-row clickable" data-idx="' + r.i + '">' +
        '<span class="no">#' + r.e.ply + '</span>' +
        '<span class="mv ' + (r.isMe ? 'me' : 'opp') + '">' + r.e.notation + '</span>' + badge +
        (r.better ? '<span class="best">更好的走法：' + r.better + '</span>' : '') +
        '<span class="loss">损失 ' + r.loss + '</span>' +
        '</div>';
    }
    html += '</div>';
    /* 纯文本战报 */
    let text = '【象棋复盘战报】' + meSide + '方视角 · 共 ' + log.length + ' 着\n' +
      '好棋 ' + sum.good + ' | 不够精确 ' + sum.inacc + ' | 失误 ' + sum.mistake + ' | 漏招/败着 ' + sum.blunder +
      ' | 平均每步损失 ' + avgLoss + ' | 走偏率 ' + sloppy + '%\n' +
      '风格：' + style + '（吃子' + captures + ' 将军' + checks + ' 前进' + Math.round(fwd / n * 100) + '% 偏好：' + (fav || '—') + '）\n';
    for (const r of rows) {
      if (r.isMe && (r.cls !== 'good' && r.cls !== 'ok' && r.cls !== 'mate'))
        text += '#' + r.e.ply + ' ' + r.e.notation + ' [' + r.label + ' 损失' + r.loss + ']' +
          (r.better ? ' 更好走法：' + r.better : '') + '\n';
    }
    return { html, text, rows, sum, style, captures, checks, fav, avgLoss, sloppy, meCount: meMoves.length };
  }

  /* ---------- 损失曲线 ---------- */
  function drawLossChart(rows) {
    const cv = document.getElementById('loss-chart');
    if (!cv || !rows.length) return;
    const W = 660, H = 130, PADT = 14, PADB = 8;
    cv.width = W * 2; cv.height = H * 2;
    const ctx = cv.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const maxLoss = Math.max(250, ...rows.map(r => Math.min(r.loss, 800))) * 1.1;
    const x = i => 10 + (W - 20) * (rows.length === 1 ? 0.5 : i / (rows.length - 1));
    const y = v => PADT + (H - PADT - PADB) * (1 - Math.min(v, maxLoss) / maxLoss);
    ctx.strokeStyle = '#d8c391'; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.setLineDash([4, 4]);
    for (const [v, color, label] of [[150, '#c9a227', '失误'], [350, '#e07b28', '大漏招'], [800, '#d0342c', '败着']]) {
      if (v > maxLoss) continue;
      ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(6, y(v)); ctx.lineTo(W - 6, y(v)); ctx.stroke();
      ctx.fillStyle = color; ctx.font = '10px sans-serif'; ctx.fillText(label, W - 58, y(v) - 3);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(138,100,50,.45)'; ctx.beginPath();
    rows.forEach((r, i) => { const px = x(i), py = y(r.loss); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    for (const [i, r] of rows.entries()) {
      ctx.beginPath(); ctx.arc(x(i), y(r.loss), 4, 0, Math.PI * 2);
      ctx.fillStyle = r.isMe ? (r.loss > 350 ? '#d0342c' : r.loss > 150 ? '#e07b28' : '#2e8b57') : '#9a8a68';
      ctx.fill();
    }
  }

  /* ---------- 回放模式 ---------- */
  function wireReviewRows() {
    document.querySelectorAll('#review-body .review-row.clickable').forEach(row => {
      row.onclick = () => enterReplay((+row.dataset.idx) + 1);
    });
  }
  function enterReplay(p) {
    if (!reviewSession) return;
    replayState = { p: Math.max(0, Math.min(reviewSession.fens.length - 1, p)) };
    $('dialog-review').classList.remove('show');
    drawReplayPosition();
    $('replay-bar').style.display = 'flex';
  }
  function drawReplayPosition() {
    if (!replayState || !reviewSession) return;
    const p = replayState.p;
    const st = XQ.stateFromFEN(reviewSession.fens[p]);
    const last = p > 0 ? { from: reviewSession.log[p - 1].from, to: reviewSession.log[p - 1].to } : null;
    board.setState(st, { lastMove: last });
    const row = p > 0 ? reviewSession.rows[p - 1] : null;
    const rowText = row ? (row.e ? row.e.notation : row.n) : '';
    $('rp-label').textContent = '第 ' + p + ' / ' + (reviewSession.fens.length - 1) + ' 步' +
      (row ? '：' + rowText + '（' + row.label + '）' : '（初始局面）');
    document.querySelectorAll('#review-body .review-row').forEach(r => {
      r.classList.toggle('sel', (+r.dataset.idx) === p - 1);
    });
  }
  function exitReplay() {
    replayState = null;
    $('replay-bar').style.display = 'none';
    redraw();   // 恢复实时局面
    if (G.mode === 'offline' && !G.over && G.st.turn === G.mySeat &&
        $('autopilot').checked && !G.autopilotPaused) offlineSuggest();
  }

  /* ---------- 历史存档 ---------- */
  function openStoredReview(entry) {
    reviewSession = {
      fens: entry.fens,
      log: entry.rows.map(r => ({ ply: r.p, mover: r.m, notation: r.n, from: r.from, to: r.to })),
      rows: entry.rows.map(r => ({ loss: r.loss, cls: r.cls, label: r.label, isMe: r.m === 'me', better: r.better,
        e: { ply: r.p, mover: r.m, notation: r.n, from: r.from, to: r.to } })),
      reportHtml: entry.html, reportText: entry.text,
    };
    lastReportText = entry.text;
    $('review-body').innerHTML = entry.html;
    drawLossChart(reviewSession.rows);
    wireReviewRows();
    $('dialog-history').classList.remove('show');
    $('dialog-review').classList.add('show');
  }

  function drawGrowthChart(hist) {
    const cv = document.getElementById('history-growth');
    if (!cv || hist.length < 1) return;
    const W = 640, H = 150, PADT = 18, PADB = 20;
    cv.width = W * 2; cv.height = H * 2;
    const ctx = cv.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#d8c391'; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    const n = hist.length;
    const x = i => 30 + (W - 50) * (n === 1 ? 0.5 : i / (n - 1));
    const y = v => PADT + (H - PADT - PADB) * (1 - v / 100);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = '#c9a227';
    ctx.beginPath(); ctx.moveTo(20, y(30)); ctx.lineTo(W - 20, y(30)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#c9a227'; ctx.font = '10px sans-serif';
    ctx.fillText('走偏率 30% 参考线', W - 110, y(30) - 4);
    ctx.strokeStyle = '#b03024'; ctx.beginPath();
    hist.forEach((h, i) => { const px = x(i), py = y(h.sloppy || 0); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    hist.forEach((h, i) => {
      ctx.beginPath(); ctx.arc(x(i), y(h.sloppy || 0), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#b03024'; ctx.fill();
      ctx.fillStyle = '#5e3a12'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText((h.sloppy || 0) + '%', x(i), y(h.sloppy || 0) - 8);
      if (n <= 20 || i % Math.ceil(n / 20) === 0) ctx.fillText('#' + (i + 1), x(i), H - 6);
    });
    ctx.textAlign = 'left';
  }

  function openHistory() {
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem('xq-history') || '[]'); } catch (e) {}
    const body = $('history-body');
    if (!hist.length) {
      body.innerHTML = '<div class="history-empty">还没有已完成的对局复盘<br>线下模式下一整局结束后点「复盘分析」即自动存档</div>';
    } else {
      const list = hist.map((h, i) => {
        const win = h.result && (h.result.winner === h.seat);
        const draw = h.result && h.result.winner === 0;
        const d = new Date(h.ts);
        const ds = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        return '<div class="hist-item" data-i="' + i + '">' +
          '<span class="hdate">' + ds + '</span>' +
          '<span class="hres ' + (draw ? '' : win ? 'win' : 'lose') + '">' + (draw ? '和棋' : win ? '胜' : '负') + '</span>' +
          '<span class="hstats">好棋 ' + (h.sum ? h.sum.good : '—') + ' · 漏招 ' + (h.sum ? h.sum.mistake + h.sum.blunder : '—') +
          ' · 走偏 ' + (h.sloppy || 0) + '% · ' + h.style + '</span>' +
          '</div>';
      }).join('');
      body.innerHTML = '<canvas id="history-growth"></canvas>' + list;
      drawGrowthChart(hist);
      body.querySelectorAll('.hist-item').forEach(item => {
        item.onclick = () => openStoredReview(hist[+item.dataset.i]);
      });
    }
    $('dialog-history').classList.add('show');
  }

  /* ---------- 局势评估条 ---------- */
  function setEvalBar(score, kind, moverSeat) {
    const bar = $('evalbar');
    if (!bar || bar.style.display === 'none') return;
    let frac;
    if (kind === 'mate') frac = score > 0 ? 1 : 0;
    else frac = 1 / (1 + Math.exp(-(score || 0) / 400));
    if (moverSeat === -1) frac = 1 - frac;   // 评分是行棋方视角 → 换算成红方占比
    frac = Math.max(0.04, Math.min(0.96, frac));
    $('evalbar-red').style.height = Math.round(frac * 608) + 'px';
    const pct = Math.round(frac * 100);
    const t1 = $('evalbar-tag'), t2 = $('evalbar-tag2');
    t1.style.display = 'block'; t2.style.display = 'block';
    t1.textContent = '黑 ' + (100 - pct) + '%';   // 条上方 = 黑方（上暗下红）
    t2.textContent = '红 ' + pct + '%';           // 条下方 = 红方
  }
  /* 引擎分（行棋方视角）→ 行棋方胜率百分比文本 */
  function winRateText(score) {
    const share = Math.abs(score || 0) > 9000 ? 0.99 : 1 / (1 + Math.exp(-(score || 0) / 400));
    return Math.round(share * 100);
  }
  function hideEvalBar() {
    const bar = $('evalbar');
    if (bar) bar.style.display = 'none';
    ['evalbar-tag', 'evalbar-tag2'].forEach(id => {
      const t = $(id);
      if (t) t.style.display = 'none';
    });
  }

  /* ---------- 自动替走暂停（悔棋后） ---------- */
  function showPausedUI() {
    const el = $('offline-status');
    el.className = 'offline-status wait';
    el.textContent = '已悔棋，皮卡鱼自动替走已暂停';
    const sg = $('offline-suggest');
    sg.innerHTML = '';
    const btn = document.createElement('button');
    btn.textContent = '🤖 重算并替走';
    btn.style.cssText = 'width:100%;padding:9px;border-radius:8px;border:1px solid #e8c96a;cursor:pointer;font-size:14px;background:linear-gradient(180deg,#b8860b,#8a6508);color:#fff';
    btn.onclick = () => { SFX.S.click(); G.autopilotPaused = false; offlineSuggest(); };
    sg.appendChild(btn);
  }

  /* ---------- 沙盘推演：独立棋盘，自动演示杀招 / 亲手试杀 / 逐步回放 ---------- */
  let sbBoard = null;
  let sb = null;               // { st, baseFen, pv, pvIdx, demo, hist, pos, lastMove }
  let sbDemoTimer = null;
  let lastSandboxSeed = null;  // { fen, pv, mateIn } 最近一次检测到绝杀的局面

  function sbEnsureBoard() {
    if (!sbBoard) sbBoard = new Board($('sandbox-board'));
    return sbBoard;
  }
  function openSandbox(fen, pv, mateIn) {
    sbEnsureBoard();
    sbBoard.onUserMove = (from, to) => {
      if (!sb || sb.demo) return;
      const res = sbMakeMove(from, to, true);
      if (res === 'over') return;
      sbEngineReply();   // 用户落子后皮卡鱼防守
    };
    sbBoard.canInteract = () => !!sb && !sb.demo;
    sb = { st: XQ.stateFromFEN(fen), baseFen: fen, pv: pv || [], pvIdx: 0, demo: false, hist: [], pos: 0, lastMove: null };
    if (sbDemoTimer) { clearTimeout(sbDemoTimer); sbDemoTimer = null; }
    $('sandbox-mate').textContent = mateIn ? `发现 ${mateIn} 步绝杀！` : '';
    $('sb-demo').style.display = ''; $('sb-stop').style.display = 'none';
    $('dialog-sandbox').classList.add('show');
    sbRender(pv && pv.length
      ? '沙盘就绪：▶ 自动演示绝杀路线，◀ ▶ 随时逐步回放细看；也可亲手试杀。'
      : '沙盘就绪：可亲手落子，皮卡鱼会逐着防守；或点「▶ 自动演示」互弈。◀ ▶ 随时回放。');
  }
  function sbStopDemo() {
    sb.demo = false;
    if (sbDemoTimer) { clearTimeout(sbDemoTimer); sbDemoTimer = null; }
    $('sb-demo').style.display = ''; $('sb-stop').style.display = 'none';
  }
  function sbUpdateTrail() {
    const t = $('sandbox-trail');
    if (!sb.hist.length) { t.innerHTML = '（尚无着法）'; return; }
    let html = '';
    for (let i = 0; i < sb.hist.length; i += 2) {
      const cur = i === sb.pos - 1 || i + 1 === sb.pos - 1;   // 当前浏览到的半回合所在行
      const cls = i >= sb.pos ? ' future' : (cur ? ' cur' : '');
      html += (i ? '<br>' : '') + '<span class="sb-row' + cls + '" data-i="' + i + '"><b>' + (i / 2 + 1) + '.</b> ' +
        sb.hist[i].notation + (sb.hist[i + 1] ? '　' + sb.hist[i + 1].notation : '') + '</span>';
    }
    t.innerHTML = html;
    const mark = t.querySelector('.sb-row.cur') || t.querySelector('.sb-row.future');
    if (mark) mark.scrollIntoView({ block: 'nearest' });
  }
  function sbRender(msg) {
    sbBoard.setState(sb.st, { lastMove: sb.lastMove });
    if (msg !== undefined) $('sandbox-status').textContent = msg;
    sbUpdateTrail();
  }
  /* 在沙盘上走一步（带动画与音效）。返回 'over' | true | false。
   * pos < hist.length 时走新着 = 从该局面分叉，后面被回退的着法作废 */
  function sbMakeMove(from, to, animate) {
    const m = XQ.encode(from, to);
    if (!XQ.legalMoves(sb.st).includes(m)) return false;
    const notation = XQ.moveToChinese(sb.st, m);
    const cap = sb.st.board[to];
    XQ.make(sb.st, m);
    sb.hist.length = sb.pos;
    sb.hist.push({ from, to, notation, cap });
    sb.pos++;
    sb.lastMove = { from, to };
    sbBoard.setState(sb.st, { lastMove: sb.lastMove, animate: !!animate, captured: cap });
    sbUpdateTrail();
    SFX.S.drop();
    if (cap) setTimeout(() => SFX.S.capture(), 140);
    const st1 = XQ.status(sb.st);
    if (st1.over) {
      sbStopDemo();
      const winTxt = st1.winner === 0 ? '和棋' : (st1.winner === (G.mySeat || 1) ? '绝杀达成！🎉' : '被将死');
      $('sandbox-status').textContent = '沙盘终局：' + (st1.reason === 'checkmate' ? winTxt + '（' + (XQ.detectMateType(sb.st) || '') + '）' : (st1.reason === 'stalemate' ? '困毙' : st1.reason));
      SFX.S.mate();
      return 'over';
    }
    return true;
  }
  function sbPaint() {
    sbBoard.setState(sb.st, { lastMove: sb.lastMove });
    sbUpdateTrail();
  }
  /* 回放：退一步（非破坏式，可 ▶ 下一步 重放） */
  function sbStepBack() {
    if (!sb || sb.pos <= 0) { $('sandbox-status').textContent = '已经在起始局面'; return; }
    sbStopDemo();
    XQ.unmake(sb.st);
    sb.pos--;
    const prev = sb.hist[sb.pos - 1];
    sb.lastMove = prev ? { from: prev.from, to: prev.to } : null;
    sbPaint();
    $('sandbox-status').textContent = sb.pos === 0
      ? '已回退到起始局面（▶ 下一步可重放）'
      : '回放 ' + sb.pos + ' / ' + sb.hist.length + ' —— ◀ 继续回退，▶ 前进';
  }
  /* 回放：前进一步（重放历史着法） */
  function sbStepFwd() {
    if (!sb) return;
    if (sb.pos >= sb.hist.length) { $('sandbox-status').textContent = '已是最新局面（可继续落子或点 ▶ 自动演示）'; return; }
    sbStopDemo();
    const mv = sb.hist[sb.pos];
    XQ.make(sb.st, XQ.encode(mv.from, mv.to));
    sb.pos++;
    sb.lastMove = { from: mv.from, to: mv.to };
    sbPaint();
    SFX.S.drop();
    if (mv.cap) setTimeout(() => SFX.S.capture(), 140);
    const st1 = XQ.status(sb.st);
    $('sandbox-status').textContent = st1.over
      ? '回放结束：' + (st1.reason === 'checkmate' ? '绝杀（' + (XQ.detectMateType(sb.st) || '') + '）' : (st1.reason === 'stalemate' ? '困毙' : st1.reason))
      : (sb.pos >= sb.hist.length ? '回放到最新局面' : '回放 ' + sb.pos + ' / ' + sb.hist.length);
  }
  /* 回放：跳到第 target 步之后的局面（点击棋谱行） */
  function sbJumpTo(target) {
    if (!sb) return;
    sbStopDemo();
    target = Math.max(0, Math.min(sb.hist.length, target));
    if (target === sb.pos) return;
    while (sb.pos > target) { XQ.unmake(sb.st); sb.pos--; }
    while (sb.pos < target) {
      const mv = sb.hist[sb.pos];
      XQ.make(sb.st, XQ.encode(mv.from, mv.to));
      sb.pos++;
    }
    const prev = sb.hist[sb.pos - 1];
    sb.lastMove = prev ? { from: prev.from, to: prev.to } : null;
    sbPaint();
    SFX.S.drop();
    $('sandbox-status').textContent = sb.pos >= sb.hist.length ? '回放到最新局面' : '回放 ' + sb.pos + ' / ' + sb.hist.length;
  }
  function sbDemoStep() {
    if (!sb || !sb.demo) return;
    if (sb.pvIdx < sb.pv.length) {   // 跟随绝杀路线
      const mv = sb.pv[sb.pvIdx];
      if (XQ.legalMoves(sb.st).includes(XQ.encode(mv.from, mv.to))) {
        sb.pvIdx++;
        const res = sbMakeMove(mv.from, mv.to, true);
        if (res === 'over') return;
        $('sandbox-status').textContent = '自动演示中… 第 ' + Math.ceil(sb.pos / 2) + ' 回合（点 ◀ 可随时回退细看）';
        sbDemoTimer = setTimeout(sbDemoStep, 850);
        return;
      }
      sb.pvIdx = sb.pv.length;   // 局面已偏离绝杀路线 → 转入引擎互弈
    }
    /* 路线播完：引擎对弈演示（双方都用皮卡鱼最佳应手） */
    const fen = XQ.toFEN(sb.st);
    fetch('/api/bestmove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, movetime: 400 }),
    }).then(r => r.json()).then(j => {
      if (!sb || !sb.demo) return;
      if (!j.legal || j.from == null) { sbStopDemo(); sbRender('演示结束'); return; }
      const res = sbMakeMove(j.from, j.to, true);
      if (res === 'over') return;
      sbDemoTimer = setTimeout(sbDemoStep, 650);
    }).catch(() => { sbStopDemo(); sbRender('引擎请求失败，演示停止'); });
  }
  function sbStartDemo() {
    if (!sb) return;
    sb.demo = true;
    /* 已走的着法若恰好是绝杀路线前缀，则从当前进度续播；否则从头演示 */
    let i = 0;
    while (i < sb.pos && i < sb.pv.length && sb.hist[i].from === sb.pv[i].from && sb.hist[i].to === sb.pv[i].to) i++;
    sb.pvIdx = (i === sb.pos) ? sb.pos : 0;
    $('sb-demo').style.display = 'none'; $('sb-stop').style.display = '';
    $('sandbox-status').textContent = sb.pv.length ? '自动演示：皮卡鱼的绝杀路线…' : '自动演示：皮卡鱼双方互弈…';
    sbDemoStep();
  }
  async function sbEngineReply() {
    if (!sb || sb.demo) return;
    const fen = XQ.toFEN(sb.st);
    $('sandbox-status').textContent = '🤖 皮卡鱼防守中…';
    try {
      const resp = await fetch('/api/bestmove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, movetime: 600 }),
      });
      const j = await resp.json();
      if (!sb || sb.demo) return;
      if (j.legal && j.from != null) {
        setEvalBar(j.score, j.kind, G.mySeat);
        const res = sbMakeMove(j.from, j.to, true);
        if (res === 'over') return;
        if (j.kind === 'mate' && j.score > 0) $('sandbox-status').textContent = '⚠ 皮卡鱼宣告：' + j.score + ' 步内将死——沙盘里试试破解！';
        else sbRender('轮到你，继续进攻');
      } else {
        sbStopDemo();
        $('sandbox-status').textContent = '沙盘终局：无合法着法';
      }
    } catch (e) {
      $('sandbox-status').textContent = '引擎请求失败（沙盘对弈需要服务器开启）';
    }
  }
  function bindSandboxUI() {
    $('sb-demo').onclick = () => { SFX.S.click(); sbStartDemo(); };
    $('sb-stop').onclick = () => { SFX.S.click(); sbStopDemo(); sbRender('演示已停止，可继续手动落子'); };
    $('sb-back').onclick = () => { SFX.S.click(); sbStepBack(); };
    $('sb-fwd').onclick = () => { SFX.S.click(); sbStepFwd(); };
    $('sb-reset').onclick = () => {
      SFX.S.click();
      sbStopDemo();
      sb.st = XQ.stateFromFEN(sb.baseFen);
      sb.hist = []; sb.pos = 0; sb.pvIdx = 0; sb.lastMove = null;
      sbRender('已重置到起始局面');
    };
    $('sb-close').onclick = () => { SFX.S.click(); sbStopDemo(); $('dialog-sandbox').classList.remove('show'); };
    $('sandbox-trail').onclick = (e) => {
      const row = e.target.closest('.sb-row');
      if (!row || !sb) return;
      const i = +row.dataset.i;
      if (i >= sb.hist.length) return;
      SFX.S.click();
      sbJumpTo(Math.min(sb.hist.length, i + (sb.hist[i + 1] ? 2 : 1)));
    };
  }

  function bindOfflineUI() {
    $('card-offline').onclick = () => { SFX.S.click(); $('dialog-offline').classList.add('show'); };
    $('offline-cancel').onclick = () => { SFX.S.click(); $('dialog-offline').classList.remove('show'); };
    $('offline-start').onclick = () => {
      SFX.S.click();
      $('dialog-offline').classList.remove('show');
      startOffline($('offline-side').value === 'black' ? -1 : 1);
    };
    $('autopilot').onchange = () => {
      if ($('autopilot').checked) G.autopilotPaused = false;
      if (G.mode === 'offline' && !G.over && $('autopilot').checked && G.st.turn === G.mySeat) {
        offlineSuggest();   // 勾选自动替走时，若正轮到自己则立刻计算并走子
      }
    };
    $('btn-review-now').onclick = () => { SFX.S.click(); offlineReview(); };
    $('btn-history').onclick = () => { SFX.S.click(); openHistory(); };
    $('history-close').onclick = () => { SFX.S.click(); $('dialog-history').classList.remove('show'); };
    $('history-clear').onclick = () => {
      if (!confirm('清空全部历史对局存档？')) return;
      localStorage.removeItem('xq-history');
      openHistory();
    };
    const speedSel = $('review-speed');
    speedSel.value = localStorage.getItem('xq-review-speed') || '350';
    speedSel.onchange = () => localStorage.setItem('xq-review-speed', speedSel.value);
    $('review-close').onclick = () => { SFX.S.click(); reviewAbort = true; $('dialog-review').classList.remove('show'); };
    $('review-copy').onclick = async () => {
      if (!lastReportText) return;
      try { await navigator.clipboard.writeText(lastReportText); }
      catch (e) {
        const ta = document.createElement('textarea');
        ta.value = lastReportText;
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      $('review-copy').textContent = '✓ 已复制';
      setTimeout(() => { $('review-copy').textContent = '📋 复制战报'; }, 1500);
    };
    /* 回放条按钮 */
    $('rp-prev').onclick = () => { if (replayState) { replayState.p = Math.max(0, replayState.p - 1); drawReplayPosition(); } };
    $('rp-next').onclick = () => { if (replayState) { replayState.p = Math.min(reviewSession.fens.length - 1, replayState.p + 1); drawReplayPosition(); } };
    $('rp-exit').onclick = () => { SFX.S.click(); exitReplay(); };
    $('rp-report').onclick = () => {
      if (!reviewSession) return;
      $('review-body').innerHTML = reviewSession.reportHtml;
      drawLossChart(reviewSession.rows);
      wireReviewRows();
      $('dialog-review').classList.add('show');
    };
  }

  board.onUserMove = (from, to) => {
    if (G.over) return;
    if (G.mode === 'offline') {
      if (applyMove(from, to)) {
        board.clearSelection();
        board.clearHint();
        afterOfflineMove();
      }
      return;
    }
    if (G.mode === 'pve' || G.mode === 'endgame') {
      if (G.st.turn !== G.mySeat) return;
      if (applyMove(from, to)) {
        board.clearSelection();
        maybeAI();
      }
    } else if (G.mode === 'pvp') {
      if (G.st.turn !== G.mySeat) return;
      // 服务器是权威，本地先走乐观更新，若服务器拒绝会回滚
      const backup = {
        fen: XQ.toFEN(G.st), notations: G.notations.slice(), lastMove: G.lastMove,
      };
      if (applyMove(from, to)) {
        board.clearSelection();
        G.pendingBackup = backup;
        G.net.move(from, to);
      }
    }
  };

  board.canInteract = () => {
    if (G.over) return false;
    if (replayState) return false;   // 回放浏览中：棋盘只读
    if (G.mode === 'offline') return !board.locked;   // 双方着法都由用户录入
    if (G.mode === 'pve' || G.mode === 'endgame') return G.st.turn === G.mySeat && !board.locked;
    if (G.mode === 'pvp') return G.st.turn === G.mySeat && G.net && G.net.connected;
    return false;
  };

  /* ---------- 人机 UI ---------- */
  function bindPveUI() {
    $('card-pve').onclick = () => { SFX.S.click(); $('dialog-pve').classList.add('show'); };
    $('pve-cancel').onclick = () => $('dialog-pve').classList.remove('show');
    $('pve-start').onclick = () => {
      SFX.S.click();
      $('dialog-pve').classList.remove('show');
      const sideSel = $('pve-side').value;
      G.mySeat = sideSel === 'red' ? 1 : sideSel === 'black' ? -1 : (Math.random() < .5 ? 1 : -1);
      G.aiSeat = -G.mySeat;
      G.aiLevel = +$('pve-level').value;
      G.mode = 'pve';
      hideEvalBar();
      $('ai-level-panel').style.display = '';
      $('offline-panel').style.display = 'none';
      $('net-panel').style.display = 'none';
      $('chat-panel').style.display = 'none';
      $('confirm-bar').style.display = 'none !important';
      document.querySelectorAll('#confirm-bar').forEach(e => e.classList.remove('show'));
      $('btn-draw').style.display = 'none';
      $('btn-resign').style.display = '';
      $('opp-name').textContent = '';
      setPlayerCards();
      updatePlayerInfo();
      showScene('game');
      resetGame();
    };
    // 对局中切难度
    document.querySelectorAll('.ai-levels button[data-lv]').forEach(btn => {
      btn.onclick = () => {
        G.aiLevel = +btn.dataset.lv;
        document.querySelectorAll('.ai-levels button[data-lv]').forEach(b => b.classList.toggle('sel', b === btn));
        $('ai-desc').textContent = LEVEL_DESC[G.aiLevel];
        updatePlayerInfo();
        SFX.S.click();
      };
    });
    $('btn-flip').onclick = () => {
      G.mySeat = -G.mySeat; G.aiSeat = -G.aiSeat;
      setPlayerCards(); updatePlayerInfo(); redraw();
      SFX.S.click();
    };
  }
  const LEVEL_DESC = {
    1: '入门：随手走子，适合完全新手。',
    2: '初级：会主动吃子送子，偶尔失误。',
    3: '中级：有战术意识，注意子力安全。',
    4: '高级：稳健老练，抓得住你的漏着。',
    5: '大师：全力搜索，请谨慎挑战。',
  };

  /* ---------- 联机 ---------- */
  /* ---------- 残局闯关 ---------- */
  function bindEndgameUI() {
    $('card-endgame').onclick = () => { SFX.S.click(); renderEndgameList(); $('dialog-endgame').classList.add('show'); };
    $('eg-cancel').onclick = () => $('dialog-endgame').classList.remove('show');
  }

  function renderEndgameList() {
    const list = $('eg-list');
    const unlocked = Stats.unlockedLevel(G.myName);
    list.innerHTML = '';
    for (const lv of root.ENDGAMES.all()) {
      const cleared = Stats.isCleared(G.myName, lv.id);
      const locked = lv.id > unlocked;
      const item = document.createElement('div');
      item.className = 'eg-item' + (locked ? ' locked' : '') + (cleared ? ' cleared' : '');
      item.innerHTML =
        '<div class="eg-num">' + (cleared ? '✓' : lv.id) + '</div>' +
        '<div class="eg-info"><div class="eg-name">' + lv.name + '</div><div class="eg-diff">' + lv.diff + '</div></div>' +
        (locked ? '<div class="eg-lock">🔒 需通关前一关</div>' : '');
      if (!locked) {
        item.onclick = () => {
          SFX.S.click();
          $('dialog-endgame').classList.remove('show');
          startEndgame(lv.id);
        };
      }
      list.appendChild(item);
    }
  }

  function startEndgame(levelId) {
    const lv = root.ENDGAMES.get(levelId);
    if (!lv) return;
    G.mode = 'endgame';
    hideEvalBar();
    G.egLevel = levelId;
    G.mySeat = 1; G.aiSeat = -1;          // 玩家执红，AI 执黑防守
    G.aiLevel = 5;                        // 残局防守用最高档（负残局方全力挣扎）
    G.st = XQ.stateFromFEN(lv.fen);
    G.notations = [];
    G.over = false; G.result = null; G.lastMove = null; G.mateType = null;
    G.clocks = { red: 900000, black: 900000 };
    G.clockWarned = false;
    FX.clear();
    ['btn-undo', 'btn-resign', 'btn-draw'].forEach(id => $(id).disabled = false);
    $('ai-level-panel').style.display = '';
    $('offline-panel').style.display = 'none';
    $('net-panel').style.display = 'none';
    $('chat-panel').style.display = 'none';
    $('btn-draw').style.display = 'none';
    $('btn-resign').style.display = '';
    $('eg-bar').classList.add('show');    $('eg-bar-title').textContent = '第' + lv.id + '关 · ' + lv.name + '（' + lv.diff + '）';
    $('eg-bar-tip').textContent = '💡 ' + lv.tip;
    $('room-code-hint').textContent = '残局闯关';
    setPlayerCards();
    updatePlayerInfo();
    // 名牌
    $('me-name').textContent = '你（红）';
    $('me-sub').textContent = '执红先行 · 将死黑方即通关';
    $('opp-name').textContent = 'AI 防守 · ' + lv.diff;
    $('opp-sub').textContent = '残局第' + lv.id + '关';
    $('me-clock').textContent = '∞';
    $('opp-clock').textContent = '∞';
    showScene('game');
    redraw();
    renderNotation();
    refreshClocks();
  }

  function bindPvpUI() {
    let roomListTimer = null;
    $('card-pvp').onclick = () => {
      SFX.S.click();
      $('pvp-name').value = G.myName || '';
      $('pvp-name').readOnly = !!G.loggedIn;
      $('dialog-pvp').classList.add('show');
      loadRooms();
      clearInterval(roomListTimer);
      roomListTimer = setInterval(() => {
        if (!$('dialog-pvp').classList.contains('show')) { clearInterval(roomListTimer); return; }
        loadRooms();
      }, 3000);
    };
    async function loadRooms() {
      try {
        const resp = await fetch('/api/rooms');
        const j = await resp.json();
        const box = $('room-list');
        if (!j.rooms || !j.rooms.length) { box.innerHTML = '<div class="room-empty">暂无等待中的房间——创建一个，等朋友从列表加入</div>'; return; }
        box.innerHTML = j.rooms.map(r =>
          '<div class="hist-item-style room-item" data-room="' + r.id + '">' +
          '<span class="rhost">房主：' + r.host + '</span>' +
          '<span class="rphase">房间 ' + r.id + ' · 等待加入</span>' +
          '<button>加入</button></div>').join('');
        box.querySelectorAll('.room-item button').forEach((b, i) => {
          b.onclick = () => {
            SFX.S.click();
            startPvp('join', j.rooms[i].id);
            $('dialog-pvp').classList.remove('show');
          };
        });
      } catch (e) {
        $('room-list').innerHTML = '<div class="room-empty">房间列表加载失败（服务器未响应）</div>';
      }
    }
    $('pvp-quick').onclick = () => { startPvp('quick'); };
    $('pvp-create').onclick = () => { startPvp('create'); };
    // 对局页内的房间码加入（联机等待界面直接输入对方房间码）
    $('btn-join-room').onclick = () => {
      const code = ($('room-join-input').value || '').trim().toUpperCase();
      if (code.length !== 4) { $('room-join-input').focus(); return; }
      SFX.S.click();
      G.netRoom = code;
      if (G.net && G.net.connected) G.net.join(code, G.myName);
      else startPvp('join', code);
    };
    $('pvp-join-show').onclick = () => { $('pvp-join-row').style.display = ''; };
    $('pvp-join').onclick = () => {
      const room = $('pvp-room').value.trim();
      if (room.length !== 4) { $('pvp-room').focus(); return; }
      startPvp('join', room);
    };
  }

  function startPvp(action, room) {
    if (!G.loggedIn) { FX.banner('请先在大厅登录（输个昵称即可）'); return; }
    const name = G.myName;
    G.myName = name;
    localStorage.setItem('xq-name', name);
    $('dialog-pvp').classList.remove('show');
    G.mode = 'pvp';
    hideEvalBar();
    $('ai-level-panel').style.display = 'none';
    $('offline-panel').style.display = 'none';
    $('net-panel').style.display = '';
    $('chat-panel').style.display = '';
    $('btn-draw').style.display = '';
    $('btn-resign').style.display = '';
    showScene('game');
    $('chat-log').innerHTML = '';
    $('room-code').textContent = '----';
    $('room-code-hint').textContent = '正在连接服务器…';
    $('net-status').textContent = '连接中';
    $('net-status').className = 'net-status';
    if (!G.net) {
      G.net = new Net();
      bindNetEvents();
      if (G.net.connectIfReady(doAction)) doAction();
    } else {
      if (G.net.connected) doAction();
      else if (G.net.connectIfReady(doAction)) doAction();
    }
    function doAction() {
      // 若已有等待中的 open 回调，避免重复触发
      doAction.done = true;
      doPvpAction(action, room);
    }
    if (G.net && !G.net.connected && !doAction.done) {
      // 兜底轮询（open 竞态时 connectIfReady 已注册回调；这里 8 秒内每 300ms 检查一次）
      const wait = setInterval(() => {
        if (G.net && G.net.connected) { clearInterval(wait); if (!doAction.done) doAction(); }
      }, 300);
      setTimeout(() => clearInterval(wait), 8000);
    }
  }

  function doPvpAction(action, room) {
    if (action === 'quick') G.net.quick(G.myName);
    else if (action === 'create') G.net.create(G.myName);
    else if (action === 'join') G.net.join(room, G.myName);
  }

  function syncFromSnapshot(msg) {
    // joined/created/rejoined/room 快照
    G.st = XQ.stateFromFEN(msg.fen);
    G.notations = (msg.notations || []).slice();
    G.lastMove = msg.lastMove || null;
    G.over = msg.status === 'over';
    G.result = msg.result || null;
    if (msg.clocks) G.clocks = { red: msg.clocks.red, black: msg.clocks.black };
    // 座位
    const myId = G.net.myId;
    let seat = 0;
    if (msg.red && msg.red.id === myId) seat = 1;
    if (msg.black && msg.black.id === myId) seat = -1;
    if (seat) G.mySeat = seat;
    setPlayerCards();
    // 名牌
    const myRed = G.mySeat === 1;
    const oppName = myRed ? (msg.black && msg.black.name) : (msg.red && msg.red.name);
    $('me-name').textContent = (G.myName || '你') + (myRed ? '（红）' : '（黑）');
    $('opp-name').textContent = oppName ? oppName + (myRed ? '（黑）' : '（红）') : '等待对手…';
    $('opp-sub').textContent = msg.status === 'waiting' ? '等待对手加入' : (msg.black && msg.red ? '在线对弈中' : '对手掉线…');
    if (msg.room) {
      G.netRoom = msg.room;
      try { localStorage.setItem('xq-room', msg.room); } catch (e) {}
      $('room-code').textContent = msg.room;
      $('room-code-hint').textContent = msg.status === 'waiting' ? '把「🔗 复制邀请链接」发给朋友，打开即可加入' : '房间已建立';
    }
    redraw();
    renderNotation();
    refreshClocks();
  }

  function bindNetEvents() {
    const net = G.net;

    /* 电脑对手按钮：等待中显示（仅房主），开局后隐藏 */
    const shareable = !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    function inviteUrl() { return location.origin + '/?room=' + (G.netRoom || $('room-code').textContent || ''); }
    function refreshInvite(m) {
      const btn = $('btn-invite');
      if (!btn) return;
      const waiting = m && m.status === 'waiting' && !(m.red && m.red.id && m.black && m.black.id);
      const isHost = m && m.red && m.red.id && m.red.id === net.myId;
      btn.style.display = (waiting && isHost && shareable) ? '' : 'none';
    }
    function refreshAIButton(m) {
      const btn = $('btn-add-ai');
      if (!btn) return;
      const waiting = m && m.status === 'waiting' && !(m.red && m.red.id && m.black && m.black.id);
      const isHost = m && m.red && m.red.id && m.red.id === net.myId;
      btn.style.display = (waiting && isHost) ? '' : 'none';
    }
    net.on('created', refreshAIButton);
    net.on('created', refreshInvite);
    net.on('room', refreshAIButton);
    net.on('room', refreshInvite);
    $('btn-invite').onclick = async () => {
      const link = inviteUrl();
      try { await navigator.clipboard.writeText(link); }
      catch (e) {
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      $('btn-invite').textContent = '✓ 链接已复制，发给朋友吧';
      setTimeout(() => { $('btn-invite').textContent = '🔗 复制邀请链接'; }, 2000);
    };
    net.on('ai-added', (m) => chatSys('已添加电脑对手：' + (m.name || '皮卡鱼')));
    $('btn-add-ai').onclick = () => {
      SFX.S.click();
      net.send({ t: 'add-ai' });
      $('btn-add-ai').style.display = 'none';
    };

    net.on('created', (m) => { syncFromSnapshot(m); chatSys('房间已创建，等待对手…'); });
    net.on('joined', (m) => { syncFromSnapshot(m); refreshAIButton(m); refreshInvite(m); refreshReady(m); });
    net.on('readying', (m) => { syncFromSnapshot(m); refreshReady(m.ready); });
    net.on('ready-update', (m) => refreshReady(m.ready));
    $('btn-ready').onclick = () => {
      SFX.S.click();
      net.send({ t: 'ready', on: !G.myReady });
    };
    function refreshReady(ready) {
      const btn = $('btn-ready');
      if (!btn) return;
      if (G.mode !== 'pvp' || !ready || G.over) { btn.style.display = 'none'; return; }
      const myKey = G.mySeat === 1 ? '1' : '-1';
      const oppKey = G.mySeat === 1 ? '-1' : '1';
      G.myReady = !!ready[myKey];
      btn.style.display = '';
      btn.disabled = !!ready[myKey];
      btn.textContent = ready[myKey]
        ? '⌛ 已准备，等待对方…'
        : (ready[oppKey] ? '✅ 对方已准备，点击准备开局' : '✅ 准备开局');
    }
    net.on('rejoined', (m) => { syncFromSnapshot(m); chatSys('已重新连接'); refreshAIButton(m); refreshInvite(m); });
    net.on('start', (m) => {
      const aiBtn = $('btn-add-ai');
      if (aiBtn) aiBtn.style.display = 'none';
      const readyBtn = $('btn-ready');
      if (readyBtn) readyBtn.style.display = 'none';
      G.st = XQ.stateFromFEN(m.fen);
      G.notations = []; G.over = false; G.result = null; G.lastMove = null; G.mateType = null;
      G.clocks = { red: m.clocks.red, black: m.clocks.black };
      // 换先手重开后座位可能变化：按 playerId 重新判定
      if (m.redId && m.blackId) {
        if (m.redId === net.myId) G.mySeat = 1;
        else if (m.blackId === net.myId) G.mySeat = -1;
      }
      setPlayerCards();
      const myRed = G.mySeat === 1;
      $('me-name').textContent = (G.myName || '你') + (myRed ? '（红）' : '（黑）');
      $('opp-name').textContent = (myRed ? m.black : m.red) + (myRed ? '（黑）' : '（红）');
      $('opp-sub').textContent = '在线对弈中';
      $('room-code-hint').textContent = '对局进行中';
      FX.clear();
      ['btn-undo', 'btn-resign', 'btn-draw'].forEach(id => $(id).disabled = false);
      redraw();
      renderNotation();
      refreshClocks();
      chatSys('对局开始，红方先行' + (G.mySeat === 1 ? '，你执红' : '，你执黑'));
      startLocalClock();
    });
    net.on('move', (m) => {
      // 若是自己走的（本地已乐观应用），跳过重复应用
      const isMine = G.lastMove && G.lastMove.from === m.from && G.lastMove.to === m.to;
      if (isMine && G.pendingBackup) { G.pendingBackup = null; }
      if (!isMine) {
        // 服务器权威：从 FEN 重建再播放动画
        const backupFen = XQ.toFEN(G.st);
        G.st = XQ.stateFromFEN(m.fen);
        G.notations.push(m.notation);
        G.lastMove = { from: m.from, to: m.to };
        const cap = m.cap || 0;
        redraw({ animate: true, captured: cap });
        const toXY = board.xy(m.to);
        FX.ripple(toXY);
        SFX.S.drop();
        if (cap !== 0) { setTimeout(() => { FX.slash(board.xy(m.to)); SFX.S.capture(); }, 130); }
      }
      if (m.clocks) G.clocks = { red: m.clocks.red, black: m.clocks.black };
      if (m.checked) { setTimeout(() => { FX.banner('将军！', { cls: 'check' }); SFX.S.check(); }, 300); }
      renderNotation();
      refreshClocks();
      if (m.end) finishGame(m.end.winner, m.end.reason, m.end.mateType);
      G.clockWarned = false;
    });
    net.on('clock', (m) => {
      if (m.clocks) {
        G.clocks = { red: m.clocks.red, black: m.clocks.black };
        refreshClocks();
        warnClock();
      }
    });
    net.on('end', (m) => {
      if (G.over) return;
      G.over = true;
      G.clocks = m.clocks || G.clocks;
      finishGame(m.winner, m.reason, m.mateType);
      refreshClocks();
    });
    net.on('rematch-offer', (m) => {
      if (m.from === net.myId) return;
      SFX.S.ask();
      chatSys('对方请求再来一局（换先手），点击「再来一局」按钮确认');
    });
    net.on('error', (m) => {
      chatSys('⚠ ' + (m.error || '未知错误'));
      if (G.viaInvite && /不存在|已满|结束/.test(m.error || '')) {
        G.viaInvite = false;
        try { FX.banner('房间不存在或已开始，请联系邀请人重新发送链接', { hold: 3000 }); } catch (e2) {}
      }
      // 本地乐观走子被拒 → 回滚
      if (G.pendingBackup && /轮到|合法/.test(m.error || '')) {
        G.st = XQ.stateFromFEN(G.pendingBackup.fen);
        G.notations = G.pendingBackup.notations;
        G.lastMove = G.pendingBackup.lastMove;
        G.pendingBackup = null;
        redraw();
        renderNotation();
      }
    });
    net.on('chat', (m) => chatAdd(m.from, m.text, m.seat));
    net.on('draw-offer', (m) => {
      if (m.from === net.myId) { chatSys('已发出求和请求'); return; }
      SFX.S.ask();
      showConfirm('draw', '对方求和，是否同意？');
    });
    net.on('draw-decline', () => { chatSys('对方拒绝了求和'); hideConfirm(); });
    net.on('undo-offer', (m) => {
      if (m.from === net.myId) { chatSys('已发出悔棋请求'); return; }
      SFX.S.ask();
      showConfirm('undo', '对方请求悔棋，是否同意？');
    });
    net.on('undo-decline', () => { chatSys('对方拒绝了悔棋'); hideConfirm(); });
    net.on('undo', (m) => {
      G.st = XQ.stateFromFEN(m.fen);
      G.notations = (m.notations || []).slice();
      G.lastMove = m.lastMove || null;
      G.over = false; G.result = null;
      FX.clear();
      redraw();
      renderNotation();
      refreshClocks();
      chatSys('悔棋成功，退回两步');
      $('notation-panel') && document.querySelector('.notation-panel').classList.add('undo-flash');
      setTimeout(() => document.querySelector('.notation-panel').classList.remove('undo-flash'), 1600);
    });
    net.on('peer-offline', () => {
      $('opp-sub').textContent = '⚠ 对手掉线（60 秒内可重连）';
      chatSys('对手掉线');
    });
    net.on('peer-online', () => {
      $('opp-sub').textContent = '在线对弈中';
      chatSys('对手回来了');
    });
    net.on('close', (m) => {
      $('net-status').textContent = '连接断开，自动重连中…';
      $('net-status').className = 'net-status bad';
      if (G.mode === 'pvp' && G.netRoom) {
        chatSys('与服务器断开，正在重连…');
      }
    });
    net.on('open', () => {
      $('net-status').textContent = '已连接';
      $('net-status').className = 'net-status ok';
      if (G.mode === 'pvp' && G.netRoom && net.wasConnected) {
        net.join(G.netRoom, G.myName);   // 凭 playerId 重连
      }
      net.wasConnected = true;
    });
    // 页面刷新后：若上次在对局房间，自动重连并恢复联机界面
    net.on('open', function onceAuto() {
      net.off && net.off('open', onceAuto);
      const urlRoom = (() => { try { return (new URLSearchParams(location.search).get('room') || '').toUpperCase(); } catch (e) { return ''; } })();
      const savedRoom = (() => { try { return localStorage.getItem('xq-room'); } catch (e) { return null; } })();
      const target = urlRoom || savedRoom;
      if (urlRoom) {
        G.viaInvite = true;
        try { history.replaceState(null, '', location.pathname); } catch (e) {}   // 用完即清，防刷新循环
      }
      if (target && !G.netRoom && G.mode !== 'pvp') {
        // 恢复 pvp 场景（保存的房间在服务器上可能已结束/消失，凭 playerId 重连失败则留在原处）
        G.mode = 'pvp';
        hideEvalBar();
        G.netRoom = savedRoom;
        G.myName = G.myName || localStorage.getItem('xq-name') || '玩家';
        $('ai-level-panel').style.display = 'none';
        $('offline-panel').style.display = 'none';
        $('net-panel').style.display = '';
        $('chat-panel').style.display = '';
        $('btn-draw').style.display = '';
        $('btn-resign').style.display = '';
        showScene('game');
        $('room-code').textContent = savedRoom;
        $('room-code-hint').textContent = '正在恢复对局…';
        net.join(savedRoom, G.myName);
      } else if (G.mode === 'pvp' && savedRoom && !G.netRoom) {
        G.netRoom = savedRoom;
        net.join(savedRoom, G.myName);
      }
    });
    net.on('net-error', () => {
      $('net-status').textContent = '无法连接服务器';
      $('net-status').className = 'net-status bad';
    });
  }

  function startLocalClock() {
    // 本地 200ms 心跳显示（服务器 10s 校准一次）
    if (G.clockTimer) clearInterval(G.clockTimer);
    G.clockTimer = setInterval(() => {
      if (G.mode !== 'pvp' || G.over) return;
      const el = 200;
      const turnRed = G.st.turn === 1;
      if (turnRed) G.clocks.red = Math.max(0, G.clocks.red - el);
      else G.clocks.black = Math.max(0, G.clocks.black - el);
      refreshClocks();
      warnClock();
    }, 200);
  }

  function warnClock() {
    const myRed = G.mySeat === 1;
    const mine = myRed ? G.clocks.red : G.clocks.black;
    if (mine < 30000 && !G.clockWarned && !G.over) {
      G.clockWarned = true;
      SFX.S.warn();
      FX.banner('注意时间', { cls: 'check', hold: 1100 });
    }
  }

  function chatAdd(who, text, seat) {
    const log = $('chat-log');
    const div = document.createElement('div');
    div.innerHTML = `<span class="who ${seat === 1 ? 'red' : 'black'}">${escapeHtml(who)}：</span>${escapeHtml(text)}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  function chatSys(text) {
    const log = $('chat-log');
    if (!log) return;
    const div = document.createElement('div');
    div.className = 'sys';
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 求和/悔棋确认条 ---------- */
  function showConfirm(kind, text) {
    G.pendingConfirm = kind;
    $('confirm-txt').textContent = text;
    $('confirm-bar').classList.add('show');
  }
  function hideConfirm() {
    G.pendingConfirm = null;
    $('confirm-bar').classList.remove('show');
  }
  $('confirm-yes').onclick = () => {
    SFX.S.click();
    const kind = G.pendingConfirm;
    hideConfirm();
    if (kind === 'draw') G.net.drawAccept(true);
    else if (kind === 'undo') G.net.undoAccept(true);
  };
  $('confirm-no').onclick = () => {
    SFX.S.click();
    const kind = G.pendingConfirm;
    hideConfirm();
    if (kind === 'draw') G.net.drawAccept(false);
    else if (kind === 'undo') G.net.undoAccept(false);
  };

  /* ---------- 通用操作按钮 ---------- */
  $('btn-undo').onclick = () => {
    if (G.mode === 'offline') {
      if (!G.notations.length) return;
      SFX.S.click();
      G.suggestToken++;
      XQ.unmake(G.st);
      G.notations.pop();
      G.offlineLog.pop();
      G.over = false; G.result = null; G.lastMove = null; G.mateType = null;
      FX.clear();
      board.clearHint();
      ['btn-undo', 'btn-resign', 'btn-draw'].forEach(id => $(id).disabled = false);
      $('opp-sub').textContent = '真实棋友 · 录入其着法';
      $('me-sub').textContent = '执' + (G.mySeat === 1 ? '红先行' : '黑后行') + ' · AI 全力支招';
      redraw();
      renderNotation();
      refreshClocks();
      /* 自动替走模式：悔棋后暂停，由用户确认是否重算（避免与实体棋盘动作打架） */
      if ($('autopilot').checked) {
        G.autopilotPaused = true;
        if (!G.over && G.st.turn === G.mySeat) showPausedUI();
        else setOfflineWait();
      } else {
        afterOfflineMove();
      }
      return;
    }
    if (G.mode === 'pve' || G.mode === 'endgame') {
      if (G.notations.length === 0) return;
      SFX.S.click();
      const steps = (G.st.turn === G.mySeat) ? 2 : 1;  // 轮到我→撤对方+我；轮到 AI→撤我的
      for (let i = 0; i < steps && G.ply; i++) { /* 用 XQ unmake */ }
      // 重建更稳妥：直接 unmake
      const n = Math.min(steps, G.notations.length);
      for (let i = 0; i < n; i++) {
        XQ.unmake(G.st);
        G.notations.pop();
      }
      G.over = false; G.result = null;
      FX.clear();
      G.lastMove = G.notations.length ? null : null;
      G.lastMove = null;
      redraw();
      renderNotation();
      chatSys && $('ai-info') && ($('ai-info').textContent = '');
      G.thinkToken++;   // 作废 AI 计算
      maybeAI();
    } else if (G.mode === 'pvp') {
      if (!G.net || !G.net.connected) return;
      SFX.S.click();
      G.net.undoOffer();
    }
  };

  $('btn-restart').onclick = () => {
    SFX.S.click();
    if (G.mode === 'offline') startOffline(G.mySeat);
    else if (G.mode === 'pve') resetGame();
    else if (G.mode === 'pvp') {
      // 联机重开：退房再建房太粗暴——由服务器实现 rematch 可扩展；这里提示
      chatSys('联机模式请通过房间码重新开局（当前版本）');
    }
  };

  $('btn-resign').onclick = () => {
    if (G.over) return;
    if (G.mode === 'pve') {
      SFX.S.click();
      finishGame(G.aiSeat, 'resign');
    } else if (G.mode === 'pvp') {
      if (!G.net || !G.net.connected) return;
      SFX.S.click();
      G.net.resign();
    }
  };

  $('btn-draw').onclick = () => {
    if (G.mode !== 'pvp' || G.over) return;
    if (!G.net || !G.net.connected) return;
    SFX.S.click();
    G.net.drawOffer();
  };


  /* 支招评分 → 玩家视角人话解读 */
  function hintScoreText(score) {
    // 引擎分是'当前行棋方'视角；支招在你回合算 → 分数就是你的视角
    if (score > 29000) return '即将绝杀对方！';
    if (score < -29000) return '⚠ 已被对方算出杀棋，这步只能拖延，建议直接认输或悔棋';
    if (score > 900) return '大优（领先约一个车）';
    if (score > 400) return '明显占优';
    if (score > 100) return '略占上风';
    if (score > -100) return '局面均势';
    if (score > -400) return '略微落后';
    if (score > -900) return '明显劣势，注意防守';
    return '大劣（落后约一个车），稳住阵脚';
  }

  /* ---------- 支招：大师档引擎给当前局面算最佳着法 ---------- */
  $('btn-hint').onclick = async () => {
    if (G.over) { chatSys('对局已结束'); return; }
    if (G.mode === 'offline') {
      // 线下模式：支招自动触发，此按钮用于重算/重看建议
      if (G.st.turn !== G.mySeat) { setOfflineWait(); return; }
      SFX.S.click();
      offlineSuggest();
      return;
    }
    const myTurnNow = (G.mode === 'pvp') ? (G.st.turn === G.mySeat && G.net && G.net.connected) : (G.st.turn === G.mySeat);
    if (!myTurnNow) { chatSys('现在轮到对方走，等轮到你时再支招'); return; }
    const btn = $('btn-hint');
    if (btn.disabled) return;
    SFX.S.click();
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '💡 思考中…';
    board.clearHint();
    const fen = XQ.toFEN(G.st);
    try {
      // 第一优先：服务器托管的皮卡鱼（NNUE 权重），不可用则回退内置大师档
      let done = false;
      try {
        const resp = await fetch('/api/bestmove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen, movetime: 1500 }),
        });
        if (resp.ok) {
          const j = await resp.json();
          if (j.legal && j.from != null && !G.over && XQ.toFEN(G.st) === fen) {
            board.showHint(j.from, j.to);
            const notation = j.notation || XQ.moveToChinese(G.st, XQ.encode(j.from, j.to));
            // 顺带点亮胜率条：联机/人机点支招也能看到局势走向
            $('evalbar').style.display = 'block';
            setEvalBar(j.score, j.kind, G.mySeat);
            if (G.mode === 'pve' || G.mode === 'endgame') {
              $('ai-info').textContent = '💡 支招【皮卡鱼】：' + notation + '（' + hintScoreText(j.score) + ' · 胜率 ' + winRateText(j.score) + '% · 深度 ' + j.depth + '）';
            } else {
              chatSys('💡 支招【皮卡鱼】：' + notation + '（' + hintScoreText(j.score) + ' · 胜率 ' + winRateText(j.score) + '%）');
            }
            SFX.S.ask();
            done = true;
          }
        }
      } catch (e) { /* 服务器未开/引擎缺失 → 内置 */ }
      if (done) return;
      if (G.over || XQ.toFEN(G.st) !== fen) return;
      // 回退：内置大师档全力算（禁开局库，4 秒预算，深度上限拉满）
      const r = await aiWorkerCall(G.st, 5, 4000, 20, false);
      if (!r || !r.move) return;
      if (G.over || XQ.toFEN(G.st) !== fen) return;
      board.showHint(r.move.from, r.move.to);
      const notation = XQ.moveToChinese(G.st, (r.move.from << 7) | r.move.to);
      $('evalbar').style.display = 'block';
      setEvalBar(r.score, 'cp', G.mySeat);
      if (G.mode === 'pve' || G.mode === 'endgame') {
        $('ai-info').textContent = '💡 支招【内置】：' + notation + '（' + hintScoreText(r.score) + '，深度 ' + r.depth + '）';
      } else {
        chatSys('💡 支招【内置】：' + notation + '（' + hintScoreText(r.score) + '，箭头 6 秒后消失）');
      }
      SFX.S.ask();
    } catch (e) {
      chatSys('支招计算出错，请重试');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  };

  $('btn-back').onclick = () => {
    SFX.S.click();
    if (G.mode === 'pvp' && G.net) {
      if (confirm('离开将放弃当前对局，确定？')) { G.net.leave(); G.netRoom = null; }
      else return;
    }
    sbStopDemo && sbStopDemo();
    $('dialog-sandbox') && $('dialog-sandbox').classList.remove('show');
    G.mode = 'lobby';
    hideEvalBar();
    G.thinkToken++;
    if (G.clockTimer) clearInterval(G.clockTimer);
    FX.clear();
    $('eg-bar').classList.remove('show');
    showScene('lobby');
    updateLobbyNet();
    renderStatsPanel();   // 回大厅刷新战绩
  };

  $('btn-sound').onclick = () => {
    const on = $('btn-sound').textContent.includes('开');
    // 切换
    const newState = !on;
    SFX.on(newState);
    $('btn-sound').textContent = newState ? '🔊 音效' : '🔇 静音';
  };

  /* ---------- 聊天 ---------- */
  $('chat-send').onclick = sendChat;
  $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  function sendChat() {
    const input = $('chat-input');
    const text = input.value.trim();
    if (!text || G.mode !== 'pvp' || !G.net || !G.net.connected) return;
    G.net.chat(text);
    chatAdd(G.myName || '我', text, G.mySeat);
    input.value = '';
  }

  /* ---------- 大厅 ---------- */
  function updateLobbyNet() {
    const addr = location.host;
    $('lobby-server-addr').textContent = addr;
    const st = $('lobby-net-state');
    if (G.net && G.net.connected) { st.textContent = '已连接'; st.className = 'net-status ok'; }
    else { st.textContent = '未连接（进联机时自动连接）'; st.className = 'net-status'; }
  }

  /* ---------- 大厅战绩面板 ---------- */
  function renderStatsPanel() {
    const name = G.myName || '默认玩家';
    $('stats-name').textContent = '「' + name + '」的战绩';
    const s = Stats.summary(name);
    if (!s) {
      $('stat-pve').textContent = '暂无对局';
      $('stat-pvp').textContent = '暂无对局';
      $('stat-eg').textContent = '未开始';
      ['stat-pve-rate', 'stat-pvp-rate', 'stat-eg-rate'].forEach(id => $(id).textContent = '—');
      return;
    }
    $('stat-pve').textContent = s.pve.win + '胜' + s.pve.lose + '负';
    $('stat-pve-rate').textContent = s.pve.total ? s.pve.rate + '% 胜率' : '—';
    $('stat-pvp').textContent = s.pvp.win + '胜' + s.pvp.lose + '负' + (s.pvp.draw ? ' ' + s.pvp.draw + '和' : '');
    $('stat-pvp-rate').textContent = (s.pvp.win + s.pvp.lose) ? s.pvp.rate + '% 胜率' : '—';
    const cleared = s.endgame.cleared.length;
    $('stat-eg').textContent = '通过 ' + cleared + '/10 关';
    $('stat-eg-rate').textContent = s.endgame.total ? s.endgame.rate + '% 成功率' : '—';
  }

  /* ---------- 大厅登录 / 注册（输昵称即可，首次自动注册） ---------- */
  function setLoginState(logged, name) {
    G.loggedIn = logged;
    const st = $('login-state');
    st.className = 'login-state' + (logged ? ' logged' : '');
    st.textContent = logged
      ? '✓ 当前用户：' + name + '（联机对战已就绪）'
      : '未登录 — 人机 / 残局 / 沙盘可直接玩；联机对战需先登录';
    renderStatsPanel();
  }
  const DICE_A = ['踏雪', '追风', '凌云', '听雨', '望月', '惊鸿', '断浪', '摘星', '寒江', '孤灯', '逐日', '听涛'];
  const DICE_B = ['小棋王', '大将军', '老棋痴', '少年游', '百胜将', '卧龙生', '金枪手', '神算子'];
  $('btn-dice').onclick = () => {
    SFX.S.click();
    $('login-name').value = DICE_A[(Math.random() * DICE_A.length) | 0] + DICE_B[(Math.random() * DICE_B.length) | 0];
  };
  $('btn-login').onclick = async () => {
    const name = $('login-name').value.trim();
    if (!name) { $('login-name').focus(); FX.banner('先输入昵称，或点骰子随机取一个'); return; }
    $('btn-login').disabled = true;
    try {
      const resp = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const j = await resp.json();
      if (!j.ok) { FX.banner(j.error || '登录失败'); return; }
      G.myName = j.name;
      G.loggedIn = true;
      localStorage.setItem('xq-name', j.name);
      localStorage.setItem('xq-token', j.token);
      setLoginState(true, j.name);
      FX.banner(j.isNew ? '注册成功：' + j.name : '欢迎回来：' + j.name, { hold: 1600 });
      SFX.S.win();
    } catch (e) {
      FX.banner('登录失败：服务器未响应');
    } finally {
      $('btn-login').disabled = false;
    }
  };
  /* 启动时恢复登录态（本机以前登录过的用户名 + token） */
  (function restoreLogin() {
    const savedName = localStorage.getItem('xq-user') || localStorage.getItem('xq-name');
    const savedToken = localStorage.getItem('xq-token');
    if (savedName && savedToken) {
      G.myName = savedName;
      G.loggedIn = true;
      $('login-name').value = savedName;
      setLoginState(true, savedName);
    }
  })();

  /* ---------- 启动 ---------- */
  bindPveUI();
  bindPvpUI();
  bindEndgameUI();
  bindOfflineUI();
  bindSandboxUI();
  $('btn-sandbox').onclick = () => { SFX.S.click(); openSandbox(XQ.toFEN(G.st), null, 0); };   // 全局沙盘入口（所有对战模式）
  fitBoard();

  /* 邀请链接：?room=XXXX 打开页面即自动连服务器并入房 */
  const urlRoomParam = (() => {
    try { return (new URLSearchParams(location.search).get('room') || '').toUpperCase(); } catch (e) { return ''; }
  })();
  if (urlRoomParam && /^[A-Z0-9]{4}$/.test(urlRoomParam)) {
    G.myName = G.myName || localStorage.getItem('xq-name') || ('客人' + ((Math.random() * 900 + 100) | 0));
    try { localStorage.setItem('xq-name', G.myName); } catch (e) {}
    if (!G.net) { G.net = new Net(); bindNetEvents(); }
    G.net.connect();
    /* 连接 open 后，bindNetEvents 内的 onceAuto 会读取 ?room= 并恢复联机场景加入房间 */
  }
  updateLobbyNet();
  renderStatsPanel();
  setPlayerCards();
  redraw();
})(window);
