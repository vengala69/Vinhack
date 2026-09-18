"""Request models.

These validate what the frontend sends. Reads come straight back as dicts
from sqlite3.Row, so there are no response models to keep in sync with the
schema; the database's own CHECK constraints remain the last line of defence.

Every field on an *Update model is optional: PATCH applies a partial change.
"""
from datetime import datetime, timezone
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, BeforeValidator, EmailStr, Field

# ---------------------------------------------------------------------
# Timestamp normalisation
#
# The schema stores timestamps as 'YYYY-MM-DD HH:MM:SS' and compares them as
# text, so a mixed format corrupts ordering rather than erroring: 'T' sorts
# above ' ' in ASCII, which puts 09:00 of one format *after* 17:00 of the
# other and silently breaks CHECK constraints, ORDER BY, and date arithmetic.
#
# A browser's Date.toISOString() emits '2026-09-18T14:00:00.000Z', so this is
# the default thing a frontend sends. Normalise it here rather than asking
# every caller to remember. Offset-aware input is converted to UTC, matching
# SQLite's datetime('now'), which the schema uses for its own defaults.
# ---------------------------------------------------------------------

def _to_timestamp(v: Any) -> Any:
    if v is None or not isinstance(v, (str, datetime)):
        return v
    dt = v if isinstance(v, datetime) else _parse(v)
    if dt is None:
        return v  # let the database's own constraints reject it
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _to_date(v: Any) -> Any:
    ts = _to_timestamp(v)
    return ts[:10] if isinstance(ts, str) and len(ts) >= 10 else ts


def _parse(s: str) -> Optional[datetime]:
    s = s.strip()
    try:
        # fromisoformat handles 'T' or ' ', fractional seconds, and offsets;
        # 'Z' only from Python 3.11, and a bare date is widened to midnight.
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


Timestamp = Annotated[str, BeforeValidator(_to_timestamp)]
DateStr = Annotated[str, BeforeValidator(_to_date)]

TaskType = Literal["assignment", "exam", "quiz", "project", "reading", "lab", "other"]
Priority = Literal["low", "medium", "high", "urgent"]
Status = Literal["pending", "in_progress", "completed", "cancelled"]
EventType = Literal["class", "exam", "lab", "meeting", "personal", "commute", "other"]

Score10 = Field(None, ge=1, le=10)
Score5 = Field(None, ge=1, le=5)


class StudentIn(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    semester: Optional[int] = Field(None, ge=1, le=12)


class StudentUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1)
    email: Optional[EmailStr] = None
    semester: Optional[int] = Field(None, ge=1, le=12)


class SleepLogIn(BaseModel):
    sleep_date: DateStr
    bedtime: Optional[Timestamp] = None
    wake_time: Optional[Timestamp] = None
    # left unset, a trigger derives this from bedtime and wake_time
    duration_minutes: Optional[int] = Field(None, ge=0, le=1440)
    quality: Optional[int] = Score5


class ScreenTimeIn(BaseModel):
    date: DateStr
    social_media_minutes: int = Field(0, ge=0)
    entertainment_minutes: int = Field(0, ge=0)
    education_minutes: int = Field(0, ge=0)
    communication_minutes: int = Field(0, ge=0)
    other_minutes: int = Field(0, ge=0)
    # total_screen_minutes is a generated column and is never accepted here


class MoodEnergyIn(BaseModel):
    date: DateStr
    mood_score: Optional[int] = Score10
    energy_score: Optional[int] = Score10


class TaskIn(BaseModel):
    task_name: str = Field(min_length=1)
    subject: Optional[str] = None
    task_type: TaskType = "other"
    due_date: Optional[Timestamp] = None
    estimated_effort_hours: Optional[float] = Field(None, ge=0)
    priority: Priority = "medium"
    status: Status = "pending"


class TaskUpdate(BaseModel):
    task_name: Optional[str] = Field(None, min_length=1)
    subject: Optional[str] = None
    task_type: Optional[TaskType] = None
    due_date: Optional[Timestamp] = None
    estimated_effort_hours: Optional[float] = Field(None, ge=0)
    priority: Optional[Priority] = None
    status: Optional[Status] = None
    # completed_at is managed by a trigger and is not settable


class EventIn(BaseModel):
    event_name: str = Field(min_length=1)
    event_type: EventType = "other"
    start_time: Timestamp
    end_time: Timestamp
    is_fixed: bool = True
    location: Optional[str] = None


class EventUpdate(BaseModel):
    event_name: Optional[str] = Field(None, min_length=1)
    event_type: Optional[EventType] = None
    start_time: Optional[Timestamp] = None
    end_time: Optional[Timestamp] = None
    is_fixed: Optional[bool] = None
    location: Optional[str] = None


class SessionIn(BaseModel):
    task_id: Optional[int] = None
    start_time: Timestamp
    end_time: Optional[Timestamp] = None
    # left unset, a trigger derives this from start_time and end_time
    duration_minutes: Optional[int] = Field(None, ge=0)
    focus_rating: Optional[int] = Score5


class SessionUpdate(BaseModel):
    task_id: Optional[int] = None
    end_time: Optional[Timestamp] = None
    duration_minutes: Optional[int] = Field(None, ge=0)
    focus_rating: Optional[int] = Score5
