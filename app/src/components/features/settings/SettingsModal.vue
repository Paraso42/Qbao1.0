<!-- 设置弹窗：个性化 + AI 配置 + 桌面端（自 legacy settings.js 迁移，DeepSeek 风格重设计；v3.35 版本历史/自助回退） -->
<template>
  <Modal :open="ui.settingsOpen" wide full @close="ui.closeSettings">
    <div class="sm-body">
      <nav class="sm-nav">
        <div class="sm-nav-title">设置</div>
        <div class="sm-nav-item" :class="{ active: activeTab === 'personalize' }" @click="ui.setSettingsTab('personalize')"><Icon name="settings" :size="15" />个性化</div>
        <div class="sm-nav-item" :class="{ active: activeTab === 'aiconfig' }" @click="ui.setSettingsTab('aiconfig')"><Icon name="sparkle" :size="15" />AI 配置</div>
        <!-- 桌面端：桌面环境=应用信息/检查更新/回退；网页环境=国内镜像下载（v3.35 manifest-first） -->
        <div class="sm-nav-item" :class="{ active: activeTab === 'desktop' }" @click="ui.setSettingsTab('desktop')"><Icon name="download" :size="15" />{{ isDesktop ? '桌面端' : '下载中心' }}</div>
      </nav>

      <div class="sm-content">
        <!-- 个性化 -->
        <section v-if="activeTab === 'personalize'" class="sm-tab">
          <div class="card">
            <div class="settings-section">
              <h4>边栏</h4>
              <div class="settings-row">
                <label>边栏字体大小</label>
                <input type="range" min="11" max="16" step="1" :value="settings.sidebarFontSize" @input="onFont('sidebarFontSize', $event)" @change="data.saveState()">
                <span class="settings-val">{{ settings.sidebarFontSize }}px</span>
              </div>
              <div class="font-preview" :style="{ fontSize: settings.sidebarFontSize + 'px' }"><strong>科目名称</strong><span>章节 1.1 — 3 题</span></div>
            </div>
            <div class="settings-section">
              <h4>顶栏</h4>
              <div class="settings-row">
                <label>顶栏字体大小</label>
                <input type="range" min="11" max="18" step="1" :value="settings.topbarFontSize" @input="onFont('topbarFontSize', $event)" @change="data.saveState()">
                <span class="settings-val">{{ settings.topbarFontSize }}px</span>
              </div>
            </div>
            <div class="settings-section">
              <h4>主页区域</h4>
              <div class="settings-row">
                <label>主页字体大小</label>
                <input type="range" min="15" max="22" step="1" :value="settings.mainFontSize" @input="onFont('mainFontSize', $event)" @change="data.saveState()">
                <span class="settings-val">{{ settings.mainFontSize }}px</span>
              </div>
            </div>
            <div class="settings-section">
              <h4>答题区域</h4>
              <div class="settings-row">
                <label>题目字体大小</label>
                <input type="range" min="14" max="28" step="1" :value="settings.quizFontSize" @input="onFont('quizFontSize', $event)" @change="data.saveState()">
                <span class="settings-val">{{ settings.quizFontSize }}px</span>
              </div>
            </div>
            <div class="settings-section">
              <h4>外观</h4>
              <div class="settings-row">
                <label>夜间模式</label>
                <Toggle v-model="darkMode" @change="saveSettings" />
              </div>
              <div class="settings-row">
                <label>消息提醒</label>
                <Toggle v-model="showNoticeBar" @change="saveSettings" />
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-row">
                <label>恢复默认</label>
                <button class="btn btn-secondary btn-small" @click="resetDefaults">恢复默认设置</button>
              </div>
            </div>
          </div>
        </section>

        <!-- AI 配置（P2.2 拆分：AiConfigSection） -->
        <AiConfigSection v-else-if="activeTab === 'aiconfig'" ref="aiCfgRef" />

        <!-- 桌面端 -->
        <section v-else-if="activeTab === 'desktop'" class="sm-tab">
          <!-- 桌面端内：应用信息 + 软件更新（检查更新保持现状，v3.35 增加进度/渠道/自动检查）+ 历史版本自助回退 -->
          <div v-if="isDesktop" class="card">
            <div class="settings-section">
              <h4>应用信息</h4>
              <div class="settings-row"><label>当前版本</label><span class="row-val">v{{ desktopInfo.version || '?' }}</span></div>
              <div class="settings-row"><label>服务器地址</label><span class="row-val break">{{ desktopInfo.apiBase || '未配置' }}</span></div>
              <div class="settings-row">
                <label>开机自启</label>
                <span class="row-desc">登录系统时启动 Qbao</span>
                <Toggle :model-value="desktopInfo.autoStart" @change="toggleAutoStart" />
              </div>
              <div class="settings-row">
                <label>服务器设置</label>
                <button class="btn btn-secondary btn-small" @click="showServerSetup">修改服务器地址</button>
              </div>
            </div>
            <div class="settings-section">
              <h4>软件更新</h4>
              <div class="settings-row">
                <label>自动检查</label>
                <span class="row-desc">启动后每 6 小时自动检查新版本</span>
                <Toggle :model-value="desktopInfo.autoCheck !== false" @change="setAutoCheck" />
              </div>
              <div class="settings-row">
                <label>更新渠道</label>
                <span class="row-val">{{ updateInfo.channel === 'beta' ? '测试版（beta）' : '稳定版（stable）' }}</span>
              </div>
              <div v-if="updateInfo.feedUrl" class="settings-row">
                <label>更新源</label>
                <span class="row-val break upd-feed">{{ updateInfo.feedUrl }}</span>
              </div>
              <div class="ai-status" :class="'ai-status-' + updateState">{{ updateMessage }}</div>
              <div v-if="updateState === 'progress'" class="upd-track-wrap">
                <div class="upd-track"><div class="upd-progress-bar" :style="{ width: (updatePercent || 0) + '%' }"></div></div>
                <span class="upd-percent">{{ updatePercent || 0 }}%</span>
              </div>
              <div class="ai-actions">
                <button class="btn btn-primary btn-small" :disabled="updateChecking" @click="checkUpdates">检查更新</button>
              </div>
              <p class="ai-help-note">普通版本更新始终由你确认；仅当服务器不再兼容旧版（安全/数据迁移等）时才出现强制更新提示。</p>
            </div>
            <div class="settings-section">
              <h4>历史版本（自助回退）</h4>
              <p class="col-hint">发现当前版本异常时，可自行下载任意旧版覆盖安装（不丢失数据），并可向管理员反馈问题。</p>
              <div v-if="rollback.active" class="upd-track-wrap">
                <div class="upd-track"><div class="upd-progress-bar" :style="{ width: rollback.percent + '%' }"></div></div>
                <span class="upd-percent">{{ rollback.percent }}%</span>
              </div>
              <div class="dl-list">
                <div v-for="r in desktopReleases" :key="r.version" class="dl-row">
                  <div class="dl-row-main">
                    <span class="dl-ver">v{{ r.version }}</span>
                    <span class="ver-badge" :class="verBadgeClass(r)">{{ verBadgeText(r) }}</span>
                  </div>
                  <div class="dl-row-sub">{{ r.sizeText }} · {{ r.dateText }}<span v-if="dlStatsMap[r.version]" class="dl-count">下载 {{ dlStatsMap[r.version] }} 次</span></div>
                  <div class="dl-row-actions">
                    <button class="btn btn-secondary btn-small" :disabled="!r.sha256" @click="copySha(r.sha256)">SHA256</button>
                    <button class="btn btn-primary btn-small" :disabled="!canDownload(r) || rollback.active" @click="downloadVersionClick(r)">{{ r.version === desktopInfo.version ? '重装此版本' : '下载此版本' }}</button>
                  </div>
                </div>
                <div v-if="desktopReleases.length === 0" class="dl-empty">暂无版本信息（{{ dlMsg }}）</div>
              </div>
              <div class="ai-actions">
                <button class="btn btn-secondary btn-small" :disabled="desktopListLoading" @click="loadDesktopVersions">刷新版本列表</button>
                <button class="btn btn-secondary btn-small" @click="openIssuesPanel">遇到问题？向管理员反馈</button>
              </div>
            </div>
          </div>
          <!-- 下载中心（网页环境）：Windows / Android / iOS 多端分发，自动识别当前设备 -->
          <div v-else class="card">
            <div class="settings-section">
              <h4>Qbao 应用下载 <span class="ver-badge b-latest">多端分发</span></h4>
              <p class="col-hint">Windows、Android 与 iOS 客户端与网页版账号数据云端同步。安装包由本站服务器直接分发（国内镜像），已自动识别您当前使用的设备类型。</p>
              <div class="plat-tabs" role="tablist">
                <button v-for="p in dlTabs" :key="p.id" type="button" class="plat-tab" :class="{ active: activeDl === p.id }" @click="switchDl(p.id)">
                  {{ p.label }}<span v-if="p.id === detectedDl" class="plat-cur">本机</span>
                </button>
              </div>
              <div v-if="cur.loading" class="dl-loading">正在获取下载信息…</div>
            </div>

            <!-- Windows 桌面版 -->
            <template v-if="activeDl === 'windows'">
              <div v-if="cur.published" class="settings-section">
                <h4>桌面版应用 <span class="ver-badge b-latest">稳定版渠道</span></h4>
                <p class="col-hint">电脑端独立窗口、开机自启、自动更新；账号数据与网页版云端同步。</p>
                <div class="settings-row"><label>最新版本</label><span class="row-val">{{ cur.version }}</span></div>
                <div class="settings-row"><label>安装包大小</label><span class="row-val">{{ cur.sizeText }}</span></div>
                <div class="settings-row"><label>更新日期</label><span class="row-val">{{ cur.dateText }}</span></div>
                <div class="ai-status" :class="'ai-status-' + cur.state">{{ cur.message }}</div>
                <div class="ai-actions">
                  <button class="btn btn-primary btn-small" :disabled="!cur.ready" @click="startWinDownload"><Icon name="download" :size="13" /> 下载桌面版</button>
                  <button class="btn btn-secondary btn-small" :disabled="cur.loading" @click="loadDlCenter">刷新</button>
                  <button class="btn btn-secondary btn-small" @click="openDownloadPage">查看下载页</button>
                </div>
              </div>
              <div v-else class="settings-section">
                <div class="ai-status" :class="'ai-status-' + cur.state">{{ cur.message }}</div>
              </div>
              <div v-if="cur.published" class="settings-section">
                <h4>版本历史（可自行选择旧版）</h4>
                <div class="dl-list">
                  <div v-for="r in cur.releases" :key="r.version" class="dl-row">
                    <div class="dl-row-main">
                      <span class="dl-ver">v{{ r.version }}</span>
                      <span class="ver-badge" :class="verBadgeClass(r, true)">{{ verBadgeText(r, true) }}</span>
                    </div>
                    <div class="dl-row-sub">{{ r.sizeText }} · {{ r.dateText }}<span v-if="statOf(r)" class="dl-count">下载 {{ statOf(r) }} 次</span></div>
                    <div class="dl-row-actions">
                      <button class="btn btn-secondary btn-small" :disabled="!r.sha256" @click="copySha(r.sha256)">SHA256</button>
                      <a v-if="canDownload(r)" class="btn btn-primary btn-small dl-a" :href="dlUrl(r.fileName)">下载</a>
                      <button v-else class="btn btn-secondary btn-small" disabled>{{ r.retracted ? '已撤回' : '不可用' }}</button>
                    </div>
                  </div>
                  <div v-if="cur.releases.length === 0" class="dl-empty">暂无版本信息</div>
                </div>
              </div>
              <div v-if="cur.betaReleases && cur.betaReleases.length" class="settings-section">
                <h4>内测版（可选）<span class="ver-badge b-old">Beta</span></h4>
                <p class="col-hint">Windows 内测包用于提前体验新功能与参与反馈。安装后在应用内「设置 → 桌面端」把服务器地址填写为内测网址，即可连接内测环境（数据与正式版隔离）；测试包更新走 beta 渠道，需手动「检查更新」。</p>
                <div class="dl-list">
                  <div v-for="r in cur.betaReleases" :key="r.version" class="dl-row">
                    <div class="dl-row-main">
                      <span class="dl-ver">v{{ r.version }}</span>
                      <span class="ver-badge" :class="r.betaMark === '内测最新' ? 'b-latest' : 'b-old'">{{ r.betaMark }}</span>
                    </div>
                    <div class="dl-row-sub">{{ r.sizeText }} · {{ r.dateText }}</div>
                    <div class="dl-row-actions">
                      <button class="btn btn-secondary btn-small" :disabled="!r.sha256" @click="copySha(r.sha256)">SHA256</button>
                      <a class="btn btn-primary btn-small dl-a" :href="dlUrl(r.fileName)">下载内测版</a>
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="cur.published" class="settings-section">
                <h4>安全校验（SHA256）</h4>
                <div class="sha-row">
                  <code class="sha-code">{{ cur.sha256 || '—' }}</code>
                  <button class="btn btn-secondary btn-small" :disabled="!cur.sha256" @click="copySha(cur.sha256)">复制</button>
                </div>
                <p class="ai-help-note">下载后可用校验值核对文件完整性。已安装旧版桌面端的用户，请在客户端「设置 → 桌面端」点击「检查更新」升级到最新版，无需重复下载；如新版本异常，也可在本页或下载页选择任意旧版覆盖安装。</p>
              </div>
            </template>

            <!-- Android -->
            <template v-else-if="activeDl === 'android'">
              <div v-if="cur.published" class="settings-section">
                <h4>Android 应用 <span class="ver-badge b-latest">{{ cur.version }}</span></h4>
                <p class="col-hint">安卓手机 / 平板安装包（APK，Android 5.1 及以上）。安装时如提示「未知来源」请允许；本页与网页版数据云端同步，登录后多端一致。</p>
                <div class="settings-row"><label>最新版本</label><span class="row-val">{{ cur.version }}</span></div>
                <div class="settings-row"><label>安装包大小</label><span class="row-val">{{ cur.sizeText }}</span></div>
                <div class="settings-row"><label>更新日期</label><span class="row-val">{{ cur.dateText }}</span></div>
                <div class="ai-status" :class="'ai-status-' + cur.state">{{ cur.message }}</div>
                <div class="ai-actions">
                  <a v-if="cur.fileName" class="btn btn-primary btn-small dl-a" :href="appsDlUrl('android', cur.fileName)"><Icon name="download" :size="13" /> 下载 APK</a>
                  <button class="btn btn-secondary btn-small" :disabled="cur.loading" @click="loadDlCenter">刷新</button>
                </div>
              </div>
              <div v-else class="settings-section">
                <h4>Android 应用</h4>
                <div class="ai-status" :class="'ai-status-' + cur.state">{{ cur.message }}</div>
              </div>
              <div v-if="cur.published" class="settings-section">
                <h4>版本历史</h4>
                <div class="dl-list">
                  <div v-for="r in cur.releases" :key="r.version" class="dl-row">
                    <div class="dl-row-main">
                      <span class="dl-ver">v{{ r.version }}</span>
                      <span class="ver-badge" :class="verBadgeClass(r, true)">{{ verBadgeText(r, true) }}</span>
                    </div>
                    <div class="dl-row-sub">{{ r.sizeText }} · {{ r.dateText }}<span v-if="statOf(r)" class="dl-count">下载 {{ statOf(r) }} 次</span></div>
                    <div class="dl-row-actions">
                      <button class="btn btn-secondary btn-small" :disabled="!r.sha256" @click="copySha(r.sha256)">SHA256</button>
                      <a v-if="canDownload(r)" class="btn btn-primary btn-small dl-a" :href="appsDlUrl('android', r.fileName)">下载</a>
                      <button v-else class="btn btn-secondary btn-small" disabled>{{ r.retracted ? '已撤回' : '不可用' }}</button>
                    </div>
                  </div>
                  <div v-if="cur.releases.length === 0" class="dl-empty">暂无版本信息</div>
                </div>
                <p class="ai-help-note">升级安装包请保留并重复使用同一次下载来源（正式签名不变），覆盖安装不会影响数据。</p>
              </div>
              <div v-if="cur.betaReleases && cur.betaReleases.length" class="settings-section">
                <h4>内测版（可选）<span class="ver-badge b-old">Beta</span></h4>
                <p class="col-hint">内测版是独立的「内测版应用」（应用标识与正式版不同，可共存安装、互不影响），连接独立的内测环境以提前体验新功能与参与反馈；其账号数据与正式版不互通，日常使用请安装正式版。</p>
                <div class="dl-list">
                  <div v-for="r in cur.betaReleases" :key="r.version" class="dl-row">
                    <div class="dl-row-main">
                      <span class="dl-ver">v{{ r.version }}</span>
                      <span class="ver-badge" :class="r.betaMark === '内测最新' ? 'b-latest' : 'b-old'">{{ r.betaMark }}</span>
                    </div>
                    <div class="dl-row-sub">{{ r.sizeText }} · {{ r.dateText }}<span v-if="statOf(r)" class="dl-count">下载 {{ statOf(r) }} 次</span></div>
                    <div class="dl-row-actions">
                      <button class="btn btn-secondary btn-small" :disabled="!r.sha256" @click="copySha(r.sha256)">SHA256</button>
                      <a class="btn btn-primary btn-small dl-a" :href="appsDlUrl('android', r.fileName)">下载内测版</a>
                    </div>
                  </div>
                </div>
                <p class="ai-help-note">安装说明：下载后直接安装即可（图标/名称带「内测」，与正式版并存）；若曾安装过更早的内测版，覆盖安装不会影响其数据。正式版与本页内测版互不覆盖。</p>
              </div>
            </template>

            <!-- iOS -->
            <template v-else-if="activeDl === 'ios'">
              <div v-if="cur.published" class="settings-section">
                <h4>iOS 应用 <span class="ver-badge b-latest">{{ cur.version }}</span></h4>
                <p class="col-hint">iPhone / iPad 安装包（.ipa，需 Apple 签名安装）。</p>
                <div class="settings-row"><label>最新版本</label><span class="row-val">{{ cur.version }}</span></div>
                <div class="settings-row"><label>安装包大小</label><span class="row-val">{{ cur.sizeText }}</span></div>
                <div class="settings-row"><label>更新日期</label><span class="row-val">{{ cur.dateText }}</span></div>
                <div class="ai-status" :class="'ai-status-' + cur.state">{{ cur.message }}</div>
                <div class="ai-actions">
                  <a v-if="cur.fileName" class="btn btn-primary btn-small dl-a" :href="appsDlUrl('ios', cur.fileName)"><Icon name="download" :size="13" /> 下载 iOS 包</a>
                  <button class="btn btn-secondary btn-small" :disabled="cur.loading" @click="loadDlCenter">刷新</button>
                </div>
              </div>
              <div v-else class="settings-section">
                <h4>iOS 应用</h4>
                <p class="col-hint">iOS 安装包需在 macOS 上使用 Xcode 签名出包（需 Apple Developer 账号），当前尚未发布。iPhone / iPad 用户可先用 Safari 打开本站，通过「分享 → 添加到主屏幕」获得全屏入口；正式版发布后此处将自动出现可下载版本。</p>
                <div class="ai-status ai-status-info">{{ cur.message }}</div>
              </div>
              <div v-if="cur.published && cur.releases.length" class="settings-section">
                <h4>版本历史</h4>
                <div class="dl-list">
                  <div v-for="r in cur.releases" :key="r.version" class="dl-row">
                    <div class="dl-row-main">
                      <span class="dl-ver">v{{ r.version }}</span>
                      <span class="ver-badge" :class="verBadgeClass(r, true)">{{ verBadgeText(r, true) }}</span>
                    </div>
                    <div class="dl-row-sub">{{ r.sizeText }} · {{ r.dateText }}<span v-if="statOf(r)" class="dl-count">下载 {{ statOf(r) }} 次</span></div>
                    <div class="dl-row-actions">
                      <button class="btn btn-secondary btn-small" :disabled="!r.sha256" @click="copySha(r.sha256)">SHA256</button>
                      <a v-if="canDownload(r)" class="btn btn-primary btn-small dl-a" :href="appsDlUrl('ios', r.fileName)">下载</a>
                      <button v-else class="btn btn-secondary btn-small" disabled>{{ r.retracted ? '已撤回' : '不可用' }}</button>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </section>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useUiStore } from '../../../stores/ui'
