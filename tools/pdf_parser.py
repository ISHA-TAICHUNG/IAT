#!/usr/bin/env python3
"""
從勞動部技能檢定 PDF 解析題目、選項、答案、圖片。

PDF 格式：
  1. (4) 題目文字 ①選項1 ②選項2 ③選項3 ④選項4 。
  括號內數字 = 正確答案（1-based）
"""

import fitz
import re
import base64
import json
import os


def extract_page_content(page, doc):
    """提取頁面的文字和圖片，按 Y 座標排序"""
    elements = []

    # 文字區塊
    for block in page.get_text("dict")["blocks"]:
        if "lines" not in block:
            continue
        text = ""
        for line in block["lines"]:
            for span in line["spans"]:
                text += span["text"]
        text = text.strip()
        if text:
            elements.append({
                'type': 'text',
                'text': text,
                'y': block["bbox"][1],
                'y_end': block["bbox"][3],
            })

    # 圖片
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
            elements.append({
                'type': 'image',
                'b64': b64,
                'width': w,
                'height': h,
                'size_kb': len(png_bytes) / 1024,
                'y': rect.y0,
                'y_end': rect.y1,
            })

    elements.sort(key=lambda e: e['y'])
    return elements


def parse_questions_from_text(full_text):
    """從連續文字中解析題目（處理跨行情況）"""
    # 合併所有文字，用 \n 分隔
    # 匹配格式：數字. (數字) 題目 ①選項1 ②選項2 ③選項3 ④選項4
    pattern = r'(\d+)\s*\.\s*\((\d)\)\s*'

    # 找出所有題目的起始位置
    matches = list(re.finditer(pattern, full_text))
    questions = []

    for i, m in enumerate(matches):
        q_num = int(m.group(1))
        answer = int(m.group(2)) - 1  # 轉 0-based

        # 題目文字：從此 match 之後到下一題的 match 之前
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(full_text)
        raw = full_text[start:end].strip()

        # 移除尾部的「Page X of Y」
        raw = re.sub(r'Page\s+\d+\s+of\s+\d+\s*$', '', raw).strip()

        # 解析選項：用 ①②③④ 分割
        parts = re.split(r'[①②③④]', raw)
        if len(parts) >= 5:
            q_text = parts[0].strip()
            options = [p.strip().rstrip('。').rstrip(' ').rstrip('。') for p in parts[1:5]]
        else:
            # 備選：嘗試用 (1)(2)(3)(4) 分割
            parts2 = re.split(r'(?<!\d)\((\d)\)(?!\d)', raw)
            if len(parts2) >= 9:  # text, 1, opt1, 2, opt2, 3, opt3, 4, opt4
                q_text = parts2[0].strip()
                options = [parts2[j].strip().rstrip('。') for j in [2, 4, 6, 8]]
            else:
                q_text = raw
                options = []

        # 清理題目文字
        q_text = q_text.strip().rstrip('？').rstrip('?') + '？' if q_text.endswith(('？', '?')) else q_text.strip()
        # 移除尾部多餘的標點
        q_text = re.sub(r'[\s。，]+$', '', q_text)

        # 清理選項
        clean_options = []
        for opt in options:
            opt = re.sub(r'[\s。]+$', '', opt).strip()
            if opt:
                clean_options.append(opt)

        if len(clean_options) == 4:
            questions.append({
                'q_num': q_num,
                'answer': answer,
                'q': q_text,
                'options': clean_options,
            })

    return questions


def parse_pdf(pdf_path):
    """解析整份 PDF，返回題目列表（含圖片）"""
    doc = fitz.open(pdf_path)
    all_questions = []
    current_section = ""

    # 第一遍：收集所有頁面的文字和圖片
    page_elements = []
    for page_num in range(len(doc)):
        page = doc[page_num]
        elements = extract_page_content(page, doc)
        page_elements.append((page_num, elements))

    # 第二遍：合併文字並解析題目
    # 同時記錄每個題目的頁面位置用於圖片配對
    full_text = ""
    text_positions = []  # [(char_offset, page_num, y)]

    for page_num, elements in page_elements:
        for elem in elements:
            if elem['type'] == 'text':
                # 檢查是否為章節標題
                section_match = re.match(r'.*工作項目\s*\d+\s*[：:]\s*(.*)', elem['text'])
                if section_match:
                    current_section = section_match.group(1).strip()
                    continue
                # 跳過 "Page X of Y"
                if re.match(r'Page\s+\d+\s+of\s+\d+', elem['text']):
                    continue

                offset = len(full_text)
                text_positions.append((offset, page_num, elem['y']))
                full_text += elem['text'] + " "

    # 解析題目
    questions = parse_questions_from_text(full_text)

    # 第三遍：為每個題目找到對應的頁面位置和圖片
    # 先建立題目文字 → 頁面位置的映射
    for q in questions:
        # 找題目在 full_text 中的位置
        q_pattern = re.escape(q['q'][:20])
        match = re.search(q_pattern, full_text)
        if match:
            char_pos = match.start()
            # 找對應的頁面
            q_page = 0
            q_y = 0
            for offset, pn, y in text_positions:
                if offset <= char_pos:
                    q_page = pn
                    q_y = y
            q['page'] = q_page
            q['y'] = q_y
        else:
            q['page'] = -1
            q['y'] = 0

    # 第四遍：配對圖片
    for q in questions:
        if q['page'] < 0:
            continue
        page_num = q['page']
        _, elements = page_elements[page_num]

        # 找此題目 Y 座標附近的圖片（在題目之後、下一題之前）
        best_img = None
        for elem in elements:
            if elem['type'] != 'image':
                continue
            # 圖片應在題目 Y 座標附近（-30 到 +200px）
            dist = elem['y'] - q['y']
            if -30 <= dist <= 200:
                if best_img is None or abs(dist) < abs(best_img['y'] - q['y']):
                    best_img = elem

        if best_img:
            q['image'] = f"data:image/png;base64,{best_img['b64']}"
            q['image_size'] = f"{best_img['width']}x{best_img['height']}"

    doc.close()
    return questions


def test_parse(pdf_path, max_show=10):
    """測試解析並顯示結果"""
    print(f"\n{'='*60}")
    print(f"📄 {os.path.basename(pdf_path)}")
    print(f"{'='*60}")

    questions = parse_pdf(pdf_path)
    img_count = sum(1 for q in questions if 'image' in q)

    print(f"  解析到 {len(questions)} 道題目，{img_count} 題含圖片")

    # 顯示前幾題
    for q in questions[:max_show]:
        img_tag = f" 🖼 {q.get('image_size','')}" if 'image' in q else ""
        print(f"  #{q['q_num']}(ans={q['answer']+1}) {q['q'][:50]}{img_tag}")
        if q['options']:
            print(f"    ①{q['options'][0][:20]} ②{q['options'][1][:20]} "
                  f"③{q['options'][2][:20]} ④{q['options'][3][:20]}")

    # 顯示有圖片的題目
    if img_count > 0:
        print(f"\n  --- 含圖片的題目 ---")
        for q in questions:
            if 'image' in q:
                print(f"  #{q['q_num']}(ans={q['answer']+1}) {q['q'][:45]} 🖼 {q['image_size']}")

    return questions


if __name__ == '__main__':
    PDF_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "..", "本籍技術類")

    # 測試所有 PDF
    for pdf_name in sorted(os.listdir(PDF_DIR)):
        if pdf_name.endswith('.pdf'):
            test_parse(os.path.join(PDF_DIR, pdf_name), max_show=5)
