"""
Example: multi-turn conversation with the Claude API.

Key idea: the API is stateless. Every request must include the FULL
conversation history in `messages` — Claude doesn't remember anything
on its own between calls. Each turn appends to the same list.
"""

import anthropic

client = anthropic.Anthropic()  # reads API key from ANTHROPIC_API_KEY env var

messages = []


def send(user_text: str) -> str:
    # 1. Add the new user message to the running history
    messages.append({"role": "user", "content": user_text})

    # 2. Send the FULL history so far — not just the new message
    response = client.messages.create(
        model="claude-opus-5",
        max_tokens=512,
        system="You are a concise, factual support-operations assistant.",
        messages=messages,
    )

    # 3. Extract Claude's reply text
    reply = next(block.text for block in response.content if block.type == "text")

    # 4. Add Claude's reply to the history too, so it's remembered next turn
    messages.append({"role": "assistant", "content": reply})

    return reply


if __name__ == "__main__":
    print(send("A customer can't log in after a password reset. What do you need to help?"))
    print(send("Their email is jane@example.com and the reset was 10 minutes ago."))
    print(send("What should I check first?"))