import { useDataStore } from '../../../stores/data'
import { useIssuesStore } from '../../../stores/issues'
import { IS_DESKTOP, desktopBridge, API_BASE } from '../../../core/env'
import { fetchDesktopManifest, fetchDesktopStats, fetchAppsManifest, fetchAppsStats, appsDownloadUrl, parseReleases, formatSize, formatDate } from '../../../services/desktopRelease'
import { applyFontSizes } from '../../../core/fontSizes'
import Modal from '../../ui/Modal.vue'
import Icon from '../../ui/Icon.vue'
import Toggle from '../../ui/Toggle.vue'
import AiConfigSection from './AiConfigSection.vue'

const ui = useUiStore()
const data = useDataStore()
const issuesStore = useIssuesStore()
const aiCfgRef = ref(null)

const settings = computed(() => data.state.settings)
// 打开即渲染：任何未知 tab 都回退到「个性化」，保证设置弹窗永不空白
const activeTab = computed(() => (['personalize', 'aiconfig', 'desktop'].includes(ui.settingsTab) ? ui.settingsTab : 'personalize'))

// 个性化
const darkMode = computed({
  get: () => settings.value.darkMode,
  set: (v) => { settings.value.darkMode = v }
})
const showNoticeBar = computed({
  get: () => settings.value.showNoticeBar !== false,
  set: (v) => { settings.value.showNoticeBar = v }
})
function onFont(key, e) {
  settings.value[key] = parseInt(e.target.value) || 17
  applyFontSizes(settings.value)
}
function saveSettings() {
  data.saveState()
  applyFontSizes(settings.value)
}
async function resetDefaults() {
  const ok = await ui.openConfirm('恢复默认设置', '字体大小、外观与提醒将恢复为默认值，AI 配置不受影响。确定继续？', '恢复')
  if (!ok) return
  data.state.settings = { quizFontSize: 17, sidebarFontSize: 13, topbarFontSize: 14, mainFontSize: 17, darkMode: false, showNoticeBar: true }
  saveSettings()
  ui.toast('已恢复默认设置', 'ok')
}

