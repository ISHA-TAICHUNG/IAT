// 全域設定
const CONFIG = {
    // ★ 部署 GAS Web App 後，將 URL 貼在這裡
    // 同時負責：取職類清單、取題目、接收反饋
    GAS_URL: "https://script.google.com/macros/s/AKfycbxEzEoPGPUZNcSGRHQcsACTn0TdEYbDG-cfpL22NH3p7EdjNOeQ6TduI9RjfybTd2fg/exec",

    // API 存取令牌（與 GAS 端一致）
    API_TOKEN: "IAT_2026_s3cUr3T0k3n_xK9mP7",

    // 滿分
    FULL_SCORE: 100,

    // 及格分數（預設 60）
    PASS_SCORE: 60,

    // 特定職類的及格分數覆蓋（key = categoryId）
    PASS_SCORE_BY_CAT: {
        '職護': 70,
    },

    // 測驗模式
    MODES: {
        normal: { label: "標準模式", questions: 80, time: 80, icon: "📋" },
        speed: { label: "急速模式", questions: 20, time: 20, icon: "⚡" },
        mock: { label: "模擬考", questions: 80, time: 100, icon: "🎯" },
    },
    DEFAULT_MODE: "normal",

    // 特殊出題規則：依職類設定「單選/複選分開抽題」與「分別配分」
    // 觸發時機：normal / mock 模式（speed 維持原本隨機抽題的快速練習邏輯）
    // 結構：{ single: { count, scorePerQ }, multi: { count, scorePerQ } }
    EXAM_RULES_BY_CAT: {
        '職業安全衛生管理員': {
            single: { count: 60, scorePerQ: 1 },   // 60 題 × 1 分 = 60 分
            multi:  { count: 20, scorePerQ: 2 },   // 20 題 × 2 分 = 40 分
        },
    },
};
