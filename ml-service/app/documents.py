"""Extract complete documents and identify reviewable requirement units.

The page markers are internal metadata, not requirement content. In particular,
text chunks of arbitrary length are never advertised as business requirements.
"""
from io import BytesIO
from pathlib import Path
import re
import zipfile
from pypdf import PdfReader
from docx import Document

MAX_TEXT = 1_500_000
_ID = re.compile(r'(?i)^\s*(?:[-*•]\s*)?((?:REQ|BR|FR|NFR|Требование|ТР)[\s._:-]*\d{1,6})(?:[\s:.)-]+|$)(.*)$')
_MARKER = re.compile(r'^\[Страница (\d+)\]$')
_MODAL = re.compile(r'(?i)\b(должен|должна|должно|должны|необходимо|запрещено|обязан|shall|must|should)\b')


def extract(name: str, raw: bytes) -> str:
    ext = Path(name).suffix.lower()
    if ext == '.pdf':
        reader = PdfReader(BytesIO(raw))
        if reader.is_encrypted:
            raise ValueError('PDF защищён паролем. Загрузите доступную копию.')
        if len(reader.pages) > 500:
            raise ValueError('Максимум 500 страниц на документ.')
        parts = []
        for i, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ''
            if text.strip():
                parts.append(f'[Страница {i}]\n{text}')
        text = '\n\n'.join(parts)
    elif ext == '.docx':
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            if sum(f.file_size for f in archive.infolist()) > 50_000_000:
                raise ValueError('Распакованный DOCX превышает 50 МБ.')
        doc = Document(BytesIO(raw))
        # Preserve the document order: a table between REQ headings belongs
        # to the preceding requirement, not to the final paragraph.
        blocks = []
        for block in doc.iter_inner_content():
            if hasattr(block, 'rows'):
                blocks.extend(' | '.join(cell.text for cell in row.cells) for row in block.rows)
            else:
                blocks.append(block.text)
        text = '\n'.join(blocks)
    elif ext in ('.txt', '.md', '.py', '.js', '.ts', '.java'):
        text = raw.decode('utf-8-sig')
    else:
        raise ValueError('Поддерживаются PDF, DOCX, MD, TXT, PY, JS, TS и JAVA.')
    if not text.strip():
        raise ValueError('Текст не найден. Для сканированного PDF нужен OCR — в этой версии он ещё не подключён.')
    if len(text) > MAX_TEXT:
        raise ValueError('Извлечённый текст превышает 1,5 млн символов; файл не обрезан. Разделите документ.')
    return text.strip()


# Numbered bullets are subordinate to REQ headings. A decimal such as 109.99
# must never become a new requirement or a numbered condition.
_NUMBERED_HEADING = re.compile(r'^\s*([1-9]\d{0,2})[.)]\s+(?!\d)(.+)$')
_CONDITION = re.compile(r'(?<![\w.])([1-9]\d?)[.)]\s+(?=\S)')


def _conditions(text: str) -> list[dict]:
    """Optional nested metadata: never creates independent requirements."""
    hits = list(_CONDITION.finditer(text))
    if not hits or hits[0].group(1) != '1':
        return []
    # A list is convincing only when consecutive numbers occur; isolated
    # numeric references elsewhere in the paragraph must remain plain text.
    sequence = []
    for index, hit in enumerate(hits):
        number = int(hit.group(1))
        if number != len(sequence) + 1:
            break
        end = hits[index + 1].start() if index + 1 < len(hits) else len(text)
        statement = text[hit.end():end].strip()
        if statement:
            sequence.append({'number': number, 'text': statement})
    return sequence if len(sequence) > 1 else []


