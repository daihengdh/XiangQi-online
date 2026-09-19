/* effects.js — JJ象棋式演出特效
 * 大字提示：将军！/ 绝杀！/ 吃子斩击
 * 绝杀演出按杀法分类：重炮！！/ 马后炮！！/ 双车错！！等，各有专属配色与动画
 */
(function (root) {
  'use strict';

  const layer = () => document.getElementById('fx-layer');
  const boardHost = () => document.getElementById('board-wrap');

  function clear() {
    const l = layer();
    if (l) l.innerHTML = '';
  }

  /* 大字横幅：将军 / 绝杀 / 悔棋 等 */
  function banner(text, opts) {
    opts = opts || {};
    const l = layer();
    if (!l) return;
    const div = document.createElement('div');
    div.className = 'fx-banner' + (opts.cls ? ' ' + opts.cls : '');
    div.textContent = text;
    l.appendChild(div);
    if (opts.sub) {
      const sub = document.createElement('div');
      sub.className = 'fx-banner-sub';
      sub.textContent = opts.sub;
      l.appendChild(sub);
      setTimeout(() => sub.remove(), opts.hold || 1600);
    }
    const hold = opts.hold || 1500;
    setTimeout(() => { div.classList.add('fx-out'); }, hold - 400);
    setTimeout(() => div.remove(), hold + 50);
  }

  /* 吃子斩击：目标格上的斩痕 + 火花 */
  function slash(squareXY) {
    const host = boardHost();
    if (!host || !squareXY) return;
    const d = document.createElement('div');
    d.className = 'fx-slash';
    d.style.left = (squareXY.x - 40) + 'px';
    d.style.top = (squareXY.y - 40) + 'px';
    host.appendChild(d);
    for (let i = 0; i < 5; i++) {
      const sp = document.createElement('div');
      sp.className = 'fx-spark' + (i % 2 ? ' fx-spark-b' : '');
      sp.style.left = (squareXY.x - 3 + (Math.random() * 30 - 15)) + 'px';
      sp.style.top = (squareXY.y - 3 + (Math.random() * 30 - 15)) + 'px';
      sp.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px');
      sp.style.setProperty('--dy', (Math.random() * 60 - 30) + 'px');
      host.appendChild(sp);
      setTimeout(() => sp.remove(), 650);
    }
    setTimeout(() => d.remove(), 650);
  }

  /* 落子涟漪 */
  function ripple(squareXY) {
    const host = boardHost();
    if (!host || !squareXY) return;
    const r = document.createElement('div');
    r.className = 'fx-ripple';
    r.style.left = squareXY.x + 'px';
    r.style.top = squareXY.y + 'px';
    host.appendChild(r);
    setTimeout(() => r.remove(), 700);
  }

  /* ---------- 杀法配置表：不同杀法 = 不同大字/配色/节奏 ---------- */
  const MATE_STYLES = {
    '重炮':   { cls: 'fx-style-cannon',   big: '重炮',   sym: '炮炮', color: '#ff5330', bg: 'rgba(255,70,20,.35)', quake: true },
    '马后炮': { cls: 'fx-style-horsec',   big: '马后炮', sym: '馬炮', color: '#ffb03a', bg: 'rgba(255,170,50,.3)', quake: true },
    '天地炮': { cls: 'fx-style-cannon',   big: '天地炮', sym: '炮',   color: '#ff8f1f', bg: 'rgba(255,140,30,.32)', quake: true },
    '沉底炮': { cls: 'fx-style-cannon',   big: '沉底炮', sym: '炮',   color: '#ff7b2d', bg: 'rgba(255,110,40,.3)', quake: false },
    '夹车炮': { cls: 'fx-style-rookc',    big: '夹车炮', sym: '車炮', color: '#ffd24d', bg: 'rgba(230,180,40,.3)', quake: true },
    '双车错': { cls: 'fx-style-doubleR',  big: '双车错', sym: '車車', color: '#ff4040', bg: 'rgba(255,40,40,.35)', quake: true },
    '铁门栓': { cls: 'fx-style-iron',     big: '铁门栓', sym: '門',   color: '#c8d4e8', bg: 'rgba(150,180,230,.3)', quake: true },
    '闷宫':   { cls: 'fx-style-cage',     big: '闷宫',   sym: '宮',   color: '#b06ef0', bg: 'rgba(150,80,230,.3)',  quake: false },
    '卧槽马': { cls: 'fx-style-horse',    big: '卧槽马', sym: '馬',   color: '#ff9d2e', bg: 'rgba(255,150,40,.3)',  quake: true },
    '挂角马': { cls: 'fx-style-horse',    big: '挂角马', sym: '馬',   color: '#ffcf5c', bg: 'rgba(255,200,80,.3)',  quake: true },
    '高吊马': { cls: 'fx-style-horse',    big: '高吊马', sym: '馬',   color: '#ffc466', bg: 'rgba(255,190,90,.3)',  quake: false },
    '小卒刺将': { cls: 'fx-style-pawn',   big: '小卒刺将', sym: '卒', color: '#63d05c', bg: 'rgba(70,200,60,.3)',  quake: true },
    '二鬼拍门': { cls: 'fx-style-pawn',   big: '二鬼拍门', sym: '卒卒', color: '#7ee877', bg: 'rgba(90,220,80,.32)', quake: true },
    '白脸将': { cls: 'fx-style-face',     big: '白脸将', sym: '對將', color: '#e8e8f0', bg: 'rgba(200,200,220,.3)', quake: false },
    '双将':   { cls: 'fx-style-double',   big: '双将',   sym: '將',   color: '#ff2e63', bg: 'rgba(255,30,90,.35)', quake: true },
    '海底捞月': { cls: 'fx-style-moon',   big: '海底捞月', sym: '月', color: '#5ad0e8', bg: 'rgba(70,190,230,.32)', quake: true },
    // 兜底类型（按攻击子命名）
    '车胜':   { cls: 'fx-style-doubleR',  big: '车胜',   sym: '車',   color: '#ff6a4a', bg: 'rgba(255,90,60,.32)', quake: true },
    '炮胜':   { cls: 'fx-style-cannon',   big: '炮胜',   sym: '炮',   color: '#ff8f3a', bg: 'rgba(255,130,50,.3)', quake: true },
    '马胜':   { cls: 'fx-style-horse',    big: '马胜',   sym: '馬',   color: '#ffb85c', bg: 'rgba(255,170,80,.3)', quake: true },
    '兵胜':   { cls: 'fx-style-pawn',     big: '兵胜',   sym: '兵',   color: '#75d86e', bg: 'rgba(80,210,70,.3)', quake: true },
    '绝杀':   { cls: 'fx-style-default',  big: '绝杀',   sym: '',    color: '#ffd34d', bg: 'rgba(255,160,40,.3)', quake: true },
  };

  /* 绝杀全屏演出：杀法专属大字 + 胜方字 + 印章 */
  function mate(winnerColor, mateType) {
    const l = layer();
    if (!l) return;
    const style = MATE_STYLES[mateType] || { cls: 'fx-style-default', big: mateType || '绝杀', sym: '', color: '#ffd34d', bg: 'rgba(255,160,40,.3)', quake: true, stroke: '#8a2b0f', shadow: 'rgba(255,80,20,.9)' };

    // 震屏
    if (style.quake) {
      const app = document.querySelector('.app');
      if (app) {
        app.classList.add('fx-quake');
        setTimeout(() => app.classList.remove('fx-quake'), 700);
      }
    }
    // 杀法专属色调光晕
    const glow = document.createElement('div');
    glow.className = 'fx-glow';
    if (style.bg) glow.style.background = 'radial-gradient(ellipse at center, ' + style.bg + ', transparent 75%)';
    l.appendChild(glow);
    setTimeout(() => glow.remove(), 1800);

    // 胜方左右对撞大字
    const left = document.createElement('div');
    left.className = 'fx-collision fx-left';
    left.textContent = winnerColor === 1 ? '红' : '黑';
    left.style.color = winnerColor === 1 ? '#e0452c' : '#1d1a26';
    const right = document.createElement('div');
    right.className = 'fx-collision fx-right';
    right.textContent = '胜';
    l.appendChild(left); l.appendChild(right);
    setTimeout(() => { left.remove(); right.remove(); }, 2000);

    // 杀法专属印章（大字！）
    const seal = document.createElement('div');
    seal.className = 'fx-seal ' + style.cls;
    seal.textContent = (style.big || '绝杀') + '！！';
    if (style.color) {
      seal.style.color = style.color;
      const stroke = style.stroke || 'rgba(40,20,8,.9)';
      const glow = style.shadow || style.color;
      seal.style.webkitTextStroke = '2px ' + stroke;
      seal.style.textShadow = '0 0 34px ' + glow + ', 0 6px 0 rgba(40,20,8,.85), 0 14px 40px rgba(0,0,0,.75)';
    }
    l.appendChild(seal);

    // 棋子符号残影（对称散开）
    if (style.sym) {
      for (let side = 0; side < 2; side++) {
        const sym = document.createElement('div');
        sym.className = 'fx-mate-sym' + (side ? ' fx-mate-sym-r' : '');
        sym.textContent = style.sym;
        if (style.color) { sym.style.color = style.color; sym.style.textShadow = '0 0 26px ' + style.color; }
        l.appendChild(sym);
        setTimeout(() => sym.remove(), 1900);
      }
    }

    setTimeout(() => { seal.classList.add('fx-out'); }, 1700);
    setTimeout(() => { seal.remove(); glow.remove(); }, 2300);
  }

  /* 胜负结算面板：红方胜/黑方胜/和棋 + 杀法副标题 + 操作按钮 */
  function result(winner, reason, mateType, buttons) {
    const texts = { 1: '红方胜', [-1]: '黑方胜', 0: '和棋' };
    const reasons = { checkmate: '绝杀', stalemate: '困毙', resign: '认输', timeout: '超时', agreement: '协议和棋', sixty: '六十回合无吃子', abandon: '对方离开' };
    const l = layer();
    if (!l) return;
    const box = document.createElement('div');
    box.className = 'fx-result' + (winner === 0 ? ' fx-result-draw' : '');
    const sub = mateType ? ('绝杀 · ' + mateType) : (reasons[reason] || reason);
    box.innerHTML =
      '<div class="fx-result-title">' + texts[winner] + '</div>' +
      '<div class="fx-result-reason">' + sub + '</div>' +
      '<div class="fx-result-btns"></div>';
    const btnBox = box.querySelector('.fx-result-btns');
    if (buttons && buttons.length) {
      buttons.forEach((b) => {
        const btn = document.createElement('button');
        btn.className = 'fx-result-btn' + (b.primary ? ' primary' : '');
        btn.textContent = b.text;
        btn.onclick = b.onClick;
        btnBox.appendChild(btn);
      });
    }
    l.appendChild(box);
    return box;
  }

  root.FX = {
    clear, banner, slash, ripple, mate, result, MATE_STYLES,
  };
})(window);
