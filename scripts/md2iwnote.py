"""Markdown 글을 IWAE 노트(.iwnote)로 바꿔 Vault 의 「노트」 폴더에 둔다.

IWAE 의 「노트」 목록은 `<Vault>/노트/<제목>.iwnote`(JSON)만 읽는다. 같은 폴더의 .md 는 보이지 않는다.

    python scripts/md2iwnote.py <정리.md> <Vault 폴더> [노트 제목]

- `# 제목` 은 노트 이름(제목을 따로 주지 않았을 때), `## 소제목` 은 소제목 블록이 된다.
- 소제목 사이의 글은 글 블록 하나가 된다. 목록(- , 들여쓴 하위 목록, 1.), **굵게**, ~~취소선~~, `코드`, ``` 코드 블록,
  > 인용, - [ ] 할 일, ### 제목, --- 구분선을 옮긴다.
- 표(| 칸 | 칸 |)는 노트의 표로 바꾼다.
- 같은 이름의 노트가 이미 있으면 덮지 않고 멈춘다(앱이 열어 둔 노트를 밖에서 덮으면 앱이 나중에 되돌려 쓴다).
"""
import html
import json
import os
import random
import re
import string
import sys
import time

# 노트 글 블록이 받는 태그: b strong i em u s span ul ol li br div p code pre blockquote h2 h3 h4 hr
# (할 일 목록: <ul data-type="check"><li data-checked="true|false">)
counter = 0


def new_id():
    global counter
    counter += 1
    return 'b' + format(int(time.time() * 1000), 'x') + format(counter, 'x') + ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))


def inline(text):
    out = html.escape(text, quote=False)
    out = re.sub(r'`([^`]+)`', r'<code>\1</code>', out)
    out = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', out)
    out = re.sub(r'~~([^~]+)~~', r'<s>\1</s>', out)
    out = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', out)
    return out


def plain(text):
    text = re.sub(r'(\*\*|~~)([^*~]+)\1', r'\2', text.replace('`', ''))
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', text)


