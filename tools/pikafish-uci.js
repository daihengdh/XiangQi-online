/* pikafish-uci.js — Pikafish(皮卡鱼) UCI 引擎的 Node 桥接模块
 * 用法：
 *   const { Pikafish } = require('./tools/pikafish-uci');
 *   const eng = new Pikafish({ exe: 'engines/pikafish/pikafish.exe', nnue: 'engines/pikafish/pikafish.nnue' });
 *   await eng.start();
 *   const best = await eng.bestMove({ fen, movetime: 1000 });  // → { bestmove, ponder?, score?, depth? }
 *   await eng.stop();
 *
 * 也支持命令行自测：node tools/pikafish-uci.js <pikafish.exe路径> [nnue路径]
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');

class Pikafish {
  constructor({ exe, nnue, threads = 2, hash = 256 } = {}) {
    if (!exe) throw new Error('缺少 exe 路径');
    this.exe = path.resolve(exe);
    this.nnue = nnue ? path.resolve(nnue) : null;
    this.threads = threads;
    this.hash = hash;
    this.proc = null;
    this.buffer = '';
    this.waiters = [];   // { test(line), resolve, reject }
    this.lastInfo = null;
  }

  _handleLine(line) {
    line = line.trim();
    if (!line) return;
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i];
      if (w.test(line)) {
        this.waiters.splice(i, 1);
        w.resolve(line);
        return;
      }
    }
    const m = line.match(/^info .*depth (\d+).*score (cp|mate) (-?\d+)/);
    if (m) this.lastInfo = { depth: +m[1], kind: m[2], score: +m[3] };
    const pv = line.match(/\bpv ((?:[a-i][0-9]){1,}(?: [a-i][0-9])*)/);
    if (pv) this.lastInfo = Object.assign(this.lastInfo || {}, { pv: pv[1].split(/\s+/) });
  }

  _send(cmd) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(cmd + '\n');
  }

  _waitFor(test, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex(w => w.resolve === resolve);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error('Pikafish 等待超时'));
      }, timeoutMs);
      this.waiters.push({ test, resolve: (line) => { clearTimeout(timer); resolve(line); }, reject });
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.exe, [], { cwd: path.dirname(this.exe) });
      this.proc.on('error', (e) => {
        const i = this.waiters.findIndex(w => w.reject === reject);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(e);
      });
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (d) => {
        this.buffer += d;
        let idx;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + 1);
          this._handleLine(line);
        }
      });
      this._waitFor(l => l === 'uciok', 20000).then(resolve).catch(reject);
      this._send('uci');
    }).then(() => {
      this._send('setoption name Threads value ' + this.threads);
      this._send('setoption name Hash value ' + this.hash);
      if (this.nnue) this._send('setoption name EvalFile value ' + this.nnue);
      this._send('isready');
      return this._waitFor(l => l === 'readyok', 20000);
    });
  }

  /** 计算最佳着法。go: { fen, moves?: [uci,...], movetime?, depth? } */
  bestMove({ fen, moves = [], movetime = 1000, depth }) {
    this.lastInfo = null;
    return Promise.resolve().then(() => {
      if (!this.proc) throw new Error('引擎未启动');
      this._send('position fen ' + fen + (moves.length ? ' moves ' + moves.join(' ') : ''));
      this._send(depth ? ('go depth ' + depth) : ('go movetime ' + movetime));
      return this._waitFor(l => l.startsWith('bestmove'), Math.max(60000, (movetime || 0) * 4 + 30000));
    }).then(line => {
      const parts = line.split(/\s+/);
      const out = { bestmove: parts[1] };
      if (parts[3] && parts[3] !== '(none)') out.ponder = parts[3];
      if (this.lastInfo) {
        out.score = this.lastInfo.score;
        out.depth = this.lastInfo.depth;
        out.kind = this.lastInfo.kind;   // 'cp' | 'mate'（mate 时 score = 步数，正=行棋方将杀）
        if (this.lastInfo.pv) out.pv = this.lastInfo.pv;   // 主变着法序列（UCI 坐标）
      }
      return out;
    });
  }

  stop() {
    if (this.proc) {
      this._send('quit');
      try { this.proc.kill(); } catch (e) { /* 忽略 */ }
      this.proc = null;
    }
  }
}

module.exports = { Pikafish };

// 命令行自测：node tools/pikafish-uci.js <pikafish.exe> [nnue]
if (require.main === module) {
  const exe = process.argv[2];
  if (!exe) { console.error('用法: node tools/pikafish-uci.js <pikafish.exe> [nnue]'); process.exit(1); }
  const eng = new Pikafish({ exe, nnue: process.argv[3], threads: 1, hash: 128 });
  const XQ = require('../public/js/rules.js');
  (async () => {
    console.log('启动 UCI 引擎...');
    await eng.start();
    console.log('引擎就绪 OK');
    const st = XQ.stateFromFEN(XQ.START_FEN);
    const r1 = await eng.bestMove({ fen: XQ.toFEN(st), movetime: 800 });
    console.log('初始局面最佳:', JSON.stringify(r1));
    await eng.stop();
    console.log('自测完成 OK');
  })().catch(e => { console.error('自测失败:', e.message); process.exit(1); });
}
