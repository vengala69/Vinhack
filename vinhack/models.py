"""Request models.

These validate what the frontend sends. Reads come straight back as dicts
from sqlite3.Row, so there are no response models to keep in sync with the
schema; the database's own CHECK constraints remain the last line of defence.

Every field on an *Update model is optional: PATCH applies a partial change.
"""
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field

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
    sleep_date: str
    bedtime: Optional[str] = None
    wake_time: Optional[str] = None
    # left unset, a trigger derives this from bedtime and wake_time
    duration_minutes: Optional[int] = Field(None, ge=0, le=1440)
    quality: Optional[int] = Score5


class ScreenTimeIn(BaseModel):
    date: str
    social_media_minutes: int = Field(0, ge=0)
    entertainment_minutes: int = Field(0, ge=0)
    education_minutes: int = Field(0, ge=0)
    communication_minutes: int = Field(0, ge=0)
    other_minutes: int = Field(0, ge=0)
    # total_screen_minutes is a generated column and is never accepted here


class MoodEnergyIn(BaseModel):
    date: str
    mood_score: Optional[int] = Score10
    energy_score: Optional[int] = Score10


class TaskIn(BaseModel):
    task_name: str = Field(min_length=1)
    subject: Optional[str] = None
    task_type: TaskType = "other"
    due_date: Optional[str] = None
    estimated_effort_hours: Optional[float] = Field(None, ge=0)
    priority: Priority = "medium"
    status: Status = "pending"


class TaskUpdate(BaseModel):
    task_name: Optional[str] = Field(None, min_length=1)
    subject: Optional[str] = None
    task_type: Optional[TaskType] = None
    due_date: Optional[str] = None
    estimated_effort_hours: Optional[float] = Field(None, ge=0)
    priority: Optional[Priority] = None
    status: Optional[Status] = None
    # completed_at is managed by a trigger and is not settable


class EventIn(BaseModel):
    event_name: str = Field(min_length=1)
    event_type: EventType = "other"
    start_time: str
    end_time: str
    is_fixed: bool = True
    location: Optional[str] = None


class EventUpdate(BaseModel):
    event_name: Optional[str] = Field(None, min_length=1)
    event_type: Optional[EventType] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    is_fixed: Optional[bool] = None
    location: Optional[str] = None


class SessionIn(BaseModel):
    task_id: Optional[int] = None
    start_time: str
    end_time: Optional[str] = None
    # left unset, a trigger derives this from start_time and end_time
    duration_minutes: Optional[int] = Field(None, ge=0)
    focus_rating: Optional[int] = Score5


class SessionUpdate(BaseModel):
    task_id: Optional[int] = None
    end_time: Optional[str] = None
    duration_minutes: Optional[int] = Field(None, ge=0)
    focus_rating: Optional[int] = Score5
