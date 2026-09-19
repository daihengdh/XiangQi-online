/* audio.js — WebAudio 程序化音效（零素材文件）
 * 落子（棋子叩盘）、吃子（斩击）、将军（锣声）、绝杀（重鼓+锣）、胜利/失败、按钮、计时警告
 */
(function (root) {
  'use strict';

  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function on(v) { enabled = v; if (v) ac(); }

  function env(node, t0, a, d, peak) {
    const g = node.context.createGain();
    node.connect(g);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    g.connect(node.context.destination);
    return g;
  }

  function osc(type, freq, t0, dur, peak, freqEnd) {
    const c = ac(); if (!c || !enabled) return null;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    env(o, t0, 0.005, dur, peak);
    o.start(t0); o.stop(t0 + dur + 0.1);
    return o;
  }

  function noise(t0, dur, peak, filterFreq) {
    const c = ac(); if (!c || !enabled) return;
    const len = Math.max(1, (dur * c.sampleRate) | 0);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq || 3000;
    src.connect(f);
    const g = c.createGain();
    g.gain.setValueAtTime(peak, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    f.connect(g); g.connect(c.destination);
    src.start(t0); src.stop(t0 + dur);
  }

  const S = {
    /* 落子：短促的木叩 + 高频点击 */
    drop() {
      const c = ac(); if (!c || !enabled) return;
      const t = c.currentTime;
      osc('sine', 180, t, 0.09, 0.5, 90);
      noise(t, 0.05, 0.25, 6000);
    },
    /* 吃子：斩击 */
    capture() {
      const c = ac(); if (!c || !enabled) return;
      const t = c.currentTime;
      noise(t, 0.12, 0.4, 9000);
      osc('square', 300, t, 0.1, 0.18, 120);
      osc('sawtooth', 140, t + 0.02, 0.14, 0.2, 60);
    },
    /* 将军：锣声 */
    check() {
      const c = ac(); if (!c || !enabled) return;
      const t = c.currentTime;
      for (const [f, d, p] of [[660, 0.5, 0.22], [990, 0.4, 0.1], [1320, 0.3, 0.05]]) {
        const o = c.createOscillator();
        o.type = 'triangle'; o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(p, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + d + 0.1);
        // 颤音感
        const lfo = c.createOscillator();
        lfo.frequency.value = 8 + f / 100;
        const lg = c.createGain(); lg.gain.value = 6;
        lfo.connect(lg); lg.connect(o.frequency);
        lfo.start(t); lfo.stop(t + d);
      }
    },
    /* 绝杀：重鼓 + 长锣 */
    mate() {
      const c = ac(); if (!c || !enabled) return;
      const t = c.currentTime;
      osc('sine', 100, t, 0.5, 0.7, 40);          // 鼓
      noise(t, 0.3, 0.5, 700);                    // 鼓皮
      for (const [f, d, p] of [[523, 1.4, 0.2], [784, 1.1, 0.12], [1047, 0.9, 0.06], [1319, 0.7, 0.04]]) {
        const o = c.createOscillator();
        o.type = 'triangle'; o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(p, t + 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1 + d);
        o.connect(g); g.connect(c.destination);
        o.start(t + 0.1); o.stop(t + 1.7);
      }
    },
    /* 胜利小调 */
    win() {
      const c = ac(); if (!c || !enabled) return;
      const t = c.currentTime;
      const notes = [523, 659, 784, 1047];
      notes.forEach((f, i) => osc('triangle', f, t + i * 0.13, 0.3, 0.25));
    },
    /* 失败下行 */
    lose() {
      const c = ac(); if (!c || !enabled) return;
      const t = c.currentTime;
      const notes = [440, 370, 311, 262];
      notes.forEach((f, i) => osc('sine', f, t + i * 0.16, 0.35, 0.22));
    },
    /* 按钮 */
    click() {
      const c = ac(); if (!c || !enabled) return;
      osc('sine', 800, c.currentTime, 0.05, 0.12, 500);
    },
    /* 30 秒警告 */
    warn() {
      const c = ac(); if (!c || !enabled) return;
      osc('square', 880, c.currentTime, 0.08, 0.08);
      osc('square', 880, c.currentTime + 0.15, 0.08, 0.08);
    },
    /* 求和/悔棋请求提示音 */
    ask() {
      const c = ac(); if (!c || !enabled) return;
      osc('triangle', 660, c.currentTime, 0.1, 0.15);
      osc('triangle', 880, c.currentTime + 0.12, 0.14, 0.15);
    },
  };

  root.SFX = { S, on };
})(window);
