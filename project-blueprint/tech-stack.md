# Gato LLC — Tech Stack Recommendation

Gato LLC moves non-hazardous freight around the US. This document names one real, current technology for every component in `project-blueprint/architecture.md`, rates how well it actually fits a small trucking company's dispatch operation, and points at what to learn first.

Companion knowledge base (same shape as the architecture site, search/illustrations/Ask agent included): [`project-blueprint/stack/index.html`](stack/index.html).

---

## 1. Fit-Rating Key

| Icon | Rating | What it means |
|---|---|---|
| 🟢 | **great fit** | Matches Gato's actual size and needs. Pick it, move on. |
| 🟡 | **good fit** | Works, but there's a real caveat worth reading before you commit. |
| 🔴 | **consider carefully** | Usable, but this is where the plan is most likely to hurt Gato — cost, lock-in, or a maturity mismatch. |

Ratings are judged against Gato's actual scale: a small in-house dispatch team, a handful of trucks and drivers, low request volume, and no dedicated infra staff — not against what's popular.

**Breakdown: 5 🟢 · 2 🟡 · 1 🔴** (8 rows total: 6 components + 2 data-flow additions).

---

## 2. Headline: Where This Stack Is Most Likely to Break

The riskiest part of this plan isn't anything Gato writes — it's the **Broker & Load Board APIs** (DAT, Truckstop.com). Those are the one dependency Gato doesn't control: paid subscriptions, a formal partner-approval process, rate limits, and pricing that can change out from under the project. Everything else here is boring, proven, and swappable if it turns out wrong; that one is a business relationship wearing a technology costume, and it's on the Phase 3 critical path. Get access and pricing confirmed with DAT/Truckstop *before* Phase 3 is scheduled, not during it.

The second-riskiest choice is adding real-time push (Socket.IO) before it's needed — see §3 for why it's rated 🟡 instead of 🟢.

**Least confident calls, and why:**
- **Broker & Load Board APIs (🔴)** — outside Gato's control; access/cost aren't confirmed yet.
- **Real-time status sync via Socket.IO (🟡)** — at this scale, 5–10 second polling would look nearly identical to a dispatcher and is far simpler to run. Socket.IO is only worth its complexity once real-time actually matters.
- **Driver App via React Native/Expo (🟡)** — app-store review adds days to every release, and Expo's managed workflow can fight you the moment a native feature falls outside what it wraps.

---

## 3. Recommendations

### Things a person touches