def requirements_from_text(text: str) -> list[dict]:
    """Group everything between explicit requirement headings under that ID.

    In documents without such headings, conservative numbered/modal extraction
    is labelled for review. Neither list items nor technical pages become
    additional top-level requirements in documents containing REQ IDs.
    """
    lines = text.splitlines()
    has_ids = any(_ID.match(line.strip()) for line in lines)
    units: list[dict] = []
    by_original_id: dict[str, dict] = {}
    current = None
    page = None
    unclassified: list[str] = []

    def flush():
        nonlocal current
        if current is None:
            return
        body = '\n'.join(current.pop('_lines')).strip()
        if body:
            current['text'] = body
            if not current['title']:
                current['title'] = next((part[:250] for part in body.splitlines()
                                         if part.strip() and not _ID.fullmatch(part.strip())), body[:250])
            current['title'] = current['title'][:250]
            conditions = _conditions(body)
            if conditions:
                current['conditions'] = conditions
            existing = by_original_id.get(current.get('originalId')) if has_ids else None
            if existing is None:
                units.append(current)
                if has_ids:
                    by_original_id[current['originalId']] = current
            else:
                # Repeated PDF heading (e.g. at a page break): merge, never
                # silently create another row for the same requirement ID.
                # The repeated REQ heading itself is not a new condition.
                first, _, rest = body.partition('\n')
                continuation = rest.strip() if _ID.match(first) else body
                if continuation and continuation not in existing['text']:
                    existing['text'] += '\n' + continuation
                if current.get('pageEnd'):
                    existing['pageEnd'] = max(existing.get('pageEnd') or 0, current['pageEnd'])
                merged = _conditions(existing['text'])
                if merged:
                    existing['conditions'] = merged
        current = None

    def start(line: str, title: str, original_id=None, kind='review'):
        nonlocal current
        flush()
        current = {
            'originalId': original_id, 'title': title.strip()[:250],
            'page': page, 'pageEnd': page, 'extraction': kind,
            '_lines': [line],
        }

    for raw in lines:
        line = raw.strip()
        marker = _MARKER.fullmatch(line)
        if marker:
            page = int(marker.group(1))
            continue
        if not line:
            if current is not None and current['_lines'] and current['_lines'][-1] != '':
                current['_lines'].append('')
            continue
        match = _ID.match(line) if has_ids else None
        if match:
            original_id = re.sub(r'[\s._:]+', '-', match.group(1).upper())
            title = match.group(2).lstrip(' \t:—–-')
            if current and current.get('originalId') == original_id:
                # A heading repeated in the same block is not a new object.
                if title and title != current['title'] and title not in current['_lines']:
                    current['_lines'].append(title)
                current['pageEnd'] = page
            else:
                start(line, title, original_id, 'explicit')
        elif has_ids:
            if current is not None:
                current['_lines'].append(line)
                current['pageEnd'] = page
            else:
                unclassified.append(line)
        else:
            numbered = _NUMBERED_HEADING.match(line)
            if numbered and _MODAL.search(numbered.group(2)):
                start(line, numbered.group(2), numbered.group(1), 'numbered')
            elif current is None:
                if _MODAL.search(line):
                    start(line, line, None, 'heuristic')
                else:
                    unclassified.append(line)
            else:
                current['_lines'].append(line)
                current['pageEnd'] = page
    flush()
    if not has_ids and unclassified and units:
        # Keep pre-heading context without manufacturing another top-level row.
        context = '\n'.join(unclassified).strip()
        if context:
            units[0]['text'] = context + '\n' + units[0]['text']
            units[0]['extraction'] = 'review'
    if not units:
        # A document with no explicit structure is a reviewable source block,
        # NOT a set of one-sentence invented business requirements.
        original = '\n'.join(x for x in lines if not _MARKER.fullmatch(x.strip())).strip()
        if original:
            units.append({'originalId': None, 'title': 'Требуется ручное выделение требований',
                          'text': original, 'page': 1 if '[Страница ' in text else None,
                          'extraction': 'review'})
    if len(units) > 2000:
        raise ValueError('Найдено более 2000 требований; разделите документ. Результат не обрезан.')
    return units

def chunks(text: str, size: int = 6000) -> list[str]:
    result = []
    while len(text) > size:
        boundary = text.rfind('\n', 0, size)
        if boundary < size // 2:
            boundary = size
        result.append(text[:boundary].strip())
        text = text[boundary:].strip()
    if text:
        result.append(text)
    return result
