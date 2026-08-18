# How to Authenticate to the Claude API

A plain-language walkthrough for setting up API access. Saved here so you can come back to it any time.

---

## The short version

1. Get an API key from the Anthropic Console.
2. Store it as an environment variable — never in your code.
3. Install the SDK.
4. Create a client. It picks up the key automatically.
5. Make a request.

---

## Step 1: Get an API key

1. Go to the Anthropic Console (console.anthropic.com) and sign in.
2. Find the **API Keys** section (usually under account/organization settings).
3. Click **Create Key**, give it a name (e.g. `local-dev`), and copy the value.
4. The key looks like `sk-ant-api03-...`. You'll only see the full value once — copy it somewhere safe immediately.

Treat this key like a password. Anyone with it can make API calls billed to your account.

---

## Step 2: Store the key as an environment variable

**Never paste the key directly into your code or commit it to git.** Instead, set it as an environment variable named `ANTHROPIC_API_KEY`.

**Windows (PowerShell) — for the current session only:**
```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-api03-your-key-here"
```

**Windows — permanently (so it persists across terminal sessions):**
```powershell
setx ANTHROPIC_API_KEY "sk-ant-api03-your-key-here"
```
(Close and reopen your terminal after running this.)

**Mac/Linux (bash/zsh):**
```bash
export ANTHROPIC_API_KEY="sk-ant-api03-your-key-here"
```
Add that line to your `~/.bashrc` or `~/.zshrc` to make it permanent.

**Using a `.env` file (common for projects):**
Create a `.env` file in your project root:
```
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
```
Then make sure `.env` is listed in `.gitignore` so it never gets committed. Most frameworks (and libraries like `python-dotenv`) will load this automatically.

---

## Step 3: Install the SDK

**Python:**
```bash
pip install anthropic
```

**TypeScript/JavaScript:**
```bash
npm install @anthropic-ai/sdk
```

---

## Step 4: Create the client — no key in your code

The official SDKs automatically look for the `ANTHROPIC_API_KEY` environment variable, so you don't pass the key as a string anywhere.

**Python:**
```python
import anthropic

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY automatically
```

**TypeScript:**
```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY automatically
```

If you ever need to pass a key explicitly (e.g. testing with a different key), you *can* do `anthropic.Anthropic(api_key="...")`, but the environment-variable approach is safer and is what `hello_claude.py` in this repo already uses.

---

## Step 5: Make a request

This project's `hello_claude.py` is a working example:

```python
import anthropic

client = anthropic.Anthropic()  # reads API key from ANTHROPIC_API_KEY env var

response = client.messages.create(
    model="claude-opus-5",
    max_tokens=512,
    messages=[{"role": "user", "content": "Hello, Claude"}],
)

for block in response.content:
    if block.type == "text":
        print(block.text)
```

Run it with:
```bash
python hello_claude.py
```

If it prints a reply, authentication is working.

---

## Alternative: log in without an API key (`ant` CLI)

If you install the `ant` CLI, you can authenticate interactively instead of managing a key yourself:

```bash
ant auth login
```

This opens a browser, logs you in, and stores credentials locally. Any SDK client created with no arguments (`anthropic.Anthropic()`) will pick this up automatically too. Check what's active any time with:

```bash
ant auth status
```

---

## Common errors and fixes

| Error | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` | `ANTHROPIC_API_KEY` not set, or invalid/revoked key | Re-check the env var is set in the terminal you're running from; generate a new key if needed |
| `403 Forbidden` | Key doesn't have access to the requested model/feature | Check key permissions in the Console |
| `404 Not Found` | Typo in the model name | Use exact model IDs, e.g. `claude-opus-5` |

---

## Security checklist

- [ ] Never hardcode the key in a `.py`/`.ts` file
- [ ] Never print the key or log it
- [ ] `.env` (if used) is in `.gitignore`
- [ ] Don't commit any file containing `sk-ant-...`
- [ ] If a key is ever accidentally committed or exposed, revoke it in the Console immediately and create a new one
