/* endgames.js — 残局闯关关卡库（全部经引擎验证：开局合法且存在强制杀线）
 * 通关条件：红方将死/困毙黑方；被黑反杀或走进死局则失败可重试
 */
(function (root) {
  'use strict';
  const LEVELS = [
    {
      id: 1, name: '沉底车', diff: '入门',
      fen: '4k4/5P3/9/9/9/9/3R5/9/9/3K5 w',
      tip: '车沉底线将军，小兵封住将的退路。',
    },
    {
      id: 2, name: '马后炮', diff: '入门',
      fen: '4k4/3P1P3/9/5N3/9/4C4/9/9/9/4K4 w',
      tip: '双兵封两翼，马跳宫心做炮架，炮照将成杀。',
    },
    {
      id: 3, name: '铁门栓', diff: '初级',
      fen: '3ak4/4a4/9/3N5/9/9/3R5/9/9/4K4 w',
      tip: '车镇肋线，马跳宫门锁死黑将。',
    },
    {
      id: 4, name: '双车错', diff: '初级',
      fen: '3aka3/9/9/9/9/9/9/9/3R5/R2K5 w',
      tip: '两车错开线路轮流将军，士象全也挡不住。',
    },
    {
      id: 5, name: '重炮', diff: '初级',
      fen: '4k4/4a4/9/3C5/9/3C5/9/9/9/4K4 w',
      tip: '前炮以士为架，后炮同线补位，双炮轮番叫将。',
    },
    {
      id: 6, name: '闷宫', diff: '初级',
      fen: '3aka3/4p4/9/9/9/9/C8/9/9/4K4 w',
      tip: '黑方宫门被自己塞死，炮平中路一步成杀。',
    },
    {
      id: 7, name: '卧槽马', diff: '中级',
      fen: '4k4/3P1P3/9/3N5/9/9/9/9/9/3K5 w',
      tip: '双兵封两翼，马跳卧槽位置照将。',
    },
    {
      id: 8, name: '双车错·士', diff: '中级',
      fen: '3ak4/9/9/9/9/9/9/9/3R5/R2K5 w',
      tip: '车先沉底叫将，再调另一车封宫。',
    },
    {
      id: 9, name: '三兵刺将', diff: '中级',
      fen: '4k4/3P1P3/4P4/9/9/9/9/9/9/4K4 w',
      tip: '三兵推进，中路兵照将、双封两翼，帅镇中路防将吃兵。',
    },
    {
      id: 10, name: '双车错·全防', diff: '高级',
      fen: '3ak1b2/9/1b7/9/9/9/9/9/3R5/R2K5 w',
      tip: '黑士象全防守，双车辗转腾挪，五步之内完成绝杀。',
    },
  ];

  function get(i) { return LEVELS[i - 1] || null; }
  function all() { return LEVELS; }

  root.ENDGAMES = { LEVELS, get, all };
})(window);
