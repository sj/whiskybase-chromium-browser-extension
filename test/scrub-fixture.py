"""Replace personal account data in saved fixture pages with neutral stand-ins.

Pages saved while signed in (Whiskybase, Whisky Auctioneer, ...) contain your
name, email, username, account IDs and session tokens. Tokens and account
fields are recognised by their markup; your own details are passed as options,
so they are never stored in the project:

    python3 test/scrub-fixture.py --name "First Last" --email you@example.org \\
        --username yourname --id 12345 test/fixtures/whiskybase/new-page.html

Afterwards, search the page for anything you passed to check nothing is left.
"""
import argparse
import re

# Markup that holds account data or session tokens, whoever is signed in.
STRUCTURAL = [
    (r'(<meta name="csrf-token" content=")[^"]+(")', r'\1scrubbed-csrf-token\2'),
    (r'(name="_token"(?: type="hidden")? value=")[^"]+(")', r'\1scrubbed-csrf-token\2'),
    (r'(type="hidden" name="_token" value=")[^"]+(")', r'\1scrubbed-csrf-token\2'),
    (r"(var c = ')[A-Za-z0-9]{30,}(')", r'\1scrubbed-csrf-token\2'),
    (r'(name="form_token" value=")[^"]+(")', r'\1scrubbed-form-token\2'),
    (r'("permissionsHash":")[0-9a-f]+(")', r'\g<1>' + '0' * 64 + r'\2'),
    (r'("user":\{"uid":")\d+(")', r'\g<1>10001\2'),
    (r'("(?:membership_date|registration_date|last_seen)":")[^"]+(")', r'\1Jan 01 2020 00:00:00\2'),
    (r"(window\.user\.country = ')[^']*(')", r'\1Unknown\2'),
    (r'("identify":\{"email":")[^"]*(","\$first_name":")[^"]*(","\$last_name":")[^"]*(")',
     r'\1user@example.com\2Example\3User\4'),
    (r'("profile":\{"user_id":)\d+(,"name":")[^"]*(","email":")[^"]*(")', r'\g<1>10001\2Example User\3user@example.com\4'),
]


def personal_rules(args):
    rules = []
    for name in args.name:
        rules.append((re.escape(name).replace(r'\ ', r'\s+'), 'Example User'))
        rules += [(re.escape(part), 'Example') for part in name.split()[:1]]
    rules += [(re.escape(e), 'user@example.com') for e in args.email]
    rules += [(r'(?<![A-Za-z0-9])' + re.escape(u) + r'(?![A-Za-z0-9])', 'example-user') for u in args.username]
    rules += [(r'\b' + re.escape(i) + r'\b', '10001') for i in args.id]
    return rules


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('files', nargs='+')
    p.add_argument('--name', action='append', default=[], help='your full name (repeatable)')
    p.add_argument('--email', action='append', default=[], help='your email address (repeatable)')
    p.add_argument('--username', action='append', default=[], help='your username on the site (repeatable)')
    p.add_argument('--id', action='append', default=[], help='your account number on the site (repeatable)')
    args = p.parse_args()
    rules = [(re.compile(pat, re.I), rep) for pat, rep in personal_rules(args) + STRUCTURAL]
    for path in args.files:
        with open(path, encoding='utf-8') as f:
            s = f.read()
        total = 0
        for pat, rep in rules:
            s, n = pat.subn(rep, s)
            total += n
        with open(path, 'w', encoding='utf-8') as f:
            f.write(s)
        print(f'{total:4d} replacements  {path}')


if __name__ == '__main__':
    main()
