/* engine-worker.js — AI 引擎 Worker 线程，防止搜索时界面卡顿 */
'use strict';
importScripts('rules.js', 'engine.js');

let thinking = false;

self.onmessage = (e) => {
  const { fen, level, id, timeMs, noBook, maxDepth } = e.data;
  if (thinking) return;          // 同一时刻只算一步
  thinking = true;
  try {
    const st = XQ.stateFromFEN(fen);
    const result = Engine.think(st, level, { timeMs, noBook: !!noBook, maxDepth: maxDepth || undefined });
    postMessage({ id, ok: true, result });
  } catch (err) {
    postMessage({ id, ok: false, error: String(err && err.message || err) });
  } finally {
    thinking = false;
  }
};