def convert(lines):
    title = None
    blocks = []
    buf = []  # (indent, 'li' | 'ol' | 'ck' | 'p' | 'h3' | 'h4' | 'q' | 'pre' | 'hr', text)

    def flush():
        if not buf:
            return
        parts_html, parts_text = [], []
        i = 0
        while i < len(buf):
            indent, kind, text = buf[i]
            if kind in ('q', 'ol', 'ck'):
                # 같은 종류의 줄을 한 덩이로
                rows = []
                while i < len(buf) and buf[i][1] == kind:
                    rows.append(buf[i][2])
                    i += 1
                if kind == 'q':
                    parts_html.append('<blockquote>' + '<br>'.join(inline(r) for r in rows) + '</blockquote>')
                    parts_text.extend(plain(r) for r in rows)
                elif kind == 'ol':
                    parts_html.append('<ol>' + ''.join(f'<li>{inline(r)}</li>' for r in rows) + '</ol>')
                    parts_text.extend(f'{n}. {plain(r)}' for n, r in enumerate(rows, 1))
                else:
                    parts_html.append('<ul data-type="check">' + ''.join(
                        f'<li data-checked="{"true" if r[0] == "x" else "false"}">{inline(r[1:])}</li>' for r in rows) + '</ul>')
                    parts_text.extend(('☑ ' if r[0] == 'x' else '☐ ') + plain(r[1:]) for r in rows)
                continue
            if kind in ('th', 'tr'):
                # 이어진 표 줄을 표 하나로(노트는 표를 그린다)
                head, body = [], []
                while i < len(buf) and buf[i][1] in ('th', 'tr'):
                    (head if buf[i][1] == 'th' and not body else body).append(buf[i][2])
                    i += 1
                cell = lambda tag, c: f'<{tag}>{inline(c) or "<br>"}</{tag}>'
                table = '<table>'
                if head:
                    table += '<thead>' + ''.join('<tr>' + ''.join(cell('th', c) for c in row) + '</tr>' for row in head) + '</thead>'
                table += '<tbody>' + ''.join('<tr>' + ''.join(cell('td', c) for c in row) + '</tr>' for row in body) + '</tbody></table>'
                parts_html.append(table)
                parts_text.extend(' | '.join(plain(c) for c in row) for row in head + body)
                continue
            if kind == 'pre':
                parts_html.append('<pre>' + '<br>'.join(html.escape(row, quote=False) for row in text.split('\n')) + '</pre>')
                parts_text.append(text)
                i += 1
                continue
            if kind == 'hr':
                parts_html.append('<hr>')
                i += 1
                continue
            if kind != 'li':
                parts_html.append(f'<{kind}>{inline(text)}</{kind}>' if kind in ('h3', 'h4') else f'<div>{inline(text)}</div>')
                parts_text.append(plain(text))
                i += 1
                continue
            base = indent
            items = []
            while i < len(buf) and buf[i][1] == 'li' and buf[i][0] <= base:
                item = inline(buf[i][2])
                parts_text.append('• ' + plain(buf[i][2]))
                i += 1
                subs = []
                while i < len(buf) and buf[i][1] == 'li' and buf[i][0] > base:
                    subs.append(f'<li>{inline(buf[i][2])}</li>')
                    parts_text.append('  - ' + plain(buf[i][2]))
                    i += 1
                if subs:
                    item += '<ul>' + ''.join(subs) + '</ul>'
                items.append(f'<li>{item}</li>')
            parts_html.append('<ul>' + ''.join(items) + '</ul>')
        blocks.append({'id': new_id(), 'kind': 'text', 'text': '\n'.join(parts_text), 'html': ''.join(parts_html)})
        buf.clear()

    code = None  # ``` 안의 줄들
    for raw in lines:
        line = raw.rstrip()
        if line.lstrip().startswith('```'):
            if code is None:
                code = []
            else:
                buf.append((0, 'pre', '\n'.join(code)))
                code = None
            continue
        if code is not None:
            code.append(line)
            continue
        if line.startswith('# ') and title is None and not blocks and not buf:
            title = line[2:].strip()
            continue
        if line.startswith('## '):
            flush()
            blocks.append({'id': new_id(), 'kind': 'section', 'title': plain(line[3:].strip())})
            continue
        if re.match(r'^#{1,6} ', line):
            level = len(line) - len(line.lstrip('#'))
            buf.append((0, 'h3' if level <= 3 else 'h4', line.lstrip('#').strip()))
            continue
        if line.strip() == '':
            continue
        if re.fullmatch(r'(-{3,}|\*{3,}|_{3,})', line.strip()):
            buf.append((0, 'hr', ''))
            continue
        if line.startswith('>'):
            buf.append((0, 'q', line.lstrip('>').strip()))
            continue
        if line.startswith('|'):
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if all(re.fullmatch(r':?-+:?', c) for c in cells):
                # 구분 줄: 바로 앞 줄이 머리줄이다
                if buf and buf[-1][1] == 'tr':
                    buf[-1] = (0, 'th', buf[-1][2])
                continue
            buf.append((0, 'tr', cells))
            continue
        m = re.match(r'^\s*[-*+] \[([ xX])\] ?(.*)$', line)
        if m:
            buf.append((0, 'ck', ('x' if m.group(1).lower() == 'x' else ' ') + m.group(2)))
            continue
        m = re.match(r'^\s*\d+[.)] (.*)$', line)
        if m:
            buf.append((0, 'ol', m.group(1)))
            continue
        m = re.match(r'^(\s*)[-*+] (.*)$', line)
        if m:
            buf.append((len(m.group(1)), 'li', m.group(2)))
            continue
        buf.append((0, 'p', line.strip()))
    if code is not None:
        buf.append((0, 'pre', '\n'.join(code)))
    flush()
    for block in blocks:
        if block['kind'] == 'text':
            block['text'] = block['text'].replace('\0', '')
            block['html'] = block['html'].replace('\0', '')
    return title, blocks


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    source, vault = sys.argv[1], sys.argv[2]
    with open(source, encoding='utf-8') as f:
        title, blocks = convert(f.read().splitlines())
    name = sys.argv[3] if len(sys.argv) > 3 else (title or os.path.splitext(os.path.basename(source))[0])
    name = re.sub(r'[\\/:*?"<>|]', ' ', name).strip()
    folder = os.path.join(vault, '노트')
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, name + '.iwnote')
    # 노트 제목은 하위 폴더까지 통틀어 겹치지 않아야 한다(앱·MCP 가 제목으로 노트를 찾는다)
    for parent, _dirs, files in os.walk(folder):
        for file in files:
            if file.lower() == (name + '.iwnote').lower():
                sys.exit(f'이미 있음: {os.path.join(parent, file)} (다른 제목을 주거나, 앱에서 지운 뒤 다시)')
    with open(target, 'x', encoding='utf-8') as f:
        f.write(json.dumps({'version': 1, 'blocks': blocks}, ensure_ascii=False, indent=2) + '\n')
    sections = [b['title'] for b in blocks if b['kind'] == 'section']
    print(f'만듦: {target}\n블록 {len(blocks)}개, 소제목: {", ".join(sections) or "(없음)"}')


if __name__ == '__main__':
    main()
