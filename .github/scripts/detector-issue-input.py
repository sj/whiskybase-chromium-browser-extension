"""Turn a "Page detected wrongly" issue into input for the detector workflow.

Reads the issue as returned by the GitHub API (JSON), takes the issue form's
fields as plain data, downloads the zipped pages it links to and unpacks the
.html file from each zip in memory. Nothing in the issue is ever run or used
as a path:

    python3 -I .github/scripts/detector-issue-input.py issue.json OUT_DIR OWNER/REPO

Writes to OUT_DIR (which must be new or empty):
  result.json      {"ok": true, ...} or {"ok": false, "error": "..."}
  fields.json      the form's fields by id, as strings
  page.html        the saved page
  whiskybase.html  the saved Whiskybase page, if attached

Problems with the report itself (missing attachment, bad zip, ...) give
"ok": false and exit 0, so the workflow can tell the reporter; only bugs
exit non-zero.
"""
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile

# Labels from .github/ISSUE_TEMPLATE/detector.yml, in the order the form shows them.
LABELS = {
    'Page URL': 'page-url',
    'Saved page (zipped HTML)': 'page-html',
    'What the extension shows': 'what-happened',
    'Distillery': 'distillery',
    'ABV (%)': 'abv',
    'Bottle name': 'name',
    'Bottler': 'bottler',
    'Age (years)': 'age',
    'Vintage (year distilled)': 'vintage',
    'Bottled (year)': 'bottled',
    'Volume': 'volume',
    'Cask number': 'cask-number',
    'Other details': 'other-details',
    'Whiskybase entry': 'whiskybase-url',
    'Saved Whiskybase page (zipped HTML)': 'whiskybase-html',
    'Extension version': 'version',
}
LONG_FIELDS = {'what-happened', 'other-details'}

MAX_ZIP_BYTES = 25 * 1024 * 1024    # GitHub's own limit for attachments
MAX_HTML_BYTES = 20 * 1024 * 1024
MAX_MEMBERS = 500


class ReportError(Exception):
    pass


def clean(value, limit):
    # Plain text only: no control or invisible formatting characters.
    value = re.sub(r'[\x00-\x08\x0b-\x1f\x7f​-‏‪-‮⁠-⁯﻿]', '', value)
    value = re.sub(r'<!--.*?-->', '', value, flags=re.S).strip()
    return '' if value == '_No response_' else value[:limit]


def parse_form(body):
    fields = {v: '' for v in LABELS.values()}
    for section in re.split(r'^### ', '\n' + body.replace('\r\n', '\n'), flags=re.M)[1:]:
        heading, _, value = section.partition('\n')
        field = LABELS.get(heading.strip())
        if field:
            fields[field] = clean(value, 4000 if field in LONG_FIELDS else 300)
    return fields


def attachment_url(text, repo):
    # Only GitHub's own attachment storage, never another host.
    m = re.search(r'https://github\.com/(?:user-attachments/files|' + re.escape(repo) +
                  r'/files)/\d+/[A-Za-z0-9._%+-]+\.zip\b', text)
    return m.group(0) if m else None


def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'detector-issue-workflow'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read(MAX_ZIP_BYTES + 1)
    if len(data) > MAX_ZIP_BYTES:
        raise ReportError(f'The attachment {url} is larger than 25 MB.')
    return data


