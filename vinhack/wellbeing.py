"""The wellbeing chat, backed by a real model.

Two things make this different from a generic chatbot wrapper:

  * it is grounded. The student's own logged figures - sleep, energy, open
    deadlines - go into the system prompt, so the reply talks about their week
    rather than offering advice in the abstract.
  * it knows what it is not. The prompt is explicit that this is a study-habit
    companion, not a counsellor, and that anything touching self-harm gets a
    short reply pointing at real help rather than a coaching conversation.

The call is a plain POST to an OpenAI-compatible /chat/completions endpoint,
so Groq, OpenAI, OpenRouter, Together or a local Ollama all work by changing
LLM_BASE_URL alone. It uses urllib, so the app needs no extra dependency.

If no API key is configured the endpoint returns 503 and the page says so.
There is no second response path: a reply on that screen either came from the
model or is an error message saying it did not.
"""
import json
import os
import urllib.error
import urllib.request
from typing import Any, Optional

# All chosen by the deployment, not by the source. See .env.example.
BASE_URL = os.environ.get("LLM_BASE_URL") or "https://api.groq.com/openai/v1"
MODEL = os.environ.get("LLM_MODEL") or "llama-3.3-70b-versatile"
MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS") or 700)
MAX_HISTORY = int(os.environ.get("LLM_MAX_HISTORY") or 12)   # turns kept
TIMEOUT = int(os.environ.get("LLM_TIMEOUT") or 30)

SYSTEM = """You are a study-habits companion inside VinHack, an app a student \
uses to track their own sleep, coursework and focus sessions. You are talking \
to the student about their week.

You are not a therapist, a doctor or a counsellor, and you must not present \
yourself as one. Do not diagnose, do not name conditions, and do not discuss \
medication. You help with the ordinary mechanics of student life: workload \
that has piled up, sleep that has slipped, procrastination, exam nerves, \
drafting an email asking for an extension.

How to reply:
- Two short paragraphs at most. This is a chat box, not an article.
- Use their actual numbers when they are relevant. They are given below. Say \
"you have been averaging 6.2 hours" rather than "try to get enough sleep".
- Be direct and practical. One concrete next step beats three suggestions.
- Do not open with flattery, do not say "I hear you", and do not restate their \
message back to them before answering.
- British spelling.

If the student mentions self-harm, suicide, wanting to disappear, or being \
unsafe: stop the study-habits conversation. Reply briefly and warmly, say \
plainly that you are a study app and not equipped for this, and point them to \
someone real - their university counselling service, someone they trust, or a \
crisis line (in India, Tele-MANAS on 14416; elsewhere, findahelpline.com). Do \
not attempt to counsel them, and do not ask probing questions."""


def api_key() -> Optional[str]:
    """The key, from whichever variable the deployment used."""
    for name in ("LLM_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY"):
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return None


def configured() -> bool:
    """True when there is a credential to call the model with."""
    return api_key() is not None


def _line(label: str, value: Any, suffix: str = "") -> Optional[str]:
    if value is None:
        return None
    return f"- {label}: {value}{suffix}"


def context_block(insights: dict, tasks: list[dict], student: dict) -> str:
    """The student's own figures, as plain lines the model can quote back."""
    averages = insights.get("averages") or {}
    scores = insights.get("scores") or {}
    sleep_minutes = averages.get("avg_sleep_minutes")

    lines = [
        f"Student: {student.get('name')}, semester {student.get('semester') or 'unknown'}.",
        f"Today is {insights.get('today')}. Figures cover the last "
        f"{insights.get('window_days')} days.",
        "",
    ]
    facts = [
        _line("Average sleep", f"{sleep_minutes / 60:.1f}" if sleep_minutes else None,
              " hours a night, against an 8-hour goal"),
        _line("Running sleep balance", insights.get("sleep_debt_hours"),
              " hours (negative means behind)"),
        _line("Average reported energy", averages.get("avg_energy"), " out of 10"),
        _line("Average reported mood", (insights.get("mood") or {}).get("avg_mood"),
              " out of 10"),
        _line("Focus sessions logged", (insights.get("focus") or {}).get("sessions")),
        _line("Average focus rating", (insights.get("focus") or {}).get("avg_focus"),
              " out of 5"),
        _line("Daily social-media time", averages.get("avg_social_minutes"), " minutes"),
        _line("Current study streak", insights.get("streak_days"), " days"),
        _line("Overall index", insights.get("synthesis_index"), " out of 100"),
        _line("Sleep sub-score", scores.get("sleep_health"), " out of 100"),
    ]
    lines += [f for f in facts if f]

    best = (insights.get("focus_by_part_of_day") or [])
    if best:
        top = best[0]
        lines.append(f"- Focuses best in the {top['part_of_day']} "
                     f"({top['avg_focus']}/5 across {top['sessions']} sessions)")

    if tasks:
        lines.append("")
        lines.append(f"Open coursework ({len(tasks)} items, soonest first):")
        for task in tasks[:6]:
            due = task.get("due_date") or "no due date"
            lines.append(f"- {task['task_name']} ({task.get('subject') or 'general'}), "
                         f"{task.get('priority')} priority, due {due}")
    else:
        lines.append("")
        lines.append("Nothing is currently open on their coursework list.")

    return "\n".join(lines)


def reply(message: str, history: list[dict], context: str) -> dict:
    """Ask the model for one reply. Raises RuntimeError with a usable message.

    The user's message is passed through exactly as typed - nothing here reads
    it to decide what to do with it.
    """
    key = api_key()
    if not key:
        raise RuntimeError("No LLM_API_KEY is set.")

    turns: list[dict] = [{
        "role": "system",
        "content": SYSTEM + "\n\nTheir figures right now:\n\n" + context,
    }]
    for turn in history[-MAX_HISTORY:]:
        role = turn.get("role")
        text = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and text:
            turns.append({"role": role, "content": text})
    turns.append({"role": "user", "content": message})

    payload = json.dumps({
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "temperature": 0.6,
        "messages": turns,
    }).encode("utf-8")

    request = urllib.request.Request(
        BASE_URL.rstrip("/") + "/chat/completions",
        data=payload,
        headers={"Authorization": "Bearer " + key,
                 "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # The body carries the provider's reason - a bad model name, an
        # expired key - and is worth far more in the log than the status.
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"HTTP {exc.code} from the model API: {detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"{type(exc).__name__}: {exc}") from exc

    try:
        text = (body["choices"][0]["message"]["content"] or "").strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Unexpected response shape: {str(body)[:300]}") from exc
    if not text:
        raise RuntimeError("The model returned an empty reply.")

    usage = body.get("usage") or {}
    return {
        "reply": text,
        "model": body.get("model") or MODEL,
        "usage": {
            "input_tokens": usage.get("prompt_tokens"),
            "output_tokens": usage.get("completion_tokens"),
        },
    }
