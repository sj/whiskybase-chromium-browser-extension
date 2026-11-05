"""Write the pull request or issue comment for the detector workflow.

    python3 -I .github/scripts/detector-issue-report.py RESULT_JSON AGENT_JSON OUT_DIR

RESULT_JSON is detector-issue-input.py's result, AGENT_JSON the agent's
structured output (may be missing or empty). The rest comes from the
environment: ISSUE, FIXTURE, FIX_RESULT (the fix job's result),
PASSED ("true" when the verify job's checks and tests passed) and RUN_URL.

Prints "action=pr" or "action=comment" for $GITHUB_OUTPUT and writes to
OUT_DIR: body.md, and for a pull request also title.txt and commit.txt. The
agent's text is quoted as data: HTML is escaped and @mentions are defused.
"""
import json
import os
import re
import sys

TEMPLATE = '.github/pull_request_template.md'


def load(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def quote(text, limit=3000):
    text = str(text or '').strip()[:limit]
    text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return re.sub(r'@(?=\w)', '@​', text)  # no notifications from the agent's text


def emails_in_patch(path):
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            added = '\n'.join(line for line in f if line.startswith('+'))
    except OSError:
        return []
    found = re.findall(r'[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})', added)
    return sorted({d.lower() for d in found} - {'example.com', 'example.org'})


def pr_body(issue, summary, fixture, domains, run_url):
    with open(TEMPLATE, encoding='utf-8') as f:
        t = f.read()
    t = re.sub(r'\A<!--.*?-->\s*', '', t, flags=re.S)
    t = re.sub(r'<!-- Which page.*?-->', lambda _: summary, t, flags=re.S)
    t = t.replace('Fixes #<!-- issue number -->', f'Fixes #{issue}')
    head, sep, rest = t.partition('## Detector fixes')
    section, sep2, tail = rest.partition('\n## ')
    # Checked by the workflow; personal data is left for the reviewer to confirm.
    section = re.sub(r'- \[ \] (?=The page is added|`test/run.mjs` has|`npm test` passes)', '- [x] ', section)
    t = head + sep + section + sep2 + tail
    privacy = (f'Email addresses in the new fixture are at: {", ".join(domains)}. Check that none is a visitor\'s.'
               if domains else 'The new fixture contains no email addresses.')
    return (t.rstrip() + '\n\n## Opened by the detector workflow\n\n'
            f'Made by a Claude agent from issue #{issue} ([workflow run]({run_url})). '
            'The workflow checked that only `src/detector.js`, `test/run.mjs` and the new fixture changed, '
            'and ran `npm test` on a fresh runner.\n\n'
            f'New fixture: `{fixture}`\n\n'
            'Before merging:\n\n'
            '- Check the fixture for personal information (names, email addresses, usernames, account IDs). '
            f'It was cleaned with the structural rules of `test/scrub-fixture.py`, and the agent looked for what remained. {privacy}\n'
            '- Review the detector change; the agent worked from the issue and the page, which are untrusted input.\n'
            '- The Tests workflow does not start for pull requests opened by GitHub Actions: '
            'close and reopen this pull request, or push to its branch, to run it.\n\n'
            '🤖 Generated with [Claude Code](https://claude.com/claude-code)\n')


def main():
    result_path, agent_path, out_dir = sys.argv[1:4]
    env = os.environ
    issue = env['ISSUE']
    result, agent = load(result_path), load(agent_path)
    os.makedirs(out_dir, exist_ok=True)
    summary, reason = quote(agent.get('summary')), quote(agent.get('reason'))
    run = f'[workflow run]({env["RUN_URL"]})'
    retry = 'A maintainer can run it again with a comment that starts with `/fix-detector`.'

    if result.get('ok') and agent.get('fixed') is True and env.get('PASSED') == 'true':
        patch = os.path.join(os.path.dirname(agent_path), 'changes.patch')
        body = pr_body(issue, summary, f'test/fixtures/{env["FIXTURE"]}', emails_in_patch(patch), env['RUN_URL'])
        page = re.sub(r'(-product-page)?(-WB\d+)?(-issue-\d+)?\.html$', '', env['FIXTURE'])
        title = f'Detector: fix {page}'
        with open(os.path.join(out_dir, 'title.txt'), 'w', encoding='utf-8') as f:
            f.write(title)
        with open(os.path.join(out_dir, 'commit.txt'), 'w', encoding='utf-8') as f:
            f.write(f'{title}\n\nAdds the page from #{issue} as a fixture with an expectation, '
                    'and adjusts the detector for it.\n\nFixes #' + issue + '\n')
        action = 'pr'
    elif not result.get('ok'):
        body = ('The detector workflow could not use this report: '
                f'{quote(result.get("error") or "unknown error")} ({run})\n\n'
                'Please edit the issue to fix this. ' + retry)
        action = 'comment'
    elif env.get('FIX_RESULT') != 'success':
        body = f'The detector workflow did not finish ({run}). ' + retry
        action = 'comment'
    elif agent.get('fixed') is not True:
        body = ('The detector workflow could not make the tests pass for this page, so it opened no pull request '
                f'({run}).\n\n**What it tried:**\n\n{summary or "_No summary._"}\n\n'
                f'**Why it stopped:**\n\n{reason or "_No reason given._"}\n\n' + retry)
        action = 'comment'
    else:
        body = ('The agent reported a fix, but the workflow\'s own checks of the changed files or `npm test` failed, '
                f'so it opened no pull request ({run}).\n\n**The agent\'s summary:**\n\n{summary or "_No summary._"}\n\n'
                + retry)
        action = 'comment'

    with open(os.path.join(out_dir, 'body.md'), 'w', encoding='utf-8') as f:
        f.write(body)
    print(f'action={action}')


if __name__ == '__main__':
    main()
