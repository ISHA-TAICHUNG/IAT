#!/usr/bin/env python3
"""
xlsx → json 題庫轉換腳本
使用方式: python3 tools/convert_xlsx.py
會輸出到 data/ 資料夾
"""

import openpyxl
import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.dirname(BASE_DIR)  # 題庫 xlsx 所在目錄
DATA_DIR = os.path.join(BASE_DIR, "data")

os.makedirs(DATA_DIR, exist_ok=True)

# 職類對應設定：output_name -> [source_xlsx_files]（有多個則合併去重）
CATEGORIES = [
    # ── 業務主管 ────────────────────────────────────────────────────
    {
        "id": "甲種業務主管",
        "name": "甲種職業安全衛生業務主管",
        "group": "業務主管",
        "files": ["優化_一般業務主管測驗網.xlsx"],
    },
    {
        "id": "乙種業務主管",
        "name": "乙種職業安全衛生業務主管",
        "group": "業務主管",
        "files": ["乙種_優化＿測驗卷.xlsx"],
    },
    {
        "id": "丙種業務主管",
        "name": "丙種職業安全衛生業務主管（甲乙丙種）",
        "group": "業務主管",
        "files": ["甲種_優化＿測驗卷.xlsx"],
    },
    {
        "id": "營造業務主管",
        "name": "營造業職業安全衛生業務主管（甲乙丙種）",
        "group": "業務主管",
        "files": ["優化_營造業務主管測驗網.xlsx"],
    },
    # ── 作業主管 ────────────────────────────────────────────────────
    {
        "id": "擋土支撐作業主管",
        "name": "擋土支撐作業主管",
        "group": "作業主管",
        "files": ["優化_擋土支撐作業主管測驗網.xlsx"],
    },
    {
        "id": "模板支撐作業主管",
        "name": "模板支撐作業主管",
        "group": "作業主管",
        "files": ["優化_模板支撐作業主管測驗網.xlsx"],
    },
    {
        "id": "施工架組配作業主管",
        "name": "施工架組配作業主管",
        "group": "作業主管",
        "files": ["優化_施工架組配作業主管測驗網.xlsx"],
    },
    {
        "id": "鋼構組配作業主管",
        "name": "鋼構組配作業主管",
        "group": "作業主管",
        "files": ["優化_鋼構組配作業主管測驗網.xlsx"],
    },
    {
        "id": "露天開挖作業主管",
        "name": "露天開挖作業主管",
        "group": "作業主管",
        "files": ["優化_露天開挖作業主管測驗網.xlsx"],
    },
    {
        "id": "屋頂作業主管",
        "name": "屋頂作業主管",
        "group": "作業主管",
        "files": ["優化_屋頂作業主管測驗網.xlsx"],
    },
    {
        "id": "有機溶劑作業主管",
        "name": "有機溶劑作業主管",
        "group": "作業主管",
        "files": ["優化_有機溶劑作業主管測驗網.xlsx"],
    },
    {
        "id": "缺氧作業主管",
        "name": "缺氧作業主管",
        "group": "作業主管",
        "files": ["優化_缺氧作業主管測驗網.xlsx"],
    },
    {
        "id": "特定化學作業主管",
        "name": "特定化學物質作業主管",
        "group": "作業主管",
        "files": ["優化_特定化學作業主管測驗網.xlsx"],
    },
    {
        "id": "粉塵作業主管",
        "name": "粉塵作業主管",
        "group": "作業主管",
        "files": ["優化_粉塵作業主管測驗網.xlsx"],
    },
    # ── 護理 ────────────────────────────────────────────────────────
    {
        "id": "職護",
        "name": "從事勞工健康服務之護理及相關人員",
        "group": "醫護",
        "files": ["優化_職護測驗網.xlsx"],
    },
    # ── 外籍移工－固定式起重機 ───────────────────────────────────────
    {
        "id": "固定式起重機_本籍",
        "name": "固定式起重機操作人員（本籍）",
        "group": "外籍移工",
        "files": ["測驗網_固定式_本籍(含共同科目)_.xlsx"],
    },
    {
        "id": "固定式起重機_印尼",
        "name": "固定式起重機操作人員（印尼籍）",
        "group": "外籍移工",
        "files": ["測驗網_固定式_印尼(含共同科目)_.xlsx"],
    },
    {
        "id": "固定式起重機_泰國",
        "name": "固定式起重機操作人員（泰籍）",
        "group": "外籍移工",
        "files": ["測驗網_固定式_泰國(含共同科目).xlsx"],
    },
    {
        "id": "固定式起重機_菲律賓",
        "name": "固定式起重機操作人員（菲律賓籍）",
        "group": "外籍移工",
        "files": ["測驗網_固定式_菲律賓(含共同科目)_.xlsx"],
    },
    {
        "id": "固定式起重機_越南",
        "name": "固定式起重機操作人員（越南籍）",
        "group": "外籍移工",
        "files": ["測驗網_固定式_越南(含共同科目).xlsx"],
    },
    # ── 外籍移工－堆高機 ─────────────────────────────────────────────
    {
        "id": "堆高機_本籍",
        "name": "堆高機操作人員（本籍）",
        "group": "外籍移工",
        "files": ["測驗網_堆高機_本籍(含共同科目)_.xlsx"],
    },
    {
        "id": "堆高機_印尼",
        "name": "堆高機操作人員（印尼籍）",
        "group": "外籍移工",
        "files": ["測驗網_堆高機_印尼(含共同科目)_.xlsx"],
    },
    {
        "id": "堆高機_泰國",
        "name": "堆高機操作人員（泰籍）",
        "group": "外籍移工",
        "files": ["測驗網_堆高機_泰國(含共同科目).xlsx"],
    },
    {
        "id": "堆高機_菲律賓",
        "name": "堆高機操作人員（菲律賓籍）",
        "group": "外籍移工",
        "files": ["測驗網_堆高機_菲律賓(含共同科目) _.xlsx"],
    },
    {
        "id": "堆高機_越南",
        "name": "堆高機操作人員（越南籍）",
        "group": "外籍移工",
        "files": ["測驗網_堆高機_越南(含共同科目).xlsx"],
    },
    # ── 外籍移工－移動式起重機 ───────────────────────────────────────
    {
        "id": "移動式起重機_本籍",
        "name": "移動式起重機操作人員（本籍）",
        "group": "外籍移工",
        "files": ["測驗網_移動式_本籍(含共同科目)_.xlsx"],
    },
    # ── 外籍移工－一般壓力容器 ───────────────────────────────────────
    {
        "id": "一壓_本籍",
        "name": "一般壓力容器操作人員（本籍）",
        "group": "外籍移工",
        "files": ["測驗網_一壓_本籍(含共同科目).xlsx"],
    },
]


