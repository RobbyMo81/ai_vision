# ai-vision Promo Campaign
**Repo:** https://github.com/RobbyMo81/ai_vision  
**Goal:** Recruit builders to test and help enhance the project  
**Platforms:** X (Twitter), Reddit, LinkedIn  
**Date:** 2026-05-03

---

# 🐦 X (Twitter/X) Campaign

## Post 1 — Hook / Awareness

> I built **ai-vision**: give it a URL + a plain-English instruction → it navigates, clicks, types, and extracts like a human.  
>
> No CSS selectors. No brittle XPaths. Just your words.  
>
> Looking for builders to try it and help shape it. 🧵
> 
> 👉 https://github.com/RobbyMo81/ai_vision
> 
> #OpenSource #AI #BrowserAutomation #DevTools

---

## Post 2 — Pain Point / Value Prop

> Tired of your Selenium/Puppeteer scripts breaking every time a site changes?  
>
> **ai-vision** replaces fragile selectors with LLM reasoning. The agent *reads* the page visually and semantically — and adapts.  
>
> Works for: web research, form automation, data extraction, UI testing, dashboards.  
>
> Open source. Try it → https://github.com/RobbyMo81/ai_vision  
> #AI #Automation #DevTools

---

## Post 3 — Technical Deep-Dive (for builders)

> Under the hood of **ai-vision**:  
>
> 🔀 3 swappable engines: browser-use (Python/LangChain), stagehand (TS/Playwright), skyvern (computer-vision)  
> 🤖 Supports Claude & OpenAI  
> 🦀 Rust config GUI  
> 🔐 HashiCorp Vault for secrets  
> 📜 TypeScript CLI + SQLite task history  
>
> Swap engines with one flag. No prompt changes needed.  
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

> One command. Real browser. LLM in control.  
>
> ```
> ai-vision run "Go to HN and list the top 5 stories"
> ```
>
> That's it. No selectors. No scripts.  
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

I've been building **ai-vision**, an AI-driven browser automation platform. The core idea: you give it a URL and a plain-English instruction, and it controls a real browser — navigating, clicking, typing, extracting — without any CSS selectors or XPaths.

Instead of brittle DOM queries, it uses language-model reasoning to *read* the page visually and semantically and decide what to do next. When the page looks different than expected, it adapts.

**What you can do with it:**
- Web research (navigate → summarize)
- Multi-step form automation
- Data extraction from dynamic/obfuscated UIs
- Natural language UI testing (no selectors)
- Dashboard interaction in plain English
- End-to-end process automation

**Architecture:**
- 3 swappable engines: `browser-use` (Python/LangChain + headless Chromium), `stagehand` (TypeScript/Playwright), `skyvern` (computer-vision-centric)
- Supports Claude (Haiku/Sonnet/Opus) and OpenAI (GPT-4o-mini / GPT-4o / o3)
- TypeScript CLI, SQLite task history, Rust config GUI, optional HashiCorp Vault for secrets

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

I built **ai-vision** to solve this. Instead of targeting DOM elements with CSS selectors, it uses an LLM to *read the page* and figure out what to do — just like a human would. You give it a plain-English instruction, it controls a real browser.

**Example:**
```bash
# No selectors. Just English.
node dist/cli/index.js run "Fill out the contact form on example.com with test data"
node dist/cli/index.js run "Go to GitHub trending and extract the top 10 repos" --screenshot
```

**Use cases:**
- Replacing fragile scrapers
- Automating form submissions
- UI regression testing without selectors
- Automating internal tools/dashboards

**Stack:** TypeScript (83%), Python FastAPI bridges, Rust config GUI, Playwright, LangChain, SQLite, optional HashiCorp Vault

It supports 3 browser engines (browser-use, stagehand, skyvern) and both Claude and GPT-4o. Swap engines with `--engine stagehand` — no prompt changes.

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

**What I built:** ai-vision is an AI-driven browser automation CLI. You give it a URL and a plain-English instruction, and it drives a real browser — navigating, clicking, typing, extracting — using an LLM as the reasoning engine.

**The problem it solves:** Traditional automation tools (Selenium, Puppeteer, Playwright scripts) require exact CSS selectors or XPaths. These break constantly. ai-vision uses language-model reasoning instead — the agent reads the page visually and adapts.

**Cool bits of the stack:**
- Written in **TypeScript** with Python FastAPI bridges for ML engines
- **Rust** TUI config GUI (built with ratatui-style tooling)
- 3 pluggable automation engines: browser-use, stagehand, skyvern
- **HashiCorp Vault** integration for local secrets management
- **SQLite** for full task history
- Supports Claude 4 (Haiku/Sonnet/Opus) and GPT-4o

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

For the past several months, I've been building **ai-vision**: an open-source platform that lets you control a real web browser with plain-English instructions, powered by a large language model.

The insight behind it is simple: **traditional browser automation is too brittle.**

Selenium, Puppeteer, and Playwright scripts rely on exact CSS selectors and XPaths. Every time a website redesigns, every time an element moves — your automation breaks. You maintain the selectors instead of the work.

ai-vision takes a different approach:
- You give it a URL and a natural-language instruction
- The LLM reads the page visually and semantically
- It decides what to click, type, or extract — and adapts when things look different

**Real-world use cases I've been testing it on:**
✅ Web research — navigate, read, return structured summaries  
✅ Form automation — multi-step forms in plain English  
✅ Data extraction — dynamic and obfuscated UIs  
✅ UI testing — human-readable test cases, no selectors  
✅ Dashboard interaction — internal tools in plain English  
✅ Process automation — chained end-to-end browser workflows  

**The architecture is modular:**  
Three swappable engines (browser-use with LangChain, stagehand with Playwright, skyvern with computer vision). One CLI. Swap engines with a single flag without changing your prompt.

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

**Hot take:** CSS selectors are the wrong abstraction for browser automation in 2026.

They assume the DOM is stable. It's not. They assume you know the exact structure. You often don't.

Language models can *read* a page the way a human does — and decide what to interact with based on meaning, not structure.

That's the core idea behind **ai-vision**, the open-source browser automation tool I've been building.

You write: *"Go to the pricing page and extract the Pro plan cost"*  
It navigates, finds the pricing page, reads it, returns the answer.

No selectors. No maintenance. Just intent.

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
1. **Problem:** Selector-based automation is fragile and high-maintenance
2. **Solution:** LLM reasoning replaces selectors — reads the page like a human
3. **Differentiation:** 3 swappable engines, multi-LLM support, production-ready stack
4. **CTA:** Test it, break it, open issues/PRs
5. **Credibility:** Real codebase, 7 open issues, clean architecture, co-authored with Claude

## Engagement Tips
- On Reddit: **Comment first, link second.** Lead with the problem/story, put the repo link at the end
- On X: Use the thread format (Post 1 as a thread opener) to maximize algorithmic reach
- On LinkedIn: Tag relevant people in comments (QA engineers, TypeScript devs, AI tooling folks you know)
- Respond to every comment in the first 2 hours to boost algorithmic distribution
