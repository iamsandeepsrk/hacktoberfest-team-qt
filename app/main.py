import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Base directories
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DB_PATH = BASE_DIR.parent / "workouts.db"

app = FastAPI(
    title="Touch Grass Outdoor Fitness Coach",
    description="Edge-powered outdoor fitness tracker with real-time pose estimation and voice cues.",
    version="1.0.0"
)

# Enable CORS for local development / testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SQLite Initialization
def get_db_connection():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS workouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exercise_type TEXT NOT NULL,
                rep_count INTEGER NOT NULL,
                duration_seconds REAL NOT NULL,
                calories_est REAL DEFAULT 0.0,
                created_at TEXT NOT NULL
            );
            """
        )
        conn.commit()

init_db()

# Pydantic Schemas
class WorkoutLogCreate(BaseModel):
    exercise_type: str = Field(..., min_length=1, description="Type of exercise (e.g. squats, pushups)")
    rep_count: int = Field(..., ge=0, description="Completed repetitions")
    duration_seconds: float = Field(..., ge=0, description="Duration in seconds")
    calories_est: Optional[float] = Field(default=0.0, ge=0, description="Estimated calories burned")
    timestamp: Optional[str] = Field(default=None, description="ISO timestamp of session")

class WorkoutLogResponse(BaseModel):
    id: int
    exercise_type: str
    rep_count: int
    duration_seconds: float
    calories_est: float
    created_at: str

# API Endpoints
@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "app": "Touch Grass Outdoor Fitness Coach",
        "version": "1.0.0"
    }

@app.post(
    "/api/workouts/log",
    response_model=WorkoutLogResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Log completed workout session"
)
def log_workout(workout: WorkoutLogCreate):
    created_at = workout.timestamp or datetime.now(timezone.utc).isoformat()
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO workouts (exercise_type, rep_count, duration_seconds, calories_est, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    workout.exercise_type.lower().strip(),
                    workout.rep_count,
                    workout.duration_seconds,
                    workout.calories_est or 0.0,
                    created_at,
                )
            )
            workout_id = cursor.lastrowid
            conn.commit()

            return WorkoutLogResponse(
                id=workout_id,
                exercise_type=workout.exercise_type.lower().strip(),
                rep_count=workout.rep_count,
                duration_seconds=workout.duration_seconds,
                calories_est=workout.calories_est or 0.0,
                created_at=created_at,
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record workout session: {str(e)}"
        )

@app.get(
    "/api/workouts/history",
    response_model=List[WorkoutLogResponse],
    summary="Retrieve workout history"
)
def get_workout_history(limit: int = 50):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, exercise_type, rep_count, duration_seconds, calories_est, created_at
                FROM workouts
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,)
            )
            rows = cursor.fetchall()
            return [
                WorkoutLogResponse(
                    id=row["id"],
                    exercise_type=row["exercise_type"],
                    rep_count=row["rep_count"],
                    duration_seconds=row["duration_seconds"],
                    calories_est=row["calories_est"],
                    created_at=row["created_at"],
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch workout history: {str(e)}"
        )

@app.delete("/api/workouts/clear", status_code=status.HTTP_200_OK)
def clear_workout_history():
    """Utility endpoint to reset database during testing."""
    with get_db_connection() as conn:
        conn.execute("DELETE FROM workouts")
        conn.commit()
    return {"message": "Workout history cleared"}

# Serve static files & SPA root
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/", include_in_schema=False)
def serve_index():
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend index.html not found")
    return FileResponse(str(index_file))
