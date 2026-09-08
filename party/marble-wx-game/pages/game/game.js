const PEG_ROWS = 11;
const PEG_COLS = 8;
const SLOT_COUNT = 8;
const MULTIPLIERS = [{ value: 2, lit: 5 }, { value: 3, lit: 4 }, { value: 5, lit: 2 }, { value: 10, lit: 1 }];
const MARBLE_SKINS = [
  { id: 'silver', name: '经典银', price: 0, currency: 'marble', color: '#dfe5e8', edge: '#7f8a93', glow: '#ffffff', trail: '' },
  { id: 'ocean', name: '深海蓝', price: 1500, currency: 'marble', color: '#4db8ff', edge: '#176aa8', glow: '#dff5ff', trail: '' },
  { id: 'ruby', name: '赤焰红', price: 1500, currency: 'marble', color: '#ff5964', edge: '#a51f35', glow: '#ffe1df', trail: '' },
  { id: 'gold', name: '鎏金', price: 3000, currency: 'marble', color: '#ffd35a', edge: '#a66c00', glow: '#fff4bd', trail: '' },
  { id: 'comet', name: '紫电彗星', price: 8000, currency: 'marble', color: '#b57cff', edge: '#6136a8', glow: '#f0ddff', trail: '#9f63ff' },
  { id: 'aurora', name: '极光', price: 8000, currency: 'marble', color: '#61f2c2', edge: '#177f6a', glow: '#e2fff7', trail: '#5de2ff' },
  { id: 'plasma', name: '等离子', price: 8, currency: 'diamond', color: '#64e8ff', edge: '#245cff', glow: '#ffffff', trail: '#278cff' },
  { id: 'solar', name: '太阳耀斑', price: 12, currency: 'diamond', color: '#fff06a', edge: '#ff4d25', glow: '#ffffff', trail: '#ff7136' },
  { id: 'prism', name: '幻彩棱镜', price: 18, currency: 'diamond', color: '#ff78db', edge: '#5d62ff', glow: '#ffffff', trail: '#63f5dd' }
];
const BACKGROUNDS = [
  { id: 'classic', name: '经典暗场', price: 0, canvas: '#11151a', board: '#171c22', line: '#29313a' },
  { id: 'cyber', name: '霓虹矩阵', price: 5, canvas: '#080d17', board: '#0d1725', line: '#1c6680' },
  { id: 'ember', name: '熔火核心', price: 8, canvas: '#170b0d', board: '#251217', line: '#80372b' }
];

