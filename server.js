/* server.js — 零依赖联机服务器：静态文件 + WebSocket(房间/对局) + 计时
 * 用法：node server.js [端口]（默认 8080）
 */
'use strict';
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

const XQ = require(path.join(__dirname, 'public/js/rules.js'));

const PORT = +(process.argv[2] || process.env.PORT || 8080);
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
};

/* ---------- Pikafish 引擎托管（线下辅助支招用，可选：缺文件时自动降级内置引擎） ---------- */
const { Pikafish } = require(path.join(__dirname, 'tools/pikafish-uci.js'));
const ENGINE_DIR = path.join(__dirname, 'engines', 'pikafish');
const pf = { eng: null, starting: null, lastFail: 0, queue: Promise.resolve() };

function startPikafish() {
  if (pf.eng) return Promise.resolve(true);
  if (pf.starting) return pf.starting;
  if (Date.now() - pf.lastFail < 8000) return Promise.resolve(false);   // 失败后 8 秒内不重试
  pf.starting = new Promise((resolve) => {
    try {
      const eng = new Pikafish({
        exe: path.join(ENGINE_DIR, 'pikafish.exe'),
        nnue: path.join(ENGINE_DIR, 'pikafish.nnue'),
        threads: 1, hash: 128,
      });
      eng.start().then(() => {
        pf.eng = eng; pf.starting = null;
        console.log('[Pikafish] 引擎已就绪（NNUE 权重已加载）');
        resolve(true);
      }).catch((e) => {
        pf.lastFail = Date.now(); pf.starting = null;
        console.error('[Pikafish] 启动失败:', e.message);
        resolve(false);
      });
    } catch (e) {
      pf.lastFail = Date.now(); pf.starting = null;
      resolve(false);
    }
  });
  return pf.starting;
}

function pikafishBestMove(fen, movetime) {
  /* 局面合法性校验：双王在位 + 行棋方对手不被将军（违规局面会让引擎行为未定义） */
  let st = null;
  try { st = XQ.stateFromFEN(fen); } catch (e) { return Promise.reject(new Error('非法 FEN')); }
  if (st.kings[0] == null || st.kings[1] == null) return Promise.reject(new Error('局面缺少将/帅'));
  if (XQ.inCheck(st, -st.turn)) return Promise.reject(new Error('局面非法：行棋方对手正处于被将军状态'));

  const run = () => startPikafish().then((ok) => {
    if (!ok || !pf.eng) throw new Error('Pikafish 不可用');
    let timeoutId;
    const timeout = new Promise((_, rej) => {
      timeoutId = setTimeout(() => {
        /* 引擎卡死自愈：杀进程，下次请求自动重启 */
        try { pf.eng.stop(); } catch (e) {}
        pf.eng = null;
        rej(new Error('引擎搜索超时，已自动重启'));
      }, 20000);
    });
    return Promise.race([
      pf.eng.bestMove({ fen, movetime }).then((r) => { clearTimeout(timeoutId); return r; }),
      timeout,
    ]);
  });
  pf.queue = pf.queue.then(run, run);   // 引擎一次只算一步，串行化
  return pf.queue;
}

const fromUCI = (u) => {
  const f = u.charCodeAt(0) - 97, r = 9 - +u[1], t = u.charCodeAt(2) - 97, rr = 9 - +u[3];
  return [r * 9 + f, rr * 9 + t];
};

