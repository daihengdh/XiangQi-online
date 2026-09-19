/* bench-xqwlight.js — 内置引擎大师档 vs xqwlight(象棋巫师轻量版) 基准对决
 * 用法：node tools/bench-xqwlight.js [局数=4] [大师毫秒=2600] [xqwlight毫秒=1500]
 */
'use strict';
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'public', 'js', 'rules.js'));
const Engine = require(path.join(__dirname, '..', 'public', 'js', 'engine.js'));
const XWL = require(path.join(__dirname, 'xqwlight-node.js'));

const GAMES = parseInt(process.argv[2] || '4', 10);
const L5_MS = parseInt(process.argv[3] || '2600', 10);
const XWL_MS = parseInt(process.argv[4] || '1500', 10);
const MAX_PLIES = 160;

// 坐标转换：rules.js 行列 → xqwlight 16列带边框棋盘
const rc2sq = (r, c) => ((r + 3) << 4) | (c + 3);

const VAL = [0, 0, 250, 250, 430, 950, 470, 100];
function matDiff(st) {
  let s = 0;
  for (const p of st.board) if (p) s += (p > 0 ? 1 : -1) * VAL[Math.abs(p)];
  return s;
}

function playGame(builtinIsRed) {
  const st = XQ.stateFromFEN(XQ.START_FEN);
  const xwl = XWL.create();
  xwl.fromFEN(XQ.toFEN(st));
  while (st.ply < MAX_PLIES) {
    const status = XQ.status(st);
    if (status.over) return { over: status.reason, winner: status.winner, plies: st.ply };
    const builtinTurn = (st.turn === 1) === builtinIsRed;
    let mv;
    if (builtinTurn) {
      const t0 = Date.now();
      const r = Engine.think(st, 5, { timeMs: L5_MS });
      if (!r.move) return { over: 'no-move', winner: -st.turn, plies: st.ply };
      mv = { from: [r.move.from / 9 | 0, r.move.from % 9], to: [r.move.to / 9 | 0, r.move.to % 9] };
      XQ.make(st, XQ.encode(r.move.from, r.move.to));
      xwl.make(mv.from, mv.to);
    } else {
      const t0 = Date.now();
      const m = xwl.search(12, XWL_MS);
      const ms = Date.now() - t0;
      if (!m) return { over: 'no-move', winner: -st.turn, plies: st.ply };
      // xqwlight 返回带边框坐标 → rules 行列；直接在 xqwlight 内部已走子（searchMain 会 makeMove）
      const f = [m.from[0] - 3, m.from[1] - 3], t = [m.to[0] - 3, m.to[1] - 3];
      const em = XQ.encode(f[0] * 9 + f[1], t[0] * 9 + t[1]);
      if (!XQ.legalMoves(st).includes(em)) return { over: 'illegal', winner: builtinIsRed ? 1 : -1, plies: st.ply };
      xwl.make(f, t);   // xqwlight 内部同步走子（searchMain 不会自己走）
      XQ.make(st, em);
      mv = null;
    }
  }
  const d = matDiff(st);
  return { over: 'adjudicated', winner: d > 200 ? 1 : (d < -200 ? -1 : 0), plies: st.ply, mat: d };
}

const score = { builtin: 0, xqwlight: 0, draw: 0 };
console.log(`内置大师档(${L5_MS}ms) vs xqwlight(${XWL_MS}ms, depth12)，共 ${GAMES} 局`);
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const builtinIsRed = g % 2 === 0;
  const res = playGame(builtinIsRed);
  const winner = res.winner === 0 ? 'draw' : ((res.winner === 1) === builtinIsRed ? 'builtin' : 'xqwlight');
  score[winner]++;
  console.log(`第${g + 1}局 大师执${builtinIsRed ? '红' : '黑'} | ${res.over}${res.mat != null ? ' 子力差' + res.mat : ''} | ${res.plies}步 | 胜者=${winner} | 累计 内置${score.builtin}:xqwlight${score.xqwlight}:和${score.draw} | ${((Date.now() - t0) / 60000).toFixed(1)}分钟`);
}
console.log(`FINAL 内置大师=${score.builtin} xqwlight=${score.xqwlight} 和=${score.draw}`);
