# ai-vision Promo Campaign
**Repo:** https://github.com/RobbyMo81/ai_vision  
**Goal:** Recruit builders to test and help enhance the project  
**Platforms:** X (Twitter), Reddit, LinkedIn  
**Date:** 2026-05-04

## Core Positioning

**ai-vision is a human-supervised browser workflow platform for safely automating real web tasks.** It combines LLM-driven browser control with HITL approval gates, persistent session state, telemetry, and workflow hardening.

Today it proves the pattern on social publishing workflows, and it is ready to expand into read-only research, QA smoke tests, internal dashboards, and structured form workflows.

Current runtime engines: `browser-use` and `skyvern`.

---

# 🐦 X (Twitter/X) Campaign

## Post 1 — Hook / Awareness

> I built **ai-vision**: a human-supervised browser workflow platform for safely automating real web tasks.  
>
> It combines LLM browser control with HITL approval gates, persistent sessions, telemetry, and workflow hardening.  
>
> It proves the pattern on X/Reddit publishing and is ready to expand into research, QA smoke tests, dashboards, and structured form workflows. 🧵
> 
> 👉 https://github.com/RobbyMo81/ai_vision
> 
> #OpenSource #AI #BrowserAutomation #DevTools

---

## Post 2 — Pain Point / Value Prop

> Browser automation gets risky when real side effects are involved: auth, drafts, submits, approvals, and final verification.  
>
> **ai-vision** is built for supervised workflows: LLM-driven browser control plus HITL gates, telemetry, persistent sessions, and deterministic guardrails.  
>
> Current proof point: social publishing. Next targets: read-only research, QA smoke tests, dashboards, and structured forms.  
>
> Open source. Try it → https://github.com/RobbyMo81/ai_vision  
> #AI #Automation #DevTools

---

## Post 3 — Technical Deep-Dive (for builders)

> Under the hood of **ai-vision** today:  
>
> 🔀 2 runtime engines: browser-use (Python/LangChain), skyvern (computer-vision)  
> 🤖 Supports Claude & OpenAI  
> 🦀 Rust config GUI  
> 🔐 HashiCorp Vault for secrets  
> 📜 TypeScript CLI + SQLite task history  
>
> Plus HITL approval gates, persistent Chrome sessions, telemetry, and Forge workflow hardening.  
>
> Builders wanted → https://github.com/RobbyMo81/ai_vision  
> #TypeScript #Rust #Python #OpenSource

---

## Post 4 — Call to Action / Community

> **ai-vision** is live and I want your brutal feedback.  
>
> If you've ever wished you could just *tell* your browser what to do instead of writing automation code — this is for you.  
>
> ✅ Clone it  
> ✅ Run a task  
> ✅ Open an issue or PR  
>
> 7 open issues. Come help. 👇  
> https://github.com/RobbyMo81/ai_vision  
> #BuildInPublic #OpenSource #AI

---

## Post 5 — Quick Demo Format

> One command. Real browser. Human-supervised workflow.  
>
> ```
> ai-vision run "Go to HN and list the top 5 stories"
> ```
>
> Good first expansion target: read-only research and QA smoke checks before higher-risk side effects.  
>
> Try **ai-vision** and tell me what breaks 🙏  
> https://github.com/RobbyMo81/ai_vision  
> #AI #Automation #HackerNews #DevTools

---

---

# 🤖 Reddit Campaign

## Post 1 — r/MachineLearning or r/artificial
**Title:** I built an LLM-controlled browser automation tool — give it plain English, it navigates/clicks/extracts. Open source, looking for testers.

**Body:**

Hey r/MachineLearning,

I've been building **ai-vision**, a human-supervised browser workflow platform for safely automating real web tasks. It combines LLM-driven browser control with HITL approval gates, persistent session state, telemetry, and workflow hardening.

Instead of treating browser automation as a one-shot prompt, ai-vision treats it as a governed workflow: the agent can reason over the page, but side effects like auth, draft review, submit actions, and final verification are protected by explicit gates.

**What it does well today:**
- Supervised social publishing workflows
- Read-only research and extraction
- QA smoke checks
- Dashboard inspection
- Structured form workflows with review gates
- Turning live failures into hardened workflow stories and tests

