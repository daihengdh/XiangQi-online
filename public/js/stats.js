/* stats.js — 战绩统计（localStorage 持久化，按昵称区分用户）
 * 记录维度：人机（按 AI 档位细分胜负）、联机、残局（按关卡计通过）
 */
(function (root) {
  'use strict';

  const KEY = 'xq-stats-v1';
  const NAME_KEY = 'xq-name';

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { users: {} };
  }

  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
  }

  function currentName() {
    try { return localStorage.getItem(NAME_KEY) || '默认玩家'; } catch (e) { return '默认玩家'; }
  }

  function user(db, name) {
    if (!db.users[name]) {
      db.users[name] = {
        pve: { total: 0, win: 0, lose: 0, byLevel: { 1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [0, 0], 5: [0, 0] } },   // byLevel: [胜, 负]
        pvp: { total: 0, win: 0, lose: 0, draw: 0 },
        endgame: { total: 0, win: 0, lose: 0, cleared: [], bestLevel: 0 },
        createdAt: Date.now(),
      };
    }
    return db.users[name];
  }

  /* 记录一局人机结果（win=true 胜） */
  function recordPve(name, level, win) {
    const db = load();
    const u = user(db, name || currentName());
    u.pve.total++;
    if (win) u.pve.win++; else u.pve.lose++;
    const lv = String(level);
    if (!u.pve.byLevel[lv]) u.pve.byLevel[lv] = [0, 0];
    u.pve.byLevel[lv][win ? 0 : 1]++;
    save(db);
  }

  /* 记录一局联机结果 */
  function recordPvp(name, result /* 'win' | 'lose' | 'draw' */) {
    const db = load();
    const u = user(db, name || currentName());
    u.pvp.total++;
    if (result === 'win') u.pvp.win++;
    else if (result === 'lose') u.pvp.lose++;
    else u.pvp.draw++;
    save(db);
  }

  /* 记录一次残局挑战 */
  function recordEndgame(name, levelId, win) {
    const db = load();
    const u = user(db, name || currentName());
    u.endgame.total++;
    if (win) {
      u.endgame.win++;
      if (!u.endgame.cleared.includes(levelId)) u.endgame.cleared.push(levelId);
      if (levelId > u.endgame.bestLevel) u.endgame.bestLevel = levelId;
    } else {
      u.endgame.lose++;
    }
    save(db);
  }

  function winRate(w, t) { return t > 0 ? Math.round(w / t * 100) : 0; }

  /* 当前用户战绩摘要（大厅展示用） */
  function summary(name) {
    const db = load();
    const u = db.users[name || currentName()];
    if (!u) return null;
    return {
      pve: { ...u.pve, rate: winRate(u.pve.win, u.pve.total) },
      pvp: { ...u.pvp, rate: winRate(u.pvp.win, u.pvp.win + u.pvp.lose) },
      endgame: { ...u.endgame, rate: winRate(u.endgame.win, u.endgame.total) },
    };
  }

  /* 残局解锁：第 1 关始终解锁，之后需通关前一关 */
  function unlockedLevel(name) {
    const db = load();
    const u = db.users[name || currentName()];
    if (!u) return 1;
    return u.endgame.bestLevel + 1;
  }

  function isCleared(name, levelId) {
    const db = load();
    const u = db.users[name || currentName()];
    return !!(u && u.endgame.cleared.includes(levelId));
  }

  /* 切换昵称（战绩跟随昵称） */
  function setName(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch (e) {}
  }

  root.Stats = {
    recordPve, recordPvp, recordEndgame,
    summary, unlockedLevel, isCleared, setName, currentName,
    _load: load,
  };
})(window);