| Component | Recommendation | Fit | Why |
|---|---|---|---|
| **Dispatch Console** | React 18 + Vite + TypeScript | 🟢 | Fast to build the clickable truck/driver/load screen dispatchers live in all day, and TypeScript (which checks your code's shapes before it runs) catches mistakes before they reach a live dispatch board. |
| **Driver App** | React Native (Expo) | 🟡 | One JavaScript codebase gives drivers a real phone app for iPhone and Android, sharing code with the rest of the stack. **Caveat:** app-store review adds days to every release, and Expo's managed workflow can fight you the moment you need a native feature it doesn't wrap — budget for that before Phase 2. |

### Things you write

| Component | Recommendation | Fit | Why |
|---|---|---|---|
| **Dispatch & Assignment API** | Node.js + Express + TypeScript, with Sequelize (ORM, which turns database tables into code objects) and Zod (checks incoming data's shape before it's trusted) | 🟢 | This is the piece that has to work perfectly from day one — this combination forces every request and every database write to have a checked shape before it's trusted. |
| **Load Board Sync Worker** | Node.js scheduled job (node-cron) inside the same backend service | 🟢 | It just needs to wake up on a timer, ask the load boards what's new, and write it down — a full job-queue system would solve a scale problem Gato doesn't have. |

### Things you store

| Component | Recommendation | Fit | Why |
|---|---|---|---|
| **Fleet & Load Database** | PostgreSQL 16 | 🟢 | Loads, trucks, drivers, and assignments are all relationships to each other, and Postgres guarantees a half-finished assignment can never be half-saved. |

### Things you depend on

| Component | Recommendation | Fit | Why |
|---|---|---|---|
| **Broker & Load Board APIs** | DAT and/or Truckstop.com's official partner APIs | 🔴 | These are the load boards Gato actually needs — but they're the one part of this stack Gato doesn't control at all. **Caveat:** both require a paid subscription and a formal partner-approval process before you can write a line of code against them. Budget weeks of lead time and a recurring cost, not a signup form. |

### Things the data flow needs (not named as components, but required by it)

| Need (from the data-flow walkthrough) | Recommendation | Fit | Why |
|---|---|---|---|
| Pushing status changes back to the Console "in near real time" (step 10) | Socket.IO (WebSockets, a live two-way connection) over the existing Express server | 🟡 | Pushes a driver's status update to the dispatcher's screen the instant it happens. **Caveat:** it's a second connection type to run and debug in production. At Gato's scale, polling the API every 5–10 seconds looks almost identical to the dispatcher and is far simpler to operate — start there, add Socket.IO only once real-time earns its complexity. |
| Somewhere for the API, database, and worker to actually run | Docker Compose on a single Linux VPS | 🟢 | The API, database, and worker all need somewhere to run, and one small server is plenty for one company's dispatch operation. |

---

## 4. Copy-Ready Prompts

Paste any of these into a new Claude conversation to learn that piece properly, using Gato LLC as the running example.

| Technology | Prompt |
|---|---|
| React + Vite | *"Explain React and Vite to me like I'm new to frontend development, using my Gato LLC Dispatch Console as the example. How would the truck-and-load assignment screen actually be built?"* |
| React Native + Expo | *"Explain React Native and Expo to me like I'm new to mobile development, using my Gato LLC Driver App as the example. How would a driver's 'mark as delivered' button actually work end to end?"* |
| Node.js + Express + Sequelize + Zod | *"Explain Node.js, Express, Sequelize, and Zod to me like I'm new to backend development, using my Gato LLC Dispatch and Assignment API as the example. What would the 'assign a load to a truck' endpoint actually look like?"* |
| node-cron scheduled jobs | *"Explain how a scheduled background job (node-cron) works to me like I'm new to backend development, using my Gato LLC Load Board Sync Worker as the example. How would it avoid creating duplicate load records if it runs twice?"* |
| PostgreSQL | *"Explain PostgreSQL to me like I'm new to databases, using my Gato LLC Fleet and Load Database as the example. What tables would I actually have, and how would they connect?"* |
| DAT / Truckstop.com APIs | *"Explain how a third-party load board API (like DAT or Truckstop.com) typically works to me like I'm new to external API integrations, using my Gato LLC Load Board Sync Worker as the example. What would I need from them before I could write any code?"* |
| Socket.IO / WebSockets | *"Explain Socket.IO and WebSockets to me like I'm new to real-time web features, using my Gato LLC Dispatch Console as the example. When would polling be good enough instead?"* |
| Docker Compose + a VPS | *"Explain Docker Compose and running a small app on a Linux VPS to me like I'm new to deployment, using my Gato LLC backend as the example. What would actually be running on the server?"* |

---

## 5. What to Learn First, In Order

1. **PostgreSQL** — the data model everything else stands on.
2. **Node.js + Express + TypeScript** — the API that reads and writes that data.
3. **Sequelize + Zod** — how the API keeps every read and write honest.
4. **React + Vite** — the Dispatch Console dispatchers will live in.
5. **Docker Compose hosting** — get a real version running somewhere before adding more surface area.
6. **Socket.IO** — only once polling actually starts to feel slow.
7. **React Native / Expo** — the Driver App, once the Console and API are proven.
8. **DAT / Truckstop.com partner APIs** — start the access/pricing conversation early, but build against it last; it's Phase 3, not Phase 1.

---

## 6. Alternatives Considered, and Why Not

| Component | Alternative | Why it lost |
|---|---|---|
| Dispatch Console | Next.js | Adds server-rendering and routing machinery built for public, SEO-facing sites. The Console is a login-only internal tool — that machinery is weight with no payoff. |
| Driver App | Plain Progressive Web App (PWA) | Skips app-store review, but reliable background status updates and offline behavior on a moving truck are much shakier in a browser tab than in an installed app — the exact failure mode this app can't afford. |
| Dispatch & Assignment API | Python + FastAPI | Just as capable and just as typed, but splitting the stack across two languages doubles what a two-or-three-person team has to context-switch between, for no functional gain here. |
| Fleet & Load Database | MongoDB | Documents are a poor fit for data that's fundamentally about relationships — this truck, this driver, this load, right now. You'd end up hand-building the referential integrity Postgres gives for free. |
| Load Board Sync Worker | A dedicated queue (BullMQ + Redis) | Built for high-volume, bursty background work. Gato is polling a couple of load boards on a schedule, not processing thousands of jobs a minute — the extra moving part (Redis) isn't earning its keep yet. |
| Broker & Load Board APIs | Scraping the load board websites directly | Violates both providers' terms of service and breaks the moment their page markup changes — fragile and risky in a way a business shouldn't build on. |
| Real-time status sync | Server-Sent Events (SSE) | One-directional and lighter than WebSockets, but Socket.IO's reconnect handling and broad browser support is more battle-tested for a small team without dedicated infra time. |
| Hosting & Runtime | Kubernetes / a managed platform (e.g. AWS ECS) | Built for scaling many services across many machines. Gato is running three cooperating processes for one company — the operational overhead would cost more engineer-hours than the fleet it's dispatching. |

---

## 7. How Hard Each Decision Is to Undo

| Decision | Difficulty to undo | Why |
|---|---|---|
| Fleet & Load Database (PostgreSQL) | 🔒🔒🔒 Hard | Once real assignment history lives in it, switching engines means migrating years of operational record, not just code. |
| Broker & Load Board APIs (DAT/Truckstop) | 🔒🔒🔒 Hard | This is a business relationship as much as a technology choice — switching providers means renegotiating a contract, not changing a config value. |
| Dispatch & Assignment API (Node/Express) | 🔒🔒 Medium | The framework is swappable, but this is the load-bearing wall of the system — a rewrite means re-testing every workflow that touches an assignment. |
| Driver App (React Native/Expo) | 🔒🔒 Medium | The code is portable, but you're also undoing an app-store listing and re-onboarding drivers to a new install. |
| Dispatch Console (React/Vite) | 🔒 Easy | A frontend rewrite only touches the Console; the API and database underneath don't change. |
| Load Board Sync Worker (node-cron) | 🔒 Easy | A small, isolated scheduled function — swapping the scheduling mechanism later doesn't touch anything else. |
| Real-time sync (Socket.IO) | 🔒 Easy | Additive on top of the REST API; ripping it out just means the UI falls back to polling, which still works. |
| Hosting (Docker Compose / VPS) | 🔒 Easy | Compose files are portable — moving to a bigger host or a different provider later is a config change, not a rewrite. |

---

## 8. What This Document Does NOT Tell You

- The actual database schema (tables, columns, foreign keys) — that's a design step, not a tech choice.
- Pricing or contract terms for DAT/Truckstop.com — that's a business conversation Gato needs to have directly with them.
- Security or compliance posture (HAZMAT rules, DOT paperwork) — `architecture.md` already flags this as out of scope for day one.
- Team hiring or staffing needs.
- CI/CD pipeline specifics.
- The actual UI/UX design of the Console or Driver App.
- Concrete cost estimates for hosting or API subscriptions.

---

*Generated from `project-blueprint/architecture.md`. Every component in that file has a row above. Full interactive version with search and illustrations: [`project-blueprint/stack/index.html`](stack/index.html).*
