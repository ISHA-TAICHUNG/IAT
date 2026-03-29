#!/usr/bin/env python3
"""
從技能檢定 PDF 重建本籍技術類 JSON 題庫。
包含：題目、選項、答案、圖片（Base64）、科目標記（subject）。

用法: python3 rebuild_json.py
"""

import fitz
import re
import base64
import json
import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_DIR = os.path.dirname(BASE_DIR)
PDF_DIR = os.path.join(PROJECT_DIR, "本籍技術類")
DATA_DIR = os.path.join(BASE_DIR, "data")
IMG_DEBUG_DIR = os.path.join(BASE_DIR, "tools", "debug_images")

# === 設定 ===
CATEGORIES = {
    "堆高機_本籍": {
        "name": "堆高機操作人員（本籍）",
        "group": "即測即評",
        "specialty_pdf": "堆高機操作.pdf",
    },
    "固定式起重機_本籍": {
        "name": "固定式起重機操作人員（本籍）",
        "group": "即測即評",
        "specialty_pdf": "固定式起重機操作.pdf",
    },
    "移動式起重機_本籍": {
        "name": "移動式起重機操作人員（本籍）",
        "group": "即測即評",
        "specialty_pdf": "移動式起重機操作.pdf",
    },
    "一壓_本籍": {
        "name": "第一種壓力容器操作人員（本籍）",
        "group": "即測即評",
        "specialty_pdf": "第一種壓力容器操作.pdf",
    },
}

COMMON_PDFS = [
    "工作倫理與職業道德共同科目.pdf",
    "環境保護共同科目.pdf",
    "節能減碳共同科目.pdf",
    "職業安全衛生共同科目.pdf",
]


def extract_all_from_page(page, doc):
    """提取頁面的所有文字（合併）和圖片位置"""
    # 取得完整頁面文字
    full_text = page.get_text("text")

    # 取得圖片
    images = []
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        pix = fitz.Pixmap(doc, xref)
        w, h = pix.width, pix.height
        if w > 500 and h > 500:  # 浮水印
            continue

        rects = page.get_image_rects(img_info)
        for rect in rects:
            if pix.n > 4:
                pix2 = fitz.Pixmap(fitz.csRGB, pix)
            else:
                pix2 = pix
            if pix2.alpha:
                pix2 = fitz.Pixmap(fitz.csRGB, pix2)
            png_bytes = pix2.tobytes("png")
            b64 = base64.b64encode(png_bytes).decode('ascii')
            images.append({
                'b64': b64,
                'width': w,
                'height': h,
                'y': rect.y0,
                'size_kb': len(png_bytes) / 1024,
            })

    return full_text, images


def parse_pdf_questions(pdf_path):
    """從 PDF 解析所有題目，附帶圖片"""
    doc = fitz.open(pdf_path)
    all_page_data = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        text, images = extract_all_from_page(page, doc)
        all_page_data.append((page_num, text, images))

    # 合併所有頁面文字
    full_text = ""
    page_boundaries = []  # [(char_start, page_num)]
    for page_num, text, _ in all_page_data:
        page_boundaries.append((len(full_text), page_num))
        full_text += text + "\n"

    # 清理：移除 "Page X of Y" 行
    full_text = re.sub(r'Page\s+\d+\s+of\s+\d+', '', full_text)

    # 移除章節標題行
    full_text = re.sub(r'\d{5}\s+.*工作項目\s*\d+\s*[：:][^\n]*\n', '\n', full_text)

    # 解析所有題目
    # 格式：數字. (數字) 題目 ①選項1 ②選項2 ③選項3 ④選項4
    pattern = r'(\d+)\s*\.\s*\((\d)\)\s*'
    matches = list(re.finditer(pattern, full_text))

    questions = []
    for i, m in enumerate(matches):
        q_num = int(m.group(1))
        answer = int(m.group(2)) - 1

        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)
        raw = full_text[start:end].strip()

        # 解析選項
        parts = re.split(r'[①②③④]', raw)
        if len(parts) >= 5:
            q_text = parts[0].strip()
            options = []
            for p in parts[1:5]:
                opt = p.strip()
                # 清理尾部標點和空白
                opt = re.sub(r'[\s。，\.\,]+$', '', opt)
                options.append(opt)
        else:
            # 備選解析
            q_text = raw
            options = []

        if len(options) != 4 or not q_text:
            continue

        # 清理題目文字
        q_text = re.sub(r'[\s]+', '', q_text)  # 移除中間多餘空白
        q_text = q_text.replace('\n', '')

        # 清理選項
        clean_opts = []
        for opt in options:
            opt = opt.replace('\n', '').strip()
            opt = re.sub(r'\s+', ' ', opt)
            clean_opts.append(opt)

        # 找出題目所在頁面（用字元位置推算）
        q_char_pos = m.start()
        q_page = 0
        for char_start, pn in page_boundaries:
            if char_start <= q_char_pos:
                q_page = pn

        # 找配對圖片（只有題目文字引用圖片時才配對）
        image_data = None
        IMAGE_KEYWORDS = ['左圖', '下圖', '如圖', '右圖', '上圖', '依圖示',
                          '圖為', '圖表示', '圖中', '如下圖', '標貼警示',
                          '標貼', '圖標誌', '圖之標誌', '圖示標貼',
                          '標章', '何者為節能', '下列何者為']
        has_img_ref = any(kw in q_text for kw in IMAGE_KEYWORDS)
        _, _, page_images = all_page_data[q_page]

        if page_images and has_img_ref:
            page = doc[q_page]

            # 找題目文字在頁面的 Y 座標（用答案數字提高精確度）
            search_str = f"{q_num}. ({answer + 1})"
            instances = page.search_for(search_str)
            if not instances:
                search_str = f"{q_num}.({answer + 1})"
                instances = page.search_for(search_str)
            if not instances:
                # 用題目前幾個獨特字搜尋
                search_txt = q_text[:12] if len(q_text) > 5 else q_text
                instances = page.search_for(search_txt)

            if instances:
                q_y = instances[0].y0

                # 找下一題的 Y（同頁）
                next_q_y = 9999
                for j in range(i + 1, min(i + 5, len(matches))):
                    next_num = int(matches[j].group(1))
                    next_inst = page.search_for(f"{next_num}. (")
                    if not next_inst:
                        next_inst = page.search_for(f"{next_num}.")
                    if next_inst:
                        next_q_y = next_inst[0].y0
                        break

                # 找此題和下一題之間的圖片（或頁面底部前）
                best_img = None
                for img in page_images:
                    if q_y - 15 <= img['y'] < next_q_y:
                        if best_img is None or img['y'] < best_img['y']:
                            best_img = img

                if best_img:
                    image_data = f"data:image/png;base64,{best_img['b64']}"

        q_entry = {
            'q': q_text,
            'options': clean_opts,
            'answer': answer,
        }
        if image_data:
            q_entry['image'] = image_data

        questions.append(q_entry)

    doc.close()
    return questions