// 桌面端
const isDesktop = ref(IS_DESKTOP)
const desktopInfo = ref({ version: '', apiBase: '', serverLabel: '', autoStart: false, autoCheck: true })
const updateInfo = ref({ feedUrl: '', channel: 'stable', autoCheck: true })
const updateState = ref('idle')
const updateMessage = ref('启动应用后会自动检查更新；有新版本时会提示下载。')
const updateChecking = ref(false)
const updatePercent = ref(0)

// 下载中心（网页环境，多端分发）：windows/android/ios 各自独立状态，UA 自动推荐当前设备
const dlTabs = [
  { id: 'windows', label: 'Windows' },
  { id: 'android', label: 'Android' },
  { id: 'ios', label: 'iOS' }
]
function detectDlPlatform() {
  if (typeof navigator === 'undefined') return 'windows'
  const ua = String(navigator.userAgent || '')
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  return 'windows'
}
const detectedDl = ref(detectDlPlatform())
const activeDl = ref(detectDlPlatform())
function emptyDl() {
  return { state: 'info', message: '正在获取下载信息…', loading: false, ready: false, published: false, version: '—', sizeText: '—', dateText: '—', sha256: '', fileName: '', releases: [], betaReleases: [] }
}
const dls = ref({ windows: emptyDl(), android: emptyDl(), ios: emptyDl() })
const winStats = ref({})   // windows：version → 下载次数
const appsStats = ref({})  // android/ios：fileName → 下载次数
const cur = computed(() => dls.value[activeDl.value] || emptyDl())
function statOf(r) {
  if (!r) return 0
  const map = activeDl.value === 'windows' ? winStats.value : appsStats.value
  const key = activeDl.value === 'windows' ? r.version : r.fileName
  return map[key] || 0
}
const dlStatsMap = ref({})
const desktopReleases = ref([])
const dlMsg = ref('')
const desktopListLoading = ref(false)
const rollback = ref({ active: false, percent: 0 })

