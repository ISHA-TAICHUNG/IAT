#!/usr/bin/env python3
"""
從技能檢定 PDF 提取圖片，配對到 JSON 題庫，以 Base64 嵌入。

用法: python3 extract_images.py [--dry-run] [--save-images]
"""

import fitz  # PyMuPDF
import json
import base64
import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_DIR = os.path.dirname(BASE_DIR)
PDF_DIR = os.path.join(PROJECT_DIR, "本籍技術類")
DATA_DIR = os.path.join(BASE_DIR, "data")
IMG_OUT_DIR = os.path.join(BASE_DIR, "tools", "extracted_images")

# PDF → JSON 對應
PDF_TO_JSON = {
    "堆高機操作.pdf": ["堆高機_本籍.json"],
    "固定式起重機操作.pdf": ["固定式起重機_本籍.json"],
    "移動式起重機操作.pdf": ["移動式起重機_本籍.json"],
    "第一種壓力容器操作.pdf": ["一壓_本籍.json"],
    "節能減碳共同科目.pdf": [
        "堆高機_本籍.json", "固定式起重機_本籍.json",
        "移動式起重機_本籍.json", "一壓_本籍.json",
    ],
    "工作倫理與職業道德共同科目.pdf": [
        "堆高機_本籍.json", "固定式起重機_本籍.json",
        "移動式起重機_本籍.json", "一壓_本籍.json",
    ],
    "環境保護共同科目.pdf": [
        "堆高機_本籍.json", "固定式起重機_本籍.json",
        "移動式起重機_本籍.json", "一壓_本籍.json",
    ],
    "職業安全衛生共同科目.pdf": [
        "堆高機_本籍.json", "固定式起重機_本籍.json",
        "移動式起重機_本籍.json", "一壓_本籍.json",
    ],
}


def clean_text(s):
    """移除空白和標點，用於比對"""
    return re.sub(r'[\s\u3000\.\,\。\，\?\？\!\！\;\；\:\：\、\～]+', '', str(s))


def extract_options(text):
    """從 PDF 題目文字中提取 4 個選項"""
    # 匹配 ①...②...③...④... 格式
    parts = re.split(r'[①②③④]', text)
    if len(parts) >= 5:
        return [clean_text(p) for p in parts[1:5]]
    # 匹配 (1)...(2)...(3)...(4)... 格式
    parts = re.split(r'\(\d\)', text)
    if len(parts) >= 5:
        return [clean_text(p) for p in parts[1:5]]
    return []


def options_similarity(pdf_opts, json_opts):
    """比較兩組選項的相似度（0-4，越高越相似）"""
    if not pdf_opts or not json_opts:
        return 0
    matches = 0
    for po in pdf_opts:
        if len(po) < 2:
            continue
        for jo in json_opts:
            jo_clean = clean_text(jo)
            # 包含關係（處理截斷情況）
            shorter = min(len(po), len(jo_clean))
            if shorter < 2:
                continue
            # 前 N 字完全匹配
            match_len = 0
            for i in range(shorter):
                if po[i] == jo_clean[i]:
                    match_len += 1
                else:
                    break
            if match_len >= min(4, shorter):
                matches += 1
                break
    return matches


def extract_images_with_context(pdf_path):
    """從 PDF 提取所有圖片，附帶頁面上下文（題目文字）"""
    doc = fitz.open(pdf_path)
    results = []

    for page_num in range(len(doc)):
        page = doc[page_num]

        # 提取所有文字區塊及其位置
        text_blocks = []
        for block in page.get_text("dict")["blocks"]:
            if "lines" not in block:
                continue
            text = ""
            for line in block["lines"]:
                for span in line["spans"]:
                    text += span["text"]
            text = text.strip()
            if text:
                text_blocks.append({
                    'text': text,
                    'y': block["bbox"][1],
                    'y_end': block["bbox"][3],
                })

        # 解析題目（帶題號和選項）
        page_questions = []
        for tb in text_blocks:
            match = re.match(r'(\d+)\s*\.\s*\((\d)\)\s*(.*)', tb['text'])
            if match:
                q_num = int(match.group(1))
                answer = int(match.group(2)) - 1
                q_text = match.group(3).strip()
                opts = extract_options(q_text)
                # 只保留問句部分（去掉選項）
                q_only = re.split(r'[①②③④]', q_text)[0].strip()
                page_questions.append({
                    'q_num': q_num,
                    'answer': answer,
                    'text': q_only,
                    'full_text': q_text,
                    'options': opts,
                    'y': tb['y'],
                    'page': page_num,
                })

        # 提取圖片
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            pix = fitz.Pixmap(doc, xref)
            w, h = pix.width, pix.height

            # 過濾浮水印
            if w > 500 and h > 500:
                continue

            rects = page.get_image_rects(img_info)
            for rect in rects:
                # 轉 PNG
                if pix.n > 4:
                    pix2 = fitz.Pixmap(fitz.csRGB, pix)
                else:
                    pix2 = pix
                if pix2.alpha:
                    pix2 = fitz.Pixmap(fitz.csRGB, pix2)
                png_bytes = pix2.tobytes("png")
                b64 = base64.b64encode(png_bytes).decode('ascii')

                # 找最近的題目（圖片上方最近的題目）
                best_q = None
                best_dist = float('inf')
                for q in page_questions:
                    dist = rect.y0 - q['y']
                    if -30 <= dist < best_dist:
                        best_dist = dist
                        best_q = q

                results.append({
                    'page': page_num,
                    'xref': xref,
                    'width': w,
                    'height': h,
                    'y': rect.y0,
                    'b64': b64,
                    'size_kb': len(png_bytes) / 1024,
                    'pdf_q': best_q,
                })

    doc.close()
    return results


