'use strict';

// ============================================================
// 积分系统常量配置（v3.29）
// 所有规则数值集中于此，可按运营调整；改动需重新发布生效。
// ============================================================

module.exports = {
  // —— 赚取 ——
  SIGNUP_BONUS: 20,              // 注册奖励
  DAILY_LOGIN_BONUS: 5,          // 每日首次登录奖励
  QUIZ_CORRECT_POINTS: 1,        // 每答对 1 道客观题
  QUIZ_DAILY_CAP: 30,            // 每日答题赚分上限（服务端按台账 SUM 截断）
  SHARE_DOWNLOAD_POINTS: 2,      // 分享库被他人下载一次
  SHARE_BANK_CAP: 20,            // 单库分享奖励封顶

  // —— 消耗 ——
  FILE_EXTEND_COST: 10,          // 文件池续期 7 天
  FILE_EXTEND_DAYS: 7,
  AI_FREE_DAILY: 10,             // AI 出题每日免费次数（generate 尝试 + 任务创建共享）
  AI_OVER_COST: 2,               // 超出后每次扣分（入口预扣，失败不退）
  AI_UPLOAD_FREE_DAILY: 10,      // /ai/upload 每日免费次数（防解析 CPU 滥用）
  AI_UPLOAD_OVER_COST: 1,        // 超出后每次扣分
  AI_TASK_USER_LIMIT: 3,         // 每用户同时 queued+running 的 AI 任务上限（防占满串行 worker）

  // —— 学期清零 ——
  EXPIRY_NOTIFY_DAYS: 7,         // 清零前 N 天开始通知
  EXPIRY_DATES: [                // 按 月/日 排序；每年这两日 00:00 清零
    { month: 2, day: 1, label: '寒假积分清零' },
    { month: 8, day: 1, label: '暑假积分清零' },
  ],
  EXPIRY_LOCK_KEY: 82029,        // pg_advisory_xact_lock 键（防多实例重复清零）

  // 成就 → 积分 档位（与 app/src/services/achievements.js 的 ACHIEVEMENT_ACTIONS 一一对应）
  ACHIEVEMENT_REWARDS: {
    // 入门 +10
    first_step: 10,
    first_correct: 10,
    five_answers: 10,
    // 进阶 +20
    first_chapter: 20,
    ten_correct: 20,
    streak_5: 20,
    ten_questions: 20,
    three_chapters: 20,
    two_subjects: 20,
    // 中级 +50
    fifty_questions: 50,
    hundred_correct: 50,
    streak_10: 50,
    five_subjects: 50,
    hundred_questions: 50,
    perfect_session: 50,
    // 高级 +100
    five_hundred_q: 100,
    streak_20: 100,
    ten_subjects: 100,
    // 顶级 +200
    thousand_questions: 200,
    streak_50: 200,
  },

  // —— 台账原因中文标签（供 points/rules 与前端渲染） ——
  REASON_LABELS: {
    signup: '注册奖励',
    daily_login: '每日登录',
    quiz_answer: '答题得分',
    achievement: '成就奖励',
    share_download: '分享被下载',
    ai_generate: 'AI 出题',
    ai_upload: 'AI 解析上传',
    file_extend: '文件池续期',
    roulette_bet: '轮盘押注',
    roulette_win: '轮盘赢彩',
    admin_adjust: '管理员调整',
    expiry_reset: '学期积分清零',
  },
};