/* ---------- 静态文件 ---------- */
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  /* API：皮卡鱼最佳着法（POST /api/bestmove  {fen, movetime?}） */
  if (req.method === 'POST' && urlPath === '/api/bestmove') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let fen = '', movetime = 2000;
      try {
        const j = JSON.parse(body || '{}');
        fen = String(j.fen || '');
        movetime = Math.min(8000, Math.max(200, +j.movetime || 2000));
      } catch (e) { /* 忽略，按空参处理 */ }
      if (!fen) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '缺少 fen' }));
        return;
      }
      pikafishBestMove(fen, movetime).then((r) => {
        let out = { bestmove: r.bestmove, score: r.score, depth: r.depth, kind: r.kind || 'cp', legal: false };
        try {
          const st = XQ.stateFromFEN(fen);
          const [fsq, tsq] = fromUCI(r.bestmove);
          if (XQ.legalMoves(st).includes(XQ.encode(fsq, tsq))) {
            out.legal = true;
            out.from = fsq; out.to = tsq;
            out.notation = XQ.moveToChinese(st, XQ.encode(fsq, tsq));
          }
        } catch (e) { /* 校验失败按非法处理 */ }
        /* 主变着法序列（沙盘推演用）：逐个换算坐标与中文记谱 */
        if (Array.isArray(r.pv) && r.pv.length) {
          try {
            const pst = XQ.stateFromFEN(fen);
            out.pv = [];
            for (const u of r.pv) {
              const [pf, pt] = fromUCI(u);
              const pm = XQ.encode(pf, pt);
              if (!XQ.legalMoves(pst).includes(pm)) break;
              out.pv.push({ from: pf, to: pt, notation: XQ.moveToChinese(pst, pm), cap: pst.board[pt] || 0 });
              XQ.make(pst, pm);
            }
          } catch (e) { /* PV 换算失败不影响主结果 */ }
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(out));
      }).catch((e) => {
        const bad = /非法|缺少|无合法/.test(e.message || '');
        res.writeHead(bad ? 400 : 503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message || 'engine unavailable' }));
      });
    });
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------- WebSocket（RFC6455 子集：text 帧 + ping/pong + close） ---------- */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const crypto = require('crypto');

function wsAccept(key) { return crypto.createHash('sha1').update(key + GUID).digest('base64'); }

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2); header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10); header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

class WSConn {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = null;
    this.fragOpcode = 0;
    this.alive = true;
    this.onmessage = null;
    this.onclose = null;
    socket.on('data', d => this._feed(d));
    const end = () => this._closed();
    socket.on('close', end); socket.on('error', end); socket.on('end', end);
  }
  _closed() {
    if (!this.alive) return;
    this.alive = false;
    if (this.onclose) this.onclose();
  }
  _feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.alive) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = b.readUInt32BE(6); off = 10; }
      let mask = null;
      if (masked) { if (b.length < off + 4) return; mask = b.slice(off, off + 4); off += 4; }
      if (b.length < off + len) return;
      let payload = b.slice(off, off + len);
      if (mask) {
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      this.buffer = b.slice(off + len);

      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x9) { this.socket.write(encodeFrame(0xA, payload)); continue; }  // ping→pong
      if (opcode === 0xA) continue;

      if (!fin) {
        if (opcode !== 0) this.fragOpcode = opcode;
        this.fragments = this.fragments ? Buffer.concat([this.fragments, payload]) : payload;
        continue;
      }
      let whole = payload;
      if (this.fragments) { whole = Buffer.concat([this.fragments, payload]); this.fragments = null; }
      const op = opcode !== 0 ? opcode : this.fragOpcode;
      if (op === 0x1 || op === 0x2) {
        let text;
        try { text = whole.toString('utf8'); } catch (e) { this.close(); return; }
        if (text.length > 64 * 1024) { this.close(); return; }
        if (this.onmessage) this.onmessage(text);
      }
    }
  }
  send(text) {
    if (!this.alive) return;
    try { this.socket.write(encodeFrame(0x1, Buffer.from(String(text), 'utf8'))); } catch (e) { this._closed(); }
  }
  close() {
    if (!this.alive) return;
    try { this.socket.write(encodeFrame(0x8, Buffer.alloc(0))); } catch (e) {}
    this.socket.end();
    this._closed();
  }
}

/* ---------- 房间 ---------- */
const rooms = new Map();       // roomId → room
const playerMap = new Map();   // playerId → {room, seat}

const ROOM_TTL = 24 * 3600 * 1000;      // 空房间保留时长
const BASE_TIME = 15 * 60 * 1000;       // 每方 15 分钟包干
const INC_TIME = 30 * 1000;             // 每步加 30 秒
const DISCONNECT_GRACE = 60 * 1000;     // 掉线宽限