def match_to_json(pdf_images, json_questions):
    """將 PDF 圖片精確配對到 JSON 題目，確保 1:1"""
    matched = []  # (json_id, img_data)
    used_json_ids = set()

    for img_data in pdf_images:
        pdf_q = img_data['pdf_q']
        if not pdf_q:
            matched.append((None, img_data, "無關聯 PDF 題目"))
            continue

        # 候選集：用選項比對
        candidates = []
        for jq in json_questions:
            if jq['id'] in used_json_ids:
                continue

            # 選項相似度（最重要的指標）
            json_opts_clean = [clean_text(o) for o in jq['options']]
            opt_score = options_similarity(pdf_q['options'], json_opts_clean)

            # 題目文字相似度（輔助）
            pdf_text_clean = clean_text(pdf_q['text'])
            json_text_clean = clean_text(jq['q'])
            text_match = 0
            for i in range(min(len(pdf_text_clean), len(json_text_clean))):
                if pdf_text_clean[i] == json_text_clean[i]:
                    text_match += 1
                else:
                    break

            # 綜合分數：至少 3 個選項匹配 + 至少 5 字題目匹配
            if opt_score >= 3 and text_match >= 5:
                score = opt_score * 100 + text_match
                candidates.append((score, jq))
            elif opt_score >= 4:  # 4 選項完全匹配則放寬題目要求
                score = opt_score * 100 + text_match
                candidates.append((score, jq))

        if candidates:
            candidates.sort(key=lambda x: -x[0])
            best_jq = candidates[0][1]
            used_json_ids.add(best_jq['id'])
            matched.append((best_jq['id'], img_data, best_jq))
        else:
            matched.append((None, img_data, f"未配對 PDF#{pdf_q['q_num']}"))

    return matched


def process_pdf(pdf_name, json_names, dry_run=False, save_images=False):
    """處理單個 PDF"""
    pdf_path = os.path.join(PDF_DIR, pdf_name)
    if not os.path.exists(pdf_path):
        print(f"  ⚠ PDF 不存在: {pdf_path}")
        return 0

    print(f"\n{'='*60}")
    print(f"📄 {pdf_name}")
    print(f"{'='*60}")

    # 提取圖片及上下文
    pdf_images = extract_images_with_context(pdf_path)
    print(f"  圖片數: {len(pdf_images)}")
    if not pdf_images:
        return 0

    total_injected = 0

    for json_name in json_names:
        json_path = os.path.join(DATA_DIR, json_name)
        if not os.path.exists(json_path):
            continue

        with open(json_path, 'r') as f:
            data = json.load(f)
        json_qs = data['questions']

        # 配對
        matches = match_to_json(pdf_images, json_qs)
        injected = 0

        for json_id, img_data, info in matches:
            pdf_q = img_data['pdf_q']
            if json_id is None:
                if pdf_q:
                    print(f"  ✗ {info}: 「{pdf_q['text'][:35]}」 opts={pdf_q['options'][:2]}")
                continue

            jq = info  # info is the json question when matched
            data_uri = f"data:image/png;base64,{img_data['b64']}"

            # 避免重複注入（如果已有 image 且更大，保留舊的）
            existing = jq.get('image')
            if existing and len(existing) > len(data_uri):
                continue

            if not dry_run:
                jq['image'] = data_uri

            injected += 1
            print(f"  ✓ → {json_name} ID {jq['id']}: "
                  f"「{jq['q'][:30]}」 ({img_data['width']}x{img_data['height']}, "
                  f"{img_data['size_kb']:.1f}KB)")

            if save_images:
                out_dir = os.path.join(IMG_OUT_DIR, json_name.replace('.json', ''))
                os.makedirs(out_dir, exist_ok=True)
                png_bytes = base64.b64decode(img_data['b64'])
                with open(os.path.join(out_dir, f"id{jq['id']}.png"), 'wb') as f:
                    f.write(png_bytes)

        if injected > 0:
            if not dry_run:
                with open(json_path, 'w') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"  💾 {json_name}: {injected} 張圖片{'（DRY RUN）' if dry_run else ''}")

        total_injected += injected

    return total_injected


def main():
    dry_run = '--dry-run' in sys.argv
    save_images = '--save-images' in sys.argv

    mode = "🔍 DRY RUN" if dry_run else "🚀 執行"
    print(f"{mode} 模式\n")

    total = 0
    for pdf_name, json_names in PDF_TO_JSON.items():
        total += process_pdf(pdf_name, json_names, dry_run, save_images)

    print(f"\n{'='*60}")
    print(f"✅ 共 {total} 張圖片注入")


if __name__ == '__main__':
    main()