function buildStatsMap(j) {
  const m = {}
  if (j && Array.isArray(j.perVersion)) {
    for (const r of j.perVersion) m[r.version] = r.downloads
  }
  return m
}

function applyTopDl(s, top) {
  if (!top) {
    s.version = '—'; s.sizeText = '—'; s.dateText = '—'; s.sha256 = ''; s.fileName = ''
    return
  }
  s.version = 'v' + top.version
  s.sizeText = top.sizeText
  s.dateText = top.dateText
  s.sha256 = top.sha256 || ''
  s.fileName = top.fileName
}
async function loadDlCenter() {
  const p = activeDl.value
  const s = dls.value[p]
  if (s.loading) return
  s.loading = true
  s.state = 'info'
  s.message = '正在获取下载信息…'
  try {
    if (p === 'windows') {
      const [mani, stats, betaMani] = await Promise.all([fetchDesktopManifest(), fetchDesktopStats().catch(() => null), fetchDesktopManifest(null, 'beta').catch(() => null)])
      const releases = parseReleases(mani)
      const br = (betaMani && Array.isArray(betaMani.releases)) ? parseReleases(betaMani) : []
      br.forEach((r, i) => { r.betaMark = i === 0 ? '内测最新' : '内测版' })
      s.betaReleases = br
      winStats.value = buildStatsMap(stats)
      s.releases = releases
      const top = releases.find((r) => !r.retracted) || releases[0] || null
      applyTopDl(s, top)
      s.published = !!top
      s.message = top ? '已就绪，点击「下载桌面版」开始下载' : '暂无可用版本'
    } else {
      const [mani, stats] = await Promise.all([fetchAppsManifest(null, p), fetchAppsStats(null, p).catch(() => null)])
      const all = parseReleases(mani)
      const br = all.filter((r) => r.channel === 'beta')
      br.forEach((r, i) => { r.betaMark = i === 0 ? '内测最新' : '内测版' })
      s.betaReleases = br
      s.releases = all.filter((r) => r.channel !== 'beta')
      const m = {}
      if (stats && Array.isArray(stats.perFile)) for (const f of stats.perFile) m[f.fileName] = f.downloads
      appsStats.value = m
      const top = s.releases.find((r) => !r.retracted) || s.releases[0] || null
      applyTopDl(s, top)
      s.published = !!top
      s.message = top ? '已就绪，点击下载' + (p === 'android' ? ' APK' : ' iOS 安装包') + '开始安装' : (s.betaReleases.length ? '正式版暂未发布；下方「内测版」可先体验（数据与正式版隔离）' : '该平台暂无可下载版本')
    }
    s.ready = true
    s.state = 'ok'
  } catch (e) {
    s.ready = false
    s.published = false
    s.state = 'info'
    const is404 = !!(e && /HTTP 404/.test(String(e.message || '')))
    s.message = is404
      ? (p === 'ios' ? 'iOS 安装包尚未发布（需 macOS + Apple Developer 签名出包）' : '该平台安装包暂未发布，请稍后再试')
      : '获取下载信息失败（' + ((e && e.message) || '网络错误') + '），请重试'
  } finally {
    s.loading = false
  }
}
function switchDl(id) {
  if (!dlTabs.some((p) => p.id === id)) return
  activeDl.value = id
  const s = dls.value[id]
  if (!s.ready && !s.loading) loadDlCenter()
}
function appsDlUrl(platform, fileName) {
  return appsDownloadUrl(platform, fileName)
}