let nextId = 1;
function newRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do { id = ''; for (let i = 0; i < 4; i++) id += chars[(Math.random() * chars.length) | 0]; } while (rooms.has(id));
  return id;
}

function newPlayerId() { return 'p' + (nextId++) + '-' + Math.random().toString(36).slice(2, 7); }

function roomSnapshot(room) {
  return {
    t: 'room', room: room.id,
    fen: XQ.toFEN(room.st),
    turn: room.st.turn,
    moveCount: room.moveList.length,
    red: { id: room.red ? room.red.id : null, name: room.red ? room.red.name : null, online: !!room.redConn },
    black: { id: room.black ? room.black.id : null, name: room.black ? room.black.name : null, online: !!room.blackConn },
    clocks: { red: room.clockRed, black: room.clockBlack },
    status: room.status,           // waiting | playing | over
    result: room.result || null,   // {winner:1|-1|0, reason}
    drawOffer: room.drawOffer || null,
    undoOffer: room.undoOffer || null,
    lastMove: room.lastMove || null,
    notations: room.notationList,
    you: undefined,
  };
}

function broadcast(room, obj, exceptId) {
  for (const p of [room.red, room.black]) {
    if (!p) continue;
    const conn = p.id === (room.red && room.red.id) ? room.redConn : room.blackConn;
    if (!conn) continue;
    if (exceptId && p.id === exceptId) continue;
    const msg = Object.assign({}, obj);
    msg.you = p.id;
    conn.send(JSON.stringify(msg));
  }
}

function seatOf(room, playerId) {
  if (room.red && playerId === room.red.id) return 1;
  if (room.black && playerId === room.black.id) return -1;
  return 0;
}

function bothOnline(room) { return !!room.redConn && !!room.blackConn; }

function startGame(room, swapSides) {
  if (swapSides && room.red && room.black) {
    const t = room.red; room.red = room.black; room.black = t;
    const tc = room.redConn; room.redConn = room.blackConn; room.blackConn = tc;
  }
  room.st = XQ.stateFromFEN(XQ.START_FEN);
  room.moveList = [];
  room.notationList = [];
  room.lastMove = null;
  room.status = 'playing';
  room.result = null; room.drawOffer = null; room.undoOffer = null; room.rematch = null;
  room.disconnectAt = null;
  room.turnStart = Date.now();
  // 联机红先。开局随机换边由创建者决定是否开启；默认随机
  room.clockRed = BASE_TIME; room.clockBlack = BASE_TIME;
  broadcast(room, { t: 'start', fen: XQ.toFEN(room.st), red: room.red.name, black: room.black.name, redId: room.red.id, blackId: room.black.id, clocks: { red: room.clockRed, black: room.clockBlack } });
  console.log(`[房间 ${room.id}] 对局开始：${room.red.name}(红) vs ${room.black.name}(黑)`);
  scheduleAiMove(room);
}

function endGame(room, winner, reason) {
  if (room.status === 'over') return;
  room.status = 'over';
  if (room.aiTimer) { clearTimeout(room.aiTimer); room.aiTimer = null; }
  room.result = { winner, reason };
  broadcast(room, { t: 'end', winner, reason, clocks: { red: room.clockRed, black: room.clockBlack } });
  console.log(`[房间 ${room.id}] 对局结束：胜方 ${winner}（${reason}）`);
}

function applyClockTick(room, now) {
  if (room.status !== 'playing' || !bothOnline(room)) return;
  const el = now - (room.turnStart || now);
  const turn = room.st.turn;
  if (turn === 1) room.clockRed = Math.max(0, room.clockRed - el);
  else room.clockBlack = Math.max(0, room.clockBlack - el);
  room.turnStart = now;
  if (room.clockRed <= 0) endGame(room, -1, 'timeout');
  else if (room.clockBlack <= 0) endGame(room, 1, 'timeout');
}

