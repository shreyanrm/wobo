# password-reset

> **Status: do not ship. Blocked on the same owner ruling as help article 07.** WOBO-PLAN §6 specifies a third-party account button and phone OTP, and no password path at all. This spec exists only if the owner confirms that an optional password is being built.

**Kind:** transactional
**Trigger:** a password reset is requested for an account that has a password set
**To:** the account's verified email address
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** immediately
**Category:** account. Not switchable off.

## Subject lines
**Primary:** Reset your Wobo password
Alternates: Set a new password for Wobo

## Preview text
The link works for {{expiry_minutes}} minutes. If this was not you, your account is fine.

## Body

Someone asked to reset the password for the Wobo account on {{email_address}}.

[Set a new password]

The link works for {{expiry_minutes}} minutes and once only.

If it was not you, you do not need to do anything. Your password has not changed and nobody can get in with this link once it expires. If you would like us to check the account, write to support@heywobo.com.

You can also sign in without a password at any time, with a code sent to {{email_address}} or to your phone number.

## Variables
| Variable | Example | Notes |
|---|---|---|
| `email_address` | aditi@example.com | The account address |
| `reset_url` | https://heywobo.com/reset?t=... | Single use |
| `expiry_minutes` | 30 | Must match the real expiry |

## Rules
- Never state whether an account exists for an address that was not found; the request path returns the same message either way and this email is simply not sent.
- No device, location or IP detail in the body. It alarms more often than it helps and is frequently wrong.
