# AGENTS.md

Guidance for AI coding agents (Claude Code, Cursor, etc.) working on the DraftBox codebase.

---

## What this project is

DraftBox is a micro-SaaS that generates professional business documents (SOWs, MSAs, RFP responses, NDAs, change orders, etc.) for small-to-mid B2B service businesses — agencies, consultancies, contractors, ops teams. Users provide structured input through a form, the app uses the Anthropic API to generate a properly formatted document, and users edit, export, and reuse it.

**This is not a generic AI writing tool.** We deliberately avoid email writing, blog posts, and other commoditized use cases. The value proposition is specialized: structured business documents that follow professional conventions and would otherwise take hours to draft from scratch.

**Target customer:** small business operations managers, agency owners, B2B service founders, fractional consultants. People who expense $79/month for software without thinking, who produce these documents weekly, and who feel the pain of producing them manually.

Keep this positioning in mind when making product decisions. If a feature request sounds like "make this more like ChatGPT," it's probably the wrong direction. If it sounds like "make this more useful for an agency owner producing their fifth SOW this month," it's probably right.

---

## Tech stack

- **Backend:** Node.js + Express. Single `server.js` for now; split into `routes/` only when it exceeds ~400 lines.
- **Frontend:** Vanilla HTML, CSS, and JavaScript. No framework, no build step, no bundler.
- **Database:** Supabase (PostgreSQL). Client singleton in `lib/db.js`. Schema has two tables: `users` and `docs`. Column naming is snake_case in the DB; the JS layer maps back to camelCase for the client (`user_id` → `userId`, `voice_profile` → `voiceProfile`).
- **AI:** Anthropic API. Use `claude-sonnet-4-6` for paid-tier document generation, `claude-haiku-4-5-20251001` for free-tier and for any non-document AI calls (e.g. summarization, classification).
- **Hosting:** Render (Web Service, free tier). Auto-deploys from `main` branch on GitHub.
- **Payments:** Stripe (recurring subscriptions)

When you need a new dependency, add it sparingly. Justify it in a comment in `package.json` or in the PR description. We prefer 50 lines of vanilla JS over a 200KB dependency.

---

## Environment variables

Required on Render (Settings → Environment). Never commit these.

| Variable | Source |
|----------|--------|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` key (not `anon`) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `JWT_SECRET` | Generate with `openssl rand -base64 32` |

`PORT` is set automatically by Render — do not add it.

---

## Architecture conventions

### Document type registry

The most important architectural piece. All document types are defined in `lib/documentTypes.js` as a registry object. Each entry contains everything the rest of the app needs to know about that type: label, category, required fields, optional fields, prompt additions, output structure, badge color, and legal disclaimer flag.

When adding a new document type, add it to the registry — do not hardcode references anywhere else. The dashboard form, the API generation endpoint, the section navigator, and the badge styling all read from this registry. If you find yourself writing a `switch` statement on document type slug, you're doing it wrong; the data should live in the registry instead.

### Prompt construction

Prompts are built in `lib/promptBuilder.js`. There is a single base system prompt that defines Claude's role as a business document specialist. Each document type contributes a `systemPromptAddition` from the registry. The user message is assembled from the form fields as a structured brief. Output format instructions enforce the section structure defined in the registry's `outputStructure` field.

Don't write inline prompts in route handlers. Always go through the builder.

### Frontend structure

`dashboard.html` is the main app shell; CSS lives in `public/css/dashboard.css` and JS is split into `public/js/state.js`, `public/js/api.js`, and `public/js/dashboard.js`. The form in the new-document modal renders dynamically from the registry. Adding a new document type should not require editing `dashboard.html`.

Don't introduce a frontend framework to "clean it up." That's a trap.

### API endpoints

All API endpoints live under `/api/`. Auth-protected endpoints use the `authMiddleware` defined in `server.js`. The middleware sets `req.user`. Plan-limit enforcement happens at the endpoint level by reading the user's plan from the DB.

The current plan tiers are: Free trial (2 documents total), Starter ($29/mo, 15 docs/mo), Business ($79/mo, unlimited), Agency ($149/mo, unlimited + team seats). If you change these, update them consistently across `server.js` (planLimit/planModel helpers), the landing page pricing cards, and the dashboard sidebar upgrade card. Don't update them in only one place.

### Supabase queries

Use the client from `lib/db.js`. Always destructure `{ data, error }` and throw on error. Use `.single()` when expecting one row — it returns `data: null` (not an array) when nothing matches, so check `if (!data)` rather than `if (!data.length)`.

```js
const { data: user, error } = await supabase.from('users').select('*').eq('id', id).single();
if (error) throw error;
if (!user) return res.status(404).json({ error: 'Not found' });
```

---

## Visual design system

This is fixed. Don't deviate without explicit instruction.

- **Palette:** Warm paper `#f5f2ec`, cream `#ede9e0`, ink `#0f0e0d`, rust `#c2531a` (primary accent), muted `#7a756e` (secondary text), border `#d8d3ca`.
- **Typography:** Instrument Serif (display, headlines, document titles), DM Sans (body, UI). Both from Google Fonts.
- **Style:** Editorial, warm, refined. Think indie literary magazine meets professional services firm. Not "tech startup," not "AI tool," not "SaaS dashboard."
- **Spacing:** Generous. Whitespace is a feature.
- **Animations:** Subtle. Page-load reveals (fadeUp), hover transitions, typewriter effect on document generation. Nothing flashy.