function handleMove(room, playerId, from, to) {
  if (room.status !== 'playing') return { error: '对局未在进行中' };
  const seat = seatOf(room, playerId);
  if (seat === 0) return { error: '你不是本局玩家' };
  if (room.st.turn !== seat) return { error: '还没轮到你走' };
  const now = Date.now();
  applyClockTick(room, now);
  const m = XQ.encode(from, to);
  const legal = XQ.legalMoves(room.st);
  if (!legal.includes(m)) return { error: '不合法着法' };
  const notation = XQ.moveToChinese(room.st, m);
  const cap = room.st.board[to];
  XQ.make(room.st, m);
  room.moveList.push(m);
  room.notationList.push(notation);
  room.lastMove = { from, to };
  room.drawOffer = null; room.undoOffer = null;

  // 计时：落子方加时
  if (seat === 1) { room.clockRed = Math.min(BASE_TIME * 2, room.clockRed + INC_TIME); }
  else { room.clockBlack = Math.min(BASE_TIME * 2, room.clockBlack + INC_TIME); }
  room.turnStart = Date.now();

  const st1 = XQ.status(room.st);
  let end = null;
  if (st1.over) {
    room.status = 'over';
    room.result = { winner: st1.winner, reason: st1.reason };
    end = { winner: st1.winner, reason: st1.reason, mateType: (st1.reason === 'checkmate' ? XQ.detectMateType(room.st) : null) };
  }
  const checked = XQ.inCheck(room.st, room.st.turn);
  broadcast(room, {
    t: 'move', from, to, notation, fen: XQ.toFEN(room.st), cap: cap || 0,
    checked, end,
    clocks: { red: room.clockRed, black: room.clockBlack },
  });
  if (end) console.log(`[房间 ${room.id}] ${end.winner === 1 ? '红' : end.winner === -1 ? '黑' : '和'}胜（${end.reason}${end.mateType ? '·' + end.mateType : ''}）`);
  else scheduleAiMove(room);   // AI 房间：轮到电脑则应招
  return {};
}

function createRoom(name, wantsRed) {
  const id = newRoomId();
  const room = {
    id, createdAt: Date.now(), status: 'waiting',
    red: null, black: null, redConn: null, blackConn: null,
    st: XQ.stateFromFEN(XQ.START_FEN), moveList: [], notationList: [],
    lastMove: null, result: null, drawOffer: null, undoOffer: null,
    clockRed: BASE_TIME, clockBlack: BASE_TIME, turnStart: 0,
    aiPlayerId: null, aiTimer: null,
  };
  rooms.set(id, room);
  return room;
}

/* ---------- 皮卡鱼电脑玩家（房间人数不足时可加 AI 对手） ---------- */
function aiInRoom(room) { return !!room.aiPlayerId; }
function aiSeatOf(room) { return room.aiPlayerId ? seatOf(room, room.aiPlayerId) : 0; }

function scheduleAiMove(room) {
  if (!room.aiPlayerId || room.status !== 'playing') return;
  if (aiSeatOf(room) !== room.st.turn) return;
  if (room.aiTimer) clearTimeout(room.aiTimer);
  room.aiTimer = setTimeout(() => {
    if (!room.aiPlayerId || room.status !== 'playing' || aiSeatOf(room) !== room.st.turn) return;
    const fen = XQ.toFEN(room.st);
    const finish = (f, t) => {
      if (!room.aiPlayerId || room.status !== 'playing') return;
      const res = handleMove(room, room.aiPlayerId, f, t);
      if (res.error) console.error(`[房间 ${room.id}] AI 走子被拒:`, res.error);
      else scheduleAiMove(room);   // 连续两步都是 AI（不可能，但保险）
    };
    pikafishBestMove(fen, 900).then((r) => {
      if (r.legal) { const [f, t] = fromUCI(r.bestmove); finish(f, t); }
      else {
        const ms = XQ.legalMoves(room.st);
        const m = ms[(Math.random() * ms.length) | 0];
        finish(XQ.mFrom(m), XQ.mTo(m));
      }
    }).catch(() => {
      const ms = XQ.legalMoves(room.st);
      if (!ms.length) return;
      const m = ms[(Math.random() * ms.length) | 0];
      finish(XQ.mFrom(m), XQ.mTo(m));
    });
  }, 700);
}