**Architecture:**
- 2 runtime engines: `browser-use` (Python/LangChain + Chromium), `skyvern` (computer-vision-centric)
- Supports Claude (Haiku/Sonnet/Opus) and OpenAI (GPT-4o-mini / GPT-4o / o3)
- TypeScript CLI, SQLite task history, Rust config GUI, optional HashiCorp Vault for secrets
- HITL web control panel, persistent browser profile, telemetry, and Forge governance

**Quick start:**
```bash
git clone https://github.com/RobbyMo81/ai_vision
cd ai-vision && pnpm install && pnpm run build
node dist/cli/index.js run "Go to news.ycombinator.com and list the top 5 stories"
```

I'm actively looking for builders to **test it, stress-test it, and open issues or PRs**. There are 7 open issues and room for contributions at every level — new engine integrations, prompt improvements, better error handling, docs.

Repo: https://github.com/RobbyMo81/ai_vision

Would love to hear what you think breaks, what you'd want it to do, and any feedback on the architecture.

---

## Post 2 — r/webdev
**Title:** Tired of Selenium/Puppeteer breaking when sites change? I built an LLM-powered alternative — no selectors needed. OSS + looking for contributors.

**Body:**

Hey r/webdev,

You know the drill: you write a Puppeteer scraper, the site updates its class names, and your whole script breaks. You update it. It breaks again.

I built **ai-vision** to make browser automation safer when real workflows matter. It uses LLM-driven browser control, but wraps risky steps in HITL approval gates, deterministic checks, persistent session state, and telemetry.

**Example:**
```bash
# Natural-language-first, with workflow guardrails.
node dist/cli/index.js run "Fill out the contact form on example.com with test data"
node dist/cli/index.js run "Go to GitHub trending and extract the top 10 repos" --screenshot
```

**Use cases:**
- Read-only extraction and research
- QA smoke checks
- Structured form workflows with human review
- Internal dashboard inspection
- Supervised publishing and other side-effecting workflows

**Stack:** TypeScript, Python FastAPI bridges, Rust config GUI, Playwright, LangChain, SQLite, optional HashiCorp Vault

It currently supports `browser-use` and optional `skyvern`, plus Claude/OpenAI model configuration.

I'm looking for devs to **test it on real-world sites**, report what breaks, and ideally contribute. The codebase is clean and documented.

👉 https://github.com/RobbyMo81/ai_vision

