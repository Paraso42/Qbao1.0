'use strict';
const fs = require('fs');
const p = 'D:/Qbao/app/public/games/marble/game.js';
let raw = fs.readFileSync(p, 'utf8');
if (raw.startsWith('(function () {')) { console.log('already wrapped'); process.exit(0); }
raw = '(function () {' + (raw.includes('\r\n') ? '\r\n' : '\n') + raw.trimEnd() + (raw.includes('\r\n') ? '\r\n' : '\n') + '})();\n';
fs.writeFileSync(p, raw);
console.log('wrapped bytes=' + raw.length);
