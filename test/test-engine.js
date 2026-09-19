/* test-engine.js — AI 引擎测试：node test/test-engine.js */
'use strict';
const XQ = require('../public/js/rules.js');
const Engine = require('../public/js/engine.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  ✗ FAIL: ' + msg); }
}

const { stateFromFEN, toFEN, make, legalMoves, encode } = XQ;
const { think } = Engine;

/* ---------- 1. 一步杀（各档难度都应能看见） ---------- */
{
  // 红车(1,0)→(0,0) 将死黑将（与规则测试同一局面）
  const expected = encode(1 * 9 + 0, 0 * 9 + 0);
  for (const lv of [1, 2, 3, 4, 5]) {
    const st = stateFromFEN('4k4/R8/4P4/9/9/9/2p6/9/9/4K4 w');
    const r = think(st, lv, { timeMs: 3000, noBook: true });
    assert(r && r.move && encode(r.move.from, r.move.to) === expected,
      `一步杀 L${lv} 找到杀着（实际 ${r && r.move ? r.move.from + '-' + r.move.to : '无'}）`);
  }
}

/* ---------- 2. 各档返回合法着法 ---------- */
{
  for (let lv = 1; lv <= 5; lv++) {
    const st = stateFromFEN(XQ.START_FEN);
    const r = think(st, lv, { noBook: true });
    const legal = legalMoves(st).map(String);
    assert(r && r.move && legal.includes(String(encode(r.move.from, r.move.to))), `L${lv} 返回合法着法`);
  }
}

/* ---------- 3. 开局库多样性 ---------- */
{
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const st = stateFromFEN(XQ.START_FEN);
    const r = think(st, 4, {});
    if (r && r.move) seen.add(r.move.from * 100 + r.move.to);
  }
  assert(seen.size >= 3, `开局库产生多种开局（实际 ${seen.size} 种）`);
}

/* ---------- 4. 完整自对弈（不变量） ---------- */
{
  for (const lv of [1, 3, 5]) {
    const st = stateFromFEN(XQ.START_FEN);
    let ok = true, moves = 0;
    const t0 = Date.now();
    while (moves < 80) {
      const ms = legalMoves(st);
      if (ms.length === 0) break;
      const r = think(st, lv, { noBook: true, timeMs: 400 });
      const m = encode(r.move.from, r.move.to);
      if (!ms.includes(m)) { ok = false; console.error(`    L${lv} 走了非法着法`); break; }
      make(st, m);
      moves++;
      const s = XQ.status(st);
      if (s.over) break;
    }
    assert(ok, `L${lv} 自对弈 ${moves} 步全部合法（${Date.now() - t0}ms）`);
    const fen2 = toFEN(st);
    assert(toFEN(stateFromFEN(fen2)) === fen2, `L${lv} 中局 FEN 往返一致`);
  }
}

/* ---------- 5. 大师档战术灵敏度：白吃无根车 ---------- */
{
  // 红车(4,0) 吃黑车(4,4)（无根，且吃后还将军）
  const st = stateFromFEN('2bak4/9/9/9/R3r5/9/9/9/9/3K5 w');
  const r = think(st, 5, { timeMs: 2500, noBook: true });
  assert(r.move && r.move.from === 4 * 9 + 0 && r.move.to === 4 * 9 + 4,
    `L5 白吃车（实际 ${r.move.from}-${r.move.to}）`);
}

/* ---------- 6. 弱档会犯错、强档不会：送吃测试 ---------- */
{
  // 黑卒(4,4) 顶着红炮(7,4)的线路：弱档水平下红炮可能不吃（噪声），强档必吃
  const st = stateFromFEN('4k4/9/9/9/4p4/9/9/9/4C4/4K4 w');
  // 炮(8,4) 直接吃黑卒？炮不吃无架的贴身子——(8,4)到(4,4)无架不能吃。换个清晰局面：
  // 红马(8,6) 吃黑卒(6,5)（无根卒，马走日腿位无阻）
  const st2 = stateFromFEN('4k4/9/9/9/9/9/5p3/9/6N3/3K5 w');
  const legal2 = legalMoves(st2);
  const capture = encode(8 * 9 + 6, 6 * 9 + 5);
  const r5 = think(stateFromFEN('4k4/9/9/9/9/9/5p3/9/6N3/3K5 w'), 5, { timeMs: 2000, noBook: true });
  assert(legal2.includes(capture) && r5.move && encode(r5.move.from, r5.move.to) === capture,
    `L5 吃无根卒（实际 ${r5.move.from}-${r5.move.to}）`);
  // L1 有一定概率不吃（噪声大），只验证不抛错即可
  const r1 = think(stateFromFEN('4k4/9/9/9/9/9/5p3/9/6N3/3K5 w'), 1, { timeMs: 300, noBook: true });
  assert(r1 && r1.move, 'L1 正常返回');
}

console.log(`\n引擎测试：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
