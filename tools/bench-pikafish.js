/* bench-pikafish.js — 内置引擎大师档 vs Pikafish 实力对比
 * 用法：node tools/bench-pikafish.js [局数=2] [大师毫秒=2600] [皮卡鱼毫秒=500]
 * 皮卡鱼需要 exe+nnue（engines/pikafish/ 下）。
 */
'use strict';
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'public', 'js', 'rules.js'));
const Engine = require(path.join(__dirname, '..', 'public', 'js', 'engine.js'));
const { Pikafish } = require(path.join(__dirname, 'pikafish-uci.js'));

const GAMES = parseInt(process.argv[2] || '2', 10);
const L5_MS = parseInt(process.argv[3] || '2600', 10);
const PF_MS = parseInt(process.argv[4] || '500', 10);
const MAX_PLIES = 160;

const VAL = [0, 0, 250, 250, 430, 950, 470, 100];
function matDiff(st) {
  let s = 0;
  for (const p of st.board) if (p) s += (p > 0 ? 1 : -1) * VAL[Math.abs(p)];
  return s;
}
// rules (row,col) → UCI：列 a-i，行号从红方底线数（rank = 9-row）
const toUCI = (from, to) => String.fromCharCode(97 + (from % 9)) + (9 - (from / 9 | 0)) + String.fromCharCode(97 + (to % 9)) + (9 - (to / 9 | 0));
const fromUCI = (u) => { const f = u.charCodeAt(0) - 97, r = 9 - +u[1], t = u.charCodeAt(2) - 97, rr = 9 - +u[3]; return [r * 9 + f, rr * 9 + t]; };

(async () => {
  const pf = new Pikafish({ exe: path.join(__dirname, '..', 'engines', 'pikafish', 'pikafish.exe'), nnue: path.join(__dirname, '..', 'engines', 'pikafish', 'pikafish.nnue'), threads: 1, hash: 128 });
  await pf.start();
  console.log(`内置大师档(${L5_MS}ms) vs Pikafish(${PF_MS}ms)，共 ${GAMES} 局`);
  const t0 = Date.now();
  const score = { builtin: 0, pikafish: 0, draw: 0 };
  for (let g = 0; g < GAMES; g++) {
    const builtinIsRed = g % 2 === 0;
    const st = XQ.stateFromFEN(XQ.START_FEN);
    let result = null;
    while (st.ply < MAX_PLIES) {
      const status = XQ.status(st);
      if (status.over) { result = { over: status.reason, winner: status.winner }; break; }
      const builtinTurn = (st.turn === 1) === builtinIsRed;
      if (builtinTurn) {
        const r = Engine.think(st, 5, { timeMs: L5_MS });
        if (!r.move) { result = { over: 'no-move', winner: -st.turn }; break; }
        XQ.make(st, XQ.encode(r.move.from, r.move.to));
      } else {
        const u = await pf.bestMove({ fen: XQ.toFEN(st), movetime: PF_MS });
        if (!u.bestmove || u.bestmove === '(none)') { result = { over: 'no-move', winner: -st.turn }; break; }
        const [f, t] = fromUCI(u.bestmove);
        const em = XQ.encode(f, t);
        if (!XQ.legalMoves(st).includes(em)) { result = { over: 'pikafish-illegal', winner: builtinIsRed ? 1 : -1 }; break; }
        XQ.make(st, em);
      }
    }
    if (!result) {
      const d = matDiff(st);
      result = { over: 'adjudicated', winner: d > 200 ? 1 : (d < -200 ? -1 : 0), mat: d };
    }
    const winner = result.winner === 0 ? 'draw' : ((result.winner === 1) === builtinIsRed ? 'builtin' : 'pikafish');
    score[winner]++;
    console.log(`第${g + 1}局 大师执${builtinIsRed ? '红' : '黑'} | ${result.over}${result.mat != null ? ' 子力差' + result.mat : ''} | ${st.ply}步 | 胜者=${winner} | 累计 内置${score.builtin}:皮卡鱼${score.pikafish}:和${score.draw} | ${((Date.now() - t0) / 60000).toFixed(1)}分钟`);
  }
  console.log(`FINAL 内置大师=${score.builtin} Pikafish=${score.pikafish} 和=${score.draw}`);
  pf.stop();
  process.exit(0);
})().catch(e => { console.error('失败:', e); process.exit(1); });
