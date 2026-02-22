// 全域設定
const CONFIG = {
    // ★ 部署 GAS Web App 後，將 URL 貼在這裡
    // 同時負責：取職類清單、取題目、接收反饋
    GAS_URL: "https://script.google.com/macros/s/AKfycbyLH1aSgL7KM4wNSrUFMPKBYASFG7JtllNjlzfhNDrO132SE_6_JIX40_qTdug7qUsS/exec",

    // API 存取令牌（與 GAS 端一致）
    API_TOKEN: "IAT_2026_s3cUr3T0k3n_xK9mP7",

    // 滿分
    FULL_SCORE: 100,

    // 及格分數
    PASS_SCORE: 60,

    // 測驗模式
    MODES: {
        normal: { label: "標準模式", questions: 80, time: 80, icon: "📋" },
        speed: { label: "急速模式", questions: 20, time: 20, icon: "⚡" },
    },
    DEFAULT_MODE: "normal",
};
