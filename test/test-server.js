/* test-server.js — 联机协议集成测试：node test/test-server.js
 * 直接调用 server.js 导出的 route 逻辑，模拟两个玩家客户端完整对局
 */
'use strict';
const assert = require('assert');
const path = require('path');
const XQ = require(path.join(__dirname, '../public/js/rules.js'));

// 用 require 缓存控制端口，避免真实监听冲突：设 PORT=0 由测试内部换端口
process.env.PORT = '0';
const S = require('../server.js');

// 假连接对象：捕获 send，模拟 route
class FakeConn {
  constructor() {
    this.playerId = null;
    this.roomId = null;
    this.inbox = [];
    this.onmessage = null;
    this.onclose = null;
  }
  send(raw) { this.inbox.push(JSON.parse(raw)); }
  get last() { return this.inbox[this.inbox.length - 1]; }
  wait(t) {  // 取第一条 t 匹配的消息
    const m = this.inbox.find(x => x.t === t);
    if (!m) throw new Error('缺少消息 ' + t + '（已有 ' + this.inbox.map(x => x.t).join(',') + '）');
    return m;
  }
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + '：' + e.message); }
}
// 准备机制：双方就座后需各自 ready 才开局
function readyUp(S, x, y) {
  S.route(x, JSON.stringify({ t: 'ready', on: true }));
  S.route(y, JSON.stringify({ t: 'ready', on: true }));
}

/* ---------- 1. 建房 + 加入 → 自动开始 ---------- */
test('建房/加入/开始', () => {
  const a = new FakeConn(), b = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: '小红' }));
  assert(a.wait('created').room, '创建返回房间号');
  const roomId = a.playerId && a.roomId;
  assert(a.roomId, '创建者绑定房间');

  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: '小黑' }));
  readyUp(S, a, b);
  const started = b.wait('start');
  assert(started.fen === XQ.START_FEN, '开局 FEN');
  assert(started.red === '小红' && started.black === '小黑', '座位分配');
  a.wait('start');
});

/* ---------- 2. 服务器校验着法：非法着法被拒 ---------- */
test('非法着法被拒绝', () => {
  const a = new FakeConn(), b = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: 'A' }));
  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: 'B' }));
  readyUp(S, a, b);
  b.wait('start'); a.wait('start');

  // 黑方（b）先走 → 被拒（红先）
  S.route(b, JSON.stringify({ t: 'move', from: 0, to: 9 }));
  assert(b.wait('error').error.includes('轮到'), '未轮到被拒');
  // 红方走不合法着法（帅飞两格）
  S.route(a, JSON.stringify({ t: 'move', from: 85, to: 67 }));
  assert(a.wait('error').error.includes('合法') || a.inbox.some(m => m.t === 'error'), '非法着法被拒');
  // 红方走合法着法（炮二平五）
  S.route(a, JSON.stringify({ t: 'move', from: 70, to: 67 }));
  const mv = b.wait('move');
  assert(mv.notation === '炮二平五', '着法记谱：' + mv.notation);
  assert(mv.fen.split(' ')[1] === 'b', '轮转到黑方');
});

/* ---------- 3. 完整对局：双车错杀（服务器判胜负） ---------- */
test('完整对局到将死', () => {
  const a = new FakeConn(), b = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: '甲' }));
  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: '乙' }));
  readyUp(S, a, b);
  b.wait('start'); a.wait('start');

  // 双方各走两步走到可测局面：直接构造——用服务器 API 复制房间状态
  const room = S.rooms.get(a.roomId);
  // 直接设置一个一步杀局面（红走车(1,0)→(0,0) 绝杀）
  room.st = XQ.stateFromFEN('4k4/R8/4P4/9/9/9/2p6/9/9/4K4 w');
  room.status = 'playing';
  S.route(a, JSON.stringify({ t: 'move', from: 9, to: 0 }));   // (1,0)→(0,0)
  const end = b.wait('move');
  assert(end.end && end.end.winner === 1 && end.end.reason === 'checkmate', '服务器判定红方绝杀');
  a.wait('move');
});

/* ---------- 4. 认输 / 求和 / 悔棋 ---------- */
test('认输判负', () => {
  const a = new FakeConn(), b = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: '甲' }));
  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: '乙' }));
  readyUp(S, a, b);
  b.wait('start'); a.wait('start');
  S.route(b, JSON.stringify({ t: 'resign' }));
  const e = a.wait('end');
  assert(e.winner === 1 && e.reason === 'resign', '黑方认输红胜');
});

test('求和流程', () => {
  const a = new FakeConn(), b = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: '甲' }));
  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: '乙' }));
  readyUp(S, a, b);
  b.wait('start'); a.wait('start');
  S.route(a, JSON.stringify({ t: 'draw' }));          // 红求和
  assert(b.wait('draw-offer').from === a.playerId, '收到求和');
  S.route(b, JSON.stringify({ t: 'draw', accept: true }));
  const e = a.wait('end');
  assert(e.winner === 0 && e.reason === 'agreement', '协议和棋');
});

