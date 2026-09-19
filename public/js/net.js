/* net.js — 联机客户端（WebSocket）
 * 协议见 server.js：create/join/quick/move/chat/resign/draw/undo/leave
 */
(function (root) {
  'use strict';

  class Net {
    constructor() {
      this.ws = null;
      this.connected = false;
      this.myId = null;
      this.myName = '玩家';
      this.room = null;
      this.handlers = {};
      this.reconnectTimer = null;
      this.wasConnected = false;   // 用于重连同一房间
    }

    on(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); }
    off(t, fn) { const h = this.handlers[t]; if (!h) return; const i = h.indexOf(fn); if (i >= 0) h.splice(i, 1); }
    emit(t, msg) { (this.handlers[t] || []).forEach(fn => fn(msg)); }

    connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = proto + '//' + location.host + '/ws';
      let ws;
      try { ws = new WebSocket(url); }
      catch (e) { this.emit('net-error', { error: '无法创建连接' }); return; }
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.emit('open', {});
      };
      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.emit('close', { hadRoom: !!this.room });
        // 非主动离开时尝试重连
        if (this.wasConnected && !this.left) {
          this.scheduleReconnect();
        }
      };
      ws.onerror = () => { this.emit('net-error', { error: '连接出错' }); };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg.you) {
          this.myId = msg.you;
          try { sessionStorage.setItem('xq-pid', msg.you); } catch (err2) {}   // 刷新后凭 id 重连
        }
        this.emit(msg.t, msg);
        this.emit('*', msg);
      };
    }

    scheduleReconnect() {
      if (this.reconnectTimer) return;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 2000);
    }

    /* 确保已发起连接；cb 在连接就绪时恰好执行一次（处理 open 已错过的竞态） */
    connectIfReady(cb) {
      if (this.connected) { if (cb) cb(); return true; }
      if (!this.ws || this.ws.readyState === 3) this.connect();
      if (this.ws && this.ws.readyState === 1) {
        // 连接已建立但 open 事件可能早已错过
        this.connected = true;
        if (cb) cb();
        return true;
      }
      // 等待 open（绑定在 connect 之前由调用方完成，或用轮询兜底）
      if (this.ws && this.ws.readyState === 0 && cb) {
        this.on('open', cb);
      }
      return false;
    }

    send(obj) {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    }

    /* ---------- 操作 ---------- */
    create(name) {
      this.myName = name || this.myName;
      this.left = false;
      this.send({ t: 'create', name: this.myName });
    }
    join(roomId, name) {
      this.myName = name || this.myName;
      this.left = false;
      const o = { t: 'join', room: roomId.toUpperCase(), name: this.myName };
      let pid = this.myId;
      if (!pid) { try { pid = sessionStorage.getItem('xq-pid'); } catch (e) {} }
      if (pid) o.playerId = pid;   // 刷新后凭 id 重连
      this.send(o);
    }
    quick(name) {
      this.myName = name || this.myName;
      this.left = false;
      this.send({ t: 'quick', name: this.myName });
    }
    move(from, to) { this.send({ t: 'move', from, to }); }
    chat(text) { this.send({ t: 'chat', text }); }
    resign() { this.send({ t: 'resign' }); }
    drawOffer() { this.send({ t: 'draw' }); }
    drawAccept(accept) { this.send({ t: 'draw', accept: !!accept }); }
    undoOffer() { this.send({ t: 'undo' }); }
    undoAccept(accept) { this.send({ t: 'undo', accept: !!accept }); }
    leave() { this.left = true; this.room = null; this.send({ t: 'leave' }); }
  }

  root.Net = Net;
})(window);
