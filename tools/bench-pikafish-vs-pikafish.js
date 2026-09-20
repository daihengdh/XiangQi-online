/* bench-pikafish-vs-pikafish.js — 皮卡鱼 vs 皮卡鱼 自对弈基准
 * 用法: node tools/bench-pikafish-vs-pikafish.js [局数=4] [基础每步毫秒=500]
 * 两个独立引擎实例（引擎A/引擎B），逐着输出着法与评估，跟踪整条对局链路。
 * 每局思考时间递增，避免同局面同时间导致的完全复刻。
 */
'use strict';
const path = require('path');
const XQ = require(path.join(__dirname, '../public/js/rules.js'));
const { Pikafish } = require(path.join(__dirname, 'pikafish-uci.js'));

const EXE = path.join(__dirname, '../engines/pikafish/pikafish.exe');
const NNUE = path.join(__dirname, '../engines/pikafish/pikafish.nnue');
const GAMES = Math.max(1, +(process.argv[2] || 4));
const BASE_MT = Math.max(100, +(process.argv[3] || 500));
const PLY_CAP = 160;   // 超出按最后评估判定（|分|≥600 判胜，否则和）

const fromUCI = (u) => [(9 - +u[1]) * 9 + (u.charCodeAt(0) - 97), (9 - +u[3]) * 9 + (u.charCodeAt(2) - 97)];
const fmtScore = (kind, score, moverIsRed) => {
  const sign = moverIsRed ? 1 : -1;   // 换算成红方视角
  if (kind === 'mate') return score * sign > 0 ? `红${score * sign > 0 ? '' : '-'}方 ${Math.abs(score)} 步杀` : `黑方 ${Math.abs(score)} 步杀`;
  const v = score * sign;
  return (v > 0 ? '+' : '') + v;
};

async function playGame(gi, engRed, engBlack, movetime) {
  const st = XQ.stateFromFEN(XQ.START_FEN);
  const t0 = Date.now();
  let winner = 0, reason = '裁决';
  let lastRedView = 0;
  const notations = [];
  console.log(`\n═══ 第 ${gi + 1} 局 ═══ 每步 ${movetime}ms | 红方=引擎${engRed.name} 黑方=引擎${engBlack.name}`);
  for (let ply = 0; ply < PLY_CAP; ply++) {
    const moverIsRed = st.turn === 1;
    const eng = moverIsRed ? engRed : engBlack;
    let r;
    try {
      r = await eng.bestMove({ fen: XQ.toFEN(st), movetime });
    } catch (e) {
      winner = moverIsRed ? -1 : 1; reason = '引擎超时'; break;
    }
    const [f, t] = fromUCI(r.bestmove || '');
    const mv = XQ.encode(f, t);
    if (!XQ.legalMoves(st).includes(mv)) {
      winner = moverIsRed ? -1 : 1; reason = '非法着法'; break;
    }
    const notation = XQ.moveToChinese(st, mv);
    XQ.make(st, mv);
    notations.push((moverIsRed ? '红 ' : '黑 ') + notation);
    const isMateKind = r.kind === 'mate';
    const redView = isMateKind
      ? (Math.abs(r.score) > 50 ? 30000 : 0)
      : ((r.score || 0) * (moverIsRed ? 1 : -1));
    lastRedView = redView;
    const evalTxt = isMateKind
      ? (r.score > 0 === moverIsRed ? `红 ${Math.abs(r.score)} 步杀` : `黑 ${Math.abs(r.score)} 步杀`)
      : ((redView > 0 ? '+' : '') + redView);
    console.log(`  ${String(Math.floor(ply / 2) + 1).padStart(3)} ${moverIsRed ? '红' : '黑'} ${notation.padEnd(6, '　')} 评估 ${evalTxt} (d${r.depth || '?'})`);
    const st1 = XQ.status(st);
    if (st1.over) {
      winner = st1.winner;
      reason = st1.reason === 'checkmate' ? '绝杀' + (XQ.detectMateType(st) || '') : (st1.reason === 'stalemate' ? '困毙' : st1.reason);
      break;
    }
  }
  if (winner === 0 && reason === '裁决') {
    if (Math.abs(lastRedView) >= 600) winner = lastRedView > 0 ? 1 : -1;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const resTxt = winner === 1 ? '红胜' : winner === -1 ? '黑胜' : '和棋';
  console.log(`  ▶ 结果：${resTxt}（${reason}），共 ${notations.length} 步，用时 ${secs}s`);
  console.log('  着法：' + notations.join(' '));
  return { winner, reason, plies: notations.length, secs: +secs };
}

(async () => {
  const engA = new Pikafish({ exe: EXE, nnue: NNUE, threads: 2, hash: 256 });
  const engB = new Pikafish({ exe: EXE, nnue: NNUE, threads: 2, hash: 256 });
  engA.name = 'A'; engB.name = 'B';
  const t0 = Date.now();
  await engA.start(); await engB.start();
  console.log('✓ 两个皮卡鱼实例已就绪（各 2 线程 / 256MB）');

  const tally = { red: 0, black: 0, draw: 0 };
  for (let gi = 0; gi < GAMES; gi++) {
    // 交替先后手 + 每局递增思考时间（避免同局面同算力完全复刻）
    const [rEng, bEng] = gi % 2 === 0 ? [engA, engB] : [engB, engA];
    engA._send('ucinewgame'); engB._send('ucinewgame');
    const res = await playGame(gi, rEng, bEng, BASE_MT + gi * 150);
    if (res.winner === 1) tally.red++; else if (res.winner === -1) tally.black++; else tally.draw++;
  }
  console.log(`\n═══ 总成绩（${GAMES} 局）═══`);
  console.log(`先手方胜 ${tally.red} / 后手方胜 ${tally.black} / 和棋 ${tally.draw}`);
  console.log(`引擎A 对 引擎B 交叉后手各半；总用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  engA.stop(); engB.stop();
  process.exit(0);
})().catch((e) => { console.error('对弈失败：' + e.message); process.exit(1); });
