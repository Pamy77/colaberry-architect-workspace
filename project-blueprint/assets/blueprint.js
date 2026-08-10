/* Single source of truth for the Gato LLC blueprint knowledge base.
   Every page renders from this object. If a number appears twice in
   this file, that is a bug — fix the source, not the display. */
const BLUEPRINT = {
  meta: {
    project: "Gato LLC — Dispatch System",
    generated: "2026-08-06"
  },

  idea: {
    text: "Gato LLC is a trucking/transportation company moving non-hazardous freight around the US.",
    users: [
      { name: "Gato dispatchers/staff", role: "Internal ops: assign trucks/drivers to loads, watch the board." },
      { name: "Drivers / owner-operators", role: "Field: see assigned loads, report status, deliver proof." },
      { name: "Brokers / load boards", role: "External source: freight marketplaces Gato pulls loads from." }
    ],
    dayOnePriority: "Reliably match available trucks/drivers to loads and track who is carrying what.",
    guarantorComponent: "Dispatch & Assignment API"
  },

  sections: [
    { id: "summary",      file: "01-summary.html",     title: "The Idea",                 desc: "Who it's for, what it does, and what must work on day one." },
    { id: "components",   file: "02-components.html",  title: "Components",               desc: "Every building block, traced back to the words that required it." },
    { id: "architecture", file: "03-architecture.html",title: "How It Fits Together",      desc: "The system as a flowchart — services, data stores, and outside parties." },
    { id: "dataflow",     file: "04-dataflow.html",    title: "Data Flow",                 desc: "The numbered walkthrough of a load from broker to delivery." },
    { id: "buildorder",   file: "05-buildorder.html",  title: "Build Order",               desc: "What ships first, and what each phase proves." },
    { id: "assumptions",  file: "06-assumptions.html", title: "Assumptions",               desc: "What we guessed, and what breaks if we guessed wrong." },
    { id: "coverage",     file: "07-coverage.html",    title: "What This Doesn't Cover",   desc: "The honest list of what is out of scope today." }
  ],

  components: [
    {
      id: "console", name: "Dispatch Console", category: "Frontend (built)", shape: "rect",
      sentence: "Gives Gato's dispatchers a screen showing every truck, driver, and open load, and lets them click to assign one to the other.",
      words: "“Gato dispatchers/staff” (named user) + the day-one priority itself"
    },
    {
      id: "driverapp", name: "Driver App", category: "Frontend (built)", shape: "rect",
      sentence: "Lets drivers and owner-operators see the loads they've been given and tap a button to mark “picked up,” “in transit,” or “delivered.”",
      words: "“Drivers/owner-operators” (named user)"
    },
    {
      id: "api", name: "Dispatch & Assignment API", category: "Backend (built)", shape: "rect",
      sentence: "The engine that actually matches a load to a truck and driver, remembers the decision, and pushes status changes to everyone — the piece that has to work perfectly from day one.",
      words: "“reliably match available trucks/drivers to loads and track who's carrying what” (the day-one sentence)"
    },
    {
      id: "db", name: "Fleet & Load Database", category: "Data store", shape: "cylinder",
      sentence: "The permanent record of every load, truck, driver, and assignment, so nothing is forgotten between logins or lost when a screen closes.",
      words: "“track who's carrying what” — state that must outlive a session"
    },
    {
      id: "worker", name: "Load Board Sync Worker", category: "Backend (built)", shape: "rect",
      sentence: "Periodically checks outside freight marketplaces for loads Gato could carry, so dispatchers don't have to search manually.",
      words: "“Brokers/load boards” (named source)"
    },
    {
      id: "brokers", name: "Broker & Load Board APIs", category: "Third party", shape: "hexagon",
      sentence: "The external freight marketplaces (e.g. DAT, Truckstop.com) that list loads other companies need carried.",
      words: "“Brokers/load boards” (named directly)"
    }
  ],

  diagrams: {
    flowchart:
`flowchart TD
    Dispatcher(["Dispatcher"])
    Driver(["Driver / Owner-Operator"])
    Console["Dispatch Console"]
    DriverApp["Driver App"]
    API["Dispatch and Assignment API"]
    DB[("Fleet and Load Database")]
    Worker["Load Board Sync Worker"]
    Brokers{{"Broker and Load Board APIs"}}

    Dispatcher -->|opens| Console
    Console -->|"requests available loads and fleet status"| API
    API -->|reads and writes| DB
    Console -->|"sends assignment: load, truck, driver"| API
    Driver -->|opens| DriverApp
    DriverApp -->|fetches assigned loads| API
    Driver -->|"updates status: picked up, in transit, delivered"| DriverApp
    DriverApp -->|posts status update| API
    Worker -->|polls for available freight| Brokers
    Worker -->|writes new load records| DB
    API -->|"live assignment and status"| Console`,

    sequence:
`sequenceDiagram
    participant Brokers as Broker and Load Board APIs
    participant Worker as Load Board Sync Worker
    participant DB as Fleet and Load Database
    participant Console as Dispatch Console
    participant Dispatcher
    participant API as Dispatch and Assignment API
    participant DriverApp as Driver App
    participant Driver

    Worker->>Brokers: poll for available freight
    Brokers-->>Worker: available loads
    Worker->>DB: write new load records
    Dispatcher->>Console: open dispatch board
    Console->>API: request available loads and fleet status
    API->>DB: read loads, trucks, drivers
    DB-->>API: current state
    API-->>Console: available loads and fleet
    Dispatcher->>Console: assign load to driver
    Console->>API: assignment command
    API->>DB: write assignment record
    Driver->>DriverApp: open app
    DriverApp->>API: fetch assigned loads
    API-->>DriverApp: assigned load list
    Driver->>DriverApp: mark picked up / in transit / delivered
    DriverApp->>API: post status update
    API->>DB: write status update
    Console->>API: poll for status changes
    API-->>Console: live assignment and status
    Console-->>Dispatcher: shows who is carrying what`,

    gantt:
`gantt
    title Gato LLC Build Order
    dateFormat  YYYY-MM-DD
    axisFormat  %b %d
    section Phase 1 - Core Dispatch
    Data model, Console, manual load entry :p1, 2026-08-10, 30d
    section Phase 2 - Driver Loop
    Driver App, status updates, proof of delivery :p2, after p1, 21d
    section Phase 3 - Automated Sourcing
    Load Board Sync Worker, broker integration :p3, after p2, 21d
    section Phase 4 - Back Office
    Compliance docs, invoicing, reporting :p4, after p3, 30d`
  },

  dataFlow: [
    { step: 1, text: "The Load Board Sync Worker polls the Broker & Load Board APIs on a schedule for freight Gato could carry." },
    { step: 2, text: "New loads are written into the Fleet & Load Database." },
    { step: 3, text: "A dispatcher opens the Dispatch Console, which asks the Dispatch & Assignment API for the current loads, trucks, and drivers." },
    { step: 4, text: "The API reads that state from the Database and returns it to the Console." },
    { step: 5, text: "The dispatcher assigns a specific load to a specific driver/truck in the Console." },
    { step: 6, text: "The Console sends that assignment to the API, which writes it to the Database as the permanent record." },
    { step: 7, text: "A driver opens the Driver App, which fetches their newly assigned loads from the API." },
    { step: 8, text: "As the driver picks up, transports, and delivers the load, they update status in the Driver App." },
    { step: 9, text: "Each status update is sent to the API and written to the Database." },
    { step: 10, text: "The Dispatch Console reflects those status changes back to the dispatcher in near real time, so they always know who is carrying what." }
  ],

  buildPhases: [
    { id: "p1", name: "Phase 1 — Core Dispatch", scope: "Data model + Dispatch Console + manual load entry + assignment logic.", proves: "The day-one priority works end to end, even before any outside integration exists.", start: "2026-08-10", days: 30, critical: true },
    { id: "p2", name: "Phase 2 — Driver Loop", scope: "Driver App: assigned-load view, status updates, proof of delivery.", proves: "The assignment is visible and actionable to the people actually doing the work.", start: "2026-09-09", days: 21, critical: false },
    { id: "p3", name: "Phase 3 — Automated Sourcing", scope: "Load Board Sync Worker + broker/load board integration.", proves: "Loads no longer have to be typed in by hand.", start: "2026-09-30", days: 21, critical: false },
    { id: "p4", name: "Phase 4 — Back Office (deferred)", scope: "Compliance documents, invoicing, reporting.", proves: "Not designed in this pass — see What This Doesn't Cover.", start: "2026-10-21", days: 30, critical: false }
  ],

  assumptions: [
    { assumption: "Gato dispatches its own fleet and contracted owner-operators, not a public marketplace where any driver self-assigns.", impact: "No self-serve driver bidding was designed; dispatchers hold assignment authority. If wrong, the Console needs a driver-facing bidding view." },
    { assumption: "“Non-hazardous” means no HAZMAT-specific compliance workflow is needed on day one.", impact: "Compliance/DOT documentation is deferred to Phase 4. If wrong, a compliance component must move into Phase 1." },
    { assumption: "The Load Board Sync Worker only pulls loads in (read-only), not posts Gato's own loads out for others to bid on.", impact: "Broker integration is one-directional. If wrong, the Worker needs a posting path and the Broker APIs become bidirectional." },
    { assumption: "U.S. domestic freight only, single time-zone handling model.", impact: "No customs, cross-border, or multi-currency handling exists. If wrong, the Database and API need locale/currency fields." },
    { assumption: "Shippers (freight customers) are not direct system users on day one.", impact: "No customer-facing quoting/booking portal was designed. If wrong, a new frontend and API surface are needed." }
  ],

  openQuestion: {
    question: "Does Gato dispatch its own contracted fleet, or is this really a marketplace where any driver can self-assign?",
    branchA: { label: "Dispatcher-controlled (assumed)", detail: "Current design stands: Console + API hold assignment authority; drivers only report status." },
    branchB: { label: "Open marketplace", detail: "Requires a driver-facing bidding/claim view, race-condition-safe assignment locking, and a trust/vetting layer before a driver can self-assign." }
  },

  notCovered: [
    "Customer-facing quoting or booking portal for shippers",
    "Invoicing, billing, and payment processing",
    "Compliance/DOT paperwork, ELD integration, hours-of-service tracking",
    "Real-time GPS/telematics hardware integration (status here is driver-reported, not GPS-tracked)",
    "Route optimization, fuel, or maintenance management",
    "Reporting/analytics dashboards"
  ],

  coverage: [
    { component: "Dispatch Console", phase: "p1" },
    { component: "Fleet & Load Database", phase: "p1" },
    { component: "Dispatch & Assignment API", phase: "p1" },
    { component: "Driver App", phase: "p2" },
    { component: "Load Board Sync Worker", phase: "p3" },
    { component: "Broker & Load Board APIs", phase: "p3" }
  ]
};
