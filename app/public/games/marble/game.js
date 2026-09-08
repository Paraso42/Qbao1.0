(function () {
const Matter = (typeof window !== 'undefined' && window.Matter) || (typeof globalThis !== 'undefined' && globalThis.Matter);
const CLOUD = (typeof window !== 'undefined' && window.__qbMarbleCloud) || null;
function cloudOn() { return !!CLOUD && CLOUD.ready && CLOUD.mode === 'cloud'; }
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');
const info = wx.getSystemInfoSync();
const dpr = Math.min(info.pixelRatio || 1, 2);
const width = info.windowWidth;
const height = info.windowHeight;
canvas.width = width * dpr;
canvas.height = height * dpr;
ctx.scale(dpr, dpr);
const frame = typeof wx.requestAnimationFrame === 'function' ? (fn) => wx.requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16);
const { Engine, World, Bodies, Body } = Matter;
const engine = Engine.create({ enableSleeping: false });
engine.gravity.y = 1.0;
engine.positionIterations = 3;
engine.velocityIterations = 3;
engine.constraintIterations = 1;
const boardWidth = Math.min(width * 0.72, 480);
const left = Math.max(16, (width - boardWidth) / 2 - width * 0.018);
const right = left + boardWidth;
const top = Math.max(104, height * 0.17);
const bottom = Math.min(height - Math.max(205, height * 0.28), top + Math.max(330, height * 0.57));
const rows = 11;
const cols = 10;
// 钉子群单独缩小并下移，给右侧合并赛道留出完整的转弯空间。
const pegWidth = boardWidth;
const pegLeft = (width - pegWidth) / 2;
const pegGapX = pegWidth / (cols - 1);
const pegTop = Math.min(bottom - 220, top + 66);
const pegBottom = bottom - 24;
const pegGapY = (pegBottom - pegTop) / (rows - 1);
const slotCount = 10;
const slotWidth = boardWidth / slotCount;
const trackX = width - Math.max(28, width * 0.085);
const trackRadius = Math.min(24, Math.max(17, width * 0.06));
// 赛道从右侧上行，在第一排钉子上方平滑转向后进入板面。
const trackExitY = top + 18;
const trackExitX = right - 14;
// —— 蓄力-弹道能量模型 ——
// 轨道段以 RAIL_T 为显示时间系数: 位移 = 物理速度×RAIL_T, 减速 = RAIL_G×RAIL_T。
// 为让"轨道重力手感"与板内一致, 需 RAIL_G×RAIL_T² = 0.28×gravity.y(=0.238), 故 RAIL_G=0.95。
// 出弯初速同样按 RAIL_T 缩放 → 轨道末端速度与进板速度连续(仅剩弯道摩擦 8% 损耗)。
// RAIL_F 决定过弯临界力度 ≈50: 低于临界冲不上弯道、自然回落(不扣弹珠, 可重新蓄力);
// 满力 100 → 净空带横穿, 撞到对侧边界反弹。
const RAIL_G = 0.95;
const RAIL_F = 1.1;
const RAIL_K = 0.92;
const RAIL_T = 0.5;
const RAIL_UP_T = RAIL_T;
const RAIL_DOWN_T = RAIL_T;
const RAIL_RETURN_G = 4; // 回落段重力倍数(快速滑回发射口, 减少低力度试射的等待)
const EXIT_VY = -0.8; // 出弯口上抛(负=向上, 显示速度), 让弹道更平、贴钉阵上方净空带飞到对侧
const AIR_DAMP = 0.0018; // 弹珠空气阻力(轻微, 保留滚动余量)
// 由蓄力力度计算发射参数(初始上升速度 v0 / 发射点 startY)
function launchEnergy(power) {
  const startY = bottom - 10 - power * 0.22;
  const hTop100 = Math.max(0, bottom - 32 - trackExitY);
  const vRem100 = Math.sqrt(RAIL_F * 2 * RAIL_G * hTop100);
  const a2 = (vRem100 * vRem100 + 2 * RAIL_G * hTop100) / 100;
  return { v0: Math.sqrt(a2 * power), startY };
}
function trackGeometry(startY) {
  const centerX = trackX - trackRadius;
  const centerY = trackExitY + trackRadius;
  const verticalLength = Math.max(36, startY - centerY);
  const arcLength = Math.PI * trackRadius * 0.5;
  const horizontalLength = Math.max(12, centerX - trackExitX);
  return { centerX, centerY, verticalLength, arcLength, horizontalLength, total: verticalLength + arcLength + horizontalLength };
}
function trackPoint(t, startY) {
  const g = trackGeometry(startY);
  let distance = Math.max(0, Math.min(1, t)) * g.total;
  if (distance <= g.verticalLength) return { x: trackX, y: startY - distance };
  distance -= g.verticalLength;
  if (distance <= g.arcLength) {
    const angle = -distance / trackRadius;
    return { x: g.centerX + trackRadius * Math.cos(angle), y: g.centerY + trackRadius * Math.sin(angle) };
  }
  distance -= g.arcLength;
  return { x: g.centerX - Math.min(g.horizontalLength, distance), y: trackExitY };
}
function drawTrackPath(startY) {
  ctx.moveTo(trackX, startY);
  for (let i = 1; i <= 56; i += 1) { const p = trackPoint(i / 56, startY); ctx.lineTo(p.x, p.y); }
}
const pegs = [];
for (let row = 0; row < rows; row += 1) {
  for (let col = 0; col < cols; col += 1) {
    const x = row % 2 ? pegLeft + pegGapX * 0.5 + col * pegGapX : pegLeft + col * pegGapX;
    if (x <= pegLeft + pegWidth) pegs.push({ x, y: pegTop + row * pegGapY, row, boost: row === 2 || row === rows - 3, damp: row === 0 || row === 1 });
  }
}
// 注意: Matter 的 Body.setStatic 会把 isStatic 刚体的 restitution 清零(friction 设为 1),
// 所以钉子弹性必须在创建后回写, 否则三种钉物理上完全一样。
// 另: 碰撞弹性取两者较大值(pair.restitution = max), 故小球自身弹性必须 ≤ 最低档(蓝钉), 差异才不会被盖掉。
const pegBodies = pegs.map((p) => { const b = Bodies.circle(p.x, p.y, 4.5, { isStatic: true, friction: p.damp ? 0.05 : 0.02, frictionStatic: 0 }); b.restitution = p.boost ? 1.08 : (p.damp ? 0.1 : 0.55); return b; });
const walls = [Bodies.rectangle(left - 8, (top + bottom) / 2, 16, bottom - top + 60, { isStatic: true, frictionStatic: 0 }), Bodies.rectangle(right + 8, (top + bottom) / 2, 16, bottom - top + 60, { isStatic: true, frictionStatic: 0 }), Bodies.rectangle((left + right) / 2, bottom + 54, boardWidth + 32, 16, { isStatic: true, frictionStatic: 0 })]; walls[0].restitution = 0.5; walls[1].restitution = 0.5; walls[2].restitution = 0.25;
const dividerH = 30, dividers = [];
for (let i = 1; i < slotCount; i += 1) dividers.push(Bodies.rectangle(left + i * slotWidth, bottom + 31, 4, dividerH, { isStatic: true, frictionStatic: 0, restitution: 0.3 }));
World.add(engine.world, pegBodies.concat(walls, dividers));
const skins = [{ name: '经典银', color: '#f4f6f8', cost: 0 }, { name: '深海蓝', color: '#49a8ff', cost: 1500 }, { name: '赤焰红', color: '#ff5064', cost: 1500 }, { name: '鎏金', color: '#ffd34d', cost: 3000 }, { name: '极光', color: '#52e9c0', cost: 3000 }, { name: '紫电', color: '#b26cff', cost: 3000 }, { name: '黑洞', color: '#2b2150', cost: 5000 }];
const backgrounds = [
  { name: '糖果霓虹', color: '#ffb632', board: '#ffd7e7', line: '#d95c8f', edge: '#ffe55a', cost: 0 },
  { name: '海盐霓虹', color: '#54bad0', board: '#ccecf0', line: '#277b9b', edge: '#f8f17a', cost: 0 },
  { name: '熔火乐园', color: '#e8753e', board: '#ffd0ad', line: '#b94e41', edge: '#ffe56a', cost: 0 }
];
const trails = [{ name: '无拖尾', cost: 0 }, { name: '流光拖尾', cost: 100 }, { name: '星尘拖尾', cost: 300 }, { name: '炫彩拖尾', cost: 600 }];
const halos = [{ name: '无光环', cost: 0 }, { name: '微光环', cost: 50 }, { name: '星光环', cost: 150 }, { name: '炫彩光环', cost: 300 }];
const today = new Date().toISOString().slice(0, 10);
let saved = wx.getStorageSync('galtonGame') || {};
const ownedDefault = { skins: [0, saved.skin || 0].filter((v, i, a) => a.indexOf(v) === i), bgs: [0, saved.bg || 0].filter((v, i, a) => a.indexOf(v) === i), trails: [0, saved.trail || 0].filter((v, i, a) => a.indexOf(v) === i), halos: [0, saved.halo || 0].filter((v, i, a) => a.indexOf(v) === i) };
const owned = saved.owned ? { ...ownedDefault, ...saved.owned } : ownedDefault;
if (!Array.isArray(owned.halos) || owned.halos.length === 0) owned.halos = [0];
const state = { marbles: Number.isFinite(saved.marbles) ? saved.marbles : 1000, diamonds: Number.isFinite(saved.diamonds) ? saved.diamonds : 0, wager: 0, freeClaims: saved.freeDate === today ? (saved.freeClaims || 0) : 0, power: 0, powerDir: 1, powerShow: 0, powerKeep: 0, charging: false, phase: 'confirm', randomizing: false, running: false, ball: null, multiplier: 0, multiplierReady: false, lit: new Set(), shop: false, modal: false, skin: saved.skin || 0, bg: saved.bg || 0, trail: saved.trail || 0, halo: saved.halo || 0, owned };
function save() { wx.setStorageSync('galtonGame', { marbles: state.marbles, diamonds: state.diamonds, freeClaims: state.freeClaims, freeDate: today, skin: state.skin, bg: state.bg, trail: state.trail, halo: state.halo, owned: state.owned }); }
function cloudApplySeed(seed) {
  if (!seed) return;
  saved = seed;
  state.marbles = Number.isFinite(seed.marbles) ? seed.marbles : state.marbles;
  state.diamonds = Number.isFinite(seed.diamonds) ? seed.diamonds : state.diamonds;
  if (seed.skin != null) state.skin = seed.skin;
  if (seed.bg != null) state.bg = seed.bg;
  if (seed.trail != null) state.trail = seed.trail;
  if (seed.halo != null) state.halo = seed.halo;
  if (seed.owned && seed.owned.skins) state.owned = seed.owned;
  save();
}
const uiWager = { mX: 0, pX: 0, y: 0, s: 0, addX: 0, addY: 0, addR: 0, startX: 0, startY: 0, startR: 0 }; let wagerTimer = null; let wagerRepeat = null; const shopBtn = { x: 0, y: 0, w: 54, h: 30 }; const shopItems = [];
function hexToRgba(hex, a) { const h = hex.replace('#', ''); const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);   return `rgba(${r},${g},${b},${a})`; }
function drawRedDigits(value, x, y, size) { const text = String(Math.max(0, Math.floor(value))); const segs = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg' }; const w = size * 0.58, h = size, thick = Math.max(1, size * 0.13), gap = Math.max(2, size * 0.2); for (let i = 0; i < text.length; i += 1) { const ch = segs[text[i]] || ''; const ox = x - (text.length - i) * (w + gap) + gap; const oy = y; ctx.fillStyle = 'rgba(104,18,16,.35)'; ctx.fillRect(ox + thick, oy, w - thick * 2, thick); ctx.fillRect(ox + w - thick, oy + thick, thick, h * 0.42 - thick); ctx.fillRect(ox + w - thick, oy + h * 0.58, thick, h * 0.42 - thick); ctx.fillRect(ox + thick, oy + h - thick, w - thick * 2, thick); ctx.fillRect(ox, oy + h * 0.58, thick, h * 0.42 - thick); ctx.fillRect(ox, oy + thick, thick, h * 0.42 - thick); ctx.fillRect(ox + thick, oy + h * 0.5 - thick * 0.5, w - thick * 2, thick); ctx.fillStyle = '#e33b32'; for (let j = 0; j < 7; j += 1) { const key = 'abcdefg'[j]; if (ch.indexOf(key) < 0) continue; if (key === 'a' || key === 'd' || key === 'g') ctx.fillRect(ox + thick, oy + (key === 'a' ? 0 : (key === 'g' ? h * 0.5 - thick * 0.5 : h - thick)), w - thick * 2, thick); else ctx.fillRect(ox + (key === 'b' || key === 'c' ? w - thick : 0), oy + (key === 'b' || key === 'f' ? thick : h * 0.5 + thick * 0.5), thick, h * 0.42 - thick); } } return text.length * (w + gap) - gap; }
function drawSettleFx(b) {
  const sx = left + b.slot * slotWidth + slotWidth / 2;
  const cy = bottom + 42;
  const t = b.settleFrames;
  const p = Math.min(t / 45, 1);
  if (state.skin === 3) { ctx.save(); ctx.translate(sx, cy); const goldSize = Math.max(3.5, Math.min(6, slotWidth * 0.18)); for (let q = 0; q < 3; q += 1) { const fall = Math.max(0, Math.min(1, (t - q * 4) / 34)); const x = q === 0 ? 0 : (q === 1 ? -goldSize * 2.1 : goldSize * 2.1); const y = -slotWidth * 0.25 + fall * slotWidth * 0.3; const alpha = fall > 0.9 ? Math.max(0, 1 - (fall - 0.9) * 8) : 1; ctx.save(); ctx.translate(x, y); ctx.rotate((q - 1) * 0.18 + fall * (q === 1 ? -0.22 : 0.22)); ctx.globalAlpha = alpha; ctx.fillStyle = '#ffd044'; ctx.fillRect(-goldSize, -goldSize * 0.72, goldSize * 2, goldSize * 1.44); ctx.fillStyle = '#fff2a1'; ctx.fillRect(-goldSize + 0.8, -goldSize * 0.72 + 0.8, goldSize * 0.72, 1); ctx.restore(); } ctx.globalAlpha = Math.max(0, 1 - p); ctx.fillStyle = 'rgba(255,210,55,.3)'; ctx.beginPath(); ctx.arc(0, slotWidth * 0.02, 7 + p * 10, 0, Math.PI * 2); ctx.fill(); ctx.restore(); } else if (state.skin === 4) { ctx.save(); for (let q = 0; q < 10; q += 1) { const seed = q * 1.91; const phase = (t * (0.0068 + (q % 3) * 0.001) + q * 0.11) % 1.05; const mx = sx - slotWidth * 0.28 + Math.sin(seed) * slotWidth * 0.12 + phase * slotWidth * 0.5; const my = cy - slotWidth * 0.3 - phase * slotWidth * 0.42 + Math.cos(seed) * 3; const len = 7 + (q % 4) * 2; const alpha = Math.max(0, Math.min(1, 1 - Math.max(0, phase - 0.92) * 2.8)); ctx.globalAlpha = alpha * 0.85; ctx.strokeStyle = q % 2 ? '#63f5b4' : '#b8ffd6'; ctx.lineWidth = 2 + (q % 3) * 0.7; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - len * 0.72, my + len); ctx.stroke(); ctx.globalAlpha = Math.max(0.35, alpha); ctx.fillStyle = '#eafff2'; ctx.beginPath(); ctx.arc(mx, my, 2.2 + (q % 2), 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = Math.max(0, 1 - p) * 0.8; ctx.strokeStyle = '#43e89a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, cy, 10 + p * 26, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } else if (state.skin === 5) {
    const bolts = 7;
    const blink = (t % 6) < 3 ? 1 : 0.4;
    ctx.globalAlpha = blink;
    ctx.strokeStyle = '#c9a3ff'; ctx.lineWidth = 2;
    for (let q = 0; q < bolts; q += 1) {
      const ang = (q / bolts) * Math.PI * 2 + t * 0.05;
      const len = 14 + (t % 12);
      let px = sx, py = cy;
      ctx.beginPath(); ctx.moveTo(px, py);
      const segs = 3;
      for (let s = 1; s <= segs; s += 1) {
        const r = len * (s / segs);
        const jit = Math.sin(q * 3 + s + t) * 4;
        px = sx + Math.cos(ang) * r + Math.cos(ang + 1.57) * jit;
        py = cy + Math.sin(ang) * r + Math.sin(ang + 1.57) * jit;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.8 * blink;
    ctx.fillStyle = '#e6d4ff';
    ctx.beginPath(); ctx.arc(sx, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (state.skin === 6) {
    const disc = 16 + p * 10;
    ctx.save();
    ctx.translate(sx, cy);
    ctx.rotate(t * 0.15);
    ctx.strokeStyle = 'rgba(150,90,255,.7)'; ctx.lineWidth = 3;
    for (let a = 0; a < 3; a += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, disc - a * 4, a * 2, a * 2 + Math.PI * 1.3);
      ctx.stroke();
    }
    ctx.restore();
    const cr = 6 + p * 8;
    const g = ctx.createRadialGradient(sx, cy, 1, sx, cy, cr);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.7, '#0a0418');
    g.addColorStop(1, 'rgba(40,10,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, cy, cr, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
}
function roundedRectPath(x, y, w, h, r) {
  const q = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath(); ctx.moveTo(x + q, y); ctx.arcTo(x + w, y, x + w, y + h, q); ctx.arcTo(x + w, y + h, x, y + h, q); ctx.arcTo(x, y + h, x, y, q); ctx.arcTo(x, y, x + w, y, q); ctx.closePath();
}
function drawCabinetBg() {
  const theme = backgrounds[state.bg] || backgrounds[0];
  const outer = { x: 6, y: 5, w: width - 12, h: height - 10 };
  const header = { x: 20, y: 13, w: width - 40, h: Math.max(62, Math.min(76, height * .105)) };
  const field = { x: 14, y: header.y + header.h + 8, w: width - 28, h: Math.max(170, bottom - header.y - header.h + 92) };
  const warm = state.bg === 1 ? '#42aec0' : (state.bg === 2 ? '#df6a3d' : '#f39c20');
  const dark = state.bg === 1 ? '#17657a' : (state.bg === 2 ? '#9f3e32' : '#c95228');
  ctx.save(); ctx.lineJoin = 'round';
  const base = ctx.createLinearGradient(0, 0, width, height); base.addColorStop(0, warm); base.addColorStop(.42, '#ffe35a'); base.addColorStop(.78, '#ffb52c'); base.addColorStop(1, dark); ctx.fillStyle = base; ctx.fillRect(0, 0, width, height);
  roundedRectPath(outer.x, outer.y, outer.w, outer.h, 28); ctx.shadowColor = 'rgba(91,35,13,.5)'; ctx.shadowBlur = 20; ctx.fillStyle = '#ffbf31'; ctx.fill(); ctx.shadowBlur = 0;
  roundedRectPath(outer.x + 4, outer.y + 4, outer.w - 8, outer.h - 8, 24); const frame = ctx.createLinearGradient(0, outer.y, 0, outer.y + outer.h); frame.addColorStop(0, '#fff47c'); frame.addColorStop(.22, '#ffd337'); frame.addColorStop(.55, '#f59c20'); frame.addColorStop(.84, '#ffc83a'); frame.addColorStop(1, '#fff079'); ctx.fillStyle = frame; ctx.fill();
  roundedRectPath(outer.x + 7, outer.y + 7, outer.w - 14, outer.h - 14, 21); ctx.strokeStyle = 'rgba(255,255,217,.9)'; ctx.lineWidth = 2; ctx.stroke(); roundedRectPath(outer.x + 12, outer.y + 12, outer.w - 24, outer.h - 24, 18); ctx.strokeStyle = 'rgba(180,79,23,.58)'; ctx.lineWidth = 3; ctx.stroke();
  roundedRectPath(field.x, field.y, field.w, field.h, 23); const board = ctx.createLinearGradient(0, field.y, 0, field.y + field.h); board.addColorStop(0, theme.board || '#ffd7e7'); board.addColorStop(.5, state.bg === 1 ? '#d8f1f1' : '#ffe1eb'); board.addColorStop(1, state.bg === 2 ? '#ffd4b9' : '#fff0e5'); ctx.fillStyle = board; ctx.fill();
  ctx.save(); roundedRectPath(field.x + 4, field.y + 4, field.w - 8, field.h - 8, 19); ctx.clip(); const glow = ctx.createRadialGradient(width * .4, field.y + field.h * .46, 8, width * .4, field.y + field.h * .46, width * .75); glow.addColorStop(0, 'rgba(255,255,255,.52)'); glow.addColorStop(.48, state.bg === 1 ? 'rgba(107,214,225,.14)' : 'rgba(255,132,190,.17)'); glow.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = glow; ctx.fillRect(field.x, field.y, field.w, field.h);
  [[.1,.24,26,'rgba(255,255,255,.18)'],[.78,.2,30,'rgba(255,139,186,.15)'],[.2,.73,23,'rgba(255,181,74,.15)'],[.65,.78,30,'rgba(131,202,255,.13)'],[.9,.58,22,'rgba(255,198,89,.15)']].forEach((s) => { const x = field.x + field.w * s[0], y = field.y + field.h * s[1], g = ctx.createRadialGradient(x, y, 1, x, y, s[2]); g.addColorStop(0, s[3]); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s[2], 0, Math.PI * 2); ctx.fill(); }); ctx.restore();
  roundedRectPath(field.x, field.y, field.w, field.h, 23); ctx.strokeStyle = 'rgba(189,75,73,.76)'; ctx.lineWidth = 4; ctx.stroke(); roundedRectPath(field.x + 7, field.y + 7, field.w - 14, field.h - 14, 18); ctx.strokeStyle = 'rgba(255,247,206,.82)'; ctx.lineWidth = 2; ctx.stroke();
  roundedRectPath(header.x, header.y, header.w, header.h, 24); const marquee = ctx.createLinearGradient(0, header.y, 0, header.y + header.h); marquee.addColorStop(0, '#4b205c'); marquee.addColorStop(.55, '#28153f'); marquee.addColorStop(1, '#150d29'); ctx.fillStyle = marquee; ctx.fill(); ctx.shadowColor = 'rgba(255,63,193,.8)'; ctx.shadowBlur = 12; ctx.strokeStyle = 'rgba(255,167,222,.82)'; ctx.lineWidth = 2; ctx.stroke(); ctx.shadowBlur = 0;
  const cardW = Math.min(108, width * .28); roundedRectPath(header.x + 8, header.y + 8, cardW, header.h - 16, 17); ctx.fillStyle = 'rgba(42,22,55,.55)'; ctx.strokeStyle = 'rgba(255,204,237,.48)'; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke(); ctx.textAlign = 'left'; ctx.fillStyle = '#fff5fb'; ctx.font = 'bold ' + Math.max(12, Math.min(16, width * .043)) + 'px sans-serif'; ctx.fillText('弹珠', header.x + 17, header.y + 24); ctx.font = 'bold ' + Math.max(16, Math.min(21, width * .055)) + 'px sans-serif'; ctx.fillStyle = '#fffdf8'; ctx.font = 'bold ' + Math.max(13, Math.min(17, width * .044)) + 'px sans-serif'; ctx.fillText(String(state.marbles), header.x + 17, header.y + 42); ctx.font = 'bold ' + Math.max(12, Math.min(16, width * .043)) + 'px sans-serif'; ctx.fillStyle = '#5de8ff'; ctx.fillText('钻石', header.x + 17, header.y + 60); ctx.fillStyle = '#fffdf8'; ctx.fillText(String(state.diamonds), header.x + 53, header.y + 60); ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(255,49,207,.95)'; ctx.shadowBlur = 18; ctx.fillStyle = '#211525'; ctx.font = 'bold ' + Math.max(26, Math.min(39, width * .105)) + 'px sans-serif'; ctx.fillText('\u5f39\u732a\u4e50', width / 2, header.y + header.h * .67); ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,132,228,.92)'; ctx.lineWidth = 1; ctx.strokeText('\u5f39\u732a\u4e50', width / 2, header.y + header.h * .67);
  
  const lampY = header.y + header.h - 8, count = 20, tick = Date.now() / 260; for (let i = 0; i < count; i += 1) { const x = header.x + 128 + i * ((header.w - 164) / Math.max(1, count - 1)), a = .3 + .7 * (.5 + .5 * Math.sin(tick + i * .56)); ctx.fillStyle = i % 3 === 0 ? 'rgba(255,41,152,' + a + ')' : (i % 3 === 1 ? 'rgba(55,203,238,' + a + ')' : 'rgba(174,123,255,' + a + ')'); ctx.beginPath(); ctx.arc(x, lampY, 2.7, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
function draw() {
  ctx.fillStyle = backgrounds[state.bg].color; ctx.fillRect(0, 0, width, height); drawCabinetBg();

  pegs.forEach((p) => {
    const blue = p.damp;
    const green = p.boost;
    const ring = blue ? '#2c62bd' : (green ? '#2e8b4b' : '#9da0aa');
    const core = blue ? '#a8cfff' : (green ? '#8ee6a0' : '#777b86');
    const halo = blue ? 'rgba(42,100,196,.22)' : (green ? 'rgba(40,147,75,.2)' : 'rgba(118,116,130,.13)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(p.x, p.y, 10.5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 8.2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(p.x, p.y, 5.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.beginPath(); ctx.arc(p.x - 1.4, p.y - 1.7, 2.1, 0, Math.PI * 2); ctx.fill();
  });
  const slotTop = bottom + 22, slotBot = bottom + 52;
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(left - 4, slotTop - 9, boardWidth + 8, 2);
  for (let i = 0; i < slotCount; i += 1) {
    const x = left + i * slotWidth, lit = state.lit.has(i);
    const slotGlow = ctx.createLinearGradient(0, slotTop - 5, 0, slotTop + 8);
    slotGlow.addColorStop(0, lit ? '#fff18a' : '#a0a5ad'); slotGlow.addColorStop(1, lit ? '#e2a82b' : '#656b75');
    ctx.fillStyle = slotGlow; ctx.fillRect(x + 2, slotTop - 4, slotWidth - 4, 7);
  }
  ctx.fillStyle = '#1d2029'; ctx.fillRect(left - 4, slotBot - 2, boardWidth + 8, 14);
  ctx.fillStyle = '#4c515c'; ctx.fillRect(left - 4, slotBot - 2, boardWidth + 8, 3);
  ctx.strokeStyle = '#747985'; ctx.lineWidth = 1.5;
  for (let i = 0; i <= slotCount; i += 1) { const x = left + i * slotWidth; ctx.beginPath(); ctx.moveTo(x, slotTop - 11); ctx.lineTo(x, slotBot + 1); ctx.stroke(); }
  ctx.fillStyle = '#252a33'; ctx.strokeStyle = '#a7aab1'; ctx.lineWidth = 1;
  for (let i = 1; i < slotCount; i += 1) { const x = left + i * slotWidth; ctx.beginPath(); ctx.moveTo(x - 3, slotTop - 11); ctx.lineTo(x, slotTop - 22); ctx.lineTo(x + 3, slotTop - 11); ctx.closePath(); ctx.fill(); ctx.stroke(); }
const trackStartY = state.ball && state.ball.phase === 'rail' ? state.ball.startY : bottom - 10 - (state.charging ? state.power * 0.22 : 0);
  ctx.strokeStyle = '#59616e'; ctx.lineWidth = 12; ctx.shadowColor = 'rgba(28,31,39,.35)'; ctx.shadowBlur = 5; ctx.lineCap = 'round'; ctx.beginPath(); drawTrackPath(trackStartY); ctx.stroke();
  ctx.shadowBlur = 0; ctx.strokeStyle = '#eef2f4'; ctx.lineWidth = 2.5; ctx.beginPath(); drawTrackPath(trackStartY); ctx.stroke();
  const rodY = bottom - 10 - (state.charging ? state.power * 0.22 : 0);
  ctx.strokeStyle = '#c52f3b'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(trackX, rodY); ctx.lineTo(trackX, bottom + 3); ctx.stroke(); ctx.fillStyle = '#ef3f4b'; ctx.fillRect(trackX - 13, rodY - 5, 26, 9);
  ctx.strokeStyle = '#f3c84b'; ctx.lineWidth = 2; ctx.beginPath(); for (let i = 0; i < 10; i += 1) { const sx = trackX + (i % 2 ? 6 : -6); const sy = rodY - i * 3; if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); } ctx.stroke(); const pbTop = bottom + 14; const pbBottom = bottom + 80; const pbW = 12; const pbh = pbBottom - pbTop; ctx.fillStyle = '#262833'; ctx.fillRect(trackX - pbW / 2 - 2, pbTop - 2, pbW + 4, pbh + 4); ctx.fillStyle = '#484a53'; ctx.fillRect(trackX - pbW / 2, pbTop, pbW, pbh); const pfill = Math.max(0, Math.min(100, state.powerShow)) / 100; const pfh = Math.round(pbh * pfill); ctx.fillStyle = state.charging ? '#ff5b66' : '#f3c84b'; ctx.fillRect(trackX - pbW / 2, pbBottom - pfh, pbW, pfh); ctx.strokeStyle = '#8b7e73'; ctx.lineWidth = 1.2; ctx.strokeRect(trackX - pbW / 2 - 0.5, pbTop - 0.5, pbW + 1, pbh + 1); ctx.fillStyle = '#f3c84b'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${Math.round(state.powerShow)}%`, trackX, pbBottom + 13); ctx.textAlign = 'start'; const topInfoY = trackExitY - 12; const rdT = state.multiplierReady; const predN = rdT ? state.multiplier * state.wager : 0; const predD = Math.floor(predN / 50); const labelY = topInfoY - 20; const boxY = topInfoY - 16; const boxW = Math.max(46, width * 0.17); const boxH = 26; const boxGap = 7; const totalW = boxW * 3 + boxGap * 2; const boxX = Math.max(5, (width - totalW) / 2); ctx.textAlign = 'center'; ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#211525'; ctx.fillText('倍率', boxX + boxW / 2, labelY); ctx.fillText('预计获得弹珠数', boxX + boxW + boxGap + boxW / 2, labelY); ctx.fillText('预计获得钻石数', boxX + (boxW + boxGap) * 2 + boxW / 2, labelY); ctx.fillStyle = 'rgba(10,10,14,.92)'; ctx.fillRect(boxX, boxY, boxW, boxH); ctx.fillRect(boxX + boxW + boxGap, boxY, boxW, boxH); ctx.fillRect(boxX + (boxW + boxGap) * 2, boxY, boxW, boxH); const dSize = Math.max(15, Math.min(20, width * .052)); const multiplierW = String(Math.max(0, Math.floor(state.multiplier || 0))).length * (dSize * .78); const nTextW = String(Math.max(0, Math.floor(predN))).length * (dSize * .78); const dTextW = String(Math.max(0, Math.floor(predD))).length * (dSize * .78); drawRedDigits(state.multiplier || 0, boxX + boxW / 2 + multiplierW / 2, boxY + 3, dSize); drawRedDigits(predN, boxX + boxW + boxGap + boxW / 2 + nTextW / 2, boxY + 3, dSize); drawRedDigits(predD, boxX + (boxW + boxGap) * 2 + boxW / 2 + dTextW / 2, boxY + 3, dSize); ctx.textAlign = 'start';
  if (state.ball && state.ball.phase !== 'settle' && state.ball.trail && state.ball.trail.length > 1 && state.trail > 0) { const tr = state.ball.trail; const n = tr.length; const color = skins[state.skin].color; const trailBoost = state.trail; ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; if (trailBoost >= 3) { const tail = tr[0], head = tr[n - 1]; const dx = head.x - tail.x, dy = head.y - tail.y, len = Math.max(1, Math.hypot(dx, dy)); const nx = -dy / len, ny = dx / len; const hues = [190, 285, 48, 125]; for (let q = 0; q < 3; q += 1) { const w = 5.5 - q * 1.1; const off = (q - 1) * 2.1; const tx = tail.x + nx * off, ty = tail.y + ny * off; const hx = head.x + nx * off, hy = head.y + ny * off; const trailColors = ['rgba(45,220,255,.52)', 'rgba(190,70,255,.86)', 'rgba(255,210,55,.58)']; ctx.fillStyle = trailColors[q];; ctx.beginPath(); ctx.moveTo(tx, ty); for (let k = 1; k < n; k += 1) { const t = k / (n - 1); const px = tr[k].x + nx * off, py = tr[k].y + ny * off; ctx.lineTo(px + nx * w * t, py + ny * w * t); } for (let k = n - 1; k >= 1; k -= 1) { const t = k / (n - 1); const px = tr[k].x + nx * off, py = tr[k].y + ny * off; ctx.lineTo(px - nx * w * t, py - ny * w * t); } ctx.closePath(); ctx.globalAlpha = 1; ctx.fill(); } ctx.globalAlpha = 0.24; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tail.x, tail.y); for (let k = 1; k < n; k += 1) ctx.lineTo(tr[k].x, tr[k].y); ctx.stroke(); } else { for (let k = 1; k < n; k += 1) { const a = tr[k - 1], b2 = tr[k]; const t = k / n; const alpha = t * t * (trailBoost === 2 ? 0.7 : 0.58); const widthTrail = (trailBoost === 2 ? 3 : 2) + t * (trailBoost === 2 ? 10 : 6); ctx.strokeStyle = hexToRgba(color, alpha); ctx.lineWidth = widthTrail; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); } } ctx.restore(); }if (state.ball) { if (state.ball.phase === 'settle') drawSettleFx(state.ball); if (state.halo > 0 && state.ball.phase !== 'settle') { for (let ring = 1; ring <= state.halo; ring += 1) { const pulse = 1 + Math.sin(Date.now() / 120) * 0.16; const rr = (8 + ring * 4) * pulse; const a = 0.62 - ring * 0.1; if (state.halo >= 3 && ring % 2 === 0) ctx.strokeStyle = `hsla(${(ring * 90) % 360},90%,62%,${a})`; else if (state.halo >= 3) ctx.strokeStyle = `hsla(${(ring * 90 + 180) % 360},90%,62%,${a})`; else ctx.strokeStyle = `rgba(255,232,170,${a})`; ctx.lineWidth = 3.2 - ring * 0.3; ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, rr, 0, Math.PI * 2); ctx.stroke(); } } if (state.ball.phase !== 'settle' || state.skin <= 2) { const settlePulse = state.ball.phase === 'settle' ? (1 + Math.sin(state.ball.settleFrames * 0.3) * 0.12) : 1; const br = 6 * settlePulse; const ballGradient = ctx.createRadialGradient(state.ball.x - br * 0.35, state.ball.y - br * 0.4, br * 0.2, state.ball.x, state.ball.y, br * 1.2); ballGradient.addColorStop(0, '#ffffff'); ballGradient.addColorStop(0.18, skins[state.skin].color); ballGradient.addColorStop(0.72, skins[state.skin].color); ballGradient.addColorStop(1, 'rgba(20,24,32,.8)'); ctx.fillStyle = ballGradient; ctx.shadowColor = 'rgba(0,0,0,.38)'; ctx.shadowBlur = 4; ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, br, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; if (state.ball.phase === 'settle') { ctx.globalAlpha = 0.45; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(state.ball.x, state.ball.y, br + 3, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; } } if (state.ball.phase === 'rail' && state.ball.v < 0) { ctx.fillStyle = '#ffcc66'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('力度不足，弹珠回落', left, bottom + 18); } }
  
  if (!state.running && !state.shop) { const rowY = height - 66; const infoW = 68, addR = 27, actionW = 88, actionH = 44, shopW = 54, shopH = 34, gap = 7; const totalW = infoW + addR * 2 + actionW + shopW + gap * 3; const startX = Math.max(8, (width - totalW) / 2); const infoX = startX; const addX = infoX + infoW + gap + addR; const actionX = addX + addR + gap + actionW / 2; const shopX = actionX + actionW / 2 + gap; ctx.textAlign = 'center'; ctx.fillStyle = '#211525'; ctx.font = 'bold 10px sans-serif'; ctx.fillText('已投弹珠数', infoX + infoW / 2, rowY - 22); ctx.fillStyle = 'rgba(10,10,14,.92)'; roundedRectPath(infoX, rowY - 17, infoW, 29, 4); ctx.fill(); const wagerTextW = String(state.wager).length * 14; drawRedDigits(state.wager, infoX + infoW / 2 + wagerTextW / 2, rowY - 14, 20); const addGrad = ctx.createLinearGradient(addX, rowY - addR, addX, rowY + addR); addGrad.addColorStop(0, '#64d4fb'); addGrad.addColorStop(1, '#126497'); ctx.fillStyle = addGrad; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 7; ctx.beginPath(); ctx.arc(addX, rowY, addR, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(229,250,255,.9)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('投珠', addX, rowY + 5); const actionGrad = ctx.createLinearGradient(actionX, rowY - actionH / 2, actionX, rowY + actionH / 2); actionGrad.addColorStop(0, state.phase === 'confirm' ? '#54c9ed' : '#67e778'); actionGrad.addColorStop(1, state.phase === 'confirm' ? '#176fa8' : '#148c42'); ctx.fillStyle = actionGrad; ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 7; roundedRectPath(actionX - actionW / 2, rowY - actionH / 2, actionW, actionH, 12); ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(state.phase === 'confirm' ? '确认倍率' : '长按发射', actionX, rowY + 4); const shopY = rowY - shopH / 2; ctx.fillStyle = '#3a2a12'; ctx.fillRect(shopX, shopY, shopW, shopH); ctx.strokeStyle = '#ffd35a'; ctx.lineWidth = 1.5; ctx.strokeRect(shopX, shopY, shopW, shopH); ctx.fillStyle = '#ffd35a'; ctx.font = 'bold 14px sans-serif'; ctx.textBaseline = 'middle'; ctx.fillText('商城', shopX + shopW / 2, rowY); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'start'; uiWager.addX = addX; uiWager.addY = rowY; uiWager.addR = addR; uiWager.startX = actionX; uiWager.startY = rowY; uiWager.startR = actionW / 2; shopBtn.x = shopX; shopBtn.y = shopY; shopBtn.w = shopW; shopBtn.h = shopH; }
  if (state.shop) drawShop();
}
function drawShop() {
  const px = 14, pw = width - 28, topY = 40;
  ctx.fillStyle = '#05080c';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(5,8,12,.97)';
  ctx.fillRect(12, topY, width - 24, height - 60);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('弹珠商城', px, topY + 30);
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#70e8ff';
  ctx.fillText('钻石 ' + state.diamonds + '    弹珠 ' + state.marbles + (cloudOn() ? '    积分 ' + CLOUD.meta.pointsBalance : '（游客模式）'), px, topY + 54);
  shopItems.length = 0;
  let y = topY + 68;
  const rowH = 22;
  function section(t) {
    y += 10;
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(px, y - 3, pw, 1);
    y += 5;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#9aa4b0';
    ctx.fillText(t, px, y);
    y += 16;
  }
  function item(label, sub, active, action, arg) {
    const iy = y, ih = rowH - 4;
    ctx.fillStyle = active ? 'rgba(255,211,90,.16)' : 'rgba(255,255,255,.03)';
    ctx.fillRect(px, iy, pw, ih);
    ctx.fillStyle = active ? '#ffd35a' : '#e6ebf0';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, px + 10, iy + 17);
    ctx.textAlign = 'right';
    ctx.fillStyle = active ? '#ffd35a' : '#9aa4b0';
    ctx.font = '13px sans-serif';
    ctx.fillText(sub, px + pw - 12, iy + 17);
    ctx.textAlign = 'start';
    shopItems.push({ x: px, y: iy, w: pw, h: ih, action, arg });
    y += rowH;
  }
  section('弹珠皮肤（弹珠购买）');
  skins.forEach((s, i) => { const active = state.skin === i, has = state.owned.skins.indexOf(i) >= 0; const sub = active ? '使用中' : (has ? '点击装备' : (s.cost ? s.cost + ' 弹珠' : '免费')); item(s.name, sub, active, 'skin', i); });
  section('拖尾特效（钻石购买）');
  trails.forEach((t, i) => { const active = state.trail === i, has = state.owned.trails.indexOf(i) >= 0; const sub = active ? '使用中' : (has ? '点击装备' : (t.cost ? t.cost + ' 钻石' : '免费')); item(t.name, sub, active, 'trail', i); });
  section('光环（钻石购买）');
  halos.forEach((h, i) => { const active = state.halo === i, has = state.owned.halos.indexOf(i) >= 0; const sub = active ? '使用中' : (has ? '点击装备' : (h.cost ? h.cost + ' 钻石' : '免费')); item(h.name, sub, active, 'halo', i); });
  if (cloudOn()) {
    section('Qbao 兑换（1 积分 = 10 弹珠 · 1 钻石 = 2 积分）');
    item('10 积分 → 100 弹珠', '点击兑换', false, 'exchangeIn', 0);
    item('1 钻石 → 2 积分', '今日可兑 ' + CLOUD.meta.diamondOutLeft + '/' + CLOUD.meta.diamondOutCap + ' 分', false, 'exchangeD2P', 0);
  }
  section('钻石兑换弹珠');
  item('50 钻石 → 1000 弹珠', state.diamonds >= 50 ? '点击兑换' : '钻石不足', false, 'exchange', 0);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#6b7480';
  ctx.textAlign = 'center';
  ctx.fillText('点击空白处关闭', width / 2, height - 82);
  ctx.textAlign = 'start';
}
function handleShopTap(it) {
  if (it.action === 'exchangeIn' || it.action === 'exchangeD2P') {
    if (!cloudOn()) { wx.showToast({ title: '游客模式不可兑换积分', icon: 'none' }); draw(); return; }
    if (it.action === 'exchangeIn') {
      CLOUD.exchangeP2M(CLOUD.meta.exchangeRate * 10).then((r) => { state.marbles = r.marbles; save(); draw(); CLOUD.toast('兑换成功：积分 → 弹珠'); }).catch((err) => { CLOUD.toast((err && err.message) || '兑换失败'); draw(); });
    } else {
      if (state.diamonds < 1) { CLOUD.toast('暂无钻石（钻石来自对局命中）'); draw(); return; }
      CLOUD.exchangeD2P(1).then((r) => { state.diamonds = r.diamonds; save(); draw(); CLOUD.toast('兑换成功：钻石 → Qbao 积分 +' + CLOUD.meta.diamondToPoints); }).catch((err) => { CLOUD.toast((err && err.message) || '兑换失败'); draw(); });
    }
    return;
  }
  const doLocal = (cat, arr, key, cur) => { const i = it.arg; if (state[key] === i) return; if (state.owned[arr].indexOf(i) >= 0) { state[key] = i; } else { const c = cat[i].cost; if (state[cur] >= c) { state[cur] -= c; state.owned[arr].push(i); state[key] = i; } else { wx.showToast({ title: cur === 'marbles' ? '弹珠不足' : '钻石不足', icon: 'none' }); draw(); return; } } };
  const doCloud = (catKey) => { CLOUD.purchase(catKey, it.arg).then((r) => { state.owned[catKey] = (r.owned && r.owned[catKey]) || state.owned[catKey]; if (r.equipped && r.equipped[catKey] != null) { if (catKey === 'skins') state.skin = r.equipped[catKey]; else if (catKey === 'halos') state.halo = r.equipped[catKey]; else state.trail = r.equipped[catKey]; } if (r.marbles != null) state.marbles = r.marbles; if (r.diamonds != null) state.diamonds = r.diamonds; save(); draw(); }).catch((err) => { CLOUD.toast((err && err.message) || '购买失败'); draw(); }); };
  if (it.action === 'skin') { if (cloudOn()) { doCloud('skins'); return; } doLocal(skins, 'skins', 'skin', 'marbles'); }
  else if (it.action === 'halo') { if (cloudOn()) { doCloud('halos'); return; } doLocal(halos, 'halos', 'halo', 'diamonds'); }
  else if (it.action === 'trail') { if (cloudOn()) { doCloud('trails'); return; } doLocal(trails, 'trails', 'trail', 'diamonds'); }
  else if (it.action === 'exchange') {
    if (cloudOn()) { CLOUD.purchase('diamond2marble', 0).then((r) => { state.diamonds = r.diamonds; state.marbles = r.marbles; save(); draw(); }).catch((err) => { CLOUD.toast((err && err.message) || '兑换失败'); draw(); }); return; }
    if (state.diamonds >= 50) { state.diamonds -= 50; state.marbles += 1000; } else { wx.showToast({ title: '钻石不足', icon: 'none' }); draw(); return; }
  }
  save(); draw();
}function randomize() {
  state.multiplierReady = false; state.randomizing = true;
  const timer = setInterval(() => { state.multiplier = [2, 3, 5, 10][Math.floor(Math.random() * 4)]; draw(); }, 70);
  const finish = (multiplier, lit) => { clearInterval(timer); state.randomizing = false; state.multiplier = multiplier; state.lit = new Set(lit); state.multiplierReady = true; state.phase = 'charge'; draw(); };
  if (!cloudOn()) {
    setTimeout(() => { const i = Math.floor(Math.random() * 4); const count = [5, 4, 2, 1][i]; const picks = []; while (picks.length < count) { const slot = Math.floor(Math.random() * slotCount); if (picks.indexOf(slot) < 0) picks.push(slot); } finish([2, 3, 5, 10][i], picks); }, 14 * 70);
  } else {
    CLOUD.startRound(state.wager).then((r) => { state.marbles = r.marbles; save(); finish(r.multiplier, r.lit); }).catch((err) => { clearInterval(timer); state.randomizing = false; state.phase = 'confirm'; draw(); CLOUD.toast((err && err.message) || '开局失败，请重试'); CLOUD.refresh().then(() => draw()).catch(() => {}); });
  }
}function showFree() {
  if (state.marbles !== 0 || state.modal) return;
  if (cloudOn()) {
    if (CLOUD.meta.freeLeft <= 0) { state.modal = true; wx.showModal({ title: '弹珠不足', content: '今日免费弹珠已领完，可在商城用 Qbao 积分兑换，或明天再来', confirmText: '知道了', showCancel: false, complete: () => { state.modal = false; } }); return; }
    state.modal = true; CLOUD.freeClaim().then((r) => { state.modal = false; state.marbles = r.marbles; CLOUD.meta.freeLeft = r.freeLeft; save(); draw(); CLOUD.toast('领取 ' + CLOUD.meta.freeAmount + ' 颗弹珠'); }).catch((err) => { state.modal = false; CLOUD.toast((err && err.message) || '领取失败'); }); return;
  }
  if (state.freeClaims >= 2 || state.modal) return;
  state.modal = true; wx.showModal({ title: '弹珠不足', content: '今日还剩 ' + (2 - state.freeClaims) + ' 次免费领取\n每次补充 50 颗弹珠', confirmText: '领取50颗', cancelText: '关闭', complete: (r) => { state.modal = false; if (r.confirm) { state.marbles += 50; state.freeClaims += 1; save(); draw(); } } });
}function launch() { const launchPower = state.power; state.power = 0; state.powerShow = launchPower; state.powerKeep = 70; if (state.marbles <= 0) { showFree(); return; } const e = launchEnergy(launchPower); const tg = trackGeometry(e.startY); state.ball = { phase: 'rail', s: 0, v: e.v0, startY: e.startY, x: trackX, y: e.startY, launchPower, total: tg.total, vert: tg.verticalLength, arc: tg.arcLength, hinted: false }; state.running = true; state.phase = 'confirm'; }
let lastT = 0; let physicsAccumulator = 0;
function loop() { const now = Date.now(); let dt = lastT ? now - lastT : 16.666; lastT = now; if (dt > 66) dt = 66; else if (dt < 1) dt = 16.666; const f = dt / (1000 / 60); if (state.charging) { state.power += state.powerDir * 2 * f; if (state.power >= 100) { state.power = 100; state.powerDir = -1; } if (state.power <= 0) { state.power = 0; state.powerDir = 1; } state.powerShow = state.power; } if (state.running && state.ball) { const b = state.ball; if (b.phase === 'rail') { let ce; if (b.s <= b.vert) ce = 1; else if (b.s <= b.vert + b.arc) ce = Math.cos((b.s - b.vert) / trackRadius); else ce = 0; const falling = b.v < 0; if (falling && !b.hinted) { b.hinted = true; wx.showToast({ title: '力度不足，弹珠回落', icon: 'none' }); } const kt = (falling ? RAIL_DOWN_T : RAIL_UP_T) * f; b.v -= ce * RAIL_G * (falling ? RAIL_RETURN_G : 1) * kt; b.s += b.v * kt; if (b.s <= 0) { state.ball = null; state.running = false; state.phase = 'charge'; } else if (!falling && b.s >= b.total) { const wager = Math.min(state.wager, state.marbles); if (!cloudOn()) { state.marbles -= wager; save(); } b.phase = 'board'; b.wager = wager; b.settled = false; b.ageFrames = 0; b.stillF = 0; b.nudges = 0; const exX = trackExitX + (Math.random() - 0.5) * 1.6; const body = Bodies.circle(exX, trackExitY, 6, { restitution: 0.48, friction: 0.012, frictionStatic: 0, frictionAir: AIR_DAMP }); World.add(engine.world, body); b.body = body; Body.setPosition(body, { x: exX, y: trackExitY }); Body.setVelocity(body, { x: (-b.v * RAIL_K + (Math.random() - 0.5) * 0.5) * RAIL_T, y: EXIT_VY + (Math.random() - 0.5) * 0.3 * RAIL_T }); Body.setAngularVelocity(body, 0); b.x = exX; b.y = trackExitY; b.lx = exX; b.ly = trackExitY; } else { const t = Math.max(0, Math.min(1, b.s / b.total)); const p = trackPoint(t, b.startY); b.x = p.x; b.y = p.y; } } else if (b.phase === 'board') { physicsAccumulator = Math.min(33.332, physicsAccumulator + dt); const physicsStep = 16.666; let physicsSteps = Math.min(2, Math.floor(physicsAccumulator / physicsStep)); if (physicsSteps < 1) { physicsSteps = 1; physicsAccumulator = 0; } else { physicsAccumulator = Math.max(0, physicsAccumulator - physicsSteps * physicsStep); } for (let step = 0; step < physicsSteps; step += 1) Engine.update(engine, physicsStep); const clampedX = Math.max(left + 8, Math.min(right - 8, b.body.position.x)); if (clampedX !== b.body.position.x) Body.setPosition(b.body, { x: clampedX, y: b.body.position.y }); b.x = clampedX; b.y = b.body.position.y; b.ageFrames += f; const moved = Math.hypot(b.x - b.lx, b.y - b.ly); b.lx = b.x; b.ly = b.y; const speed = Math.hypot(b.body.velocity.x, b.body.velocity.y); if (moved < 0.24 && speed < 0.7 && b.y < bottom - 34) b.stillF += f; else b.stillF = Math.max(0, b.stillF - f * 0.5); if (b.y > bottom + 14 && b.y < bottom + 34 && Math.abs(b.body.velocity.x) < 0.5 && Math.abs(b.body.velocity.y) < 0.6) { const cx = left + Math.round((b.x - left) / slotWidth) * slotWidth; const dir = b.x >= cx ? 1 : -1; Body.setVelocity(b.body, { x: dir * 1.0, y: b.body.velocity.y }); } if (b.stillF > 12) { b.stillF = 0; b.nudges += 1; if (b.nudges >= 6) { b.ageFrames = 1200; } else { const kickX = Math.random() < 0.5 ? -1.25 : 1.25; Body.setVelocity(b.body, { x: kickX, y: 3.4 }); Body.setAngularVelocity(b.body, kickX * 0.18); Body.translate(b.body, { x: kickX * 0.35, y: 0.8 }); } } if ((b.y >= bottom + 35 || b.ageFrames > 1100) && !b.settled) { b.settled = true; b.phase = 'settle'; b.settleFrames = 0; b.stopVx = (b.trail && b.trail.length ? b.trail[b.trail.length - 1].vx : 0); b.stopVy = (b.trail && b.trail.length ? b.trail[b.trail.length - 1].vy : 0); b.trailFade = 0; b.slot = Math.max(0, Math.min(slotCount - 1, Math.floor((b.x - left) / slotWidth))); Body.setStatic(b.body, true); Body.setPosition(b.body, { x: left + b.slot * slotWidth + slotWidth / 2, y: bottom + 42 }); Body.setVelocity(b.body, { x: 0, y: 0 }); b.x = left + b.slot * slotWidth + slotWidth / 2; b.y = bottom + 42; } } else if (b.phase === 'settle') { b.settleFrames += f; if (b.trail && b.trail.length > 0 && state.trail > 0) { b.trailFade = (b.trailFade || 0) + 1; const dec = Math.max(0.2, 1 - b.trailFade / 26); let _sp = Math.hypot(b.stopVx || 0, b.stopVy || 0); let _dx = (b.stopVx || 0), _dy = (b.stopVy || 0); if (_sp > 1.8) { _dx = _dx / _sp * 1.8; _dy = _dy / _sp * 1.8; } _dx *= dec; _dy *= dec; for (let i = 0; i < b.trail.length - 1; i++) { b.trail[i].x += _dx; b.trail[i].y += _dy; } const _h = b.trail[b.trail.length - 1]; _h.x = b.x; _h.y = b.y; if (b.trailFade > 16) b.trail = []; } if (b.settleFrames >= 55) {
  if (!cloudOn()) {
    const win = state.lit.has(b.slot);
    const reward = win ? b.wager * state.multiplier : 0;
    state.marbles += reward; state.diamonds += Math.floor(reward / 50);
    World.remove(engine.world, b.body); state.ball = null; state.running = false; state.phase = 'confirm'; state.multiplierReady = false; state.multiplier = 0; state.wager = 0; state.lit = new Set();
    save();
    if (CLOUD && CLOUD.reportReward) CLOUD.reportReward(reward);
    wx.showModal({ title: win ? '恭喜你' : '很遗憾', content: win ? ('获得 ' + reward + ' 颗弹珠\n钻石 +' + Math.floor(reward / 50) + ' 颗') : '再试一次吧', showCancel: false });
  } else {
    const slot = b.slot;
    World.remove(engine.world, b.body); state.ball = null; state.running = false; state.phase = 'confirm'; state.multiplierReady = false; state.multiplier = 0; state.wager = 0; state.lit = new Set();
    save();
    CLOUD.settleRound(slot).then(function (r) {
      state.marbles = r.marbles; state.diamonds = r.diamondBalance; save();
      if (CLOUD.reportReward) CLOUD.reportReward(r.won ? r.reward : 0);
      wx.showModal({ title: r.won ? '恭喜你' : '很遗憾', content: r.won ? ('获得 ' + r.reward + ' 颗弹珠\n钻石 +' + r.diamonds + ' 颗' + (r.capped ? '\n（今日赢取已达上限）' : '')) : '再试一次吧', showCancel: false });
    }).catch(function (err) {
      CLOUD.toast((err && err.message) || '结算失败，请重试');
      CLOUD.refresh().then(function () { draw(); }).catch(function () {});
    });
  }
} } } if (state.running && state.ball && state.ball.phase !== 'settle') { const b = state.ball; b.trail = b.trail || []; const vx = (b.phase === 'board' && b.body) ? b.body.velocity.x : 0; const vy = (b.phase === 'board' && b.body) ? b.body.velocity.y : 0; b.trail.push({ x: b.x, y: b.y, vx, vy }); const maxLen = [0, 5, 8, 8][state.trail]; while (b.trail.length > maxLen) b.trail.shift(); } if (!state.charging && state.powerShow > 0) { if (state.powerKeep > 0) state.powerKeep -= f; else state.powerShow = Math.max(0, state.powerShow - 3 * f); } draw(); frame(loop); }
wx.onTouchStart((e) => { const t = e.touches && e.touches[0]; if (!t) return; const x = t.clientX; const y = t.clientY; const sbx2 = shopBtn.x; const sby2 = shopBtn.y; if (sbx2 > 0 && x >= sbx2 && x <= sbx2 + shopBtn.w && y >= sby2 && y <= sby2 + shopBtn.h) { state.shop = !state.shop; state.charging = false; draw(); return; } if (state.shop) { for (let i = 0; i < shopItems.length; i += 1) { const it = shopItems[i]; if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) { handleShopTap(it); return; } } state.shop = false; draw(); return; } if (state.running || state.randomizing || state.modal) return; if (uiWager.addR > 0 && Math.hypot(x - uiWager.addX, y - uiWager.addY) <= uiWager.addR + 8) { state.wager = Math.min(100, state.wager + 1); draw(); if (wagerTimer) clearTimeout(wagerTimer); if (wagerRepeat) clearInterval(wagerRepeat); wagerTimer = setTimeout(() => { wagerRepeat = setInterval(() => { if (state.wager >= 100) { clearInterval(wagerRepeat); wagerRepeat = null; return; } state.wager += 1; draw(); }, 70); }, 350); return; } if (uiWager.startR > 0 && Math.hypot(x - uiWager.startX, y - uiWager.startY) <= uiWager.startR + 8) { if (state.wager < 5) { wx.showToast({ title: '至少投5个珠子后才能开始', icon: 'none' }); return; } if (state.phase === 'confirm') { randomize(); return; } if (state.phase === 'charge') { state.charging = true; state.power = 0; state.powerShow = 0; state.powerKeep = 0; state.powerDir = 1; } return; }  });
wx.onTouchEnd(() => { if (wagerTimer) { clearTimeout(wagerTimer); wagerTimer = null; } if (wagerRepeat) { clearInterval(wagerRepeat); wagerRepeat = null; } if (!state.charging) return; state.charging = false; launch(); });
if (typeof wx.onTouchCancel === 'function') wx.onTouchCancel(() => { if (wagerTimer) { clearTimeout(wagerTimer); wagerTimer = null; } if (wagerRepeat) { clearInterval(wagerRepeat); wagerRepeat = null; } state.charging = false; state.power = 0; state.powerShow = 0; draw(); });
if (CLOUD && !CLOUD.ready) {
  CLOUD.onReady(function (seed) { if (seed) cloudApplySeed(seed); frame(loop); draw(); if (state.marbles === 0) setTimeout(showFree, 300); });
} else {
  frame(loop); draw(); if (state.marbles === 0) setTimeout(showFree, 300);
}
})();
