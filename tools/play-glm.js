/* play-glm.js — GLM(红) vs 内置引擎大师档(黑) 交互对弈
 * 用法：
 *   node tools/play-glm.js init                # 重置到起始局面（或带初始棋谱文件）
 *   node tools/play-glm.js move 炮二平五       # 红方走一步，引擎应招并打印局面
 */
'use strict';
const fs = require('fs');
const path = require('path');
const XQ = require(path.join(__dirname, '..', 'public', 'js', 'rules.js'));
const Engine = require(path.join(__dirname, '..', 'public', 'js', 'engine.js'));

const STATE = path.join(__dirname, '..', '.vs-qwen', 'glm-vs-engine.json');
const L5_MS = 2600;   // 出厂大师档

function load() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return []; }
}
function save(list) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(list)); }

function replay(list) {
  const st = XQ.stateFromFEN(XQ.START_FEN);
  for (const nt of list) {
    const hits = XQ.legalMoves(st).filter(m => XQ.moveToChinese(st, m) === nt);
    if (hits.length !== 1) throw new Error('棋谱无法唯一匹配: ' + nt + ' (命中' + hits.length + ')');
    XQ.make(st, hits[0]);
  }
  return st;
}

function boardText(st) {
  const rows = [];
  for (let r = 0; r < 10; r++) {
    let s = '';
    for (let c = 0; c < 9; c++) { const p = st.board[r * 9 + c]; s += p === 0 ? '＋' : XQ.pieceChar(p); }
    rows.push((10 - r) + ' ' + s.split('').join(' '));
  }
  return rows.join('\n');
}

const VAL = [0, 0, 250, 250, 430, 950, 470, 100];
function matDiff(st) {
  let s = 0;
  for (const p of st.board) if (p) s += (p > 0 ? 1 : -1) * VAL[Math.abs(p)];
  return s;
}

const cmd = process.argv[2];
const list = load();

if (cmd === 'init') {
  save([]);
  console.log('已重置到初始局面。');
  process.exit(0);
}

if (cmd === 'move') {
  const myNotation = process.argv[3];
  if (!myNotation) { console.error('缺少着法'); process.exit(1); }
  const st = replay(list);
  if (st.turn !== 1) { console.error('当前轮到黑方，状态异常'); process.exit(1); }
  const status0 = XQ.status(st);
  if (status0.over) { console.log('对局已结束:', status0.reason); process.exit(0); }
  const hits = XQ.legalMoves(st).filter(m => XQ.moveToChinese(st, m) === myNotation);
  if (hits.length !== 1) {
    console.log('红方着法无法唯一匹配:', myNotation, '命中', hits.length);
    console.log('合法着法:', XQ.legalMoves(st).map(m => XQ.moveToChinese(st, m)).join(' '));
    process.exit(1);
  }
  const myMove = hits[0];
  const myCap = st.board[myMove & 127];
  XQ.make(st, myMove);
  list.push(myNotation);
  console.log('红方:', myNotation + (myCap ? '(吃' + XQ.pieceChar(myCap) + ')' : ''));

  // 对局结束检查（红走完后）
  let s1 = XQ.status(st);
  if (s1.over) {
    save(list);
    console.log(boardText(st));
    console.log('对局结束:', s1.reason, '胜者:', s1.winner === 1 ? '红(我)' : s1.winner === -1 ? '黑(引擎)' : '和');
    console.log('完整棋谱:', list.join(' '));
    process.exit(0);
  }

  // 引擎(黑)应招
  const t0 = Date.now();
  const r = Engine.think(st, 5, { timeMs: L5_MS });
  const ms = Date.now() - t0;
  if (!r.move) { save(list); console.log('引擎无着法，红胜'); process.exit(0); }
  const em = XQ.encode(r.move.from, r.move.to);
  const eCap = st.board[em & 127];
  const eNotation = XQ.moveToChinese(st, em);
  XQ.make(st, em);
  list.push(eNotation);
  console.log('黑方(大师):', eNotation + (eCap ? '(吃' + XQ.pieceChar(eCap) + ')' : ''), `深度${r.depth} ${r.nodes}节点 ${ms}ms 评分${r.score}${r.aborted ? ' [超时中断]' : ''}`);
  save(list);

  const s2 = XQ.status(st);
  console.log('子力差(红视角):', matDiff(st));
  console.log(boardText(st));
  console.log('轮到: 红 | 棋谱:', list.join(' '));
  if (s2.over) {
    console.log('对局结束:', s2.reason, '胜者:', s2.winner === 1 ? '红(我)' : s2.winner === -1 ? '黑(引擎)' : '和');
    console.log('完整棋谱:', list.join(' '));
  }
  process.exit(0);
}

console.error('用法: node tools/play-glm.js init | move <着法>');
process.exit(1);
