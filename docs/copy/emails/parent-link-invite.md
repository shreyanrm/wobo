# parent-link-invite

**Kind:** transactional
**Trigger:** a learner or parent creates the parent link and enters the parent's email
**To:** the parent
**From:** Wobo <hello@mail.heywobo.com> · **Reply-to:** support@heywobo.com
**Send:** immediately
**Category:** account. Not switchable off; the link itself can be ended at any time by either side.

## Subject lines
**Primary:** {{learner_first_name}} set up a weekly update for you
Alternates: A weekly page from {{learner_first_name}}'s learning

## Preview text
One page a week. No dashboard, nothing to check daily.

## Body

Hello.

{{learner_first_name}} uses Wobo, a tutor that teaches by drawing on their own school syllabus, and has set up a weekly update for you.

Once a week you will get one page: what they studied, what they cracked, and one thing they drew. It takes about a minute to read.

[See this week's page]

**What you will not get.** Their conversations with me. A list of their wrong answers. A notification when they are online. Anything that lets you set targets for them. It is a window into the work, not a monitor.

You can stop the weekly page at any time from the page itself, and so can {{learner_first_name}}.

{{consent_block}}

## Variables
| Variable | Example | Notes |
|---|---|---|
| `learner_first_name` | (from the account) | |
| `page_url` | https://heywobo.com/p/... | Signed, revocable, no account needed to view |
| `consent_block` | — | Present only where the learner is under 18 and consent is outstanding: one short paragraph explaining what needs consent, what it turns on, and a link. Never bundled with the weekly page; a parent may consent without taking the page, and take the page without consenting. |

## Rules
- Written to the parent, in plain language, assuming no knowledge of the product.
- No plan pitch in the invite. The upgrade conversation, if any, belongs on the weekly page, once the parent has seen something worth paying for.
- Never implies the child is behind, at risk, or in need of intervention.