function performUndo(room) {
  const steps = Math.min(2, room.moveList.length);
  for (let i = 0; i < steps; i++) { XQ.unmake(room.st); room.moveList.pop(); room.notationList.pop(); }
  room.status = 'playing';
  room.result = null; room.drawOffer = null; room.undoOffer = null;
  room.lastMove = room.moveList.length ? { from: XQ.mFrom(room.moveList[room.moveList.length - 1]), to: XQ.mTo(room.moveList[room.moveList.length - 1]) } : null;
  room.turnStart = Date.now();
  broadcast(room, { t: 'undo', fen: XQ.toFEN(room.st), moveCount: room.moveList.length, notations: room.notationList, lastMove: room.lastMove });
}

/* ---------- 消息处理 ---------- */
function route(conn, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (e) { return; }
  const pid = conn.playerId;

  switch (msg.t) {
    case 'create': {
      const name = String(msg.name || '玩家').slice(0, 20);
      const room = createRoom(name);
      const player = { id: newPlayerId(), name };
      // 等待第二个玩家：创建者持红
      room.red = player;
      room.redConn = conn;
      conn.playerId = player.id;
      conn.roomId = room.id;
      playerMap.set(player.id, { room: room.id, seat: 1 });
      conn.send(JSON.stringify(Object.assign(roomSnapshot(room), { t: 'created', you: player.id })));
      console.log(`[房间 ${room.id}] ${name} 创建房间`);
      break;
    }
    case 'join': {
      const roomId = String(msg.room || '').toUpperCase();
      const room = rooms.get(roomId);
      if (!room) { conn.send(JSON.stringify({ t: 'error', error: '房间不存在' })); break; }
      if (room.black && room.blackConn) {
        // 旁观者或重连失败：先看是否能凭旧 id 认领空位
        const claimSeat = (p, id) => p && p.id === id && !((p.id === room.red.id) ? room.redConn : room.blackConn);
        if (!(claimSeat(room.red, msg.playerId) || claimSeat(room.black, msg.playerId))) {
          conn.send(JSON.stringify({ t: 'error', error: '房间已满' }));
          break;
        }
      }
      // 重连：同 playerId
      if (msg.playerId && (msg.playerId === (room.red && room.red.id) || msg.playerId === (room.black && room.black.id))) {
        const seat = msg.playerId === room.red.id ? 1 : -1;
        if (seat === 1) room.redConn = conn; else room.blackConn = conn;
        conn.playerId = msg.playerId; conn.roomId = room.id;
        conn.send(JSON.stringify(Object.assign(roomSnapshot(room), { t: 'rejoined', you: msg.playerId })));
        broadcast(room, { t: 'peer-online' });
        if (room.status === 'playing' && bothOnline(room)) room.turnStart = Date.now();
        console.log(`[房间 ${room.id}] ${msg.playerId} 重连`);
        break;
      }
      const name = String(msg.name || '玩家').slice(0, 20);
      const player = { id: newPlayerId(), name };
      if (!room.red) { room.red = player; room.redConn = conn; }
      else { room.black = player; room.blackConn = conn; }
      conn.playerId = player.id;
      conn.roomId = room.id;
      playerMap.set(player.id, { room: room.id, seat: seatOf(room, player.id) });
      conn.send(JSON.stringify(Object.assign(roomSnapshot(room), { t: 'joined', you: player.id })));
      if (room.status === 'waiting' && room.red && room.black && room.redConn && room.blackConn) startGame(room);
      else if (room.status === 'playing' && bothOnline(room)) room.turnStart = Date.now();
      break;
    }
    case 'quick': {
      // 快速匹配：找 waiting 房间加入，否则自己创建
      let found = null;
      for (const r of rooms.values()) {
        if (r.status === 'waiting' && r.red && r.redConn && !r.black) { found = r; break; }
      }
      if (found) {
        msg.room = found.id;
        msg.t = 'join';
        route(conn, JSON.stringify(msg));
      } else {
        msg.t = 'create';
        route(conn, JSON.stringify(msg));
      }
      break;
    }
    case 'move': {
      const room = rooms.get(conn.roomId);
      if (!room) break;
      const res = handleMove(room, conn.playerId, msg.from | 0, msg.to | 0);
      if (res.error) conn.send(JSON.stringify({ t: 'error', error: res.error }));
      else scheduleAiMove(room);   // 人走完 → 轮到 AI 则应招
      break;
    }
    case 'add-ai': {
      const room = rooms.get(conn.roomId);
      if (!room) break;
      if (room.status !== 'waiting') { conn.send(JSON.stringify({ t: 'error', error: '对局已开始，无法添加电脑' })); break; }
      if (seatOf(room, conn.playerId) === 0) { conn.send(JSON.stringify({ t: 'error', error: '只有房主可以添加电脑' })); break; }
      if (room.red && room.black) { conn.send(JSON.stringify({ t: 'error', error: '房间已满' })); break; }
      const ai = { id: 'ai-' + newPlayerId(), name: '皮卡鱼' };
      if (!room.red) { room.red = ai; room.redConn = null; }
      else { room.black = ai; room.blackConn = null; }
      room.aiPlayerId = ai.id;
      broadcast(room, { t: 'ai-added', name: ai.name });
      conn.send(JSON.stringify(Object.assign(roomSnapshot(room), { t: 'room', you: conn.playerId })));
      if (room.status === 'waiting' && room.red && room.black) startGame(room);
      console.log(`[房间 ${room.id}] 已添加电脑对手：${ai.name}（${aiSeatOf(room) === 1 ? '红' : '黑'}方）`);
      break;
    }
    case 'chat': {
      const room = rooms.get(conn.roomId);
      if (!room) break;
      const seat = seatOf(room, conn.playerId);
      if (seat === 0) break;
      const name = seat === 1 ? room.red.name : room.black.name;
      const text = String(msg.text || '').slice(0, 200);
      if (!text.trim()) break;
      broadcast(room, { t: 'chat', from: name, seat, text });
      break;
    }
    case 'resign': {
      const room = rooms.get(conn.roomId);
      if (!room || room.status !== 'playing') break;
      const seat = seatOf(room, conn.playerId);
      if (seat === 0) break;
      endGame(room, -seat, 'resign');
      break;
    }
    case 'draw': {
      const room = rooms.get(conn.roomId);
      if (!room || room.status !== 'playing') break;
      const seat = seatOf(room, conn.playerId);
      if (seat === 0) break;
      const aiOpp = aiInRoom(room) && aiSeatOf(room) === -seat;
      if (msg.accept === undefined) {
        if (room.drawOffer && room.drawOffer !== conn.playerId) {
          endGame(room, 0, 'agreement');
        } else if (!room.drawOffer) {
          if (aiOpp) {   // AI 拒绝求和
            room.drawOffer = null;
            broadcast(room, { t: 'draw-decline' });
          } else {
            room.drawOffer = conn.playerId;
            broadcast(room, { t: 'draw-offer', from: conn.playerId });
          }
        }
      } else if (msg.accept) {
        if (room.drawOffer && room.drawOffer !== conn.playerId) endGame(room, 0, 'agreement');
      } else {
        room.drawOffer = null;
        broadcast(room, { t: 'draw-decline' });
      }
      break;
    }
    case 'undo': {
      const room = rooms.get(conn.roomId);
      if (!room) break;
      if (msg.accept === undefined || msg.accept === true) {
        // offer 或 accept
        const seat = seatOf(room, conn.playerId);
        if (seat === 0) break;
        const aiOpp = aiInRoom(room) && aiSeatOf(room) === -seat;
        if (room.undoOffer && room.undoOffer !== conn.playerId) {
          performUndo(room);
        } else if (!room.undoOffer) {
          if (aiOpp && room.moveList.length) {   // AI 自动同意悔棋
            performUndo(room);
            scheduleAiMove(room);
          } else if (!room.undoOffer) {
            room.undoOffer = conn.playerId;
            broadcast(room, { t: 'undo-offer', from: conn.playerId });
          }
        }
      } else {
        room.undoOffer = null;
        broadcast(room, { t: 'undo-decline' });
      }
      break;
    }
    case 'rematch': {
      const room = rooms.get(conn.roomId);
      if (!room || room.status !== 'over') break;
      const seat = seatOf(room, conn.playerId);
      if (seat === 0) break;
      if (aiInRoom(room)) {   // 与电脑重开：立即换先手重开
        startGame(room, true);
        break;
      }
      if (room.rematch) {
        if (room.rematch !== conn.playerId) {
          // 双方都同意：换先手重开
          startGame(room, true);
          room.rematch = null;
        }
        // 同一玩家重复点击忽略
      } else {
        room.rematch = conn.playerId;
        broadcast(room, { t: 'rematch-offer', from: conn.playerId });
      }
      break;
    }
    case 'leave': {
      cleanupConn(conn);
      break;
    }
  }
}

