/* board-ui.js — 棋盘渲染（Canvas）与交互
 * 拟物风格：木纹棋盘 + 立体感棋子 + 走位提示 + 平滑动 + 吃子闪动
 */
(function (root) {
  'use strict';
  const XQ = root.XQ;

  const CELL = 64;               // 格子像素（CSS）
  const MARGIN = 46;             // 边距
  const PIECE_R = 28;            // 棋子半径
  const COLS = '九八七六五四三二一'; // 从左到右（黑方视角时反向）

  class Board {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.flipped = false;      // 玩家执黑时翻转让黑在下
      this.state = XQ.stateFromFEN(XQ.START_FEN);
      this.squares = [];         // from/to 可落点
      this.onUserMove = null;    // (from,to)
      this.lastMove = null;
      this.selected = null;
      this.checkSquare = null;   // 被将军的将
      this.animQueue = [];
      this.piecePos = null;      // sq → {x,y} 当前显示位置（用于动画）
      this.locked = false;       // 锁定交互（动画中/非本方回合）
      this.hitMap = [];          // 点击命中棋子
      this.buildPositions();
      this.render();
      this.bindEvents();
    }

    buildPositions() {
      const pos = new Float64Array(90 * 2);
      for (let sq = 0; sq < 90; sq++) {
        const r = (sq / 9) | 0, c = sq % 9;
        const rr = this.flipped ? 9 - r : r;
        const cc = this.flipped ? 8 - c : c;
        pos[sq * 2] = MARGIN + cc * CELL;
        pos[sq * 2 + 1] = MARGIN + rr * CELL;   // row0=黑方在顶部；翻转时黑方镜像到底部
      }
      this.pos = pos;
    }

    xy(sq) { return { x: this.pos[sq * 2], y: this.pos[sq * 2 + 1] }; }

    setState(state, opts) {
      opts = opts || {};
      this.state = state;
      if (opts.flipped !== undefined) {
        this.flipped = opts.flipped;
        this.buildPositions();
      }
      this.lastMove = opts.lastMove || null;
      this.checkSquare = opts.checkSquare || null;
      this.selected = null;
      this.squares = [];
      if (opts.animate && opts.lastMove) {
        this.animateMove(opts.lastMove.from, opts.lastMove.to, opts.captured);
      } else {
        this.piecePos = null;
        this.render();
      }
    }

    /* 播放一步动画：from → to，被吃子淡出。
     * 定时器驱动（rAF 不可用/后台节流时仍能完成并落定） */
    animateMove(from, to, captured) {
      const p = this.state.board[to];
      const start = this.xy(from), end = this.xy(to);
      if (!this.piecePos) this.piecePos = new Map();
      for (let sq = 0; sq < 90; sq++) {
        const q = this.state.board[sq];
        if (q !== 0 && sq !== to) this.piecePos.set(sq, this.xy(sq));
      }
      this.piecePos.set(to, start);
      const t0 = Date.now(), DUR = 220;
      const capInfo = captured ? { sq: to, piece: captured, alpha: 1 } : null;
      this.anim = { from, to, t0, DUR, capInfo };
      const tick = () => {
        if (!this.anim) return;
        this.animFrame(Date.now());
        if (this.anim) setTimeout(tick, 30);
      };
      tick();
    }

    animFrame(now) {
      if (!this.anim) { this.render(); return; }
      const { t0, DUR, to } = this.anim;
      const t = Math.min(1, Math.max(0, (now - t0) / DUR));
      const ease = 1 - Math.pow(1 - t, 3);
      const a = this.xy(this.anim.from), b = this.xy(to);
      const x = a.x + (b.x - a.x) * ease, y = a.y + (b.y - a.y) * ease;
      this.piecePos.set(to, { x, y });
      if (this.anim.capInfo) this.anim.capInfo.alpha = 1 - t;
      this.render();
      if (t >= 1) {
        this.piecePos = null;
        this.anim = null;
        this.render();
      }
    }

    /* ---------- 绘制 ---------- */
    render() {
      const ctx = this.ctx;
      const W = MARGIN * 2 + CELL * 8, H = MARGIN * 2 + CELL * 9;
      if (this.canvas.width !== W * 2) { this.canvas.width = W * 2; this.canvas.height = H * 2; this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px'; }
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      this.drawBoard(ctx);
      this.drawHighlights(ctx);
      this.drawHint(ctx);
      this.drawPieces(ctx);
    }

    drawBoard(ctx) {
      // 木底
      const grad = ctx.createLinearGradient(0, 0, 0, 640);
      grad.addColorStop(0, '#f0d4a8');
      grad.addColorStop(1, '#d9b57c');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 608, 700);

      // 木纹
      ctx.save();
      ctx.globalAlpha = 0.06;
      for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        const y = (i * 31) % 700 + Math.sin(i * 3.7) * 8;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(150, y + 6, 400, y - 8, 608, y + 3);
        ctx.strokeStyle = i % 2 ? '#7a4f1d' : '#5e3a12';
        ctx.lineWidth = (i % 4) + 0.6;
        ctx.stroke();
      }
      ctx.restore();

      // 外框
      ctx.strokeStyle = '#5b3a16';
      ctx.lineWidth = 3;
      ctx.strokeRect(MARGIN - 14, MARGIN - 14, CELL * 8 + 28, CELL * 9 + 28);
      ctx.strokeStyle = '#7a5024';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(MARGIN - 10, MARGIN - 10, CELL * 8 + 20, CELL * 9 + 20);

      // 网格线
      ctx.strokeStyle = '#4a2e10';
      ctx.lineWidth = 1.2;
      for (let r = 0; r < 10; r++) {
        ctx.beginPath();
        ctx.moveTo(MARGIN, MARGIN + r * CELL);
        ctx.lineTo(MARGIN + 8 * CELL, MARGIN + r * CELL);
        ctx.stroke();
      }
      for (let c = 0; c < 9; c++) {
        ctx.beginPath();
        if (c === 0 || c === 8) {
          ctx.moveTo(MARGIN + c * CELL, MARGIN);
          ctx.lineTo(MARGIN + c * CELL, MARGIN + 9 * CELL);
        } else {
          ctx.moveTo(MARGIN + c * CELL, MARGIN);
          ctx.lineTo(MARGIN + c * CELL, MARGIN + 4 * CELL);
          ctx.moveTo(MARGIN + c * CELL, MARGIN + 5 * CELL);
          ctx.lineTo(MARGIN + c * CELL, MARGIN + 9 * CELL);
        }
        ctx.stroke();
      }

      // 楚河汉界
      ctx.save();
      ctx.fillStyle = '#6b4419';
      ctx.font = '600 34px "KaiTi", "STKaiti", "Noto Serif SC", serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.85;
      ctx.fillText('楚  河', MARGIN + 2 * CELL, MARGIN + 4.5 * CELL);
      ctx.fillText('汉  界', MARGIN + 6 * CELL, MARGIN + 4.5 * CELL);
      ctx.restore();

      // 兵/炮位的标记
      const marks = [[2, 1], [2, 7], [3, 0], [3, 2], [3, 4], [3, 6], [3, 8], [6, 0], [6, 2], [6, 4], [6, 6], [6, 8], [7, 1], [7, 7]];
      ctx.strokeStyle = '#4a2e10';
      ctx.lineWidth = 1;
      for (const [r, c] of marks) {
        const x = MARGIN + c * CELL, y = MARGIN + r * CELL;
        const d = 6, g = 4;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          if (c === 0 && sx < 0) continue;
          if (c === 8 && sx > 0) continue;
          ctx.beginPath();
          ctx.moveTo(x + sx * g, y + sy * (d + g));
          ctx.lineTo(x + sx * g, y + sy * g);
          ctx.lineTo(x + sx * (d + g), y + sy * g);
          ctx.stroke();
        }
      }

      // 九宫斜线
      for (const top of [0, 7]) {
        ctx.beginPath();
        ctx.moveTo(MARGIN + 3 * CELL, MARGIN + top * CELL);
        ctx.lineTo(MARGIN + 5 * CELL, MARGIN + (top + 2) * CELL);
        ctx.moveTo(MARGIN + 5 * CELL, MARGIN + top * CELL);
        ctx.lineTo(MARGIN + 3 * CELL, MARGIN + (top + 2) * CELL);
        ctx.stroke();
      }

      // 坐标文字
      ctx.save();
      ctx.fillStyle = '#8a6432';
      ctx.font = '13px "KaiTi", serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const labels = this.flipped ? '一二三四五六七八九' : COLS;
      for (let c = 0; c < 9; c++) ctx.fillText(labels[c], MARGIN + c * CELL, MARGIN - 26);
      for (let c = 0; c < 9; c++) ctx.fillText(this.flipped ? COLS[c] : '一二三四五六七八九'[c], MARGIN + c * CELL, MARGIN + 9 * CELL + 26);
      ctx.restore();
    }

    drawHighlights(ctx) {
      // 上一步标记
      if (this.lastMove) {
        for (const sq of [this.lastMove.from, this.lastMove.to]) {
          const { x, y } = this.xy(sq);
          ctx.save();
          ctx.strokeStyle = 'rgba(180,60,30,.65)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(x - CELL / 2 + 3, y - CELL / 2 + 3, CELL - 6, CELL - 6);
          ctx.restore();
        }
      }
      // 选中
      if (this.selected != null) {
        const { x, y } = this.xy(this.selected);
        ctx.save();
        ctx.strokeStyle = '#e8862a';
        ctx.lineWidth = 3;
        ctx.strokeRect(x - CELL / 2 + 2, y - CELL / 2 + 2, CELL - 4, CELL - 4);
        ctx.restore();
      }
      // 可走点（含 JJ象棋式安全提示）
      for (const t of this.squares) {
        const { x, y } = this.xy(t);
        const target = this.state.board[t] !== 0;
        // 落子安全性：走过去（吃掉目标子后）会不会被对方反吃
        let danger = false;
        {
          const from = this.selected, to = t;
          XQ.make(this.state, (from << 7) | to);
          const byRed = this.state.turn === XQ.RED;   // 走完轮对方，攻击我的是对方
          danger = XQ.attackedBy(this.state.board, to, byRed);
          // 将的攻击不算在 attackedBy 里（将只能在宫内相邻格吃）——手动补，带白脸豁免：
          if (!danger) {
            const ek = byRed ? this.state.kings[0] : this.state.kings[1];
            if (ek != null) {
              const kr = (ek / 9) | 0, kc = ek % 9;
              const tr = (to / 9) | 0, tc = to % 9;
              const rMin = byRed ? 7 : 0, rMax = rMin + 2;
              if (Math.abs(kr - tr) <= 1 && Math.abs(kc - tc) <= 1 && tr >= rMin && tr <= rMax && tc >= 3 && tc <= 5) {
                danger = true;
                // 白脸豁免：模拟将吃掉我子（将走到 to），若之后双王照面则将这步非法，我子安全
                XQ.make(this.state, (ek << 7) | to);
                if (XQ.kingsFacing(this.state.board, this.state.kings[0], this.state.kings[1])) danger = false;
                XQ.unmake(this.state);
              }
            }
          }
          XQ.unmake(this.state);
        }
        ctx.save();
        if (target) {
          // 可吃子：绿色发光圈（危险时红绿叠加为暗警示）
          ctx.shadowColor = danger ? 'rgba(220,50,40,.9)' : 'rgba(70,200,80,.9)';
          ctx.shadowBlur = 14;
          ctx.strokeStyle = danger ? 'rgba(220,50,40,.95)' : 'rgba(70,200,80,.95)';
          ctx.lineWidth = 3.5;
          ctx.beginPath(); ctx.arc(x, y, PIECE_R + 5, 0, Math.PI * 2); ctx.stroke();
          ctx.shadowBlur = 0;
        } else if (danger) {
          // 空格但走过去会被吃：红色警示框（打叉）
          ctx.strokeStyle = 'rgba(220,50,40,.75)';
          ctx.lineWidth = 3;
          ctx.strokeRect(x - 22, y - 22, 44, 44);
          ctx.beginPath();
          ctx.moveTo(x - 11, y - 11); ctx.lineTo(x + 11, y + 11);
          ctx.moveTo(x + 11, y - 11); ctx.lineTo(x - 11, y + 11);
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(60,110,60,.55)';
          ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,.5)';
          ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.restore();
      }
      // 被将军的将（脉冲呼吸，rAF 驱动；后台节流时静止一帧也不影响正确性）
      if (this.checkSquare != null) {
        const { x, y } = this.xy(this.checkSquare);
        ctx.save();
        const t = performance.now() / 300;
        const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
        ctx.strokeStyle = `rgba(230,30,30,${0.55 + 0.4 * pulse})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(x, y, PIECE_R + 5, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        if (!this._checkPulse) {
          this._checkPulse = setInterval(() => { if (!this.anim && this.checkSquare != null) this.render(); }, 500);
        }
      } else if (this._checkPulse) {
        clearInterval(this._checkPulse);
        this._checkPulse = null;
      }
    }

    drawPieces(ctx) {
      const b = this.state.board;
      for (let sq = 0; sq < 90; sq++) {
        const p = b[sq];
        if (p === 0) continue;
        const base = this.piecePos ? (this.piecePos.get(sq) || this.xy(sq)) : this.xy(sq);
        // 被吃棋子的淡出
        let alpha = 1;
        if (this.anim && this.anim.capInfo && this.anim.capInfo.sq === sq && this.state.board[sq] === 0) {
          alpha = this.anim.capInfo.alpha;
        } else if (this.anim && this.anim.capInfo && this.anim.capInfo.sq === sq) {
          // 目标格上已有新子，被吃子的残影画在新子下面
          this.drawPiece(ctx, this.anim.capInfo.piece, base.x, base.y, this.anim.capInfo.alpha);
        }
        if (this.anim && this.anim.to === sq && this.piecePos && this.piecePos.get(sq)) {
          // 动画中的棋子（含落子阴影）
          this.drawPiece(ctx, p, this.piecePos.get(sq).x, this.piecePos.get(sq).y, 1, true);
          continue;
        }
        this.drawPiece(ctx, p, base.x, base.y, alpha);
      }
    }

    drawPiece(ctx, p, x, y, alpha, lifting) {
      const red = p > 0;
      const ch = XQ.pieceChar(p);
      ctx.save();
      ctx.globalAlpha = alpha;

      // 阴影
      ctx.save();
      ctx.globalAlpha = alpha * (lifting ? 0.45 : 0.3);
      ctx.fillStyle = '#3a2410';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 5, PIECE_R, PIECE_R * 0.92, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 棋子底：多层圆营造厚度
      const r = PIECE_R;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, '#fdf3dd');
      g.addColorStop(0.75, '#f4e2bc');
      g.addColorStop(1, '#d8bd8a');
      ctx.fillStyle = g;
      ctx.fill();

      // 侧面厚度
      ctx.beginPath(); ctx.arc(x, y + 2, r, 0, Math.PI * 2);
      ctx.fillStyle = '#c8a76b';
      ctx.globalAlpha = alpha * 0.9;
      ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.globalAlpha = alpha;
      ctx.fill();

      // 外圈刻线
      ctx.beginPath(); ctx.arc(x, y, r - 3, 0, Math.PI * 2);
      ctx.strokeStyle = red ? '#b03024' : '#1c1c28';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r - 6.5, 0, Math.PI * 2);
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = red ? 'rgba(176,48,36,.55)' : 'rgba(28,28,40,.5)';
      ctx.stroke();

      // 文字
      ctx.fillStyle = red ? '#c0271d' : '#141420';
      ctx.font = `700 ${r * 0.86}px "KaiTi", "STKaiti", "Noto Serif SC", "SimKai", serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ch, x, y + 1);
      ctx.restore();
    }

    /* ---------- 交互 ---------- */
    bindEvents() {
      const getXY = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const scale = 1;  // CSS 尺寸 = 逻辑尺寸
        return { x: (e.clientX - rect.left) / (rect.width / 608), y: (e.clientY - rect.top) / (rect.height / 700) };
      };
      this.canvas.addEventListener('click', (e) => {
        if (this.locked) return;
        const { x, y } = getXY(e);
        this.handleClick(x, y);
      });
    }

    sqAt(x, y) {
      for (let sq = 0; sq < 90; sq++) {
        const p = this.xy(sq);
        if (Math.abs(p.x - x) <= CELL / 2 && Math.abs(p.y - y) <= CELL / 2) return sq;
      }
      return -1;
    }

    handleClick(x, y) {
      const sq = this.sqAt(x, y);
      if (sq < 0) return;
      const p = this.state.board[sq];
      const interactive = this.canInteract ? this.canInteract() : true;
      if (!interactive) return;
      const myRed = this.state.turn === XQ.RED;

      // 已选中 → 走子或换选
      if (this.selected != null) {
        if (this.squares.includes(sq)) {
          if (this.onUserMove) this.onUserMove(this.selected, sq);
          return;
        }
        if (p !== 0 && (p > 0) === (this.state.board[this.selected] > 0)) {
          this.select(sq);
          return;
        }
        this.selected = null; this.squares = []; this.render();
        return;
      }
      // 未选中 → 选己方子
      if (p !== 0 && (p > 0) === myRed) {
        this.select(sq);
      }
    }

    select(sq) {
      this.selected = sq;
      this.squares = XQ.legalMoves(this.state).filter(m => XQ.mFrom(m) === sq).map(m => XQ.mTo(m));
      this.render();
    }

    clearSelection() { this.selected = null; this.squares = []; this.render(); }

    /* 支招提示：在棋盘上绘制 from→to 的金色箭头。persist=true 时不自动消失（线下辅助用） */
    showHint(from, to, persist) {
      this.hint = { from, to };
      this.render();
      if (this._hintFade) { clearTimeout(this._hintFade); this._hintFade = null; }
      if (!persist) this._hintFade = setTimeout(() => { this.hint = null; this.render(); }, 6000);
    }
    clearHint() {
      if (this._hintFade) clearTimeout(this._hintFade);
      if (this._hintAnim) { clearInterval(this._hintAnim); this._hintAnim = null; }
      this.hint = null; this.render();
    }

    drawHint(ctx) {
      if (!this.hint) return;
      const a = this.xy(this.hint.from), b = this.xy(this.hint.to);
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) return;
      const ux = dx / len, uy = dy / len;
      // 起终点各收进半径，避免压住棋子圆心
      const r1 = PIECE_R + 2, r2 = PIECE_R + 14;
      const x1 = a.x + ux * r1, y1 = a.y + uy * r1;
      const x2 = b.x - ux * r2, y2 = b.y - uy * r2;
      const hx = b.x - ux * (PIECE_R + 2), hy = b.y - uy * (PIECE_R + 2);
      const px = -uy, py = ux;

      ctx.save();
      const now = performance.now();

      // 底层实线（淡）——保证任何帧都能看到箭头走向
      ctx.strokeStyle = 'rgba(230,170,30,.35)';
      ctx.fillStyle = 'rgba(230,170,30,.95)';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

      // 上层流动虚线——lineDashOffset 随时间偏移产生蚂蚁线流动效果
      ctx.strokeStyle = 'rgba(255,200,60,.98)';
      ctx.lineWidth = 8;
      ctx.setLineDash([16, 12]);
      ctx.lineDashOffset = -((now / 40) % 28);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);

      // 箭头头部（实心，稍带脉动）
      const pulse = 1 + 0.08 * Math.sin(now / 180);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(x2 - px * 6 * pulse, y2 - py * 6 * pulse);
      ctx.lineTo(x2 + px * 6 * pulse, y2 + py * 6 * pulse);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 驱动下一帧（提示存续期间持续动画；hint 清除后自动停）
      if (!this._hintAnim) {
        this._hintAnim = setInterval(() => {
          if (this.hint) this.render();
          else { clearInterval(this._hintAnim); this._hintAnim = null; }
        }, 50);
      }
    }
  }

  root.Board = Board;
})(window);