def build_category_json(cat_id, cat_config):
    """為一個類別建立完整 JSON"""
    print(f"\n{'='*60}")
    print(f"🔧 建立: {cat_id} ({cat_config['name']})")
    print(f"{'='*60}")

    all_questions = []

    # 1. 專業科目
    spec_pdf = os.path.join(PDF_DIR, cat_config['specialty_pdf'])
    spec_qs = parse_pdf_questions(spec_pdf)
    for q in spec_qs:
        q['subject'] = '操作'
    print(f"  📘 {cat_config['specialty_pdf']}: {len(spec_qs)} 題 "
          f"({sum(1 for q in spec_qs if 'image' in q)} 含圖)")
    all_questions.extend(spec_qs)

    # 2. 共同科目
    for common_pdf_name in COMMON_PDFS:
        common_pdf = os.path.join(PDF_DIR, common_pdf_name)
        common_qs = parse_pdf_questions(common_pdf)
        subject_name = common_pdf_name.replace('.pdf', '').replace('共同科目', '').strip()
        for q in common_qs:
            q['subject'] = '共同'
        print(f"  📗 {common_pdf_name}: {len(common_qs)} 題 "
              f"({sum(1 for q in common_qs if 'image' in q)} 含圖)")
        all_questions.extend(common_qs)

    # 3. 分配 ID
    for i, q in enumerate(all_questions):
        q['id'] = i + 1

    # 4. 統計
    spec_count = sum(1 for q in all_questions if q['subject'] == '操作')
    common_count = sum(1 for q in all_questions if q['subject'] == '共同')
    img_count = sum(1 for q in all_questions if 'image' in q)

    print(f"\n  📊 總計: {len(all_questions)} 題")
    print(f"     操作: {spec_count} 題 | 共同: {common_count} 題 | 含圖: {img_count} 題")

    # 5. 建立 JSON
    output = {
        "id": cat_id,
        "name": cat_config['name'],
        "group": cat_config['group'],
        "total": len(all_questions),
        "questions": all_questions,
    }

    return output


def main():
    dry_run = '--dry-run' in sys.argv
    save_debug = '--debug' in sys.argv

    if dry_run:
        print("🔍 DRY RUN — 不寫入檔案\n")

    for cat_id, cat_config in CATEGORIES.items():
        result = build_category_json(cat_id, cat_config)

        json_path = os.path.join(DATA_DIR, f"{cat_id}.json")
        json_size_mb = len(json.dumps(result, ensure_ascii=False)) / 1024 / 1024

        print(f"  💾 {cat_id}.json: {json_size_mb:.1f} MB")

        if not dry_run:
            with open(json_path, 'w') as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
            print(f"  ✅ 已寫入: {json_path}")

    # 更新 categories.json
    if not dry_run:
        cat_json_path = os.path.join(DATA_DIR, "categories.json")
        with open(cat_json_path, 'r') as f:
            categories = json.load(f)

        for cat in categories:
            if cat['id'] in CATEGORIES:
                json_path = os.path.join(DATA_DIR, f"{cat['id']}.json")
                with open(json_path, 'r') as f:
                    data = json.load(f)
                old_total = cat['total']
                cat['total'] = data['total']
                print(f"\n  📋 categories.json: {cat['id']} {old_total} → {cat['total']}")

        with open(cat_json_path, 'w') as f:
            json.dump(categories, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*60}")
    print("🎉 重建完成！")


if __name__ == '__main__':
    main()
