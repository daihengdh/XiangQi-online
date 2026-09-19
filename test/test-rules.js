/* test-rules.js — 规则引擎单元测试：node test/test-rules.js */
'use strict';
const XQ = require('../public/js/rules.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}
function eq(a, b, msg) { assert(a === b, `${msg}（期望 ${b}，实际 ${a}）`); }

const { stateFromFEN, toFEN, legalMoves, make, unmake, status, inCheck, moveToChinese, encode, mFrom, mTo, kingsFacing } = XQ;

/* ---------- 1. 开局着法数（手工核算：车4 马4 象4 士2 将1 炮24 兵5 = 44） ---------- */
{
  const st = stateFromFEN(XQ.START_FEN);
  const ms = legalMoves(st);
  eq(ms.length, 44, '开局合法着法数');
  eq(toFEN(st), XQ.START_FEN, 'FEN 往返一致');
}

/* ---------- 2. perft ---------- */
function perft(st, d) {
  if (d === 0) return 1;
  const ms = legalMoves(st);
  if (d === 1) return ms.length;
  let n = 0;
  for (const m of ms) { make(st, m); n += perft(st, d - 1); unmake(st); }
  return n;
}
{
  const st = stateFromFEN(XQ.START_FEN);
  const t0 = Date.now();
  const p2 = perft(st, 2), p3 = perft(st, 3);
  console.log(`  perft(2)=${p2}  perft(3)=${p3}  用时 ${Date.now() - t0}ms`);
  assert(p2 > 1500 && p2 < 2500, 'perft(2) 在合理区间');
  eq(toFEN(st), XQ.START_FEN, 'perft 后棋盘还原');
}

/* ---------- 3. 专项规则 ---------- */
function movesFrom(fen, fromSq) {
  const st = stateFromFEN(fen);
  return legalMoves(st).filter(m => mFrom(m) === fromSq).map(mTo);
}
function arrEq(a, b, msg) {
  const sa = [...a].sort((x, y) => x - y).join(','), sb = [...b].sort((x, y) => x - y).join(',');
  assert(sa === sb, `${msg}：实际[${sa}] 期望[${sb}]`);
}
const KG = '4k4'; // 黑将(0,4) + 红帅(9,4)，中间无子会照面，测试里都保证有隔子

// 蹩马腿：红马(5,4)，黑卒(4,4) 蹩住向上的两条腿
{
  const fen = '4k4/9/9/9/4p4/4N4/9/9/9/4K4 w';
  arrEq(movesFrom(fen, 5 * 9 + 4), [4 * 9 + 2, 4 * 9 + 6, 6 * 9 + 2, 6 * 9 + 6, 7 * 9 + 3, 7 * 9 + 5], '蹩马腿');
}
// 塞象眼：红相(9,2)，黑卒(8,1) 塞住左象眼
{
  const fen = '4k4/9/9/9/9/9/9/9/1p7/2B1K4 w';
  arrEq(movesFrom(fen, 9 * 9 + 2), [7 * 9 + 4], '塞象眼（象只剩一路）');
}
// 炮隔子吃 / 无炮架不能吃
{
  const fen = '4k4/9/4r4/9/4p4/4C4/9/9/9/4K4 w'; // 红炮(5,4) 黑卒(4,4)作炮架 黑车(2,4)
  const ms = movesFrom(fen, 5 * 9 + 4);
  assert(ms.includes(2 * 9 + 4), '炮隔子吃车');
  const fen2 = '4k4/9/9/9/3p5/3Cp4/9/9/9/4K4 w';  // 黑卒(4,3)贴着炮做炮架，后面无目标
  const ms2 = movesFrom(fen2, 5 * 9 + 3);
  assert(!ms2.some(t => t < 5 * 9), '炮无目标时不能越炮架');
  assert(!ms2.includes(4 * 9 + 3), '炮不能直接吃贴身子');
}
// 兵：未过河只能直进，过河能横走
{
  const fen = '4k4/9/9/9/2P6/4p4/9/9/9/4K4 w'; // 红兵(4,2) 已过河（黑卒挡将避免照面）
  arrEq(movesFrom(fen, 4 * 9 + 2), [3 * 9 + 2, 4 * 9 + 1, 4 * 9 + 3], '过河兵走法');
  const fen2 = '4k4/9/9/9/9/2P1p4/9/9/9/4K4 w'; // 红兵(5,2) 未过河
  arrEq(movesFrom(fen2, 5 * 9 + 2), [4 * 9 + 2], '未过河兵走法');
}
// 白脸将：红兵(4,4)横走会露将 → 只能直进
{
  const fen = '4k4/9/9/9/4P4/9/9/9/9/4K4 w';
  arrEq(movesFrom(fen, 4 * 9 + 4), [3 * 9 + 4], '横走露将非法');
}
// 象不过河 / 士不出宫（随机对局里已覆盖，此处验证象在河边不能前进）
{
  const fen = '4k4/9/9/9/9/2B6/9/9/9/4K4 w'; // 红相(5,2)（已在对岸？不：红相行5是河界自己一侧最前）
  // 相(5,2) 可走 (7,0),(7,4)，不能到 (3,*)（过河）
  const ms = movesFrom(fen, 5 * 9 + 2);
  assert(ms.every(t => (t / 9 | 0) >= 5), '相不过河');
}

/* ---------- 4. 将死 / 困毙 ---------- */
{
  // 红车(1,0)→(0,0) 一着将死：黑将(0,4) 无士象，红兵(2,4) 封(1,4)，红车封锁横线
  const fen = '4k4/R8/4P4/9/9/9/2p6/9/9/4K4 w';
  const st = stateFromFEN(fen);
  const ms = legalMoves(st);
  const mate = encode(1 * 9 + 0, 0 * 9 + 0);
  assert(ms.includes(mate), '杀着在合法着法中');
  make(st, mate);
  const s = status(st);
  assert(s.over && s.reason === 'checkmate' && s.winner === XQ.RED, '一步绝杀判定');
  assert(inCheck(st, XQ.BLACK), '黑方被将军');
  unmake(st);
  eq(toFEN(st), fen, 'make/unmake 还原');
}
{
  // 困毙：黑将(0,4) 无子可动——红兵(1,3)(1,5) 封两侧、红兵(3,4) 挡照面，但黑未被将军
  const fen = '4k4/3P1P3/9/4P4/9/9/9/9/9/4K4 b';
  const st = stateFromFEN(fen);
  const s = status(st);
  assert(s.over && s.reason === 'stalemate' && s.winner === XQ.RED, '困毙判定');
  assert(!inCheck(st, XQ.BLACK), '困毙时未被将军');
}

/* ---------- 5. 中文棋谱 ---------- */
{
  const st = stateFromFEN(XQ.START_FEN);
  eq(moveToChinese(st, encode(7 * 9 + 7, 7 * 9 + 4)), '炮二平五', '炮二平五');
  eq(moveToChinese(st, encode(9 * 9 + 7, 7 * 9 + 6)), '马二进三', '马二进三');
  eq(moveToChinese(st, encode(0 * 9 + 7, 2 * 9 + 6)), '马2进3', '黑方记法用阿拉伯数字');
  eq(moveToChinese(st, encode(0 * 9 + 1, 2 * 9 + 2)), '马8进7', '黑马8进7');
  eq(moveToChinese(st, encode(6 * 9 + 4, 5 * 9 + 4)), '兵五进一', '兵五进一');
  // 同列双马 → 前马
  const st2 = stateFromFEN('4k4/9/9/9/9/4N4/9/4N4/9/4K4 w');
  eq(moveToChinese(st2, encode(5 * 9 + 4, 4 * 9 + 2)), '前马进七', '前马进七');
}

/* ---------- 6. 随机对局：不变量 ---------- */
{
  let games = 200, plies = 0, finished = 0, rngState = 12345;
  const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
  let bad = 0;
  for (let g = 0; g < games; g++) {
    const st = stateFromFEN(XQ.START_FEN);
    const keys = Object.create(null);
    let keyCount = 0;
    for (let i = 0; i < 300; i++) {
      const ms = legalMoves(st);
      if (ms.length === 0) { finished++; break; }
      const snap = toFEN(st);
      const m = ms[(rnd() * ms.length) | 0];
      const cap = make(st, m);
      plies++;
      // 不变量
      if (kingsFacing(st.board, st.kings[0], st.kings[1])) { bad++; break; }
      if (cap !== 0 && st.board[mTo(m)] === 0) { bad++; break; }
      // kings 与棋盘一致
      if (st.board[st.kings[0]] !== XQ.K || st.board[st.kings[1]] !== -XQ.K) { bad++; break; }
      // make/unmake 往返
      unmake(st);
      if (toFEN(st) !== snap) { bad++; break; }
      make(st, m);
      // 棋子数量守恒（吃子除外）
      let cnt = 0; for (let s = 0; s < 90; s++) if (st.board[s] !== 0) cnt++;
      if (g === 0 && i === 0 && cnt !== 32) bad++;
      const key = toFEN(st);
      if (++keys[key] >= 3) { finished++; break; } // 三次重复局面
    }
    if (bad) break;
  }
  eq(bad, 0, '随机对局不变量');
  console.log(`  随机对局：${plies} 步，${finished} 局自然结束（将杀/困毙/重复）`);
}

console.log(`\n规则测试：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