// 桌面端：历史版本列表（manifest 直连当前服务器）
async function loadDesktopVersions() {
  desktopListLoading.value = true
  dlMsg.value = '加载中…'
  try {
    const [mani, stats] = await Promise.all([
      fetchDesktopManifest(),
      fetchDesktopStats().catch(() => null),
    ])
    desktopReleases.value = parseReleases(mani)
    dlStatsMap.value = buildStatsMap(stats)
    dlMsg.value = '无可用版本'
  } catch (e) {
    desktopReleases.value = []
    dlMsg.value = '获取失败（' + ((e && e.message) || '网络错误') + '）'
  } finally {
    desktopListLoading.value = false
  }
}

function verBadgeClass(r, web) {
  if (r.retracted) return 'b-retracted'
  if (r.stopped) return 'b-stopped'
  if (!web && r.version === desktopInfo.value.version) return 'b-installed'
  if (r.current) return 'b-latest'
  return 'b-old'
}
function verBadgeText(r, web) {
  if (r.retracted) return '已撤回'
  if (r.stopped) return '已停止服务'
  if (!web && r.version === desktopInfo.value.version) return '已安装'
  if (r.current) return web ? '当前最新' : '最新'
  return '旧版'
}
function canDownload(r) {
  return !!r && !r.retracted && !r.stopped
}
function dlUrl(fileName) {
  return API_BASE + '/desktop/download?file=' + encodeURIComponent(fileName)
}
function openDownloadPage() {
  const url = (typeof window !== 'undefined' && window.location ? window.location.origin : '') + '/dl'
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}
function openIssuesPanel() {
  issuesStore.panelOpen = true
}

