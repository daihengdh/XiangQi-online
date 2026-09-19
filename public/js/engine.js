/* engine.js — 象棋 AI 搜索引擎（浏览器 / Worker / Node 通用）
 * negamax + alpha-beta + 迭代加深 + 置换表 + 杀手/历史启发 + 静态搜索 + 将军延伸
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const XQ = (typeof require !== 'undefined' && typeof module !== 'undefined' && module.exports)
    ? null : (typeof self !== 'undefined' ? self.XQ : root.XQ);
  // Node 环境在下方 require；浏览器/Worker 用全局 XQ
  let XQRef = XQ;
  if (!XQRef && typeof require === 'function') { try { XQRef = require('./rules.js'); } catch (e) { XQRef = null; } }
  const X = XQRef || X;

  const { RED, BLACK, K, A, B, N, R, C, P, stateFromFEN, genMoves, make, unmake, inCheck, legalMoves, encode, START_FEN, toFEN } = X;

  /* ---------- 难度分级 ---------- */
  const LEVELS = {
    1: { name: '入门', depth: 1, time: 300,  noise: 260, fullWindow: true },
    2: { name: '初级', depth: 2, time: 500,  noise: 90,  fullWindow: true },
    3: { name: '中级', depth: 3, time: 900,  noise: 0 },
    4: { name: '高级', depth: 4, time: 1600, noise: 0 },
    5: { name: '大师', depth: 12, time: 2600, noise: 0 },
  };

  /* ---------- Zobrist ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return (t ^ t >>> 14) >>> 0;
    };
  }
  const rnd = mulberry32(0x5EEDC0DE);
  const ZOB1 = new Int32Array(90 * 14), ZOB2 = new Int32Array(90 * 14);
  for (let i = 0; i < 90 * 14; i++) { ZOB1[i] = rnd() | 0; ZOB2[i] = rnd() | 0; }
  const ZTURN1 = rnd() | 0, ZTURN2 = rnd() | 0;
  function codeOf(p) { return p > 0 ? p - 1 : 6 - p; }  // p∈[±1..±7] → 0..13

  /* ---------- 局面评估 ---------- */
  const VAL = [0, 0, 250, 250, 430, 950, 470, 100]; // 下标按棋子编码：2士 3象 4马 5车 6炮 7兵

  function pst(t, red, r, c) {
    const rr = red ? r : 9 - r;   // 距己方底线的行数
    switch (t) {
      case P: {
        if (rr >= 5) return 0;
        let v = 45 + (4 - rr) * 9;
        v += (rr >= 2) ? 8 : -6;
        v += (c >= 2 && c <= 6) ? 6 : -4;
        if (rr <= 2 && c >= 3 && c <= 5) v += 10;
        return v;
      }
      case N: {
        let v = 0;
        if (c === 0 || c === 8) v -= 18; else if (c === 1 || c === 7) v -= 6;
        if (rr >= 1 && rr <= 8) v += 6;
        if (rr >= 2 && rr <= 7 && c >= 2 && c <= 6) v += 6;
        return v;
      }
      case R: {
        let v = 6 - Math.abs(c - 4) * 2;
        if (rr <= 4) v += 10;
        return v;
      }
      case C: {
        let v = 10 - Math.abs(c - 4) * 2;
        if (rr >= 2 && rr <= 4) v += 8;
        return v;
      }
      default: return 0;
    }
  }

  function evaluate(st) {
    const b = st.board;
    let score = 0, phase = 0, redA = 0, redB = 0, blackA = 0, blackB = 0;
    for (let i = 0; i < 90; i++) {
      const p = b[i]; if (!p) continue;
      const red = p > 0, t = red ? p : -p;
      const r = (i / 9) | 0, c = i % 9;
      const v = VAL[t] + pst(t, red, r, c);
      if (t === A) { if (red) redA++; else blackA++; }
      else if (t === B) { if (red) redB++; else blackB++; }
      else if (t !== K) phase += VAL[t];
      score += red ? v : -v;
    }
    score += (redA - blackA) * 15 + (redB - blackB) * 10;  // 士象完整度（将安全）
    if (phase < 2200) {  // 残局：将出宫参与战斗
      const kr = (st.kings[0] / 9) | 0, bk = (st.kings[1] / 9) | 0;
      score += (kr < 7 ? (7 - kr) * 5 : 0) - (bk > 2 ? (bk - 2) * 5 : 0);
    }
    return st.turn === RED ? score : -score;
  }

  /* ---------- 搜索框架 ---------- */
  const MATE = 30000, INF = 32000, MAXPLY = 96;
  const TT_BITS = 19, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const ttKey1 = new Int32Array(TT_SIZE), ttKey2 = new Int32Array(TT_SIZE);
  const ttMove = new Int32Array(TT_SIZE), ttScore = new Int32Array(TT_SIZE);
  const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE);
  const killers = new Int32Array(MAXPLY * 2);
  const histH = new Int32Array(90 * 90);
  const moveStack = [];
  for (let i = 0; i < MAXPLY + 4; i++) moveStack.push(new Int32Array(256));
  const scoreScratch = new Int32Array(256);
  const pathKeys1 = new Int32Array(MAXPLY + 2), pathKeys2 = new Int32Array(MAXPLY + 2);
  let rootH1 = 0, rootH2 = 0;   // 根局面哈希（对局历史重复检测）
  let histSet = null;             // 对局全部历史局面哈希（"局面:局面" 字符串集合）

  let nodes = 0, deadline = 0;
  let curH1 = 0, curH2 = 0;
  let ST = null;
  const TIMEOUT = {};

  function checkTime() {
    if ((nodes & 1023) === 0 && Date.now() > deadline) throw TIMEOUT;
  }

  function applyZ(m, cap, mover) {
    const from = m >>> 7, to = m & 127;
    const z1f = ZOB1[from * 14 + codeOf(mover)], z2f = ZOB2[from * 14 + codeOf(mover)];
    const z1t = ZOB1[to * 14 + codeOf(mover)], z2t = ZOB2[to * 14 + codeOf(mover)];
    curH1 ^= z1f ^ z1t ^ ZTURN1; curH2 ^= z2f ^ z2t ^ ZTURN2;
    if (cap) { curH1 ^= ZOB1[to * 14 + codeOf(cap)]; curH2 ^= ZOB2[to * 14 + codeOf(cap)]; }
  }

  function orderMoves(buf, n, ply, ttM) {
    const b = ST.board;
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      let s;
      if (m === ttM) s = 1 << 30;
      else {
        const to = m & 127, cap = b[to];
        if (cap !== 0) {
          const vc = cap < 0 ? -cap : cap;
          const from = m >>> 7, atk = b[from], ac = atk < 0 ? -atk : atk;
          s = (1 << 20) + (vc === K ? 9000 : VAL[vc] * 16) - VAL[ac];
        }
        else if (m === killers[ply * 2]) s = 1 << 19;
        else if (m === killers[ply * 2 + 1]) s = (1 << 19) - 1;
        else s = histH[(m >>> 7) * 90 + (m & 127)];
      }
      scoreScratch[i] = s;
    }
    for (let i = 1; i < n; i++) {   // 插入排序
      const m = buf[i], s = scoreScratch[i];
      let j = i - 1;
      while (j >= 0 && scoreScratch[j] < s) { buf[j + 1] = buf[j]; scoreScratch[j + 1] = scoreScratch[j]; j--; }
      buf[j + 1] = m; scoreScratch[j + 1] = s;
    }
  }

  /* 静态搜索：只延伸吃子；被将军时全量应将 */
  function qsearch(alpha, beta, ply) {
    nodes++; checkTime();
    const st = ST, side = st.turn;
    const chk = inCheck(st, side);
    let best;
    if (!chk) {
      best = evaluate(st);
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    } else best = -INF;
    if (ply >= MAXPLY - 2) return evaluate(st);
    const buf = moveStack[ply];
    const n = genMoves(st, buf, !chk);
    orderMoves(buf, n, ply, 0);
    let legal = 0;
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      const from = m >>> 7, to = m & 127;
      const mover = st.board[from], cap = st.board[to];
      make(st, m); applyZ(m, cap, mover);
      let sc;
      if (cap === (side === RED ? -K : K)) sc = MATE - ply;
      else if (inCheck(st, side)) sc = -INF - 1;
      else sc = -qsearch(-beta, -alpha, ply + 1);
      applyZ(m, cap, mover); unmake(st);
      if (sc <= -INF) continue;
      legal++;
      if (sc > best) {
        best = sc;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) break;
        }
      }
    }
    if (chk && legal === 0) return -(MATE - ply);  // 被将死
    return best;
  }

  function search(depth, alpha, beta, ply, isNull) {
    nodes++; checkTime();
    const st = ST;
    if (ply > 0) {
      // 路径重复按和棋处理（含对局历史——防止走出与历史重复的将军循环）
      if (histSet && histSet.has((curH1 >>> 0) + ':' + (curH2 >>> 0)) && ply >= 2) return 0;
      for (let i = ply - 2; i >= 0 && i >= ply - 12; i -= 2) {
        if (pathKeys1[i] === curH1 && pathKeys2[i] === curH2) return 0;
      }
      if (st.half >= 120) return 0;
    }
    if (ply >= MAXPLY - 2) return evaluate(st);
    const side = st.turn;
    const chk = inCheck(st, side);
    if (chk && ply < 60) depth++;   // 将军延伸
    if (depth <= 0) return qsearch(alpha, beta, ply);

    // 空着裁剪：让对手白走一步仍占优 → 剪。被将军/浅层/已到杀区时不适用
    if (!isNull && !chk && depth >= 3 && ply > 0 && Math.abs(beta) < MATE - 1000) {
      curH1 ^= ZTURN1; curH2 ^= ZTURN2;      // 翻转行棋方（空着）
      const nv = -search(depth - 3, -beta, -beta + 1, ply + 1, true);
      curH1 ^= ZTURN1; curH2 ^= ZTURN2;
      if (nv >= beta) return beta;
    }

    const idx = curH1 & TT_MASK;
    let ttM = 0;
    if (ttKey1[idx] === curH1 && ttKey2[idx] === curH2) {
      ttM = ttMove[idx];
      if (ttDepth[idx] >= depth) {
        let s = ttScore[idx];
        if (s > MATE - 1000) s -= ply; else if (s < -MATE + 1000) s += ply;
        const f = ttFlag[idx];
        if (f === 1) return s;
        if (f === 2 && s >= beta) return s;
        if (f === 3 && s <= alpha) return s;
      }
    }

    pathKeys1[ply] = curH1; pathKeys2[ply] = curH2;
    const buf = moveStack[ply];
    const n = genMoves(st, buf, false);
    orderMoves(buf, n, ply, ttM);

    let best = -INF, bestMove = 0, legal = 0;
    const alphaOrig = alpha;
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      const from = m >>> 7, to = m & 127;
      const mover = st.board[from], cap = st.board[to];
      make(st, m); applyZ(m, cap, mover);
      let sc;
      if (cap === (side === RED ? -K : K)) sc = MATE - ply;
      else if (inCheck(st, side)) sc = -INF - 1;
      else if (i === 0) {
        sc = -search(depth - 1, -beta, -alpha, ply + 1, false);   // 第一个着法全窗口
      } else {
        // PVS：后续着法先用零窗口试探，只有真的更好才重新展开
        sc = -search(depth - 1, -alpha - 1, -alpha, ply + 1, false);
        if (sc > alpha && sc < beta) {
          sc = -search(depth - 1, -beta, -alpha, ply + 1, false);
        }
      }
      applyZ(m, cap, mover); unmake(st);
      if (sc <= -INF) continue;
      legal++;
      if (sc > best) {
        best = sc; bestMove = m;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) {
            if (cap === 0) {
              if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
              histH[from * 90 + to] += depth * depth;
            }
            break;
          }
        }
      }
    }
    if (legal === 0) return -(MATE - ply);  // 将死或困毙
    ttKey1[idx] = curH1; ttKey2[idx] = curH2;
    ttMove[idx] = bestMove;
    ttDepth[idx] = depth;
    let sStore = best;
    if (sStore > MATE - 1000) sStore += ply; else if (sStore < -MATE + 1000) sStore -= ply;
    ttScore[idx] = sStore;
    ttFlag[idx] = best >= beta ? 2 : (best > alphaOrig ? 1 : 3);
    return best;
  }

  /* ---------- 开局库：8 条经典主线（中文记谱经规则引擎校验合法） ----------
   * 匹配方式：当前局面 FEN 命中某条线的第 k 步局面 → 返回该线第 k 步着法。
   * 多条线同时命中时随机选，保证前几个回合走出像样定式且不重复。 */
  const BOOK_LINES = [
    ['炮二平五','马8进7','马二进三','车9平8','车一平二','卒7进1','车二进四','炮8平9'],   // 中炮对屏风马
    ['炮二平五','炮8平5','马二进三','马8进7','车一平二','车9进1','车二进六','车9平4'],   // 中炮对顺炮
    ['炮二平五','马8进7','马二进三','炮2平1','车九进一','车9平8'],                        // 中炮直车对卒底炮
    ['相三进五','象3进5','马二进三','卒3进1','兵三进一','马2进3','炮八平六','车1平2'],   // 飞相局对挺卒
    ['兵七进一','卒7进1','兵三进一','马8进7','马二进三','车9进1'],                        // 仙人指路对挺卒
    ['马二进三','炮8平7','马八进七','马8进9','车九进一','车9平8'],                        // 起马局对卒底炮
    ['炮二平六','马8进7','马二进三','车9平8','车一平二','卒3进1'],                        // 过宫炮
    ['仕四进五','卒7进1','炮八平六','马8进7','马八进九','车9平8'],                        // 飞仕局
  ];
  // 预编译：每条线展开成 [局面FEN, 着法m] 序列
  const BOOK = [];
  {
    for (const line of BOOK_LINES) {
      const st = XQRef.stateFromFEN(XQRef.START_FEN);
      const entries = [];
      for (const text of line) {
        const fen = XQRef.toFEN(st);
        let m = 0;
        for (const cand of XQRef.legalMoves(st)) {
          if (XQRef.moveToChinese(st, cand) === text) { m = cand; break; }
        }
        if (!m) break;
        entries.push({ fen, m });
        XQRef.make(st, m);
      }
      if (entries.length) BOOK.push(entries);
    }
  }
  function bookLookup(fen) {
    const hits = [];
    for (const entries of BOOK) {
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].fen === fen) { hits.push(entries[i].m); break; }
      }
    }
    if (!hits.length) return 0;
    return hits[(Math.random() * hits.length) | 0];
  }

  /* ---------- 主入口 ---------- */
  function think(st, level, opts) {
    opts = opts || {};
    const cfg = LEVELS[level] || LEVELS[3];
    ST = st;
    const startPly = st.ply;
    nodes = 0;
    deadline = Date.now() + (opts.timeMs != null ? opts.timeMs : cfg.time);
    killers.fill(0);
    histH.fill(0);

    // 对局历史 zobrist 集合（重复检测杜绝将军循环评分幻觉）
    {
      const hset = new Set();
      const tmp = stateFromFEN(XQRef.START_FEN);
      // 重放整个对局（st 带 histM），收集每个历史局面的哈希
      let h1 = 0, h2 = 0;
      for (let i = 0; i < 90; i++) {
        const p = tmp.board[i];
        if (p) { h1 ^= ZOB1[i * 14 + codeOf(p)]; h2 ^= ZOB2[i * 14 + codeOf(p)]; }
      }
      if (tmp.turn === BLACK) { h1 ^= ZTURN1; h2 ^= ZTURN2; }
      hset.add((h1 >>> 0) + ':' + (h2 >>> 0));
      for (let p = 0; p < st.ply; p++) {
        const m = st.histM[p];
        const from = m >>> 7, to = m & 127;
        const mover = tmp.board[from], cap = tmp.board[to];
        // 摘 from/落 to/吃子/换手
        h1 ^= ZOB1[from * 14 + codeOf(mover)] ^ ZOB1[to * 14 + codeOf(mover)];
        h2 ^= ZOB2[from * 14 + codeOf(mover)] ^ ZOB2[to * 14 + codeOf(mover)];
        if (cap) { h1 ^= ZOB1[to * 14 + codeOf(cap)]; h2 ^= ZOB2[to * 14 + codeOf(cap)]; }
        h1 ^= ZTURN1; h2 ^= ZTURN2;
        if (mover === K) tmp.kings[0] = to;
        tmp.board[from] = 0; tmp.board[to] = mover;
        hset.add((h1 >>> 0) + ':' + (h2 >>> 0));
      }
      // 支招/残局的局面可能不是从开局走来（FEN 直建）——此时 histM 无效, 退化为仅根哈希
      // 判定: st.ply 与重放一致才可信（残局 stateFromFEN 的 ply=0）
      histSet = st.ply > 0 ? hset : null;
      if (!histSet) histSet = new Set();
      // 当前局面哈希也加入（根）
      let r1 = 0, r2 = 0;
      for (let i = 0; i < 90; i++) {
        const p = st.board[i];
        if (p) { r1 ^= ZOB1[i * 14 + codeOf(p)]; r2 ^= ZOB2[i * 14 + codeOf(p)]; }
      }
      if (st.turn === BLACK) { r1 ^= ZTURN1; r2 ^= ZTURN2; }
      histSet.add((r1 >>> 0) + ':' + (r2 >>> 0));
      rootH1 = r1 | 0; rootH2 = r2 | 0;
    }

    const rootMoves = legalMoves(st);
    if (!rootMoves.length) return null;

    // 开局库：命中定式则直接走（可禁用）
    if (!opts.noBook) {
      const bm = bookLookup(toFEN(st));
      if (bm) {
        return { move: { from: bm >>> 7, to: bm & 127 }, score: 0, depth: 0, nodes: 0, ms: 0, level, name: cfg.name, book: true };
      }
    }

    let h1 = 0, h2 = 0;
    for (let i = 0; i < 90; i++) {
      const p = st.board[i];
      if (p) { h1 ^= ZOB1[i * 14 + codeOf(p)]; h2 ^= ZOB2[i * 14 + codeOf(p)]; }
    }
    if (st.turn === BLACK) { h1 ^= ZTURN1; h2 ^= ZTURN2; }
    curH1 = h1 | 0; curH2 = h2 | 0;

    const t0 = Date.now();
    const maxDepth = Math.min(opts.maxDepth || cfg.depth, MAXPLY - 8);
    let bestMove = rootMoves[0], bestScore = -INF, completedDepth = 0;
    let rootScores = new Array(rootMoves.length).fill(0);
    const side = st.turn;
    let aborted = false;

    try {
      for (let d = 1; d <= maxDepth; d++) {
        let alpha = -INF;
        const full = !!cfg.fullWindow;
        let iterBest = null, iterBestScore = -INF;
        const iterScores = new Array(rootMoves.length).fill(0);
        for (let i = 0; i < rootMoves.length; i++) {
          const m = rootMoves[i];
          const from = m >>> 7, to = m & 127;
          const mover = st.board[from], cap = st.board[to];
          make(st, m); applyZ(m, cap, mover);
          let sc;
          if (cap === (side === RED ? -K : K)) sc = MATE;
          else if (i === 0 || full) {
            sc = -search(d - 1, -INF, full ? INF : -alpha, 1, false);
          } else {
            // PVS：零窗口试探，更优才重搜
            sc = -search(d - 1, -alpha - 1, -alpha, 1, false);
            if (sc > alpha && !full) sc = -search(d - 1, -INF, -alpha, 1, false);
          }
          applyZ(m, cap, mover); unmake(st);
          iterScores[i] = sc;
          if (sc > iterBestScore) {
            iterBestScore = sc; iterBest = m;
            if (!full && sc > alpha) alpha = sc;
          }
        }
        // 按分数重排根着法，利于下一轮剪枝
        const pairs = rootMoves.map((m, i) => ({ m, s: iterScores[i] }));
        pairs.sort((a, b) => b.s - a.s);
        for (let i = 0; i < pairs.length; i++) { rootMoves[i] = pairs[i].m; rootScores[i] = pairs[i].s; }
        bestMove = rootMoves[0]; bestScore = rootScores[0]; completedDepth = d;
        if (bestScore > MATE - 1000) break;                     // 已见杀
        const elapsed = Date.now() - t0;
        if (elapsed > (deadline - t0) * 0.45) break;             // 剩余预算跑不完下一轮
      }
    } catch (e) {
      while (st.ply > startPly) unmake(st);   // 撤销所有未配对的 make
      aborted = true;
      if (e !== TIMEOUT) throw e;
    }

    // 弱档噪声：在全窗口精确分上随机挑选
    if (cfg.noise > 0 && completedDepth > 0) {
      let chosen = bestMove, bs = rootScores[0] + Math.random() * 2 * cfg.noise;
      for (let i = 0; i < rootMoves.length; i++) {
        const s = rootScores[i] + Math.random() * 2 * cfg.noise;
        if (s > bs) { bs = s; chosen = rootMoves[i]; }
      }
      bestMove = chosen;
    }

    return {
      move: { from: bestMove >>> 7, to: bestMove & 127 },
      score: bestScore, depth: completedDepth, nodes,
      ms: Date.now() - t0, level, name: cfg.name, aborted
    };
  }

  return { think, LEVELS, evaluate };
});
