/* bench-pikafish-upgrade-match.js — 皮卡鱼升级前后对决
 * 用法: node tools/bench-pikafish-upgrade-match.js [局数=4] [基础每步毫秒=500]
 * 旧配置 = 1 线程 / 128MB（升级前 server 配置）；新配置 = 逻辑核-4 线程 / 2GB（现配置）。
 * 每步相同思考时间，只比搜索实力；先后手交替。
 */
'use strict';
const path = require('path');
const os = require('os');
const XQ = require(path.join(__dirname, '../public/js/rules.js'));
const { Pikafish } = require(path.join(__dirname, 'pikafish-uci.js'));

const EXE = path.join(__dirname, '../engines/pikafish/pikafish.exe');
const NNUE = path.join(__dirname, '../engines/pikafish/pikafish.nnue');
const GAMES = Math.max(1, +(process.argv[2] || 4));
const BASE_MT = Math.max(100, +(process.argv[3] || 500));
const PLY_CAP = 160;

const fromUCI = (u) => [(9 - +u[1]) * 9 + (u.charCodeAt(0) - 97), (9 - +u[3]) * 9 + (u.charCodeAt(2) - 97)];

async function playGame(gi, oldEng, newEng, movetime) {
  const st = XQ.stateFromFEN(XQ.START_FEN);
  const t0 = Date.now();
  let winner = 0, reason = '裁决', lastRedView = 0;
  const notations = [];
  const oldIsRed = gi % 2 === 0;   // 交替先后手
  console.log(`\n═══ 第 ${gi + 1} 局 ═══ 每步 ${movetime}ms | 旧版执${oldIsRed ? '红' : '黑'} 新版执${oldIsRed ? '黑' : '红'}`);
  for (let ply = 0; ply < PLY_CAP; ply++) {
    const moverIsRed = st.turn === 1;
    const eng = (moverIsRed === oldIsRed) ? oldEng : newEng;
    let r;
    try {
      r = await eng.bestMove({ fen: XQ.toFEN(st), movetime });
    } catch (e) {
      winner = (eng === oldEng) ? (oldIsRed ? -1 : 1) : (oldIsRed ? 1 : -1);
      reason = '引擎超时'; break;
    }
    const [f, t] = fromUCI(r.bestmove || '');
    const mv = XQ.encode(f, t);
    if (!XQ.legalMoves(st).includes(mv)) {
      winner = (eng === oldEng) ? (oldIsRed ? -1 : 1) : (oldIsRed ? 1 : -1);
      reason = '非法着法'; break;
    }
    const notation = XQ.moveToChinese(st, mv);
    XQ.make(st, mv);
    notations.push((moverIsRed ? '红 ' : '黑 ') + notation);
    const redView = r.kind === 'mate'
      ? ((r.score > 0) === moverIsRed ? 30000 : -30000)
      : ((r.score || 0) * (moverIsRed ? 1 : -1));
    lastRedView = redView;
    const evalTxt = r.kind === 'mate'
      ? ((r.score > 0) === moverIsRed ? `红 ${Math.abs(r.score)} 步杀` : `黑 ${Math.abs(r.score)} 步杀`)
      : ((redView > 0 ? '+' : '') + redView);
    const who = eng === oldEng ? '旧' : '新';
    console.log(`  ${String(Math.floor(ply / 2) + 1).padStart(3)} ${moverIsRed ? '红' : '黑'}[${who}] ${notation.padEnd(6, '　')} 评估 ${evalTxt} (d${r.depth || '?'})`);
    const st1 = XQ.status(st);
    if (st1.over) {
      winner = st1.winner;
      reason = st1.reason === 'checkmate' ? '绝杀' + (XQ.detectMateType(st) || '') : (st1.reason === 'stalemate' ? '困毙' : st1.reason);
      break;
    }
  }
  if (winner === 0 && reason === '裁决' && Math.abs(lastRedView) >= 600) {
    winner = lastRedView > 0 ? 1 : -1;
  }
  const oldWon = winner !== 0 && ((winner === 1) === oldIsRed);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`  ▶ 结果：${winner === 0 ? '和棋' : (oldWon ? '旧版胜' : '新版胜')}（${reason}），共 ${notations.length} 步，用时 ${secs}s`);
  console.log('  着法：' + notations.join(' '));
  return { oldWon, draw: winner === 0, plies: notations.length, secs: +secs };
}

(async () => {
  const cores = os.cpus().length;
  const newThreads = Math.max(1, cores - 4);
  const oldEng = new Pikafish({ exe: EXE, nnue: NNUE, threads: 1, hash: 128 });
  const newEng = new Pikafish({ exe: EXE, nnue: NNUE, threads: newThreads, hash: 2048 });
  const t0 = Date.now();
  await oldEng.start(); await newEng.start();
  console.log(`✓ 双方就绪：旧配置 1线程/128MB vs 新配置 ${newThreads}线程/2048MB（每步同时间）`);

  const tally = { old: 0, neu: 0, draw: 0 };
  for (let gi = 0; gi < GAMES; gi++) {
    oldEng._send('ucinewgame'); newEng._send('ucinewgame');
    const res = await playGame(gi, oldEng, newEng, BASE_MT + gi * 150);
    if (res.oldWon) tally.old++; else if (res.draw) tally.draw++; else tally.neu++;
  }
  console.log(`\n═══ 总成绩（${GAMES} 局，每步 ${BASE_MT}~${BASE_MT + (GAMES - 1) * 150}ms）═══`);
  console.log(`升级前(1线程) ${tally.old} 胜 / 升级后(${newThreads}线程) ${tally.neu} 胜 / 和棋 ${tally.draw}`);
  console.log(`总用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  oldEng.stop(); newEng.stop();
  process.exit(0);
})().catch((e) => { console.error('对弈失败：' + e.message); process.exit(1); });