Page({
  data: { marbles: 1000, diamonds: 0, wager: 20, power: 0, multiplier: 2, litCount: 5, slotCount: SLOT_COUNT, stage: 'setup', isRunning: false, isCharging: false, isRandomizing: false, showResult: false, showShop: false, resultAmount: 0, resultDiamonds: 0, resultType: '', equippedSkin: 'silver', equippedBackground: 'classic', shopItems: [], backgroundItems: [], freeClaims: 0, canClaimFree: false, debugError: '' },

  onLoad() { this.loadProgress(); },
  onReady() { this.initCanvas(); },
  onShow() { this.loadProgress(); setTimeout(() => { if (!this.destroyed) { if (this.ctx && this.geometry) { this.draw(); if (this.data.stage === 'setup') this.startPreviewLights(); this.maybeShowFreeGift(); } else this.initCanvas(); } }, 120); },
  onUnload() { this.destroyed = true; if (this.frameTimer) clearTimeout(this.frameTimer); if (this.chargeTimer) clearInterval(this.chargeTimer); if (this.randomTimer) clearInterval(this.randomTimer); if (this.previewTimer) clearInterval(this.previewTimer); },

  initCanvas() {
    if (this.canvasInitializing) return;
    this.canvasInitializing = true;
    wx.createSelectorQuery().select('#gameCanvas').fields({ node: true, size: true }).exec((res) => {
      try {
        if (!res[0] || !res[0].node) throw new Error('未找到 Canvas 2D 节点');
        this.canvas = res[0].node;
        this.ctx = this.canvas.getContext('2d');
        this.dpr = wx.getWindowInfo().pixelRatio;
        this.width = res[0].width;
        this.height = res[0].height;
        this.canvas.width = this.width * this.dpr;
        this.canvas.height = this.height * this.dpr;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.setupWorld(); this.chooseLights(); this.draw();
        if (this.data.stage === 'setup') this.startPreviewLights();
        wx.nextTick(() => { if (!this.destroyed) this.maybeShowFreeGift(); });
      } catch (error) { this.setData({ debugError: error.message || String(error) }); }
      finally { this.canvasInitializing = false; }
    });
  },

  setupWorld() {
    const pad = 14, launcherWidth = 34;
    const boardLeft = pad, boardRight = this.width - pad - launcherWidth;
    const trackX = this.width - pad - 10, trackTop = 20, gridTop = 72;
    const slotBottom = this.height - 16, slotTop = slotBottom - 48, gridBottom = slotTop - 16;
    const pegEdge = 4;
    const colGap = (boardRight - boardLeft - pegEdge * 2) / (PEG_COLS - 1);
    const rowGap = ((gridBottom - gridTop) / (PEG_ROWS - 1)) * 0.72;
    const pegTop = gridTop + ((gridBottom - gridTop) - rowGap * (PEG_ROWS - 1)) / 2;
    this.geometry = { boardLeft, boardRight, trackX, trackTop, gridTop, gridBottom, pegTop, slotTop, slotBottom, colGap, rowGap, slotWidth: (boardRight - boardLeft) / SLOT_COUNT };
    this.pegs = [];
    for (let row = 0; row < PEG_ROWS; row += 1) {
      for (let col = 0; col < PEG_COLS; col += 1) {
        const x = boardLeft + pegEdge + col * colGap + (row % 2 ? colGap / 2 : 0);
        if (x <= boardRight - pegEdge) this.pegs.push({ x, y: pegTop + row * rowGap, r: 3.8, boost: row === 2 || row === PEG_ROWS - 3 });
      }
    }
    for (let col = 0; col < PEG_COLS; col += 1) {
      const x = boardLeft + pegEdge + col * colGap;
      if (x <= boardRight - pegEdge) this.pegs.push({ x, y: gridTop + 5, r: 4.4, dampener: true, boost: false });
    }
    for (let col = 0; col < PEG_COLS - 1; col += 1) {
      const x = boardLeft + pegEdge + colGap / 2 + col * colGap;
      this.pegs.push({ x, y: (gridTop + 5 + pegTop) / 2, r: 4.4, dampener: true, boost: false });
    }
    this.ball = null;
  },

  chooseLights() {
    const values = Array.from({ length: SLOT_COUNT }, (_, i) => i);
    for (let i = values.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [values[i], values[j]] = [values[j], values[i]]; }
    this.litSlots = new Set(values.slice(0, this.data.litCount));
    if (this.ctx) this.draw();
  },

  loadProgress() {
    const saved = wx.getStorageSync('galtonProgress') || {};
    const owned = Array.isArray(saved.ownedSkins) ? saved.ownedSkins : ['silver'];
    if (!owned.includes('silver')) owned.unshift('silver');
    this.ownedSkins = new Set(owned);
    const ownedBackgrounds = Array.isArray(saved.ownedBackgrounds) ? saved.ownedBackgrounds : ['classic'];
    if (!ownedBackgrounds.includes('classic')) ownedBackgrounds.unshift('classic');
    this.ownedBackgrounds = new Set(ownedBackgrounds);
    const equippedSkin = this.ownedSkins.has(saved.equippedSkin) ? saved.equippedSkin : 'silver';
    const equippedBackground = this.ownedBackgrounds.has(saved.equippedBackground) ? saved.equippedBackground : 'classic';
    const today = new Date().toISOString().slice(0, 10);
    const freeClaims = saved.freeClaimDate === today ? Math.min(2, Number(saved.freeClaims) || 0) : 0;
    this.setData({
      marbles: Number.isFinite(saved.marbles) ? saved.marbles : 1000,
      diamonds: Number.isFinite(saved.diamonds) ? saved.diamonds : 0,
      equippedSkin,
      equippedBackground,
      shopItems: this.buildShopItems(equippedSkin),
      backgroundItems: this.buildBackgroundItems(equippedBackground),
      freeClaims,
      canClaimFree: (Number.isFinite(saved.marbles) ? saved.marbles : 1000) <= 0 && freeClaims < 2
    });
  },
  saveProgress() {
    wx.setStorageSync('galtonProgress', { marbles: this.data.marbles, diamonds: this.data.diamonds, ownedSkins: Array.from(this.ownedSkins), equippedSkin: this.data.equippedSkin, ownedBackgrounds: Array.from(this.ownedBackgrounds), equippedBackground: this.data.equippedBackground, freeClaims: this.data.freeClaims, freeClaimDate: new Date().toISOString().slice(0, 10) });
  },
  claimFreeMarbles() {
    if (this.data.marbles > 0 || this.data.freeClaims >= 2 || this.freeGiftBusy) return;
    this.freeGiftBusy = true;
    const freeClaims = this.data.freeClaims + 1;
    this.setData({ marbles: this.data.marbles + 50, freeClaims, canClaimFree: false, showFreeGift: false }, () => { this.saveProgress(); this.freeGiftBusy = false; wx.showToast({ title: '已领取50颗弹珠', icon: 'success' }); });
  },
  closeFreeGift() { this.freeGiftBusy = false; },
  maybeShowFreeGift(marbles = this.data.marbles) {
    if (this.data.stage !== 'setup' || marbles > 0 || this.data.freeClaims >= 2 || this.data.showResult || this.data.showShop || this.freeGiftBusy) return;
    this.freeGiftBusy = true;
    wx.showModal({ title: '弹珠不足', content: `今日还剩 ${2 - this.data.freeClaims} 次免费领取\n每次补充 50 颗弹珠`, confirmText: '领取50颗', cancelText: '关闭', complete: (res) => { if (res.confirm) { this.freeGiftBusy = false; this.claimFreeMarbles(); } else { setTimeout(() => { this.freeGiftBusy = false; }, 200); } } });
  },
  buildShopItems(equipped = this.data.equippedSkin) {
    return MARBLE_SKINS.map((item) => ({ ...item, owned: this.ownedSkins.has(item.id), equipped: equipped === item.id }));
  },
  buildBackgroundItems(equipped = this.data.equippedBackground) {
    return BACKGROUNDS.map((item) => ({ ...item, owned: this.ownedBackgrounds.has(item.id), equipped: equipped === item.id }));
  },
  openShop() {
    if (this.data.stage !== 'setup' || this.data.showShop || this.shopTransitioning || this.freeGiftBusy || this.resultDialogOpen) return;
    this.shopTransitioning = true;
    this.stopPreviewLights();
    this.setData({ showShop: true, shopItems: this.buildShopItems(), backgroundItems: this.buildBackgroundItems() }, () => { this.shopTransitioning = false; });
  },
  closeShop() {
    if (!this.data.showShop || this.shopTransitioning) return;
    this.shopTransitioning = true;
    this.setData({ showShop: false }, () => {
      wx.nextTick(() => {
        this.canvas = null;
        this.ctx = null;
        this.geometry = null;
        this.pegs = [];
        this.initCanvas();
        this.shopTransitioning = false;
        this.maybeShowFreeGift();
      });
    });
  },
  buyOrEquipSkin(event) {
    const id = event.currentTarget.dataset.id;
    const skin = MARBLE_SKINS.find((item) => item.id === id);
    if (!skin || id === this.data.equippedSkin) return;
    let marbles = this.data.marbles, diamonds = this.data.diamonds;
    const purchased = !this.ownedSkins.has(id);
    if (purchased) {
      if (skin.currency === 'diamond') {
        if (diamonds < skin.price) { wx.showToast({ title: '钻石不足', icon: 'none' }); return; }
        diamonds -= skin.price;
      } else {
        if (marbles < skin.price) { wx.showToast({ title: '弹珠不足', icon: 'none' }); return; }
        marbles -= skin.price;
      }
      this.ownedSkins.add(id);
    }
    this.setData({ marbles, diamonds, equippedSkin: id, shopItems: this.buildShopItems(id) }, () => {
      this.saveProgress();
      this.draw();
      this.maybeShowFreeGift(marbles);
      wx.showToast({ title: purchased ? '购买并装备' : '已装备', icon: 'success' });
    });
  },
  buyOrEquipBackground(event) {
    const id = event.currentTarget.dataset.id;
    const background = BACKGROUNDS.find((item) => item.id === id);
    if (!background || id === this.data.equippedBackground) return;
    let diamonds = this.data.diamonds;
    const purchased = !this.ownedBackgrounds.has(id);
    if (purchased) {
      if (diamonds < background.price) { wx.showToast({ title: '钻石不足', icon: 'none' }); return; }
      diamonds -= background.price;
      this.ownedBackgrounds.add(id);
    }
    this.setData({ diamonds, equippedBackground: id, backgroundItems: this.buildBackgroundItems(id) }, () => { this.saveProgress(); this.draw(); wx.showToast({ title: purchased ? '购买并使用' : '已更换背景', icon: 'success' }); });
  },

  startPreviewLights() {
    if (this.previewTimer || this.data.stage !== 'setup') return;
    let tick = 0;
    this.previewTimer = setInterval(() => {
      if (this.data.stage !== 'setup' || !this.ctx) return;
      const moving = new Set();
      for (let i = 0; i < 3; i += 1) moving.add((tick + i) % SLOT_COUNT);
      this.litSlots = moving;
      tick = (tick + 1) % SLOT_COUNT;
      this.draw();
    }, 110);
  },
  stopPreviewLights() {
    if (!this.previewTimer) return;
    clearInterval(this.previewTimer);
    this.previewTimer = null;
  },

  confirmStake() {
    if (this.data.stage !== 'setup' || this.data.marbles < this.data.wager) return;
    this.stopPreviewLights();
    const remaining = this.data.marbles - this.data.wager;
    this.setData({ marbles: remaining, canClaimFree: remaining <= 0 && this.data.freeClaims < 2, stage: 'randomizing', isRandomizing: true, resultType: '' }, () => { this.saveProgress(); this.startRandomDraw(); });
  },
  startRandomDraw() {
    let tick = 0;
    this.randomTimer = setInterval(() => {
      tick += 1;
      const preview = MULTIPLIERS[tick % MULTIPLIERS.length];
      const moving = new Set();
      for (let i = 0; i < preview.lit; i += 1) moving.add((tick + i * 2) % SLOT_COUNT);
      this.litSlots = moving;
      this.setData({ multiplier: preview.value, litCount: preview.lit }, () => this.draw());
      if (tick >= 26) {
        clearInterval(this.randomTimer); this.randomTimer = null;
        const result = MULTIPLIERS[Math.floor(Math.random() * MULTIPLIERS.length)];
        this.setData({ multiplier: result.value, litCount: result.lit, stage: 'ready', isRandomizing: false }, () => this.chooseLights());
      }
    }, 65);
  },
  startCharging() {
    if (this.data.stage !== 'ready' || this.data.isRunning || this.data.isCharging) return;
    this.chargeDirection = 1;
    this.setData({ isCharging: true, power: 0, resultType: '' }, () => this.draw());
    this.chargeTimer = setInterval(() => {
      let power = this.data.power + this.chargeDirection * 3;
      if (power >= 100) { power = 100; this.chargeDirection = -1; }
      if (power <= 0) { power = 0; this.chargeDirection = 1; }
      this.setData({ power }, () => this.draw());
    }, 42);
  },
  releaseCharging() {
    if (!this.data.isCharging) return;
    clearInterval(this.chargeTimer); this.chargeTimer = null;
    const launchPower = this.data.power;
    this.setData({ isCharging: false }, () => this.startRound(launchPower));
  },
  decreaseStake() { if (this.data.stage === 'setup') this.setData({ wager: Math.max(10, this.data.wager - 10) }); },
  increaseStake() { if (this.data.stage === 'setup') this.setData({ wager: Math.min(100, this.data.wager + 10) }); },

  startRound(launchPower) {
    if (this.data.isRunning || !this.geometry || this.data.stage !== 'ready') return;
    const { trackX, slotBottom } = this.geometry;
    this.roundResolved = false; this.pendingResult = null;
    this.ball = { x: trackX, y: slotBottom - 13, lastY: slotBottom - 13, vx: 0, vy: 0, r: 6.5, phase: 'launcher', pathProgress: 0, trackVelocity: 500 + launchPower * 8, launchPower, roundFrames: 0, groundFrames: 0 };
    this.setData({ stage: 'running', isRunning: true, resultType: '' }, () => this.loop());
  },

  simulateLauncher(dt) {
    const b = this.ball, g = this.geometry;
    const rise = g.slotBottom - 13 - (g.trackTop + 22), radius = 22, arcLength = Math.PI * radius / 2;
    let acceleration = -34;
    if (b.pathProgress < rise) acceleration -= 650;
    else if (b.pathProgress < rise + arcLength) acceleration -= 650 * Math.cos((b.pathProgress - rise) / radius);
    b.trackVelocity += acceleration * dt;
    b.pathProgress += b.trackVelocity * dt;
    if (b.pathProgress <= 0 && b.trackVelocity < 0) {
      this.ball = null;
      this.setData({ isRunning: false, stage: 'ready', power: 0 }, () => this.draw());
      return;
    }
    if (b.pathProgress <= rise) { b.x = g.trackX; b.y = g.slotBottom - 13 - b.pathProgress; return; }
    const arcDistance = b.pathProgress - rise;
    if (arcDistance <= arcLength) {
      const angle = arcDistance / radius;
      b.x = g.trackX - radius + radius * Math.cos(angle);
      b.y = g.trackTop + 22 - radius * Math.sin(angle); return;
    }
    b.x = g.trackX - radius - (arcDistance - arcLength); b.y = g.trackTop;
    if (b.x <= g.boardRight - 16) { b.phase = 'board'; b.x = g.boardRight - 16; b.y = g.trackTop; b.vx = -b.trackVelocity * 0.94; b.vy = 0; }
  },

  collidePeg(b, p) {
    const dx = b.x - p.x, dy = b.y - p.y, min = b.r + p.r, d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 0.001, nx = dx / d, ny = dy / d;
    b.x += nx * (min - d); b.y += ny * (min - d);
    const normal = b.vx * nx + b.vy * ny;
    if (normal < 0) {
      const bounce = p.boost ? 2.05 : (p.dampener ? 1.08 : 1.54);
      b.vx -= bounce * normal * nx; b.vy -= bounce * normal * ny;
      if (p.boost) { b.vx *= 1.08; b.vy *= 1.08; }
      if (p.dampener) { b.vx *= 0.72; b.vy *= 0.72; }
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (speed > 760) { b.vx *= 760 / speed; b.vy *= 760 / speed; }
      b.vx *= 0.992;
    }
  },

  simulateBoard(dt) {
    const b = this.ball, g = this.geometry;
    b.lastY = b.y; b.vy += 650 * dt; b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < g.boardLeft + b.r) { b.x = g.boardLeft + b.r; b.vx = Math.abs(b.vx) * 0.5; }
    else if (b.x > g.boardRight - b.r) { b.x = g.boardRight - b.r; b.vx = -Math.abs(b.vx) * 0.5; }
    this.pegs.forEach((p) => this.collidePeg(b, p));
    if (b.y > g.slotTop - 8 && b.y < g.slotBottom) {
      for (let i = 0; i <= SLOT_COUNT; i += 1) {
        const wallX = g.boardLeft + i * g.slotWidth;
        if (Math.abs(b.x - wallX) < b.r + 1.2) { const side = b.x >= wallX ? 1 : -1; b.x = wallX + side * (b.r + 1.2); b.vx = side * Math.abs(b.vx) * 0.38; }
      }
    }
    if (!this.roundResolved && b.lastY < g.slotTop && b.y >= g.slotTop) {
      this.resolvePass(Math.max(0, Math.min(SLOT_COUNT - 1, Math.floor((b.x - g.boardLeft) / g.slotWidth))));
    }
    if (b.y + b.r >= g.slotBottom) { b.y = g.slotBottom - b.r; b.vy = Math.abs(b.vy) < 22 ? 0 : -Math.abs(b.vy) * 0.25; b.vx *= 0.75; b.groundFrames += 1; }
  },

  simulateStep(dt) { this.ball.roundFrames += 1; this.ball.phase === 'launcher' ? this.simulateLauncher(dt) : this.simulateBoard(dt); },
  resolvePass(slot) {
    this.roundResolved = true;
    if (this.litSlots.has(slot)) {
      const reward = this.data.wager * this.data.multiplier;
      const diamondReward = Math.floor(reward / 50);
      this.pendingResult = { won: true, reward, diamondReward, slot };
      this.setData({ marbles: this.data.marbles + reward, diamonds: this.data.diamonds + diamondReward }, () => this.saveProgress());
    } else this.pendingResult = { won: false, reward: 0, slot };
  },
  finishRoundIfNeeded() {
    if (this.roundEnding || !this.ball || !this.data.isRunning) return;
    if (this.ball.groundFrames >= 10 || this.ball.roundFrames >= 720) {
      this.roundEnding = true;
      if (this.frameTimer) { clearTimeout(this.frameTimer); this.frameTimer = null; }
      const result = this.pendingResult || { won: false, reward: 0 };
      this.setData({ isRunning: false, stage: 'result', power: 0, showResult: false, resultAmount: result.reward, resultDiamonds: result.diamondReward || 0, resultType: result.won ? 'win' : 'lose' }, () => {
        wx.nextTick(() => this.showResultDialog(result));
      });
    }
  },
  showResultDialog(result) {
    if (this.resultDialogOpen) return;
    this.resultDialogOpen = true;
    wx.showModal({
      title: result.won ? '恭喜你' : '很遗憾',
      content: result.won ? `获得 ${result.reward} 颗弹珠${result.diamondReward ? `\n额外获得 ${result.diamondReward} 颗钻石` : ''}` : '再试一次吧',
      showCancel: false,
      confirmText: '确定',
      complete: () => {
        this.resultDialogOpen = false;
        this.closeResult();
      }
    });
  },
  closeResult() {
    if (this.closeResultBusy) return;
    this.closeResultBusy = true;
    if (this.frameTimer) { clearTimeout(this.frameTimer); this.frameTimer = null; }
    this.ball = null; this.pendingResult = null; this.roundResolved = false;
    this.setData({ showResult: false, stage: 'setup', multiplier: 2, litCount: 5, resultAmount: 0, resultDiamonds: 0, resultType: '' }, () => {
      wx.nextTick(() => {
        this.canvas = null;
        this.ctx = null;
        this.geometry = null;
        this.pegs = [];
        this.roundEnding = false;
        this.closeResultBusy = false;
        this.initCanvas();
      });
    });
  },
  loop() {
    if (this.destroyed || !this.canvas || !this.data.isRunning) { this.frameTimer = null; return; }
    if (!this.ball) { this.frameTimer = null; return; }
    this.simulateStep(1 / 30);
    if (!this.ball || !this.data.isRunning) { this.frameTimer = null; return; }
    this.finishRoundIfNeeded(); this.draw();
    this.frameTimer = this.data.isRunning ? setTimeout(() => this.loop(), 1000 / 30) : null;
  },

  drawTrack(ctx) {
    const g = this.geometry;
    ctx.strokeStyle = '#3a414b'; ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(g.trackX, g.slotBottom - 5); ctx.lineTo(g.trackX, g.trackTop + 22);
    ctx.arc(g.trackX - 22, g.trackTop + 22, 22, 0, -Math.PI / 2, true); ctx.lineTo(g.boardRight - 16, g.trackTop); ctx.stroke();
    ctx.strokeStyle = '#77808b'; ctx.lineWidth = 1.5; ctx.stroke();
    const compression = this.data.isCharging ? 10 + this.data.power * 0.22 : (this.data.isRunning ? 8 : 15);
    const rodY = g.slotBottom - 3 - compression;
    ctx.strokeStyle = '#ffd35a'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 8; i += 1) { const x = g.trackX + (i % 2 ? 5 : -5), y = rodY - i * 3.2; i ? ctx.lineTo(x, y) : ctx.moveTo(g.trackX, y); }
    ctx.stroke();
    ctx.strokeStyle = '#c72d35'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(g.trackX, rodY); ctx.lineTo(g.trackX, g.slotBottom + 2); ctx.stroke();
    ctx.fillStyle = '#ef3e48'; ctx.fillRect(g.trackX - 10, rodY - 3, 20, 7);
  },

  drawBall(ctx) {
    const skin = MARBLE_SKINS.find((item) => item.id === this.data.equippedSkin) || MARBLE_SKINS[0];
    const b = this.ball;
    if (skin.trail && b.phase === 'board') {
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
      const length = Math.min(38, 12 + speed * 0.035);
      const tx = b.x - (b.vx / speed) * length, ty = b.y - (b.vy / speed) * length;
      const trail = ctx.createLinearGradient(tx, ty, b.x, b.y);
      trail.addColorStop(0, 'rgba(0,0,0,0)'); trail.addColorStop(1, skin.trail);
      ctx.strokeStyle = trail; ctx.lineWidth = b.r * 1.35; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const glow = ctx.createRadialGradient(b.x - 2, b.y - 2, 1, b.x, b.y, 9);
    glow.addColorStop(0, skin.glow); glow.addColorStop(.45, skin.color); glow.addColorStop(1, skin.edge);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = skin.trail || '#ffd35a'; ctx.lineWidth = 1; ctx.stroke();
  },

  draw() {
    if (!this.ctx || !this.geometry) return;
    const ctx = this.ctx, g = this.geometry;
    const theme = BACKGROUNDS.find((item) => item.id === this.data.equippedBackground) || BACKGROUNDS[0];
    ctx.clearRect(0, 0, this.width, this.height); ctx.fillStyle = theme.canvas; ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = theme.board; ctx.fillRect(g.boardLeft, g.gridTop - 12, g.boardRight - g.boardLeft, g.gridBottom - g.gridTop + 24);
    ctx.strokeStyle = theme.line; ctx.lineWidth = 1; ctx.strokeRect(g.boardLeft, g.gridTop - 12, g.boardRight - g.boardLeft, g.gridBottom - g.gridTop + 24);
    this.drawTrack(ctx);
    this.pegs.forEach((p) => {
      if (p.boost) { ctx.strokeStyle = 'rgba(93,226,165,.75)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = 'rgba(93,226,165,.22)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 8, 0, Math.PI * 2); ctx.stroke(); }
      if (p.dampener) { ctx.strokeStyle = 'rgba(91,169,255,.38)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = p.boost ? '#9cf2ca' : (p.dampener ? '#5ba9ff' : '#626c77'); ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#d8e1e6'; ctx.beginPath(); ctx.arc(p.x - 1, p.y - 1, 1, 0, Math.PI * 2); ctx.fill();
    });
    for (let i = 0; i < SLOT_COUNT; i += 1) {
      const x = g.boardLeft + i * g.slotWidth, center = x + g.slotWidth / 2, lit = this.litSlots && this.litSlots.has(i);
      if (lit) { const glow = ctx.createRadialGradient(center, g.slotTop, 2, center, g.slotTop, g.slotWidth * .7); glow.addColorStop(0, 'rgba(255,211,90,.95)'); glow.addColorStop(1, 'rgba(255,211,90,0)'); ctx.fillStyle = glow; ctx.fillRect(x, g.slotTop - g.slotWidth * .7, g.slotWidth, g.slotWidth * 1.4); }
      ctx.fillStyle = lit ? '#ffd35a' : '#39414b'; ctx.fillRect(x + 3, g.slotTop - 3, g.slotWidth - 6, 5);
      ctx.strokeStyle = '#343c46'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, g.slotTop - 18); ctx.lineTo(x, g.slotBottom); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(g.boardRight, g.slotTop - 18); ctx.lineTo(g.boardRight, g.slotBottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(g.boardLeft, g.slotBottom); ctx.lineTo(g.boardRight, g.slotBottom); ctx.stroke();
    if (this.ball) this.drawBall(ctx);
  }
});
