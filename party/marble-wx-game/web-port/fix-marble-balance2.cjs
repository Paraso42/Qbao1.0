'use strict';
const fs = require('fs');
const path = 'D:/Qbao/app/public/games/marble/game.js';
let raw = fs.readFileSync(path, 'utf8');
const startMark = 'ctx.fillText(`ctx.fillText(';
const s = raw.indexOf(startMark);
if (s < 0) { console.error('no broken anchor'); process.exit(1); }
const e = raw.indexOf('px, topY + 54);', s) + 'px, topY + 54);'.length;
if (e <= s) { console.error('no end'); process.exit(1); }
const newLine = "ctx.fillText('钻石 ' + state.diamonds + '    弹珠 ' + state.marbles + (cloudOn() ? '    积分 ' + CLOUD.meta.pointsBalance : '（游客模式）'), px, topY + 54);";
raw = raw.slice(0, s) + newLine + raw.slice(e);
fs.writeFileSync(path, raw);
console.log('FIXED bytes=' + raw.length);