Known limitations (I'm honest about these):
- CAPTCHAs are a challenge with headless browsers
- Long tasks (>10 min) may need to be broken into steps
- Skyvern requires a running server instance

Happy to answer any questions about architecture decisions!

---

## Post 3 — r/SideProject
**Title:** Show HN-style: ai-vision — control a real browser with plain English. OSS, TypeScript/Python/Rust, built with Claude. Looking for testers!

**Body:**

**What I built:** ai-vision is a human-supervised browser workflow platform. It drives a real browser with LLM assistance, but wraps real side effects in approval gates, telemetry, persistent session state, and workflow hardening.

**The problem it solves:** Browser automation gets fragile and risky when workflows include login, drafts, submit buttons, final confirmation, and changing UIs. ai-vision gives the agent room to reason while keeping humans and deterministic gates in the loop.

**Cool bits of the stack:**
- Written in **TypeScript** with Python FastAPI bridges for ML engines
- **Rust** TUI config GUI (built with ratatui-style tooling)
- 2 runtime automation engines: browser-use and skyvern
- **HashiCorp Vault** integration for local secrets management
- **SQLite** for full task history
- Supports Claude/OpenAI model configuration

**What I need from you:**
1. Clone it and run a task on a site you care about
2. Tell me if/where it fails
3. Open an issue or PR if you're feeling generous
4. Roast the code — I can handle it

Repo: https://github.com/RobbyMo81/ai_vision  
There are 7 open issues, a full SIC/Refactor/Enhancement tracker, and a FORGE.md governance doc.

Built by **RobbyMo81** + Claude (yes, Claude co-authored this). AMA!

---

---

# 💼 LinkedIn Campaign

## Post 1 — Professional Announcement / Thought Leadership

**Headline:** I built an AI-driven browser automation platform — and I'm looking for builders to help shape it.

---

For the past several months, I've been building **ai-vision**: an open-source, human-supervised browser workflow platform for safely automating real web tasks.

The insight behind it is simple: **browser automation needs both agent reasoning and workflow safety.**

Selenium, Puppeteer, and Playwright scripts are powerful, but real workflows often involve more than clicking selectors: login state, draft review, submit actions, final confirmation, telemetry, and recovery when something goes wrong.

ai-vision takes a different approach:
- You give it a URL and a natural-language instruction
- The LLM reads the page visually and semantically where useful
- HITL gates protect approval, login, secure input, and final confirmation
- Deterministic checks, telemetry, and persistent history harden the workflow over time

**Current proof point:** supervised social publishing workflows on X and Reddit.

**Next expansion targets:**
✅ Read-only research — navigate, read, return structured summaries  
✅ QA smoke tests — repeatable browser checks with telemetry  
✅ Dashboard interaction — inspect internal tools with persistent session state  
✅ Structured form workflows — fill and review multi-step forms with approval boundaries  
✅ Workflow hardening — turn live failures into tests and implementation stories  

**The architecture is modular:**  
Two runtime engines today: browser-use with LangChain and optional skyvern with computer-vision-centric automation. One CLI. One HITL web control panel. SQLite task history. Persistent browser profile.

**Stack:** TypeScript · Python · Rust · LangChain · Playwright · SQLite · HashiCorp Vault · Claude / GPT-4o

---

**Why I'm sharing this now:**

The core platform is working, and I need builders — developers, QA engineers, automation specialists — to **test it on real workflows and help improve it**.

If you've ever:
- Written a scraper that broke when the site updated
- Wanted to automate a web workflow but didn't want to write brittle code
- Worked on AI agents and want to contribute to an open-source project in this space

…then I'd love to hear from you.

**7 open issues.** A full enhancement tracker. And a codebase co-authored with Claude that I'm proud of.

👉 **Repo:** https://github.com/RobbyMo81/ai_vision

Star it, fork it, open an issue, submit a PR — or just clone it and tell me what breaks. Every test is valuable.

#OpenSource #AI #BrowserAutomation #DevTools #TypeScript #BuildInPublic #LLM #WebDevelopment

---

## Post 2 — Shorter Engagement Post

**Hot take:** browser automation needs agent reasoning, but real workflows still need guardrails.

Plain browser scripts assume the happy path. Real workflows have login, review, submit buttons, final confirmation, telemetry, and failure recovery.

Language models can help read a page and decide what to do next. But for real side effects, they need human supervision and deterministic checks.

That's the core idea behind **ai-vision**, the open-source browser automation tool I've been building.

You write: *"Go to the pricing page and extract the Pro plan cost"*  
It navigates, reads, and returns the answer.

For riskier workflows, it adds HITL approval, persistent session state, telemetry, and workflow hardening.

🔗 https://github.com/RobbyMo81/ai_vision

Looking for engineers and builders to test it and contribute. Drop a comment or open an issue.

#AI #Automation #OpenSource #DevTools #LLM

---

---

# 📋 Campaign Strategy Notes

## Timing Recommendations
- **X:** Post 1 (hook) first, then stagger Posts 2-5 over 5-7 days. Engage with replies on each.
- **Reddit:** Post to r/webdev first (largest audience). Then r/SideProject 2-3 days later. r/MachineLearning is a stretch but valid if post is technical.
- **LinkedIn:** Post 1 (full announcement) on a Tuesday-Thursday morning for max reach. Follow up with Post 2 one week later as a re-engagement.

## Hashtag Strategy
- Primary: #OpenSource #AI #BrowserAutomation #DevTools
- Technical: #TypeScript #Python #LLM #Playwright #LangChain
- Community: #BuildInPublic #SideProject

## Key Messages (consistent across platforms)
1. **Problem:** Real browser workflows are brittle and risky without supervision
2. **Solution:** LLM browser control plus HITL gates, deterministic checks, telemetry, and persistent session state
3. **Differentiation:** governed workflow hardening, two runtime engines, multi-LLM configuration, SQLite history
4. **CTA:** Test it, break it, open issues/PRs
5. **Credibility:** Real codebase, 7 open issues, clean architecture, co-authored with Claude

## Engagement Tips
- On Reddit: **Comment first, link second.** Lead with the problem/story, put the repo link at the end
- On X: Use the thread format (Post 1 as a thread opener) to maximize algorithmic reach
- On LinkedIn: Tag relevant people in comments (QA engineers, TypeScript devs, AI tooling folks you know)
- Respond to every comment in the first 2 hours to boost algorithmic distribution
