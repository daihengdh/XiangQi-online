/* xqwlight-node.js — 在 Node 中加载 xqwlight JS 引擎（engines/xqwlight/JavaScript）
 * 用法：
 *   const XWL = require('./tools/xqwlight-node');
 *   const eng = XWL.create();           // 引擎实例
 *   eng.fromFEN(fen);                   // 载入局面（标准 xiangqi FEN）
 *   const mv = eng.search(depth, ms);   // 返回 {from:[r,c], to:[r,c], notation}
 *   eng.make(from, to);                 // 在引擎内部走子
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'engines', 'xqwlight', 'JavaScript');

const sandbox = { console, Date, Math, parseInt, parseFloat };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['position.js', 'book.js', 'search.js']) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), sandbox, { filename: f });
}

function create() {
  const pos = new sandbox.Position();
  let search = null;
  const eng = {
    pos,
    fromFEN(fen) {
      pos.fromFen(fen);
      search = null;
    },
    search(depth, millis) {
      if (!search) search = new sandbox.Search(pos, 0);
      const mv = search.searchMain(depth || 10, millis || 1500);
      if (mv === 0 || mv == null) return null;
      return { from: [sandbox.SRC(mv) >> 4, sandbox.SRC(mv) & 15], to: [sandbox.DST(mv) >> 4, sandbox.DST(mv) & 15] };
    },
    // 走子（xqwlight 坐标含 3 列边框：rc = (row+3)*16 + col+3）
    make(from, to) {
      const mv = sandbox.MOVE(((from[0] + 3) << 4) | (from[1] + 3), ((to[0] + 3) << 4) | (to[1] + 3));
      if (!pos.legalMove(mv)) return false;
      pos.makeMove(mv);
      search = null;   // 局面变了，搜索树作废
      return true;
    },
  };
  return eng;
}

module.exports = { create };
