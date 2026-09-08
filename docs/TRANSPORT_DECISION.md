# Transport Decision Record — KPI Copilot MCP Server

- **Server:** `mcp-servers/kpi-copilot/server.py` (server name `kpi-copilot`)
- **Date decided:** 2026-09-08
- **Decided by:** Pam Manyika (project owner)
- **Status:** Active

---

## My answers

1. **Who calls this server, and from where?**
   Just me, from Claude Code / Claude Desktop on my laptop.

2. **How many people or processes call it at the same time, realistically?**
   One.

3. **Does it need to run on more than one machine, now or within a year?**
   No.

4. **Does anything about it have to survive between requests?**
   Yes — results from a previous tool call, and any open connections or
   subscriptions, need to still be there for the next call.

5. **What is the worst thing that happens if it is unavailable for an hour?**
   Nothing much, since nobody else depends on it. I relaunch my MCP client and
   carry on.

   *(This answer was revised during the interview. My first answer was "lost
   revenue or preventing critical operations," which did not match answers 1–3 —
   a tool only I call, from one laptop, with one caller, cannot cause that. The
   revised answer above is the accurate one.)*

---

## The transport I chose

**STDIO.**

The MCP client (Claude Code / Claude Desktop) spawns the server as a child
process over stdin/stdout, one client to one server, and shuts it down when the
client session ends. This is already how `server.py` runs
(`mcp.run(transport="stdio")`) and how it is registered in `.mcp.json`
(`command: "uv"`, `args: ["run", "--directory", …, "python", "server.py"]`).

## The state model I chose

**In-process memory, scoped to a single running session.**

There is exactly one server process and one caller, so state from a previous tool
call, plus any open connections or subscriptions, can just live in the process's
memory and still be there for the next call within the same session. No session
map, no session IDs, no external store — there is only ever one session, so
there is nothing to key state by or isolate.

Boundary: this state lives only as long as the server process. It does **not**
survive the client session ending or the server restarting. If I later need
something to persist across restarts, that is a small local file or database
inside the server — a separate decision from transport, and not needed today.

## My rationale, in my own words

It is a personal tool. I am the only one who runs it, I run it from my own
laptop, and I never have two things calling it at once. STDIO is the setup where
the client just starts it for me when I open a session and stops it when I close
one — I do not have to run a server, pick a port, keep a process alive, or think
about who can reach it over the network. Because there is only ever one process
and one caller, keeping prior results and open connections in memory is safe and
simple; there is no one else's data to mix it up with. Nothing about my answers
points to needing more than that. If the server is down, I have lost nothing — I
reopen my client and keep going.

## The option I rejected, and why

**Streamable HTTP (with an in-memory session map, i.e. stateful HTTP).**

This is the right choice when the server has to run as its own long-lived
service that things connect to over the network — several callers, callers on
other machines, automated jobs, or a server that must outlive any one client. A
session map keyed by session ID then exists to keep each caller's state separate.

None of that is true here. It would cost me real work for no benefit: I would
have to run and supervise the process myself, choose and secure a port, add auth
so it is not open on my machine, and manage the session map — all to serve a
single caller that STDIO already serves for free. I also rejected **stateless
HTTP** for a more basic reason: answer 4 says state must survive between
requests, and a stateless transport is defined by not carrying any.

## What would make me revisit this

If a second person, another machine, or an automated/scheduled process needs to
call this server — or it needs to keep running when my client is closed — switch
to streamable HTTP and move session state into a store both instances can read.
