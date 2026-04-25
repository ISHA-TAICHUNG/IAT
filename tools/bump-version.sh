#!/usr/bin/env bash
# bump-version.sh — 一鍵升版號
#
# 用途：更新 sw.js 的 CACHE_NAME、所有 HTML 內 ?v= 參數、sw.js STATIC_ASSETS
#       全部同步成今天日期 + 字母後綴（YYYYMMDDx），避免手動同步時遺漏。
#
# 用法：
#   bash exam-site/tools/bump-version.sh        # 自動產 v日期a / b / c...
#   bash exam-site/tools/bump-version.sh 20270101a   # 指定版號
#
# 規則：
#   - 預設版號 = YYYYMMDD 加遞增字母（同日多次升版會自動 a→b→c）
#   - 不會 commit；改完讓你檢查再 commit
#
set -euo pipefail

# 找到 exam-site 目錄（無論從哪裡呼叫）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_DIR="$(dirname "$SCRIPT_DIR")"
cd "$SITE_DIR"

# 取現有版號（從 sw.js）
current=$(grep -oE 'exam-v[0-9]{8}[a-z]' sw.js | head -1 | sed 's/exam-//')
today=$(date +%Y%m%d)

if [[ -n "${1:-}" ]]; then
    new_ver="$1"
elif [[ "$current" == v${today}* ]]; then
    # 同一天，字母遞增
    suffix=$(echo "$current" | sed -E "s/v${today}//")
    next_letter=$(echo "$suffix" | tr 'a-z' 'b-z' | head -c1)
    new_ver="v${today}${next_letter}"
else
    new_ver="v${today}a"
fi

if [[ "$current" == "$new_ver" ]]; then
    echo "⚠️  版號已是 $new_ver，無需更新"
    exit 0
fi

echo "🔄 升版：$current → $new_ver"

# sw.js 兩處：CACHE_NAME 和 STATIC_ASSETS
sed -i '' "s/exam-${current}/exam-${new_ver}/g" sw.js
sed -i '' "s/?v=${current#v}/?v=${new_ver#v}/g" sw.js

# HTML 內所有 ?v= 引用
for f in index.html exam.html result.html query.html exam-query.html; do
    if [[ -f "$f" ]]; then
        sed -i '' "s/?v=${current#v}/?v=${new_ver#v}/g" "$f"
    fi
done

# 驗證
echo ""
echo "📋 變更摘要："
echo "  sw.js CACHE_NAME: $(grep CACHE_NAME sw.js | head -1)"
echo "  sw.js 資源版號:    $(grep -oE '\?v=[^"]+' sw.js | sort -u | head -3 | tr '\n' ' ')"
echo "  HTML 版號分布:     $(grep -h -oE '\?v=[^"]+' *.html | sort -u)"

# 不一致時警告
unique_count=$(grep -h -oE '\?v=[^"]+' *.html sw.js | sort -u | wc -l | tr -d ' ')
if [[ "$unique_count" != "1" ]]; then
    echo ""
    echo "⚠️  警告：版號不一致，請檢查"
    exit 1
fi

echo ""
echo "✅ 完成！下一步："
echo "    git add -A && git commit -m 'chore: bump version to $new_ver' && git push"