function cleanupConn(conn) {
  const room = conn.roomId ? rooms.get(conn.roomId) : null;
  if (room) {
    if (conn.playerId === (room.red && room.red.id)) room.redConn = null;
    if (conn.playerId === (room.black && room.black.id)) room.blackConn = null;
    if (room.aiPlayerId && room.status === 'playing' && seatOf(room, conn.playerId) !== 0) {
      endGame(room, -seatOf(room, conn.playerId), 'resign');   // 离开即认输，AI 获胜
      return;
    }
    broadcast(room, { t: 'peer-offline' });
    if (room.status === 'playing') {
      room.disconnectAt = Date.now();
      // 宽限期后判负在 tick 里处理
    }
  }
  conn.playerId = null;
  conn.roomId = null;
}

/* ---------- WebSocket 升级 ---------- */
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );
  socket.setNoDelay(true);
  const conn = new WSConn(socket);
  conn.onmessage = raw => route(conn, raw);
  conn.onclose = () => cleanupConn(conn);
});

/* ---------- 定时器：棋钟 / 房间清理 ---------- */
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    applyClockTick(room, now);
    if (room.status === 'playing' && room.disconnectAt) {
      const away = room.redConn === null || room.blackConn === null;
      if (away && now - room.disconnectAt > DISCONNECT_GRACE) {
        const redGone = !room.redConn, blackGone = !room.blackConn;
        if (redGone && blackGone) endGame(room, 0, 'abandon');
        else if (redGone) endGame(room, -1, 'abandon');
        else if (blackGone) endGame(room, 1, 'abandon');
        room.disconnectAt = null;
      } else if (!away) room.disconnectAt = null;
    }
    if (now - room.createdAt > ROOM_TTL && (!room.redConn && !room.blackConn)) rooms.delete(room.id);
  }
  // 每 10 秒广播一次剩余时间
}, 1000).unref();

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status === 'playing') {
      broadcast(room, { t: 'clock', clocks: { red: room.clockRed - ((room.st.turn === 1) ? (Date.now() - room.turnStart) : 0), black: room.clockBlack - ((room.st.turn === -1) ? (Date.now() - room.turnStart) : 0) } });
    }
  }
}, 10000).unref();

/* ---------- 启动 ---------- */
function lanIPs() {
  const res = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const it of ifs[name]) {
      if (it.family === 'IPv4' && !it.internal) res.push(it.address);
    }
  }
  return res;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('════════════════════════════════════════');
  console.log('  象棋对战 · 局域网服务器已启动');
  console.log(`  本机：  http://localhost:${PORT}`);
  for (const ip of lanIPs()) console.log(`  局域网：http://${ip}:${PORT}  ← 同事在浏览器打开即可`);
  console.log('════════════════════════════════════════');
  startPikafish();   // 预热：随服务器启动加载 NNUE 权重（失败也不影响其他功能）
});

process.on('exit', () => { if (pf.eng) pf.eng.stop(); });

module.exports = { server, rooms, route, createRoom, startGame, handleMove };
