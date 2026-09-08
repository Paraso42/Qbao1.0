const SKINS = [
  { id: 'silver', name: '经典银', price: 0, color: '#dfe5e8', edge: '#7f8a93', glow: '#ffffff', trail: '' },
  { id: 'ocean', name: '深海蓝', price: 1500, color: '#4db8ff', edge: '#176aa8', glow: '#dff5ff', trail: '' },
  { id: 'ruby', name: '赤焰红', price: 1500, color: '#ff5964', edge: '#a51f35', glow: '#ffe1df', trail: '' },
  { id: 'gold', name: '鎏金', price: 3000, color: '#ffd35a', edge: '#a66c00', glow: '#fff4bd', trail: '' },
  { id: 'comet', name: '紫电彗星', price: 8000, color: '#b57cff', edge: '#6136a8', glow: '#f0ddff', trail: '#9f63ff' },
  { id: 'aurora', name: '极光', price: 8000, color: '#61f2c2', edge: '#177f6a', glow: '#e2fff7', trail: '#5de2ff' }
];

Page({
  data: { marbles: 0, equippedSkin: 'silver', ownedCount: 1, items: [] },
  onLoad() { this.loadProgress(); },
  onShow() { this.loadProgress(); },
  loadProgress() {
    const saved = wx.getStorageSync('galtonProgress') || {};
    const owned = Array.isArray(saved.ownedSkins) ? saved.ownedSkins : ['silver'];
    if (!owned.includes('silver')) owned.unshift('silver');
    this.ownedSkins = new Set(owned);
    const equippedSkin = this.ownedSkins.has(saved.equippedSkin) ? saved.equippedSkin : 'silver';
    this.setData({ marbles: Number.isFinite(saved.marbles) ? saved.marbles : 1000, equippedSkin, ownedCount: this.ownedSkins.size, items: this.buildItems(equippedSkin) });
  },
  buildItems(equipped) {
    return SKINS.map((item) => ({ ...item, owned: this.ownedSkins.has(item.id), equipped: equipped === item.id }));
  },
  selectSkin(event) {
    const id = event.currentTarget.dataset.id;
    const skin = SKINS.find((item) => item.id === id);
    if (!skin || id === this.data.equippedSkin) return;
    let marbles = this.data.marbles;
    const purchased = !this.ownedSkins.has(id);
    if (purchased) {
      if (marbles < skin.price) { wx.showToast({ title: '弹珠不足', icon: 'none' }); return; }
      marbles -= skin.price;
      this.ownedSkins.add(id);
    }
    const items = this.buildItems(id);
    this.setData({ marbles, equippedSkin: id, ownedCount: this.ownedSkins.size, items });
    wx.setStorageSync('galtonProgress', { marbles, ownedSkins: Array.from(this.ownedSkins), equippedSkin: id });
    wx.showToast({ title: purchased ? '购买并装备' : '已装备', icon: 'success' });
  }
});
