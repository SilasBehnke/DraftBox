# DraftBox — Deployment Guide

## Stack
- **Frontend**: Static HTML/CSS/JS (no framework, fast loads)
- **Backend**: Node.js + Express
- **Database**: File-based JSON (upgrades to SQLite/Postgres easily)
- **AI**: Anthropic Claude Haiku (cheapest, fastest, ~$0.001 per doc)
- **Hosting**: Railway.app (free tier → $5/mo)
- **Payments**: Stripe

---

## Environment Variables Needed

```
ANTHROPIC_API_KEY=sk-ant-...
JWT_SECRET=<random 32+ char string>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PORT=3000
```

---

## Deploy to Railway (Recommended — ~$5/mo)

1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard
4. Railway auto-detects Node.js and deploys

**Cost: ~$5/month** — well within budget

---

## Cost Model

| Item | Cost |
|------|------|
| Railway hosting | $5/mo |
| Domain (draftbox.app or similar) | ~$12/yr = $1/mo |
| Claude Haiku per doc | ~$0.001 |
| 100 docs/month | $0.10 in API |
| **Total at 0 customers** | **~$6/mo** |

Break-even: **1 Solo subscriber ($9/mo) covers all costs**

---

## Revenue Model

- Free: 5 docs (no card needed — drives signups)
- Solo: $9/mo — 20 docs/month
- Pro: $29/mo — unlimited + extra features

**Break-even: 1 customer**
**$1K MRR: ~115 Solo subscribers**

---

## Stripe Setup

1. Create account at stripe.com
2. Create two products:
   - "DraftBox Solo" — $9/month recurring
   - "DraftBox Pro" — $29/month recurring
3. Add price IDs to env vars
4. Set webhook endpoint: `https://yourdomain.com/api/webhook/stripe`

---

## Go-Live Checklist

- [ ] Get Anthropic API key (anthropic.com/api)
- [ ] Register domain
- [ ] Set up Railway hosting
- [ ] Configure Stripe products
- [ ] Set all environment variables
- [ ] Test signup → generate → upgrade flow
- [ ] Post on Indie Hackers + Reddit r/freelance

---

## Budget Allocation

| Item | Amount |
|------|--------|
| Domain registration | $15 |
| Railway hosting (2 months) | $10 |
| Claude API credits | $20 |
| Reddit ads (r/freelance) | $30 |
| Buffer | $25 |
| **Total** | **$100** |
