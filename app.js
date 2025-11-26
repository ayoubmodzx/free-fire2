const readline = require('readline');
const SessionManager = require('./sessionManager');

const sessions = {};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function print(msg) {
    console.log(msg);
}

function showMenu() {
    print('\n=============================');
    print('1. إنشاء جلسة جديدة');
    print('2. تشغيل جلسة');
    print('3. إيقاف جلسة');
    print('4. حذف جلسة');
    print('5. عرض الجلسات');
    print('0. خروج');
    print('=============================');
    rl.question('اختر: ', handleChoice);
}

function handleChoice(choice) {
    switch (choice.trim()) {
        case '1': createSession(); break;
        case '2': startSession(); break;
        case '3': stopSession(); break;
        case '4': deleteSession(); break;
        case '5': listSessions(); showMenu(); break;
        case '0': 
            print('وداعاً!');
            Object.keys(sessions).forEach(name => sessions[name].stop());
            rl.close();
            process.exit(0);
            break;
        default: showMenu();
    }
}

function createSession() {
    rl.question('اسم الجلسة: ', (name) => {
        name = name.trim();
        if (!name) { print('❌ اسم فارغ'); showMenu(); return; }
        if (sessions[name]) { print('❌ الجلسة موجودة'); showMenu(); return; }
        
        rl.question('التوكن: ', (token) => {
            token = token.trim();
            if (!token) { print('❌ توكن فارغ'); showMenu(); return; }
            
            const onLog = (n, msg, type) => {
                if (type === 'success') print(`[${n}] ✓ ${msg}`);
            };
            
            const onStatus = () => {};
            
            sessions[name] = new SessionManager(name, token, onLog, onStatus);
            print(`✓ تم إنشاء الجلسة: ${name}`);
            showMenu();
        });
    });
}

function startSession() {
    listSessions();
    if (Object.keys(sessions).length === 0) { showMenu(); return; }
    
    rl.question('اسم الجلسة للتشغيل: ', async (name) => {
        name = name.trim();
        if (!sessions[name]) { print('❌ الجلسة غير موجودة'); showMenu(); return; }
        if (sessions[name].status === 'running') { print('❌ الجلسة تعمل بالفعل'); showMenu(); return; }
        
        print(`⏳ جاري تشغيل ${name}...`);
        sessions[name].start().catch(() => {});
        showMenu();
    });
}

function stopSession() {
    listSessions();
    if (Object.keys(sessions).length === 0) { showMenu(); return; }
    
    rl.question('اسم الجلسة للإيقاف: ', (name) => {
        name = name.trim();
        if (!sessions[name]) { print('❌ الجلسة غير موجودة'); showMenu(); return; }
        
        sessions[name].stop();
        print(`✓ تم إيقاف ${name}`);
        showMenu();
    });
}

function deleteSession() {
    listSessions();
    if (Object.keys(sessions).length === 0) { showMenu(); return; }
    
    rl.question('اسم الجلسة للحذف: ', (name) => {
        name = name.trim();
        if (!sessions[name]) { print('❌ الجلسة غير موجودة'); showMenu(); return; }
        
        if (sessions[name].status === 'running') sessions[name].stop();
        delete sessions[name];
        print(`✓ تم حذف ${name}`);
        showMenu();
    });
}

function listSessions() {
    const names = Object.keys(sessions);
    if (names.length === 0) {
        print('لا توجد جلسات');
        return;
    }
    print('\n--- الجلسات ---');
    names.forEach(name => {
        const s = sessions[name];
        const status = s.status === 'running' ? '🟢' : s.status === 'reconnecting' ? '🟡' : '⚪';
        print(`${status} ${name} | ${s.status} | ID: ${s.accountId || '-'}`);
    });
    print('---------------');
}

print('🎮 مدير الجلسات');
showMenu();