// 桌面端：下载指定版本（主进程下载 + sha256 校验 + 唤起安装器）
async function downloadVersionClick(r) {
  const d = desktopBridge()
  if (!d || typeof d.downloadVersion !== 'function') {
    ui.toast('当前环境不支持自动下载安装包', 'err')
    return
  }
  const ok = await ui.openConfirm('下载 v' + r.version, '将下载该版本安装包并校验完整性，完成后提示运行安装程序（覆盖安装不会影响您的数据）。确定继续？', '下载')
  if (!ok) return
  rollback.value.active = true
  rollback.value.percent = 0
  try {
    const res = await d.downloadVersion({ fileName: r.fileName, version: r.version, sha256: r.sha256 })
    if (res && res.ok) {
      rollback.value.active = false
      if (r.version === desktopInfo.value.version) ui.toast('安装包已校验并启动安装器（重装完成即恢复正常）', 'ok')
      else ui.toast('安装包已校验并启动安装器，完成安装后即为 v' + r.version, 'ok')
    } else {
      rollback.value.active = false
      ui.toast('下载失败: ' + ((res && res.error) || '未知错误'), 'err')
    }
  } catch (e) {
    rollback.value.active = false
    ui.toast('下载失败: ' + ((e && e.message) || '未知错误'), 'err')
  }
}

function startWinDownload() {
  const w = dls.value.windows
  if (!w.ready || !w.fileName) return
  const a = document.createElement('a')
  a.href = API_BASE + '/desktop/download'
  a.download = w.fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  ui.toast('开始下载桌面版 ' + w.version, 'info')
}
function copySha(sha) {
  if (!sha) return
  const done = () => ui.toast('SHA256 已复制', 'ok')
  const fallback = () => {
    const ta = document.createElement('textarea')
    ta.value = sha
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy'); done() } catch (e) { ui.toast('复制失败，请手动复制', 'err') }
    ta.remove()
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(sha).then(done).catch(fallback)
  } else fallback()
}