test('悔棋流程', () => {
  const a = new FakeConn(), b = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: '甲' }));
  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: '乙' }));
  readyUp(S, a, b);
  b.wait('start'); a.wait('start');
  // 红走一步，黑走一步，然后黑求悔棋
  S.route(a, JSON.stringify({ t: 'move', from: 70, to: 67 }));
  S.route(b, JSON.stringify({ t: 'move', from: 67 - 9, to: 70 - 9 }));  // 黑炮8平5
  b.inbox.length = 0; a.inbox.length = 0;
  S.route(b, JSON.stringify({ t: 'undo' }));
  assert(a.wait('undo-offer'), '红方收到悔棋请求');
  S.route(a, JSON.stringify({ t: 'undo', accept: true }));
  const u = b.wait('undo');
  assert(u.moveCount === 0, '悔棋撤掉两步');
  assert(u.fen === XQ.START_FEN, '回到开局');
});

/* ---------- 5. 聊天 / 快速匹配 ---------- */
test('聊天广播', () => {
  const a = new FakeConn(), b = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: '甲' }));
  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: '乙' }));
  readyUp(S, a, b);
  b.wait('start'); a.wait('start');
  a.inbox.length = 0; b.inbox.length = 0;
  S.route(a, JSON.stringify({ t: 'chat', text: '你好！' }));
  assert(a.wait('chat').text === '你好！', '自己收到');
  assert(b.wait('chat').from === '甲', '对方收到');
});

test('快速匹配复用等待房间', () => {
  const a = new FakeConn();
  S.route(a, JSON.stringify({ t: 'quick', name: '等一' }));
  const roomA = a.roomId;
  const b = new FakeConn();
  S.route(b, JSON.stringify({ t: 'quick', name: '等二' }));
  readyUp(S, a, b);
  assert(b.roomId === roomA, '加入同一房间');
  assert(b.wait('start'), '自动开局');
});

/* ---------- 6. 房间号重复加入被拒 ---------- */
test('房间满被拒', () => {
  const a = new FakeConn(), b = new FakeConn(), c = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: 'A' }));
  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: 'B' }));
  readyUp(S, a, b);
  b.wait('start');
  S.route(c, JSON.stringify({ t: 'join', room: a.roomId, name: 'C' }));
  readyUp(S, a, c);
  assert(c.wait('error').error.includes('已满'), '第三人被拒');
});

/* ---------- 7. 再来一局（rematch）：双方确认后换先手重开 ---------- */
test('再来一局流程', () => {
  const a = new FakeConn(), b = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: '甲' }));
  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: '乙' }));
  readyUp(S, a, b);
  b.wait('start'); a.wait('start');
  // 打到结束：红方直接认输
  S.route(a, JSON.stringify({ t: 'resign' }));
  const e = a.wait('end');
  assert(e.winner === -1 && e.reason === 'resign', '红认输黑胜');
  // A 请求 rematch → 广播 offer
  S.route(a, JSON.stringify({ t: 'rematch' }));
  assert(b.wait('rematch-offer').from === a.playerId, 'B 收到再战请求');
  // A 重复点击 → 忽略（无第二次 offer）
  S.route(a, JSON.stringify({ t: 'rematch' }));
  assert(!b.inbox.some(m => m.t === 'rematch-offer' && m !== b.inbox.find(x => x.t === 'rematch-offer')), '重复点击被忽略');
  // B 同意 → 双方进入准备阶段（换先手：乙变红），重新准备后开局
  S.route(b, JSON.stringify({ t: 'rematch' }));
  assert(b.wait('readying').status === 'readying', '进入准备阶段');
  readyUp(S, a, b);
  const startsB = b.inbox.filter(m => m.t === 'start');
  const startsA = a.inbox.filter(m => m.t === 'start');
  assert(startsB.length >= 2, 'B 收到第二次开局广播');
  const st = startsB[startsB.length - 1];
  assert(st.red === '乙' && st.black === '甲', '换先手：乙执红（实际 ' + st.red + '/' + st.black + '）');
  assert(startsA.length >= 2 && startsA[startsA.length - 1].fen === XQ.START_FEN, 'A 也收到重开');
});

/* ---------- 8. 将死广播带杀法类型 ---------- */
test('将死广播含 mateType', () => {
  const a = new FakeConn(), b = new FakeConn();
  S.route(a, JSON.stringify({ t: 'create', name: '甲' }));
  S.route(b, JSON.stringify({ t: 'join', room: a.roomId, name: '乙' }));
  readyUp(S, a, b);
  b.wait('start'); a.wait('start');
  // 直接设为马后炮杀局面：红走一步将死
  const room = S.rooms.get(a.roomId);
  room.st = XQ.stateFromFEN('4k4/9/4N4/9/4C4/9/9/9/9/4K4 w');
  room.status = 'playing';
  S.route(a, JSON.stringify({ t: 'move', from: 40, to: 31 }));   // 炮退一，马后炮绝杀
  const mv = b.wait('move');
  assert(mv.end && mv.end.reason === 'checkmate', '将死');
  assert(mv.end.mateType === '马后炮', 'mateType=' + mv.end.mateType);
});

console.log(`\n联机测试：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