def html_from_zip(data, what):
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ReportError(f'The {what} attachment is not a valid zip file.')
    members = zf.infolist()
    if len(members) > MAX_MEMBERS:
        raise ReportError(f'The {what} zip contains too many files.')
    pages = [m for m in members if not m.is_dir() and re.search(r'\.html?$', m.filename, re.I)
             and not m.filename.startswith('__MACOSX/')]
    if not pages:
        raise ReportError(f'The {what} zip contains no .html file.')
    # A page saved as "Webpage, Complete" has its resources in a folder; the
    # page itself is the .html file nearest the top, and the largest of those.
    page = min(pages, key=lambda m: (m.filename.count('/'), -m.file_size))
    if page.file_size > MAX_HTML_BYTES:
        raise ReportError(f'The {what} page is larger than 20 MB.')
    with zf.open(page) as f:
        raw = f.read(MAX_HTML_BYTES + 1)
    if len(raw) > MAX_HTML_BYTES:
        raise ReportError(f'The {what} page is larger than 20 MB.')
    try:
        html = raw.decode('utf-8')
    except UnicodeDecodeError:
        html = raw.decode('cp1252', errors='replace')
    if not re.search(r'<(?:!doctype\s+html|html|head|body)\b', html[:20000], re.I):
        raise ReportError(f'The .html file in the {what} zip does not look like a web page.')
    return html


def slug(text, limit):
    s = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return s[:limit].rstrip('-')


def fixture_names(page_url, wb_url, number):
    u = urllib.parse.urlsplit(page_url)
    host = (u.hostname or '').removeprefix('www.')
    if u.scheme not in ('http', 'https') or not re.fullmatch(r'[a-z0-9.-]+\.[a-z]{2,}', host):
        raise ReportError('The page URL is not a valid http(s) address.')
    parts = [p for p in u.path.split('/') if p]
    bottle = slug(re.sub(r'\.(?:html?|php|aspx?)$', '', parts[-1], flags=re.I), 80) if parts else ''
    base = f'{host}-{bottle or f"issue-{number}"}'
    page = f'{base}-product-page.html'
    m = re.fullmatch(r'https?://(?:www\.)?whiskybase\.com/whiskies/whisky/(\d+)(?:[/?#].*)?', wb_url)
    wb = f'{base}-whiskybase-bottle-page-WB{m.group(1)}.html' if m else f'{base}-whiskybase-bottle-page.html'
    return page, wb


def main():
    issue_path, out_dir, repo = sys.argv[1:4]
    os.makedirs(out_dir, exist_ok=True)
    if os.listdir(out_dir):
        sys.exit(f'{out_dir} is not empty')
    with open(issue_path, encoding='utf-8') as f:
        issue = json.load(f)
    result = {'ok': False, 'error': '', 'fixture': '', 'whiskybase_fixture': ''}
    try:
        if 'detector' not in [label['name'] for label in issue.get('labels', [])]:
            raise ReportError('The issue does not have the "detector" label.')
        fields = parse_form(issue.get('body') or '')
        for required in ('page-url', 'distillery', 'abv'):
            if not fields[required]:
                raise ReportError(f'The issue has no "{required}" field; was it opened with the "Page detected wrongly" form?')
        result['fixture'], wb_name = fixture_names(fields['page-url'], fields['whiskybase-url'], issue['number'])

        url = attachment_url(fields['page-html'], repo)
        if not url:
            raise ReportError('No zipped page is attached under "Saved page (zipped HTML)".')
        with open(os.path.join(out_dir, 'page.html'), 'w', encoding='utf-8') as f:
            f.write(html_from_zip(download(url), 'saved page'))

        url = attachment_url(fields['whiskybase-html'], repo)
        if url:
            with open(os.path.join(out_dir, 'whiskybase.html'), 'w', encoding='utf-8') as f:
                f.write(html_from_zip(download(url), 'Whiskybase page'))
            result['whiskybase_fixture'] = wb_name

        # The attachments are in the files; their links are of no use to the agent.
        for field in ('page-html', 'whiskybase-html'):
            fields[field] = 'attached' if attachment_url(fields[field], repo) else ''
        with open(os.path.join(out_dir, 'fields.json'), 'w', encoding='utf-8') as f:
            json.dump(fields, f, indent=2, ensure_ascii=False)
        result['ok'] = True
    except ReportError as e:
        result['error'] = str(e)
    except OSError as e:
        result['error'] = f'An attachment could not be downloaded ({e.__class__.__name__}).'
    with open(os.path.join(out_dir, 'result.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