function loadDesktopInfo() {
  const d = desktopBridge()
  if (!d || typeof d.getAppInfo !== 'function') return
  d.getAppInfo().then((info) => {
    desktopInfo.value = Object.assign({ autoCheck: true }, info || {})
  }).catch(() => {})
  if (d && typeof d.getUpdateInfo === 'function') {
    d.getUpdateInfo().then((u) => { updateInfo.value = Object.assign({ feedUrl: '', channel: 'stable', autoCheck: true }, u || {}) }).catch(() => {})
  }
}
function setAutoCheck(v) {
  const d = desktopBridge()
  if (!d || typeof d.setAutoCheck !== 'function') { ui.toast('当前环境不支持设置自动检查', 'err'); return }
  d.setAutoCheck(!!v).then((r) => {
    if (r && r.ok !== false) { desktopInfo.value.autoCheck = !!v; updateInfo.value.autoCheck = !!v; ui.toast(v ? '已开启自动检查' : '已关闭自动检查', 'ok') }
    else ui.toast('设置失败: ' + ((r && r.error) || '未知错误'), 'err')
  }).catch(() => {})
}
function toggleAutoStart(v) {
  const d = desktopBridge()
  if (!d || typeof d.setAutoStart !== 'function') return
  d.setAutoStart(!!v).then((r) => {
    if (r && r.ok !== false) { desktopInfo.value.autoStart = !!r.autoStart; ui.toast(r.autoStart ? '已开启开机自启' : '已关闭开机自启', 'ok') }
    else ui.toast('设置失败: ' + ((r && r.error) || '未知错误'), 'err')
  }).catch(() => {})
}
function checkUpdates() {
  const d = desktopBridge()
  if (!d || typeof d.checkForUpdates !== 'function') {
    updateState.value = 'err'
    updateMessage.value = '当前环境不支持自动更新'
    return
  }
  updateChecking.value = true
  updateState.value = 'info'
  updateMessage.value = '正在检查更新…'
  d.checkForUpdates().then((r) => {
    updateChecking.value = false
    if (!r) return
    if (r.error) { updateState.value = 'err'; updateMessage.value = r.error; return }
    if (!r.hasUpdate) { updateState.value = 'ok'; updateMessage.value = '已是最新版本' }
  }).catch((e) => {
    updateChecking.value = false
    updateState.value = 'err'
    updateMessage.value = (e && e.message) || '检查失败'
  })
}
// P0.5: 服务器地址改为应用内输入框（ui.openPrompt）+ toast 反馈，替代原生 prompt/alert
function showServerSetup() {
  const d = desktopBridge()
  if (!d || typeof d.setServer !== 'function') { ui.toast('当前环境不支持修改服务器地址', 'err'); return }
  ui.openPrompt('设置服务器地址（如 https://your-server.example）', 'https://').then((url) => {
    if (url == null) return
    const trimmed = String(url).trim()
    if (!/^https?:\/\//.test(trimmed)) { ui.toast('请输入完整地址，如 https://your-server.example', 'err'); return }
    d.setServer(trimmed, '服务器')
      .then((r) => {
        if (r && r.ok !== false) {
          desktopInfo.value.apiBase = trimmed
          ui.toast('服务器地址已保存，重启应用生效', 'ok')
        } else {
          ui.toast('保存失败: ' + ((r && r.error) || '未知错误'), 'err')
        }
      })
      .catch((e) => ui.toast('保存失败: ' + ((e && e.message) || '未知错误'), 'err'))
  })
}
function bindUpdateStatus() {
  const d = desktopBridge()
  if (!d || typeof d.onUpdateStatus !== 'function') return
  d.onUpdateStatus((s) => {
    if (!s) return
    if (s.state === 'checking') { updateState.value = 'info'; updateMessage.value = '正在检查更新…' }
    else if (s.state === 'progress') {
      updateState.value = 'progress'
      updatePercent.value = Math.round(s.percent || 0)
      updateMessage.value = '正在下载更新 ' + updatePercent.value + '%'
    }
    else if (s.state === 'downloaded') { updateState.value = 'ok'; updateMessage.value = '更新已下载完成，重启应用即可安装' }
    else if (s.state === 'up-to-date') { updateState.value = 'ok'; updateMessage.value = '已是最新版本' }
    else if (s.state === 'error') { updateState.value = 'err'; updateMessage.value = (s.message || '检查失败') }
  })
}
function bindRollbackProgress() {
  const d = desktopBridge()
  if (!d || typeof d.onRollbackProgress !== 'function') return
  d.onRollbackProgress((s) => {
    if (!s) return
    if (s.state === 'start') { rollback.value.active = true; rollback.value.percent = 0 }
    else if (s.state === 'progress') { rollback.value.active = true; rollback.value.percent = Math.round(s.percent || 0) }
    else if (s.state === 'done' || s.state === 'error') { rollback.value.active = false }
  })
}

watch(() => ui.settingsOpen, (open) => {
  if (open) {
    if (activeTab.value === 'aiconfig') {
      if (aiCfgRef.value) aiCfgRef.value.loadForm()
    }
    if (activeTab.value === 'desktop') { if (isDesktop.value) { loadDesktopInfo(); loadDesktopVersions() } else loadDlCenter() }
  }
})
watch(() => ui.settingsTab, (tab) => {
  if (!ui.settingsOpen) return
  if (tab === 'aiconfig') { if (aiCfgRef.value) aiCfgRef.value.loadForm() }
  if (tab === 'desktop') { if (isDesktop.value) { loadDesktopInfo(); loadDesktopVersions() } else loadDlCenter() }
})

onMounted(() => { bindUpdateStatus(); bindRollbackProgress(); applyFontSizes(settings.value) })
</script>

<style scoped>
.sm-body { display: flex; gap: 0; margin: calc(var(--space-2xl) * -1); min-height: 420px; }
.sm-nav {
  width: 180px;
  flex-shrink: 0;
  background: var(--surface-hover);
  border-right: 1px solid var(--border-light);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  padding: var(--space-lg) var(--space-sm);
}
.sm-nav-title { font-size: var(--fs-sm); color: var(--text-muted); padding: 0 var(--space-md) var(--space-sm); }
.sm-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  font-size: var(--fs-base);
  color: var(--text-secondary);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.sm-nav-item:hover { background: var(--surface-card); color: var(--text-primary); }
.sm-nav-item.active { background: var(--sidebar-active); color: var(--color-primary); font-weight: 500; box-shadow: inset 2px 0 0 var(--color-primary); }
.sm-content { flex: 1; min-width: 0; padding: var(--space-2xl); overflow-y: auto; max-height: 70vh; }
.settings-row { display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md) 0; border-bottom: 1px solid var(--border-light); }
.settings-row label:not(.toggle-switch) { min-width: 110px; font-size: var(--fs-base); color: var(--text-primary); flex-shrink: 0; }
.settings-row .toggle-switch { min-width: var(--track-width); max-width: var(--track-width); }
.settings-row input[type="range"] {
  flex: 1;
  max-width: 220px;
  -webkit-appearance: none;
  appearance: none;
  height: 22px;
  background: transparent;
  cursor: pointer;
  margin: 0;
}
/* WebKit：runnable-track 默认按拇指宽度内缩，使滑条长度=拇指实际行程 */
.settings-row input[type="range"]::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: var(--border-default);
}
.settings-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--color-primary);
  border: none;
  box-shadow: var(--shadow-sm);
}
.settings-row input[type="range"]:hover::-webkit-slider-thumb { background: var(--color-primary-hover); }
.settings-row input[type="range"]::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--border-default);
}
.settings-row input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-primary);
  border: none;
}
.settings-val { font-size: var(--fs-base); font-weight: 600; min-width: 44px; color: var(--color-primary); text-align: right; }
.row-desc { flex: 1; font-size: var(--fs-sm); color: var(--text-secondary); }
.row-desc em { color: var(--text-muted); font-style: normal; font-size: var(--fs-xs); }
.row-val { color: var(--text-secondary); font-size: var(--fs-base); }
.row-val.break { word-break: break-all; }
.font-preview { display: flex; align-items: baseline; gap: 10px; margin-top: 6px; padding: 6px 12px; background: var(--surface-hover); border-radius: var(--radius-md); border-left: 3px solid var(--color-primary); color: var(--text-secondary); }
.ai-desc { color: var(--text-secondary); font-size: var(--fs-sm); margin-bottom: var(--space-sm); }
.ai-provider-meta { margin: var(--space-sm) 0; }
.ai-meta-row { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-sm); }
.ai-meta-label { font-size: var(--fs-xs); color: var(--text-muted); min-width: 56px; }
.ai-meta-url { font-size: var(--fs-xs); color: var(--text-secondary); background: var(--surface-hover); padding: 2px 8px; border-radius: var(--radius-sm); word-break: break-all; }
.cap-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.key-row { display: flex; gap: 6px; flex: 1; }
.key-input { flex: 1; }
.settings-col { padding: var(--space-md) 0; border-bottom: 1px solid var(--border-light); }
.col-label { font-size: var(--fs-base); display: block; margin-bottom: 4px; }
.col-hint { color: var(--text-muted); font-size: var(--fs-xs); margin-bottom: 8px; }
.ai-actions { display: flex; gap: var(--space-sm); margin-top: var(--space-lg); }
.ai-status { margin-top: var(--space-sm); font-size: var(--fs-sm); color: var(--text-muted); }
.ai-status-ok { color: var(--color-success); }
.ai-status-err { color: var(--color-danger); }
.ai-status-info { color: var(--color-primary); }
.sha-row { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-md) 0; border-bottom: 1px solid var(--border-light); }
.sha-code { flex: 1; min-width: 0; font-family: ui-monospace, Consolas, monospace; font-size: var(--fs-xs); color: var(--text-secondary); background: var(--surface-hover); padding: 6px 10px; border-radius: var(--radius-sm); word-break: break-all; }
.ai-help { font-size: var(--fs-sm); color: var(--text-secondary); line-height: 1.9; }
.ai-help-note { margin-top: 8px; color: var(--text-muted); font-size: var(--fs-xs); }
.dl-list { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.dl-row { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; padding: 10px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-md); flex-wrap: wrap; }
.dl-row-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dl-ver { font-weight: 600; font-size: var(--fs-base); }
.dl-row-sub { font-size: var(--fs-xs); color: var(--text-muted); width: 100%; }
.dl-count { color: var(--color-primary); margin-left: 10px; }
.dl-row-actions { display: flex; gap: 8px; }
.dl-empty { color: var(--text-muted); font-size: var(--fs-sm); padding: 12px; text-align: center; }
.dl-a { text-decoration: none; }
.ver-badge { font-size: 11px; padding: 1px 8px; border-radius: 20px; flex-shrink: 0; }
.b-latest { background: #dafbe1; color: #1a7f37; }
.b-installed { background: #ddf4ff; color: #0969da; }
.b-stopped { background: #ffebe9; color: #cf222e; }
.b-retracted { background: #f6f8fa; color: #57606a; text-decoration: line-through; }
.b-old { background: #f0f2f5; color: #57606a; }
.upd-track-wrap { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.upd-track { flex: 1; background: var(--surface-hover); border-radius: 4px; height: 8px; overflow: hidden; }
.upd-progress-bar { height: 100%; background: var(--color-primary); transition: width 0.3s; }
.upd-percent { font-size: var(--fs-xs); color: var(--text-muted); min-width: 38px; text-align: right; }
.upd-feed { font-size: var(--fs-xs); }
@media (max-width: 768px) {
  .sm-body { flex-direction: column; margin: calc(var(--space-lg) * -1); }
  .sm-nav { width: 100%; display: flex; align-items: center; gap: 4px; border-right: none; border-bottom: 1px solid var(--border-light); border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: var(--space-sm); overflow-x: auto; }
  .sm-nav-title { display: none; }
  .sm-nav-item { white-space: nowrap; flex-shrink: 0; margin-bottom: 0; }
  .sm-content { max-height: none; padding: var(--space-lg); }
  .settings-row { flex-wrap: wrap; }
  .settings-row label { min-width: 100%; }
}

.plat-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px; }
.plat-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px; border-radius: 20px; border: 1px solid var(--border-default);
  background: var(--surface-card); color: var(--text-secondary);
  font-size: var(--fs-sm); cursor: pointer;
  transition: all var(--transition-fast); touch-action: manipulation;
}
.plat-tab:hover { border-color: var(--color-primary); color: var(--color-primary); }
.plat-tab.active { background: var(--color-primary); border-color: var(--color-primary); color: #fff; font-weight: 600; }
.plat-cur { font-size: 10px; background: rgba(255,255,255,0.25); padding: 1px 6px; border-radius: 10px; }
.plat-tab:not(.active) .plat-cur { background: var(--surface-hover); color: var(--text-muted); }
.dl-loading { color: var(--text-muted); font-size: var(--fs-xs); padding: 2px 0 6px; }

</style>