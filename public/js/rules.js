/* rules.js — 中国象棋规则引擎（浏览器 / Worker / Node 通用）
 * 棋盘：10 行 × 9 列，sq = row*9 + col；row0 顶部为黑方，row9 底部为红方
 * 棋子编码：1帅 2仕 3相 4马 5车 6炮 7兵；正数红方，负数黑方
 * 着法编码：m = (from << 7) | to
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.XQ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RED = 1, BLACK = -1;
  const K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7;

  const CHAR_RED = { 1: '帅', 2: '仕', 3: '相', 4: '马', 5: '车', 6: '炮', 7: '兵' };
  const CHAR_BLACK = { 1: '将', 2: '士', 3: '象', 4: '马', 5: '车', 6: '炮', 7: '卒' };
  function pieceChar(p) { return p > 0 ? CHAR_RED[p] : CHAR_BLACK[-p]; }

  const FEN_CHAR = { 1: 'K', 2: 'A', 3: 'B', 4: 'N', 5: 'R', 6: 'C', 7: 'P' };
  const FEN_MAP = { k: K, a: A, b: B, e: B, n: N, h: N, r: R, c: C, p: P };

  const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

  const HIST_MAX = 4096;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const KNIGHT = [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]];

  function stateFromFEN(fen) {
    const parts = String(fen).trim().split(/\s+/);
    const board = new Int16Array(90);
    let r = 0, c = 0;
    for (const ch of parts[0]) {
      if (ch === '/') { r++; c = 0; if (r > 9) break; }
      else if (ch >= '1' && ch <= '9') c += +ch;
      else {
        const code = FEN_MAP[ch.toLowerCase()];
        if (code && r <= 9 && c <= 8) board[r * 9 + c] = ch === ch.toLowerCase() ? -code : code;
        c++;
      }
    }
    const st = {
      board, turn: (parts[1] || 'w') === 'w' ? RED : BLACK,
      ply: 0, half: 0,
      kings: new Int16Array(2),        // [红将, 黑将]
      histM: new Int32Array(HIST_MAX),
      histCap: new Int16Array(HIST_MAX),
      histHalf: new Int32Array(HIST_MAX),
    };
    for (let i = 0; i < 90; i++) {
      if (board[i] === K) st.kings[0] = i;
      else if (board[i] === -K) st.kings[1] = i;
    }
    return st;
  }

  function toFEN(st) {
    let s = '';
    for (let r = 0; r < 10; r++) {
      let empty = 0;
      for (let c = 0; c < 9; c++) {
        const p = st.board[r * 9 + c];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += p > 0 ? FEN_CHAR[p] : FEN_CHAR[-p].toLowerCase();
      }
      if (empty) s += empty;
      if (r < 9) s += '/';
    }
    return s + ' ' + (st.turn === RED ? 'w' : 'b');
  }

  /* sq 位置是否被 byRed 一方攻击（车/炮/马/兵） */
  function attackedBy(board, sq, byRed) {
    const r = (sq / 9) | 0, c = sq % 9;
    for (let d = 0; d < 4; d++) {
      const dr = DIRS[d][0], dc = DIRS[d][1];
      let rr = r + dr, cc = c + dc, screen = 0;
      while (rr >= 0 && rr <= 9 && cc >= 0 && cc <= 8) {
        const p = board[rr * 9 + cc];
        if (p !== 0) {
          if ((p > 0) === byRed) {
            const t = p > 0 ? p : -p;
            if (screen === 0 && t === R) return true;
            if (screen === 1 && t === C) return true;
          }
          if (++screen > 1) break;
        }
        rr += dr; cc += dc;
      }
    }
    for (let i = 0; i < 8; i++) {
      const dr = KNIGHT[i][0], dc = KNIGHT[i][1];
      const hr = r + dr, hc = c + dc;
      if (hr < 0 || hr > 9 || hc < 0 || hc > 8) continue;
      const p = board[hr * 9 + hc];
      if (p === 0 || (p > 0) !== byRed || (p > 0 ? p : -p) !== N) continue;
      // 蹩腿点：马旁沿“两格”方向的正交邻点
      const legR = Math.abs(dr) === 2 ? hr - dr / 2 : hr;
      const legC = Math.abs(dr) === 2 ? hc : hc - dc / 2;
      if (board[legR * 9 + legC] === 0) return true;
    }
    if (byRed) {
      if (r < 9 && board[(r + 1) * 9 + c] === P) return true;
      if (r <= 4) { // 红兵过河后（自身行 ≤4）可横吃
        if (c > 0 && board[r * 9 + c - 1] === P) return true;
        if (c < 8 && board[r * 9 + c + 1] === P) return true;
      }
    } else {
      if (r > 0 && board[(r - 1) * 9 + c] === -P) return true;
      if (r >= 5) {
        if (c > 0 && board[r * 9 + c - 1] === -P) return true;
        if (c < 8 && board[r * 9 + c + 1] === -P) return true;
      }
    }
    return false;
  }

  function kingsFacing(board, k1, k2) {
    const r1 = (k1 / 9) | 0, c1 = k1 % 9, r2 = (k2 / 9) | 0, c2 = k2 % 9;
    if (c1 !== c2) return false;
    const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
    for (let r = lo + 1; r < hi; r++) if (board[r * 9 + c1] !== 0) return false;
    return true;
  }

  /* color 一方是否被将军（含白脸将） */
  function inCheck(st, color) {
    const kSq = color === RED ? st.kings[0] : st.kings[1];
    if (attackedBy(st.board, kSq, color !== RED)) return true;
    return kingsFacing(st.board, st.kings[0], st.kings[1]);
  }

  /* 生成伪合法着法到 out（Int32Array），返回数量；capOnly 只生成吃子着法 */
  function genMoves(st, out, capOnly) {
    const b = st.board, turnRed = st.turn === RED;
    let n = 0;
    for (let sq = 0; sq < 90; sq++) {
      const p = b[sq];
      if (p === 0 || (p > 0) !== turnRed) continue;
      const red = p > 0, t = red ? p : -p;
      const r = (sq / 9) | 0, c = sq % 9;

      switch (t) {
        case K: {
          const rMin = red ? 7 : 0, rMax = rMin + 2;
          for (let d = 0; d < 4; d++) {
            const rr = r + DIRS[d][0], cc = c + DIRS[d][1];
            if (rr < rMin || rr > rMax || cc < 3 || cc > 5) continue;
            const q = b[rr * 9 + cc];
            if (q === 0 || (q > 0) !== red) { if (!capOnly || q !== 0) out[n++] = (sq << 7) | (rr * 9 + cc); }
          }
          // 白脸将：沿列越子直“吃”对方将（用于判定照面局面非法）
          const dr = red ? -1 : 1;
          let rr = r + dr;
          while (rr >= 0 && rr <= 9 && b[rr * 9 + c] === 0) rr += dr;
          if (rr >= 0 && rr <= 9 && b[rr * 9 + c] === (red ? -K : K)) out[n++] = (sq << 7) | (rr * 9 + c);
          break;
        }
        case A: {
          const rMin = red ? 7 : 0, rMax = rMin + 2;
          for (let d = 0; d < 4; d++) {
            const rr = r + DIAG[d][0], cc = c + DIAG[d][1];
            if (rr < rMin || rr > rMax || cc < 3 || cc > 5) continue;
            const q = b[rr * 9 + cc];
            if (q === 0 || (q > 0) !== red) { if (!capOnly || q !== 0) out[n++] = (sq << 7) | (rr * 9 + cc); }
          }
          break;
        }
        case B: {
          for (let d = 0; d < 4; d++) {
            const rr = r + DIAG[d][0] * 2, cc = c + DIAG[d][1] * 2;
            if (rr < 0 || rr > 9 || cc < 0 || cc > 8) continue;
            if (red ? rr < 5 : rr > 4) continue;                       // 象不过河
            if (b[(r + DIAG[d][0]) * 9 + c + DIAG[d][1]] !== 0) continue; // 塞象眼
            const q = b[rr * 9 + cc];
            if (q === 0 || (q > 0) !== red) { if (!capOnly || q !== 0) out[n++] = (sq << 7) | (rr * 9 + cc); }
          }
          break;
        }
        case N: {
          for (let d = 0; d < 8; d++) {
            const dr = KNIGHT[d][0], dc = KNIGHT[d][1];
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || rr > 9 || cc < 0 || cc > 8) continue;
            const legR = Math.abs(dr) === 2 ? r + dr / 2 : r;   // 蹩马腿
            const legC = Math.abs(dr) === 2 ? c : c + dc / 2;
            if (b[legR * 9 + legC] !== 0) continue;
            const q = b[rr * 9 + cc];
            if (q === 0 || (q > 0) !== red) { if (!capOnly || q !== 0) out[n++] = (sq << 7) | (rr * 9 + cc); }
          }
          break;
        }
        case R: {
          for (let d = 0; d < 4; d++) {
            const dr = DIRS[d][0], dc = DIRS[d][1];
            let rr = r + dr, cc = c + dc;
            while (rr >= 0 && rr <= 9 && cc >= 0 && cc <= 8) {
              const q = b[rr * 9 + cc];
              if (q === 0) { if (!capOnly) out[n++] = (sq << 7) | (rr * 9 + cc); }
              else { if ((q > 0) !== red) out[n++] = (sq << 7) | (rr * 9 + cc); break; }
              rr += dr; cc += dc;
            }
          }
          break;
        }
        case C: {
          for (let d = 0; d < 4; d++) {
            const dr = DIRS[d][0], dc = DIRS[d][1];
            let rr = r + dr, cc = c + dc, screen = false;
            while (rr >= 0 && rr <= 9 && cc >= 0 && cc <= 8) {
              const q = b[rr * 9 + cc];
              if (screen) {
                if (q !== 0) { if ((q > 0) !== red) out[n++] = (sq << 7) | (rr * 9 + cc); break; }
              } else if (q !== 0) screen = true;   // 炮架
              else if (!capOnly) out[n++] = (sq << 7) | (rr * 9 + cc);
              rr += dr; cc += dc;
            }
          }
          break;
        }
        case P: {
          const fr = r + (red ? -1 : 1);
          if (fr >= 0 && fr <= 9) {
            const q = b[fr * 9 + c];
            if (q === 0 || (q > 0) !== red) { if (!capOnly || q !== 0) out[n++] = (sq << 7) | (fr * 9 + c); }
          }
          if (red ? r <= 4 : r >= 5) {   // 过河兵可横走
            for (let dc = -1; dc <= 1; dc += 2) {
              const cc = c + dc;
              if (cc < 0 || cc > 8) continue;
              const q = b[r * 9 + cc];
              if (q === 0 || (q > 0) !== red) { if (!capOnly || q !== 0) out[n++] = (sq << 7) | (r * 9 + cc); }
            }
          }
          break;
        }
      }
    }
    return n;
  }

  /* 走子；返回被吃棋子编码（0 表示没吃）。内部记录历史供 unmake */
  function make(st, m) {
    const from = m >>> 7, to = m & 127;
    const b = st.board;
    const mover = b[from], cap = b[to];
    b[to] = mover; b[from] = 0;
    if (mover === K) st.kings[0] = to;
    else if (mover === -K) st.kings[1] = to;
    if (cap === K) st.kings[0] = to;
    else if (cap === -K) st.kings[1] = to;
    st.histM[st.ply] = m;
    st.histCap[st.ply] = cap;
    st.histHalf[st.ply] = st.half;
    st.half = (cap !== 0 || (mover > 0 ? mover : -mover) === P) ? 0 : st.half + 1;
    st.turn = -st.turn;
    st.ply++;
    return cap;
  }

  function unmake(st) {
    st.ply--;
    const m = st.histM[st.ply], cap = st.histCap[st.ply];
    const from = m >>> 7, to = m & 127;
    const b = st.board;
    const mover = b[to];
    b[from] = mover; b[to] = cap;
    if (mover === K) st.kings[0] = from;
    else if (mover === -K) st.kings[1] = from;
    if (cap === K) st.kings[0] = to;
    else if (cap === -K) st.kings[1] = to;
    st.half = st.histHalf[st.ply];
    st.turn = -st.turn;
  }

  const SCRATCH = new Int32Array(256);

  /* 合法着法（过滤送将/照面） */
  function legalMoves(st) {
    const n = genMoves(st, SCRATCH, false);
    const mover = st.turn;
    const res = [];
    for (let i = 0; i < n; i++) {
      const m = SCRATCH[i];
      make(st, m);
      const ok = !inCheck(st, mover);
      unmake(st);
      if (ok) res.push(m);
    }
    return res;
  }

  /* 对局状态：无子可动 = 将死/困毙（负）；120 半回合无吃子 = 和 */
  function status(st) {
    const moves = legalMoves(st);
    if (moves.length === 0) {
      const side = st.turn;
      return { over: true, winner: -side, reason: inCheck(st, side) ? 'checkmate' : 'stalemate', moves: [] };
    }
    if (st.half >= 120) return { over: true, winner: 0, reason: 'sixty', moves };
    return { over: false, moves };
  }

  /* ---------- 绝杀杀法识别（供特效演出分类） ---------- */
  function aligned(a, b) {
    return ((a / 9) | 0) === ((b / 9) | 0) || a % 9 === b % 9;
  }
  function sameLine(a, b, c) {
    const ra = (a / 9) | 0, ca = a % 9, rb = (b / 9) | 0, cb = b % 9, rc = (c / 9) | 0, cc = c % 9;
    return (ra === rb && rb === rc) || (ca === cb && cb === cc);
  }
  function betweenCount(b, from, to) {
    const ra = (from / 9) | 0, ca = from % 9, rc = (to / 9) | 0, cc = to % 9;
    let n = 0;
    if (ra === rc) {
      const step = cc > ca ? 1 : -1;
      for (let col = ca + step; col !== cc; col += step) if (b[ra * 9 + col] !== 0) n++;
    } else {
      const step = rc > ra ? 1 : -1;
      for (let row = ra + step; row !== rc; row += step) if (b[row * 9 + cc] !== 0) n++;
    }
    return n;
  }
  function screenPiece(b, cannonSq, kingSq) {
    if (!aligned(cannonSq, kingSq)) return -1;
    const ra = (cannonSq / 9) | 0, ca = cannonSq % 9, rc = (kingSq / 9) | 0, cc = kingSq % 9;
    if (ra === rc) {
      const step = cc > ca ? 1 : -1;
      for (let col = ca + step; col !== cc; col += step) { const p = b[ra * 9 + col]; if (p !== 0) return ra * 9 + col; }
    } else {
      const step = rc > ra ? 1 : -1;
      for (let row = ra + step; row !== rc; row += step) { const p = b[row * 9 + cc]; if (p !== 0) return row * 9 + cc; }
    }
    return -1;
  }
  function knightHit(from, to) {
    const dr = Math.abs(((from / 9) | 0) - ((to / 9) | 0)), dc = Math.abs(from % 9 - to % 9);
    return (dr === 2 && dc === 1) || (dr === 1 && dc === 2);
  }
  function strictlyBetween(mid, end1, end2) {
    const rm = (mid / 9) | 0, cm = mid % 9, r1 = (end1 / 9) | 0, c1 = end1 % 9, r2 = (end2 / 9) | 0, c2 = end2 % 9;
    if (r1 === r2) return rm === r1 && Math.min(c1, c2) < cm && cm < Math.max(c1, c2);
    if (c1 === c2) return cm === c1 && Math.min(r1, r2) < rm && rm < Math.max(r1, r2);
    return false;
  }

  /* 返回杀法名（'重炮'/'马后炮'/…），无法归类返回 null。
   * st 应传入将死后的局面（st.turn 为败方） */
  function detectMateType(st) {
    const b = st.board;
    const loser = st.turn;
    const kingSq = loser === RED ? st.kings[0] : st.kings[1];
    const byRed = loser !== RED;
    const kingR = (kingSq / 9) | 0;
    const mine = { 4: [], 5: [], 6: [], 7: [] };   // 马车炮兵（胜方）
    for (let sq = 0; sq < 90; sq++) {
      const p = b[sq];
      if (p !== 0 && (p > 0) === byRed) {
        const t = p > 0 ? p : -p;
        if (mine[t]) mine[t].push(sq);
      }
    }
    const rookChk = mine[5].filter(sq => aligned(sq, kingSq) && betweenCount(b, sq, kingSq) === 0);
    const cannonChk = mine[6].filter(sq => aligned(sq, kingSq) && betweenCount(b, sq, kingSq) === 1);
    const knightChk = mine[4].filter(sq => knightHit(sq, kingSq));
    const pawnChk = mine[7].filter(sq => {
      const rf = (sq / 9) | 0, cf = sq % 9, rt = kingR, ct = kingSq % 9;
      if (byRed) return (rt === rf - 1 && ct === cf) || (rf <= 4 && rt === rf && Math.abs(ct - cf) === 1);
      return (rt === rf + 1 && ct === cf) || (rf >= 5 && rt === rf && Math.abs(ct - cf) === 1);
    });

    // 马后炮：照将的炮，其炮架是己方马
    for (const c of cannonChk) {
      const s = screenPiece(b, c, kingSq);
      if (s >= 0) {
        const p = b[s];
        if ((p > 0) === byRed && (p > 0 ? p : -p) === N) return '马后炮';
      }
    }
    // 重炮：照将炮身后同线还有一门己方炮
    for (const c1 of cannonChk) {
      for (const c2 of mine[6]) {
        if (c2 !== c1 && sameLine(c2, c1, kingSq) && strictlyBetween(c1, c2, kingSq)) return '重炮';
      }
    }
    if (cannonChk.length >= 2) return '天地炮';
    if (rookChk.length >= 2) return '双车错';
    // 双将：两类异种子同时照将（双车/双炮/夹车炮/铁门栓之外的双重攻击）
    {
      const kinds = [rookChk.length, cannonChk.length, knightChk.length, pawnChk.length].filter(n => n > 0).length;
      const pieces = rookChk.length + cannonChk.length + knightChk.length + pawnChk.length;
      if (kinds >= 2 && pieces >= 2) {
        if (!(rookChk.length && cannonChk.length) && !(rookChk.length && knightChk.length)) return '双将';
      }
    }
    if (rookChk.length && cannonChk.length) return '夹车炮';
    if (rookChk.length && knightChk.length) return '铁门栓';
    // 闷宫：将的宫内出路全被己方子塞死
    {
      let total = 0, own = 0;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = kingR + dr, cc = kingSq % 9 + dc;
        if (rr < 0 || rr > 9 || cc < 3 || cc > 5) continue;
        if (loser === RED && (rr < 7 || rr > 9)) continue;
        if (loser === BLACK && rr > 2) continue;
        total++;
        const q = b[rr * 9 + cc];
        if (q !== 0 && (q > 0) === (loser === RED)) own++;
      }
      if (total > 0 && own === total && (knightChk.length || cannonChk.length || pawnChk.length || rookChk.length)) return '闷宫';
    }
    // 挂角马：马从九宫角位照将（距将两行，落在肋线上）
    for (const k of knightChk) {
      const kr = (k / 9) | 0, kc = k % 9;
      if (Math.abs(kr - kingR) === 2 && (kc === 3 || kc === 5)) return '挂角马';
    }
    for (const k of knightChk) if (Math.abs(((k / 9) | 0) - kingR) === 2) return '卧槽马';
    // 海底捞月：车沉底线照将且双王照面（借帅力从底线捞）
    for (const r of rookChk) {
      const rr = (r / 9) | 0;
      if ((rr === 0 || rr === 9) && kingsFacing(b, st.kings[0], st.kings[1])) return '海底捞月';
    }
    for (const c of cannonChk) { const cr = (c / 9) | 0; if (cr === 0 || cr === 9) return '沉底炮'; }
    // 二鬼拍门：双兵占九宫两侧肋门
    {
      const kc = kingSq % 9;
      const g1 = (kingR + (byRed ? 1 : -1)) * 9 + (kc - 1);
      const g2 = (kingR + (byRed ? 1 : -1)) * 9 + (kc + 1);
      const pAt = (sq) => sq >= 0 && sq < 90 && b[sq] !== 0 && (b[sq] > 0) === byRed && (b[sq] > 0 ? b[sq] : -b[sq]) === P;
      if (kc === 4 && pAt(g1) && pAt(g2)) return '二鬼拍门';
    }
    if (rookChk.length + cannonChk.length + knightChk.length + pawnChk.length === 0) {
      if (kingsFacing(b, st.kings[0], st.kings[1])) return '白脸将';
      return null;
    }
    if (pawnChk.length) return '小卒刺将';
    if (knightChk.length) return '高吊马';
    // 白脸将辅助：车照将且双王照面
    if (rookChk.length && kingsFacing(b, st.kings[0], st.kings[1])) return '白脸将';
    // 按攻击子兜底命名（保证将死一定有杀法名）
    if (rookChk.length) return '车胜';
    if (cannonChk.length) return '炮胜';
    if (knightChk.length) return '马胜';
    if (pawnChk.length) return '兵胜';
    return '绝杀';
  }

  /* ---------- 中文棋谱记法 ---------- */
  const NUM_RED = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  function moveToChinese(st, m) {
    const from = m >>> 7, to = m & 127;
    const p = st.board[from];
    if (!p) return '?';
    const red = p > 0;
    const ch = pieceChar(p);
    const fr = (from / 9) | 0, fc = from % 9;
    const tr = (to / 9) | 0, tc = to % 9;
    const num = n => red ? NUM_RED[n - 1] : String(n);
    // 文件号：红方从红右（col0=红九路）…col8=红一路；黑方从黑右（col8=黑1路）…col0=黑9路
    const fileOf = c => red ? 9 - c : 9 - c;

    // 同列同种棋子需要“前/中/后”区分（红方行号小在前）
    const dup = [];
    for (let r = 0; r < 10; r++) if (st.board[r * 9 + fc] === p) dup.push(r);
    let prefix = '', fileStr = '';
    if (dup.length > 1) {
      dup.sort((a, b) => red ? a - b : b - a);
      const i = dup.indexOf(fr);
      prefix = dup.length === 2 ? (i === 0 ? '前' : '后') : (i === 0 ? '前' : i === dup.length - 1 ? '后' : '中');
    } else {
      fileStr = num(fileOf(fc));
    }
    const diag = (red ? p : -p) === N || (red ? p : -p) === B || (red ? p : -p) === A;
    let action, amount;
    if (tr === fr) { action = '平'; amount = num(fileOf(tc)); }
    else {
      const forward = red ? tr < fr : tr > fr;
      action = forward ? '进' : '退';
      amount = diag ? num(fileOf(tc)) : num(Math.abs(tr - fr));
    }
    return prefix + ch + fileStr + action + amount;
  }

  return {
    RED, BLACK, K, A, B, N, R, C, P,
    START_FEN, pieceChar,
    stateFromFEN, toFEN,
    attackedBy, kingsFacing, inCheck,
    genMoves, make, unmake, legalMoves, status,
    moveToChinese, detectMateType,
    encode: (f, t) => (f << 7) | t,
    mFrom: m => m >>> 7,
    mTo: m => m & 127,
  };
});