When adding new UI, apply the same language. If you need a new color (e.g. for badge variants), pick from a small palette of muted tones consistent with the brand: slate, amber, sage, clay, ink, dust. Don't introduce arbitrary hex codes.

---

## Code style

- Clear names over clever names. `generateDocument` not `genDoc`. `documentTypeRegistry` not `dtr`.
- Short functions. If a function is over 40 lines, consider splitting it.
- Comments explain *why*, not *what*. The code shows what; the comments should explain the reasoning behind non-obvious decisions.
- Handle errors. Every `fetch` call needs a try/catch. Every API endpoint returns a proper error JSON on failure, never a raw stack trace.
- Validate input. Don't trust the client. Server-side validation is required for every field that affects generation or storage.
- Log usefully. `console.error` with context, not just the error object.

---

## What NOT to do

These are the most common mistakes AI agents make on this codebase. Watch for them.

- **Don't add frameworks.** No React, Vue, Svelte, Tailwind, Next.js, etc. The site is vanilla on purpose. It loads in under 500ms because of this. Don't fix what isn't broken.
- **Don't add user roles, permissions systems, or team-management UI** beyond the team-seat *count* on Agency plans. The real team-management feature is a future ticket.
- **Don't introduce a rich-text editor.** Plain text is intentional — easier to copy, easier to paste into the user's actual document workflow (Google Docs, Word, etc.).
- **Don't add real-time collaboration, comments, version history, or audit logs.** These are features that sound smart but bloat the product. Single-user document editing is sufficient.
- **Don't add document templates that ship with the product.** The user's *own* previous documents become their templates, via the duplicate-as-template feature. Pre-built templates make us compete with LawDepot, which we'll lose.
- **Don't write generic AI prompts.** Every prompt should be specific to the document type and informed by the registry's `systemPromptAddition`. Generic prompts produce generic output, which is the thing we're explicitly trying to avoid.
- **Don't change the Supabase schema without a migration path.** Add optional columns freely; don't rename or remove existing ones without considering existing rows.

---

## When you're stuck or uncertain

- If you're considering a change that touches the document type registry, propose the schema change before implementing it across all types.
- If you're considering adding a dependency, ask first. Most of the time we can do it with what we have.
- If a feature request seems to conflict with the positioning (target customer, document specialization, etc.), flag it. Don't silently water down the product.
- If you're refactoring files purely for "cleanliness" or "best practices," reconsider. Premature reorganization slows us down. Refactor when there's a concrete pain point, not in the abstract.

---

## Legal and trust

These documents touch legal territory. Every document type with `legalDisclaimer: true` in the registry must show a footer in the document viewer reading something like: "This document is a starting draft generated by AI. It is not legal advice. Review with qualified counsel before execution."

The signup flow includes a one-time legal acknowledgment modal. Don't bypass this. Don't add features that suggest DraftBox is a substitute for legal counsel. The Terms and Privacy pages reflect the same positioning.

---

## Testing before changes

We don't have automated tests yet. Before submitting any non-trivial change:

1. Start the server locally with `npm start` and valid `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ANTHROPIC_API_KEY` set.
2. Sign up as a new user — confirm a row appears in the Supabase `users` table.
3. Generate one document of each type your change might affect — confirm a row appears in the `docs` table.
4. Verify the output looks right, the section navigator works, and the document loads after a page refresh.
5. Try the upgrade flow (visit pricing, click upgrade — even if Stripe isn't wired, the UI flow should not break).

If you're adding a new document type, test it end-to-end and paste the generated output into your PR description so a human can sanity-check it.

---

## Strategic context (read this if nothing else)

We are pre-launch. We have not yet validated whether the target customer will pay for this product. Until we have at least 5 paying customers, *every line of code is a liability* — code we have to maintain, debug, refactor, or throw away if the positioning shifts.

The right instinct on any feature: **ship the smallest thing that lets us test the hypothesis.** If a feature doesn't directly help us validate "does the target customer pay $79/month for this," it can wait.

The right instinct on any refactor: **only if the current code is actively blocking a hypothesis-test.** Beautiful code that doesn't help us learn about the customer is wasted effort right now.

The product will look very different in six months based on what we learn. Build accordingly: small, modular, easy to change, easy to throw away. The document type registry exists because we expect to add and remove document types as we learn what sells. The vanilla-JS stack exists because we expect to rewrite the frontend if we ever raise money. Everything is provisional. That's the right mindset.
