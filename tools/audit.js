const fs = require('fs');
const path = require('path');
const DATA_DIR = path.join(__dirname, '..', 'data');
const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && f !== 'categories.json');

let totalIssues = 0;

for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
    const issues = [];

    for (const q of raw.questions) {
        const problems = [];

        if (!q.q || q.q.trim() === '') problems.push('題目空白');

        if (!q.options || q.options.length < 4) {
            problems.push('選項不足4個(有' + (q.options ? q.options.length : 0) + '個)');
        } else {
            for (let i = 0; i < q.options.length; i++) {
                if (!q.options[i] || q.options[i].trim() === '') {
                    problems.push('選項' + 'ABCD'[i] + '空白');
                }
            }
            const unique = new Set(q.options.map(o => (o || '').trim()));
            if (unique.size < q.options.length) problems.push('有重複選項');
        }

        if (q.answer === undefined || q.answer === null) {
            problems.push('答案缺失');
        } else if (q.answer < 0 || q.answer > 3) {
            problems.push('答案超出範圍:' + q.answer);
        }

        if (problems.length > 0) {
            issues.push({ id: q.id, q: (q.q || '').substring(0, 40), problems });
        }
    }

    if (issues.length > 0) {
        console.log('\n❌ ' + f + ' (' + issues.length + ' 個問題):');
        for (const iss of issues) {
            console.log('  #' + iss.id + ' [' + iss.q + '...] -> ' + iss.problems.join(', '));
        }
        totalIssues += issues.length;
    }
}

if (totalIssues === 0) {
    console.log('\n✅ 全部 ' + files.length + ' 個題庫均無發現問題！');
} else {
    console.log('\n📊 共掃描 ' + files.length + ' 個題庫，發現 ' + totalIssues + ' 題有問題');
}
