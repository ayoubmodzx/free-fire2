const SessionManager = require('./sessionManager');

const TOKENS = [
    '963425d66c1729ba1aeb70f35276732fdd650e96bd95d12185b446d271ade1a3',
    // 'token2',
    // 'token3',
];

const sessions = [];

console.log(`🎮 تشغيل ${TOKENS.length} جلسة...`);

TOKENS.forEach((token, i) => {
    const name = `جلسة${i + 1}`;
    const onLog = (n, msg, type) => {
        if (type === 'success') console.log(`✅ [${n}] تم تسجيل الدخول - ${msg}`);
        if (type === 'error') console.log(`❌ [${n}] خطأ - ${msg}`);
        if (type === 'info') console.log(`ℹ️ [${n}] ${msg}`);
    };
    
    const session = new SessionManager(name, token.trim(), onLog, () => {});
    sessions.push(session);
    session.start().catch(() => {});
});

process.on('SIGINT', () => {
    sessions.forEach(s => s.stop());
    process.exit(0);
});

process.on('SIGTERM', () => {
    sessions.forEach(s => s.stop());
    process.exit(0);
});
