"""Replace personal account data in saved fixture pages with neutral stand-ins.

Pages saved while signed in (Whiskybase, Whisky Auctioneer, ...) contain your
name, email, username, account IDs and session tokens. Tokens and account
fields are recognised by their markup; your own details are passed as options,
so they are never stored in the project:

    python3 test/scrub-fixture.py --name "First Last" --email you@example.org \\
        --username yourname --id 12345 test/fixtures/whiskybase/new-page.html

Personal and payment fields in a Next.js page's embedded data (__NEXT_DATA__)
are replaced too, whoever they belong to: some auction sites embed other
bidders' and sellers' records. So are API keys and tokens (Google, Stripe,
AWS, GitHub, Slack, JWTs, and values named as a key, token or secret).

Afterwards, search the page for anything you passed to check nothing is left.
"""
import argparse
import json
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
    # Shopify's per-visit identifiers in var __st={...}.
    (r'(__st=\{[^}]*"reqid":")[^"]+(")', r'\g<1>00000000-0000-0000-0000-000000000000\2'),
    (r'(__st=\{[^}]*"u":")[0-9a-f]+(")', r'\g<1>000000000000\2'),
]


# API keys and tokens: by their own format, or by the name they are given in
# JSON, JavaScript or an attribute. Most are a site's own keys for the browser
# (Google Maps, Shopify's storefront, Stripe's publishable key), but a token
# can also be a visitor's. Case-sensitive where the format is, so that images
# and other encoded data in the page are left alone; no replacement matches
# its own pattern again, so a second run finds nothing.
KEY_NAMES = (r'api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|'
             r'app[_-]?secret|storefront[_-]?access[_-]?token')
KEYS = [
    (r'AIza[0-9A-Za-z_-]{35}', 'scrubbed-google-api-key', 0),
    (r'GOCSPX-[0-9A-Za-z_-]{20,}', 'scrubbed-google-client-secret', 0),
    (r'\b(sk|rk|pk)_(live|test)_[0-9A-Za-z]{10,}', r'\1_\2_scrubbed', 0),
    (r'\b(?:AKIA|ASIA)[0-9A-Z]{16}\b', 'scrubbed-aws-key-id', 0),
    (r'\b(?:gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{20,})', 'scrubbed-github-token', 0),
    (r'\bxox[abposr]-[0-9A-Za-z-]{10,}', 'scrubbed-slack-token', 0),
    (r'-----BEGIN ([A-Z ]*)PRIVATE KEY-----.*?-----END \1PRIVATE KEY-----', 'scrubbed-private-key', re.S),
    # JWTs (header.payload.signature), and Mapbox's tokens (pk./sk. and two parts).
    (r'\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', 'scrubbed.jwt.token', 0),
    (r'\b(pk|sk)\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', r'\1.scrubbed', 0),
    # The key in a Sentry address (https://<key>@o123.ingest.sentry.io/456).
    (r'(https?://)[0-9a-f]{32}(@[a-z0-9.-]*\bsentry\.io)', r'\1scrubbed\2', 0),
    # "apiKey": "...", access-token="...", StorefrontAccessToken = '...'.
    (r'(["\']?(?:' + KEY_NAMES + r')["\']?\s*[:=]\s*(["\']))(?!scrubbed)[A-Za-z0-9_.+/=-]{16,}(\2)',
     r'\1scrubbed-key\3', re.I),
]


# Keys in a page's embedded JSON that hold someone's personal or payment details.
# Next.js sites (Just Whisky) embed whole records of other bidders and sellers:
# contact details, birth dates and bank details.
PERSONAL_JSON = {
    'email': 'user@example.com',
    'first_name': 'Example',
    'last_name': 'User',
    'full_name': 'Example User',
    'birth_date': '01/01/1970',
    'phone_number': '440000000000',
    'additional_phone_number': None,
    'age': None,
    'company_name': None,
    'vat_number': None,
    'card_number': None,
    'sort_code': '000000',
    'account_number': '00000000',
    'addresses': [],
    # A seller's statement for a lot: notes, payout and bank details.
    'seller_sheet': None,
    'payment_details': None,
    # Account ids of the lots' winning bidders.
    'winner': None,
}
NEXT_DATA_RE = re.compile(r'(<script id="__NEXT_DATA__" type="application/json"[^>]*>)(.*?)(</script>)', re.S)


def scrub_json(value):
    """Replaces PERSONAL_JSON keys at any depth; returns the number of replacements."""
    count = 0
    if isinstance(value, dict):
        for key in value:
            if key in PERSONAL_JSON and value[key] not in (None, '', []) and value[key] != PERSONAL_JSON[key]:
                value[key] = PERSONAL_JSON[key]
                count += 1
            else:
                count += scrub_json(value[key])
    elif isinstance(value, list):
        for item in value:
            count += scrub_json(item)
    return count


def scrub_next_data(s):
    total = 0

    def replace(m):
        nonlocal total
        data = json.loads(m.group(2))
        total += scrub_json(data)
        return m.group(1) + json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + m.group(3)

    return NEXT_DATA_RE.sub(replace, s), total


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
    rules += [(re.compile(pat, flags), rep) for pat, rep, flags in KEYS]
    for path in args.files:
        # newline='': line endings stay as saved (a page may have \r\n).
        with open(path, encoding='utf-8', newline='') as f:
            s = f.read()
        s, total = scrub_next_data(s)
        for pat, rep in rules:
            s, n = substitute(pat, rep, s)
            total += n
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(s)
        print(f'{total:4d} replacements  {path}')


def substitute(pat, rep, s):
    """Like pat.subn, but only counts what changed (not a stand-in already there)."""
    count = 0

    def replace(m):
        nonlocal count
        new = m.expand(rep)
        count += new != m.group(0)
        return new

    return pat.sub(replace, s), count


if __name__ == '__main__':
    main()
