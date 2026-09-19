/* bench-levels.js — 内置引擎档位对决：中级(3) vs 大师(5)
 * 用法：node tools/bench-levels.js [局数，默认8] [大师档每步毫秒，默认2600=出厂设置]
 * 双方交替执红黑；每步限时内迭代加深；160 步未分胜负按子力裁定。
 */
'use strict';
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'public', 'js', 'rules.js'));
const Engine = require(path.join(__dirname, '..', 'public', 'js', 'engine.js'));

const GAMES = parseInt(process.argv[2] || '8', 10);
const L5_MS = parseInt(process.argv[3] || '2600', 10);
const L3_MS = 600;
const MAX_PLIES = 160;

// 按引擎子力表累计（不含位置分，只算子力差）
const VAL = [0, 0, 250, 250, 430, 950, 470, 100];
function matDiff(st) {
  let s = 0;
  for (const p of st.board) if (p) s += (p > 0 ? 1 : -1) * VAL[Math.abs(p)];
  return s;
}

function playGame(redIsL3) {
  const st = XQ.stateFromFEN(XQ.START_FEN);
  let lastDepth = '';
  while (st.ply < MAX_PLIES) {
    const status = XQ.status(st);
    if (status.over) return { over: status.reason, winner: status.winner, plies: st.ply };
    const lv = st.turn === 1 ? (redIsL3 ? 3 : 5) : (redIsL3 ? 5 : 3);
    const t0 = Date.now();
    const r = Engine.think(st, lv, { timeMs: lv === 3 ? L3_MS : L5_MS });
    const ms = Date.now() - t0;
    if (!r.move) return { over: 'no-moves', winner: -st.turn, plies: st.ply };
    lastDepth = `L${lv}@d${r.depth}/${ms}ms`;
    XQ.make(st, XQ.encode(r.move.from, r.move.to));
  }
  const m = matDiff(st);
  return { over: 'adjudicated', winner: m > 200 ? 1 : (m < -200 ? -1 : 0), plies: st.ply, mat: m };
}

const score = { 3: 0, 5: 0, draw: 0 };
console.log(`引擎档位对决：中级(L3, ${L3_MS}ms/步) vs 大师(L5, ${L5_MS}ms/步)，共 ${GAMES} 局，交替执先`);
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const redIsL3 = g % 2 === 0;
  const res = playGame(redIsL3);
  const winnerLv = res.winner === 0 ? 0 : (res.winner === 1 ? (redIsL3 ? 3 : 5) : (redIsL3 ? 5 : 3));
  if (winnerLv === 0) score.draw++;
  else score[winnerLv]++;
  const mat = res.mat != null ? ` 子力差${res.mat}` : '';
  console.log(`第${g + 1}局  L3执${redIsL3 ? '红' : '黑'} | ${res.over}${mat} | ${res.plies}步 | 胜者=${winnerLv === 0 ? '和棋' : 'L' + winnerLv} | 累计 中级${score[3]}:大师${score[5]}:和${score.draw} | 已用${((Date.now() - t0) / 60000).toFixed(1)}分钟`);
}
console.log(`FINAL 中级(L3)=${score[3]} 大师(L5)=${score[5]} 和棋=${score.draw} 总耗时${((Date.now() - t0) / 60000).toFixed(1)}分钟`);
