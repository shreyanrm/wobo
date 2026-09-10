# verify-email

**Kind:** transactional
**Trigger:** an email address is added to an account, or used to sign in for the first time
**To:** the address being verified
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** immediately
**Category:** account. Not switchable off.

## Subject lines
**Primary:** Your Wobo code is {{code}}
Alternates: Confirm this email for Wobo

## Preview text
The code expires in {{expiry_minutes}} minutes. If this was not you, ignore this.

## Body

Enter this code in Wobo to confirm {{email_address}}.

**{{code}}**

It works for {{expiry_minutes}} minutes and once only.

[Or confirm with one tap]

If you did not ask for this, nothing has happened to your account and you can ignore this message. If it keeps arriving, write to support@heywobo.com and we will look.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `code` | 418 205 | Grouped for reading aloud; also in the subject so it can be read from a notification |
| `email_address` | aditi@example.com | The address being verified |
| `expiry_minutes` | 15 | Must match the real expiry |
| `verify_url` | https://heywobo.com/verify?t=... | One-tap link, same expiry |

## Rules
- Nothing else in this email. No product news, no links to lessons, no footer marketing.
- Same copy for the phone-number version with "code" and the number substituted, sent by SMS, under 160 characters.