def load_questions_from_xlsx(filepath):
    """從 xlsx 讀題目，回傳 list of dicts"""
    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb.active
    questions = []
    for row in ws.iter_rows(values_only=True):
        if not row[0] or not str(row[0]).strip():
            continue
        q_text = str(row[0]).strip()
        options = [str(row[i]).strip() if row[i] else "" for i in range(1, 5)]
        try:
            answer_idx = int(float(row[5])) - 1  # 轉 0-based，支援 2.0 格式
            if answer_idx < 0 or answer_idx > 3:
                continue
        except (ValueError, TypeError):
            continue
        questions.append({
            "q": q_text,
            "options": options,
            "answer": answer_idx,
        })
    wb.close()
    return questions


def deduplicate(questions):
    """以題目文字去重"""
    seen = set()
    result = []
    for q in questions:
        key = q["q"]
        if key not in seen:
            seen.add(key)
            result.append(q)
    return result


def convert_all():
    categories_meta = []

    for cat in CATEGORIES:
        all_qs = []
        for fname in cat["files"]:
            fpath = os.path.join(SOURCE_DIR, fname)
            if not os.path.exists(fpath):
                print(f"  ⚠️  找不到檔案: {fname}")
                continue
            qs = load_questions_from_xlsx(fpath)
            all_qs.extend(qs)
            print(f"  讀取 {fname}: {len(qs)} 題")

        # 去重
        all_qs = deduplicate(all_qs)

        # 加上 id
        for i, q in enumerate(all_qs):
            q["id"] = i + 1

        out = {
            "id": cat["id"],
            "name": cat["name"],
            "group": cat["group"],
            "total": len(all_qs),
            "questions": all_qs,
        }

        out_path = os.path.join(DATA_DIR, f"{cat['id']}.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)

        print(f"✅ {cat['name']}: {len(all_qs)} 題 → {cat['id']}.json")

        categories_meta.append({
            "id": cat["id"],
            "name": cat["name"],
            "group": cat["group"],
            "total": len(all_qs),
        })

    # 輸出 categories.json
    cats_path = os.path.join(DATA_DIR, "categories.json")
    with open(cats_path, "w", encoding="utf-8") as f:
        json.dump(categories_meta, f, ensure_ascii=False, indent=2)
    print(f"\n✅ categories.json 已輸出（{len(categories_meta)} 個職類）")


if __name__ == "__main__":
    print("=== 題庫轉換開始 ===\n")
    convert_all()
    print("\n=== 完成 ===")
