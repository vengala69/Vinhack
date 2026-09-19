"""The wellbeing chat, backed by Claude.

Two things make this different from a generic chatbot wrapper:

  * it is grounded. The student's own logged figures - sleep, energy, open
    deadlines - go into the system prompt, so the reply talks about their week
    rather than offering advice in the abstract.
  * it knows what it is not. The prompt is explicit that this is a study-habit
    companion, not a counsellor, and that anything touching self-harm gets a
    short reply pointing at real help rather than a coaching conversation.

If no API key is configured the endpoint reports that plainly and the frontend
falls back to its scripted replies, so the page works either way.
"""
import os
from typing import Any, Optional

# Chosen by the deployment, not by the source. See .env.example.
MODEL = os.environ.get("LLM_MODEL") or os.environ.get("ANTHROPIC_MODEL") or "claude-opus-5"
MAX_TOKENS = int(os.environ.get("LLM_MAX_TOKENS") or 700)
MAX_HISTORY = int(os.environ.get("LLM_MAX_HISTORY") or 12)   # turns kept

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


def configured() -> bool:
    """True when there is a credential the SDK can use."""
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


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
    """Ask Claude for one reply. Raises RuntimeError with a usable message."""
    try:
        import anthropic
    except ImportError as exc:                      # pragma: no cover - env dependent
        raise RuntimeError(
            "The anthropic package is not installed. Run: py -m pip install anthropic"
        ) from exc

    client = anthropic.Anthropic()

    turns: list[dict] = []
    for turn in history[-MAX_HISTORY:]:
        role = turn.get("role")
        text = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and text:
            turns.append({"role": role, "content": text})
    turns.append({"role": "user", "content": message})

    # The conversation has to start with a user turn.
    while turns and turns[0]["role"] != "user":
        turns.pop(0)

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=[
                {"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": "Their figures right now:\n\n" + context},
            ],
            # A short supportive reply does not need deep reasoning, and the
            # student is waiting on it.
            output_config={"effort": "low"},
            messages=turns,
        )
    except Exception as exc:                        # surfaced to the UI as-is
        raise RuntimeError(f"{type(exc).__name__}: {exc}") from exc

    if response.stop_reason == "refusal":
        raise RuntimeError("The model declined to answer that one.")

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    if not text:
        raise RuntimeError("The model returned an empty reply.")

    return {
        "reply": text,
        "model": response.model,
        "usage": {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        },
    }
