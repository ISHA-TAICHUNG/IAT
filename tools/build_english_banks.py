#!/usr/bin/env python3
"""從勞發署英文參考資料建置固定式起重機與堆高機英文題庫。

輸入為官方 PDF 經 pdftotext -raw 產生的六個文字檔。題目與答案只取
英文原文及該題中文題首標示的正解；既有菲律賓正式題庫僅供複用同一
sourceKey 的圖檔，絕不複用文字或答案。

此工具刻意將所有題數、題號、選項和圖像題設成 hard guard。任何一項不
符合官方來源或既有題庫結構時都會失敗，不會輸出半成品。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any


SOURCE_FILES = (
    '061004A34.raw.txt',
    '151004A34.raw.txt',
    '900060A37.raw.txt',
    '900070A30.raw.txt',
    '900080A35.raw.txt',
    '900090A30.raw.txt',
)

CATEGORY_META = {
    '06100': {
        'id': '固定式起重機_英文',
        'name': '固定式起重機操作人員（英文）',
        'group': '即測即評',
        'expected_total': 998,
        'expected_work_counts': {'01': 266, '02': 223, '03': 76, '04': 33},
    },
    '15100': {
        'id': '堆高機_英文',
        'name': '堆高機操作人員（英文）',
        'group': '即測即評',
        'expected_total': 1000,
        'expected_work_counts': {'01': 157, '02': 252, '03': 191},
    },
}

COMMON_EXPECTED = {
    '90006': {'work': '01', 'count': 100},
    '90007': {'work': '01', 'count': 100},
    '90008': {'work': '03', 'count': 100},
    '90009': {'work': '04', 'count': 100},
}

FILE_JOB_CODES = {
    '061004A34.raw.txt': '06100',
    '151004A34.raw.txt': '15100',
    '900060A37.raw.txt': '90006',
    '900070A30.raw.txt': '90007',
    '900080A35.raw.txt': '90008',
    '900090A30.raw.txt': '90009',
}

QUESTION_RE = re.compile(r'^\s*(\d+)\.\s*\(([1-4])\)\s+')
WORK_RE = re.compile(r'工作項目：\s*(\d{1,2})')
CHOICE_RE = re.compile(r'[①②③④]')
HAN_RE = re.compile(r'[\u3400-\u9fff]')
WORD_LIST_PATH = Path('/usr/share/dict/web2')
SHORT_WORD_EXCLUSIONS = {
    'a', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'i', 'if', 'in',
    'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us',
    'we',
}
EXTRA_WORDS = {
    'abnormal', 'accelerator', 'alternator', 'ammeter', 'anti-runaway',
    'connected', 'differential', 'electromagnetic', 'machinery', 'parallel',
    'reason', 'remaining', 'resistance', 'traveling',
}
WORD_SET: set[str] | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--fixed-reference', type=Path, required=True)
    parser.add_argument('--forklift-reference', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    return parser.parse_args()


def load_json(path: Path) -> Any:
    with path.open(encoding='utf-8') as handle:
        return json.load(handle)


def get_word_set() -> set[str]:
    """載入 macOS 內建英文單字表，僅用於修復 PDF 的單字內斷空格。"""
    global WORD_SET
    if WORD_SET is None:
        WORD_SET = set(EXTRA_WORDS)
        if WORD_LIST_PATH.is_file():
            WORD_SET.update(
                line.strip().lower()
                for line in WORD_LIST_PATH.read_text(encoding='utf-8', errors='ignore').splitlines()
                if line.strip()
            )
    return WORD_SET


def merge_split_words(text: str) -> str:
    """只在合併後是字典單字時，修復 PDF 文字層插入的單字內空白。"""
    words = get_word_set()

    def merge_prefix(match: re.Match[str]) -> str:
        left, right = match.group(1), match.group(2)
        combined = (left + right).lower()
        if left.lower() not in SHORT_WORD_EXCLUSIONS and combined in words:
            return left + right
        return match.group(0)

    def merge_suffix(match: re.Match[str]) -> str:
        left, right = match.group(1), match.group(2)
        combined = (left + right).lower()
        if left.lower() not in SHORT_WORD_EXCLUSIONS and combined in words:
            return left + right
        return match.group(0)

    for _ in range(3):
        previous = text
        text = re.sub(r'\b([A-Za-z]{1,3})\s+([A-Za-z]{2,})\b', merge_prefix, text)
        text = re.sub(r'\b([A-Za-z]{2,})\s+([A-Za-z])\b', merge_suffix, text)
        if text == previous:
            break
    return text


def normalise_english(text: str) -> str:
    """移除雙語 PDF 殘留的中文字元，保留原有英文標點與數字。"""
    text = text.replace('\f', ' ')
    text = HAN_RE.sub('', text)
    text = re.sub(r'[“"]\s*[”"]\s*\(degree\)', '"degree"', text)
    text = text.translate(str.maketrans({'？': '?', '：': ':', '～': '~'}))
    text = re.sub(r'(?<=[A-Za-z])\s*-\s*(?=[A-Za-z])', '-', text)
    text = re.sub(r'°\s+C\b', '°C', text)
    text = merge_split_words(text)
    text = re.sub(r'\bo\s+f\b', 'of', text, flags=re.IGNORECASE)
    text = re.sub(r'\bi\s+s\b', 'is', text, flags=re.IGNORECASE)
    text = re.sub(r'\s+([.,?!;:])', r'\1', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def is_english_content_line(line: str) -> bool:
    """判斷 PDF 文字行是否屬於英文題幹或選項，而非中文對照。"""
    line = line.replace('\f', ' ').strip()
    if not line:
        return False
    han_count = len(HAN_RE.findall(line))
    latin_count = len(re.findall(r'[A-Za-z]', line))
    return latin_count > 0 and latin_count >= han_count


def is_english_start_line(line: str) -> bool:
    """英文題幹的開頭必須是有意義的英文句，不把中文公式誤判成英文。"""
    line = line.replace('\f', ' ').strip()
    if line.startswith(('①', '②', '③', '④')):
        return False
    if not re.match(r'^(?:[A-Za-z]{3,}|[A-Za-z]{2,4}\d+|If|At|As|In|To|Of|On|By|A)\b', line):
        return False
    han_count = len(HAN_RE.findall(line))
    latin_count = len(re.findall(r'[A-Za-z]', line))
    return latin_count >= 3 and latin_count >= han_count * 5


def is_numeric_choice_continuation(line: str, previous_line: str) -> bool:
    """僅接受緊接英文行之後的純數字選項續行。"""
    line = line.replace('\f', ' ').strip()
    previous_line = previous_line.strip()
    return (
        bool(line)
        and not HAN_RE.search(line)
        and not re.search(r'[A-Za-z]', line)
        and (
            bool(CHOICE_RE.search(line))
            or (
                previous_line.endswith(('①', '②', '③', '④'))
                and bool(re.fullmatch(r'[0-9.,%°Ω×~+\-㎏ ]+', line))
            )
        )
    )


def split_question_text(text: str) -> tuple[str, list[str]]:
    positions = list(CHOICE_RE.finditer(text))
    if len(positions) != 4:
        return normalise_english(text), []

    question = normalise_english(text[:positions[0].start()])
    options: list[str] = []
    for index, marker in enumerate(positions):
        end = positions[index + 1].start() if index + 1 < len(positions) else len(text)
        options.append(normalise_english(text[marker.end():end]))
    return question, options


def parse_pdf_text(path: Path, job_code: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    current_work: str | None = None
    current: dict[str, Any] | None = None

    def finish_current() -> None:
        nonlocal current
        if current is None:
            return
        english_lines: list[str] = []
        previous_was_english = False
        english_started = False
        for line in current['raw']:
            if not english_started:
                if not is_english_start_line(line):
                    continue
                english_started = True
            if is_english_content_line(line):
                english_lines.append(line.strip())
                previous_was_english = True
            elif previous_was_english and is_numeric_choice_continuation(line, english_lines[-1]):
                english_lines.append(line.strip())
            else:
                previous_was_english = False
        english = ' '.join(english_lines)
        question, options = split_question_text(english)
        source_key = f"{job_code}-{current['work']}-{current['number']:03d}"
        records.append({
            'q': question,
            'options': options,
            'answer': current['answer'] - 1,
            'subject': '共同' if job_code.startswith('900') else '操作',
            'sourceKey': source_key,
        })
        current = None

    for raw_line in path.read_text(encoding='utf-8').splitlines():
        work_match = WORK_RE.search(raw_line)
        if work_match:
            finish_current()
            current_work = work_match.group(1).zfill(2)
            continue

        question_match = QUESTION_RE.match(raw_line.replace('\f', '').strip())
        if question_match:
            finish_current()
            if current_work is None:
                raise ValueError(f'{path.name}: 題號 {question_match.group(1)} 前找不到工作項目')
            current = {
                'number': int(question_match.group(1)),
                'answer': int(question_match.group(2)),
                'work': current_work,
                'raw': [],
            }
            continue

        if current is not None:
            current['raw'].append(raw_line)

    finish_current()
    return records


def visual_asset_map(reference: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    assets: dict[str, dict[str, Any]] = {}
    for question in reference:
        copied = {
            field: question[field]
            for field in ('image', 'optionImages')
            if question.get(field)
        }
        if copied:
            assets[question['sourceKey']] = copied
    return assets


def validate_work_counts(records: list[dict[str, Any]], expected: dict[str, int], label: str) -> None:
    actual = Counter(record['sourceKey'].split('-')[1] for record in records)
    if dict(sorted(actual.items())) != dict(sorted(expected.items())):
        raise ValueError(f'{label}: 工作項目題數不符，實際 {dict(actual)}，預期 {expected}')


def build_category(
    operation_records: list[dict[str, Any]],
    common_records: list[dict[str, Any]],
    assets: dict[str, dict[str, Any]],
    meta: dict[str, Any],
) -> dict[str, Any]:
    questions = [dict(record) for record in operation_records + common_records]
    source_keys = [question['sourceKey'] for question in questions]
    if len(source_keys) != len(set(source_keys)):
        duplicates = [key for key, count in Counter(source_keys).items() if count > 1]
        raise ValueError(f"{meta['id']}: sourceKey 重複: {duplicates[:5]}")

    for question in questions:
        copied = assets.get(question['sourceKey'])
        if copied:
            question.update(copied)
        if question.get('optionImages'):
            if len(question['optionImages']) != 4:
                raise ValueError(f"{meta['id']}/{question['sourceKey']}: optionImages 非四張")
            question['options'] = ['①', '②', '③', '④']
        if len(question['options']) != 4 or any(not option for option in question['options']):
            raise ValueError(f"{meta['id']}/{question['sourceKey']}: 缺少四個文字選項且無有效 optionImages")
        if not question['q']:
            raise ValueError(f"{meta['id']}/{question['sourceKey']}: 題幹為空")
        if not 0 <= question['answer'] <= 3:
            raise ValueError(f"{meta['id']}/{question['sourceKey']}: 答案索引異常")
        text = question['q'] + ''.join(question['options'])
        if HAN_RE.search(text):
            raise ValueError(f"{meta['id']}/{question['sourceKey']}: 英文文字仍含中文")

    if len(questions) != meta['expected_total']:
        raise ValueError(f"{meta['id']}: 題數 {len(questions)}，預期 {meta['expected_total']}")

    for index, question in enumerate(questions, start=1):
        question['id'] = index

    return {
        'id': meta['id'],
        'name': meta['name'],
        'group': meta['group'],
        'total': len(questions),
        'questions': questions,
    }


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main() -> None:
    args = parse_args()
    missing = [name for name in SOURCE_FILES if not (args.source_dir / name).is_file()]
    if missing:
        raise SystemExit(f'缺少來源檔: {", ".join(missing)}')

    fixed_assets = visual_asset_map(load_json(args.fixed_reference))
    forklift_assets = visual_asset_map(load_json(args.forklift_reference))
    parsed: dict[str, list[dict[str, Any]]] = {}
    for filename, job_code in FILE_JOB_CODES.items():
        parsed[job_code] = parse_pdf_text(args.source_dir / filename, job_code)

    validate_work_counts(parsed['06100'], CATEGORY_META['06100']['expected_work_counts'], '固定式起重機英文')
    validate_work_counts(parsed['15100'], CATEGORY_META['15100']['expected_work_counts'], '堆高機英文')
    for code, expected in COMMON_EXPECTED.items():
        validate_work_counts(parsed[code], {expected['work']: expected['count']}, f'共同科目 {code}')

    common_records = [
        record
        for code in ('90006', '90007', '90008', '90009')
        for record in parsed[code]
    ]
    fixed = build_category(parsed['06100'], common_records, fixed_assets, CATEGORY_META['06100'])
    forklift = build_category(parsed['15100'], common_records, forklift_assets, CATEGORY_META['15100'])

    args.output_dir.mkdir(parents=True, exist_ok=True)
    fixed_path = args.output_dir / f"{fixed['id']}.json"
    forklift_path = args.output_dir / f"{forklift['id']}.json"
    write_json(fixed_path, fixed)
    write_json(forklift_path, forklift)

    report = {
        'official_source_files': list(SOURCE_FILES),
        'categories': [
            {
                'id': category['id'],
                'name': category['name'],
                'total': category['total'],
                'operation_count': sum(1 for question in category['questions'] if question['subject'] == '操作'),
                'common_count': sum(1 for question in category['questions'] if question['subject'] == '共同'),
                'image_count': sum(1 for question in category['questions'] if question.get('image')),
                'option_image_count': sum(1 for question in category['questions'] if question.get('optionImages')),
                'sha256': hashlib.sha256(
                    (args.output_dir / f"{category['id']}.json").read_bytes()
                ).hexdigest(),
            }
            for category in (fixed, forklift)
        ],
    }
    write_json(args.output_dir / 'build_report.json', report)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
