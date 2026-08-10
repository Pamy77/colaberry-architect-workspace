/* Data object for the Gato LLC tech-stack knowledge base.
   `const` at top level is NOT a window property — other scripts reference
   the bare identifier STACK, same convention as BLUEPRINT in ../assets/blueprint.js. */
const STACK = {
  project: {
    name: "Gato LLC",
    oneLiner: "Gato LLC moves non-hazardous freight around the US. This is one real, current technology per component in the architecture, rated against Gato's actual size — not against what's popular."
  },

  ratingKey: [
    { icon: "🟢", word: "great fit", desc: "Matches Gato's actual size and needs. Pick it, move on." },
    { icon: "🟡", word: "good fit", desc: "Works, but there's a real caveat worth reading before you commit." },
    { icon: "🔴", word: "consider carefully", desc: "Usable, but this is where the plan is most likely to hurt Gato." }
  ],

  headline: "The riskiest part of this plan isn't anything Gato writes — it's the Broker & Load Board APIs (DAT, Truckstop.com). That's the one dependency Gato doesn't control: paid subscriptions, a formal partner-approval process, rate limits, and pricing that can change out from under the project. Everything else here is boring, proven, and swappable if it turns out wrong; that one is a business relationship wearing a technology costume, and it sits on the Phase 3 critical path.",

  leastConfident: [
    { itemId: "brokerApi", reason: "Outside Gato's control; access and cost aren't confirmed yet, and it's on the Phase 3 critical path." },
    { itemId: "realtime", reason: "At this scale, 5-10 second polling would look nearly identical to a dispatcher and is far simpler to run. Socket.IO only earns its complexity once real-time actually matters." },
    { itemId: "driverApp", reason: "App-store review adds days to every release, and Expo's managed workflow can fight you the moment a native feature falls outside what it wraps." }
  ],

  groups: [
    { id: "touch", title: "Things a Person Touches", desc: "The screens dispatchers and drivers actually use." },
    { id: "write", title: "Things You Write", desc: "The services Gato's own code lives in." },
    { id: "store", title: "Things You Store", desc: "The permanent record of every load, truck, driver, and assignment." },
    { id: "depend", title: "Things You Depend On", desc: "Outside systems Gato doesn't control." },
    { id: "dataflow", title: "Things the Data Flow Needs", desc: "Not named as components, but clearly required once you trace a load end to end." }
  ],

  items: [
    {
      id: "consoleFrontend",
      component: "Dispatch Console",
      group: "touch",
      recommendation: "React 18 + Vite + TypeScript",
      fit: "green",
      why: "Fast to build the clickable truck/driver/load screen dispatchers live in all day, and TypeScript (which checks your code's shapes before it runs) catches mistakes before they reach a live dispatch board.",
      caveat: "",
      prompt: "Explain React and Vite to me like I'm new to frontend development, using my Gato LLC Dispatch Console as the example. How would the truck-and-load assignment screen actually be built?",
      alternatives: [
        { name: "Next.js", whyNot: "Adds server-rendering and routing machinery built for public, SEO-facing sites — the Console is a login-only internal tool, so that machinery is weight with no payoff." }
      ],
      undo: { level: "easy", note: "A frontend rewrite only touches the Console; the API and database underneath don't change." },
      learnOrder: 4
    },
    {
      id: "driverApp",
      component: "Driver App",
      group: "touch",
      recommendation: "React Native (Expo)",
      fit: "amber",
      why: "One JavaScript codebase gives drivers a real phone app for iPhone and Android, sharing code with the rest of the stack.",
      caveat: "App-store review adds days to every release, and Expo's managed workflow can fight you the moment you need a native feature it doesn't wrap — budget for that friction before Phase 2.",
      prompt: "Explain React Native and Expo to me like I'm new to mobile development, using my Gato LLC Driver App as the example. How would a driver's 'mark as delivered' button actually work end to end?",
      alternatives: [
        { name: "Plain Progressive Web App (PWA)", whyNot: "Skips app-store review entirely, but reliable background status updates and offline behavior on a moving truck are much shakier in a browser tab than in an installed app — the exact failure mode this app can't afford." }
      ],
      undo: { level: "medium", note: "The React code is portable, but you're also undoing an app-store listing and re-onboarding drivers to a new install." },
      learnOrder: 7
    },
    {
      id: "dispatchApi",
      component: "Dispatch & Assignment API",
      group: "write",
      recommendation: "Node.js + Express + TypeScript, with Sequelize and Zod",
      fit: "green",
      why: "This is the piece that has to work perfectly from day one, and this combination forces every request and every database write to have a checked shape before it's trusted.",
      caveat: "",
      prompt: "Explain Node.js, Express, Sequelize, and Zod to me like I'm new to backend development, using my Gato LLC Dispatch and Assignment API as the example. What would the 'assign a load to a truck' endpoint actually look like?",
      alternatives: [
        { name: "Python + FastAPI", whyNot: "Just as capable and just as typed, but splitting the stack across two languages doubles what a two-or-three-person team has to context-switch between, for no functional gain here." }
      ],
      undo: { level: "medium", note: "The framework is swappable, but this is the load-bearing wall of the whole system — a rewrite means re-testing every workflow that touches an assignment." },
      learnOrder: 2
    },
    {
      id: "syncWorker",
      component: "Load Board Sync Worker",
      group: "write",
      recommendation: "Node.js scheduled job (node-cron), in the same backend service",
      fit: "green",
      why: "It just needs to wake up on a timer, ask the load boards what's new, and write it down — a full job-queue system would solve a scale problem Gato doesn't have.",
      caveat: "",
      prompt: "Explain how a scheduled background job (node-cron) works to me like I'm new to backend development, using my Gato LLC Load Board Sync Worker as the example. How would it avoid creating duplicate load records if it runs twice?",
      alternatives: [
        { name: "A dedicated queue (BullMQ + Redis)", whyNot: "Built for high-volume, bursty background work. Gato is polling a couple of load boards on a schedule, not processing thousands of jobs a minute — the extra moving part (Redis) isn't earning its keep yet." }
      ],
      undo: { level: "easy", note: "A small, isolated scheduled function; swapping the scheduling mechanism later doesn't touch anything else." },
      learnOrder: 3
    },
    {
      id: "database",
      component: "Fleet & Load Database",
      group: "store",
      recommendation: "PostgreSQL 16",
      fit: "green",
      why: "Loads, trucks, drivers, and assignments are all relationships to each other, and Postgres guarantees a half-finished assignment can never be half-saved.",
      caveat: "",
      prompt: "Explain PostgreSQL to me like I'm new to databases, using my Gato LLC Fleet and Load Database as the example. What tables would I actually have, and how would they connect?",
      alternatives: [
        { name: "MongoDB", whyNot: "Documents are a poor fit for data that's fundamentally about relationships — this truck, this driver, this load, right now. You'd end up hand-building the referential integrity Postgres gives for free." }
      ],
      undo: { level: "hard", note: "Once real assignment history lives in it, migrating engines means migrating years of operational record, not just code." },
      learnOrder: 1
    },
    {
      id: "brokerApi",
      component: "Broker & Load Board APIs",
      group: "depend",
      recommendation: "DAT and/or Truckstop.com's official partner APIs",
      fit: "red",
      why: "These are the load boards Gato actually needs — but they're the one part of this stack Gato doesn't control at all.",
      caveat: "Both require a paid subscription and a formal API access/partner-approval process before you can write a single line against them. Budget weeks of lead time and a recurring cost, not a signup form. Confirm access and pricing before Phase 3 is scheduled, not during it.",
      prompt: "Explain how a third-party load board API (like DAT or Truckstop.com) typically works to me like I'm new to external API integrations, using my Gato LLC Load Board Sync Worker as the example. What would I need from them before I could write any code?",
      alternatives: [
        { name: "Scraping the load board websites directly", whyNot: "Violates both providers' terms of service and breaks the moment their page markup changes — fragile and risky in a way a business shouldn't build on." }
      ],
      undo: { level: "hard", note: "This is a business relationship as much as a technology choice — switching providers later means renegotiating a contract, not changing a config value." },
      learnOrder: 8
    },
    {
      id: "realtime",
      component: "Real-Time Status Sync (Console ← API)",
      group: "dataflow",
      recommendation: "Socket.IO (WebSockets) over the existing Express server",
      fit: "amber",
      why: "Pushes a driver's status update to the dispatcher's screen the moment it happens, instead of the dispatcher having to refresh.",
      caveat: "It's a second connection type to run and debug in production. At Gato's scale — a handful of dispatchers watching a handful of trucks — polling the API every 5-10 seconds looks almost identical to the dispatcher and is far simpler to operate. Start with polling; add Socket.IO only once real-time actually earns its complexity.",
      prompt: "Explain Socket.IO and WebSockets to me like I'm new to real-time web features, using my Gato LLC Dispatch Console as the example. When would polling be good enough instead?",
      alternatives: [
        { name: "Server-Sent Events (SSE)", whyNot: "One-directional and lighter than WebSockets, but Socket.IO's reconnect handling and broad browser support is more battle-tested for a small team without dedicated infra time." }
      ],
      undo: { level: "easy", note: "Additive on top of the REST API; ripping it out just means the UI falls back to polling, which still works." },
      learnOrder: 6,
      fromDataFlow: "Data Flow step 10: \"The Dispatch Console reflects those status changes back to the dispatcher in near real time.\""
    },
    {
      id: "hosting",
      component: "Hosting & Runtime",
      group: "dataflow",
      recommendation: "Docker Compose on a single Linux VPS",
      fit: "green",
      why: "The API, database, and worker all need somewhere to actually run, and one small server is plenty for one company's dispatch operation.",
      caveat: "",
      prompt: "Explain Docker Compose and running a small app on a Linux VPS to me like I'm new to deployment, using my Gato LLC backend as the example. What would actually be running on the server?",
      alternatives: [
        { name: "Kubernetes / a managed platform (e.g. AWS ECS)", whyNot: "Built for scaling many services across many machines — Gato is running three cooperating processes for one company; the operational overhead would cost more engineer-hours than the fleet it's dispatching." }
      ],
      undo: { level: "easy", note: "Compose files are portable — moving to a bigger host or a different provider later is a config change, not a rewrite." },
      learnOrder: 5,
      fromDataFlow: "Every step in the walkthrough assumes the API, Database, and Worker are already running somewhere — that runtime is never named as a component."
    }
  ],

  notCovered: [
    "The actual database schema (tables, columns, foreign keys) — that's a design step, not a tech choice.",
    "Pricing or contract terms for DAT/Truckstop.com — that's a business conversation Gato needs to have directly with them.",
    "Security or compliance posture (HAZMAT rules, DOT paperwork) — architecture.md already flags this as out of scope for day one.",
    "Team hiring or staffing needs.",
    "CI/CD pipeline specifics.",
    "The actual UI/UX design of the Console or Driver App.",
    "Concrete cost estimates for hosting or API subscriptions."
  ],

  sections: [
    { id: "summary", file: "01-summary.html", title: "Summary", desc: "The fit-rating key, and where this stack is most likely to break." },
    { id: "recommendations", file: "02-recommendations.html", title: "Recommendations", desc: "One technology per component, grouped by what kind of thing it is." },
    { id: "prompts", file: "03-prompts.html", title: "Learning Prompts", desc: "Every copy-ready prompt, collected in one table." },
    { id: "learning", file: "04-learning-path.html", title: "Learning Path", desc: "What to learn first, in order, and why." },
    { id: "alternatives", file: "05-alternatives.html", title: "Alternatives Considered", desc: "What else we looked at, and why it lost." },
    { id: "lockin", file: "06-lockin.html", title: "Lock-In", desc: "How hard each decision is to undo later." },
    { id: "notcovered", file: "07-notcovered.html", title: "Not Covered", desc: "The honest gaps in this recommendation." },
    { id: "appendix", file: "08-appendix.html", title: "Appendix", desc: "Full cross-reference against the architecture, and what runs where." }
  ]
};
