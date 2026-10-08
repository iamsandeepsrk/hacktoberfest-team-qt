import pytest
from fastapi.testclient import TestClient

from app.main import app, get_db_connection

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_database():
    """Ensure database is clean before each test."""
    with get_db_connection() as conn:
        conn.execute("DELETE FROM workouts")
        conn.commit()
    yield
    with get_db_connection() as conn:
        conn.execute("DELETE FROM workouts")
        conn.commit()

def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "Touch Grass" in data["app"]

def test_serve_root_index():
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    assert "Touch Grass" in response.text
    assert "webcam-video" in response.text

def test_log_workout_valid():
    payload = {
        "exercise_type": "pushups",
        "rep_count": 20,
        "duration_seconds": 60.5,
        "calories_est": 9.0
    }
    response = client.post("/api/workouts/log", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["id"] > 0
    assert data["exercise_type"] == "pushups"
    assert data["rep_count"] == 20
    assert data["duration_seconds"] == 60.5
    assert data["calories_est"] == 9.0
    assert "created_at" in data

def test_log_workout_validation_error():
    # Negative rep count
    invalid_payload = {
        "exercise_type": "squats",
        "rep_count": -5,
        "duration_seconds": 30.0
    }
    response = client.post("/api/workouts/log", json=invalid_payload)
    assert response.status_code == 422

    # Missing exercise type
    missing_type_payload = {
        "rep_count": 10,
        "duration_seconds": 30.0
    }
    response = client.post("/api/workouts/log", json=missing_type_payload)
    assert response.status_code == 422

def test_get_workout_history():
    # Insert multiple workouts
    workouts = [
        {"exercise_type": "squats", "rep_count": 25, "duration_seconds": 120.0, "calories_est": 8.75},
        {"exercise_type": "pullups", "rep_count": 8, "duration_seconds": 45.0, "calories_est": 5.6},
        {"exercise_type": "jumping_jacks", "rep_count": 50, "duration_seconds": 60.0, "calories_est": 10.0}
    ]
    for w in workouts:
        res = client.post("/api/workouts/log", json=w)
        assert res.status_code == 201

    response = client.get("/api/workouts/history?limit=10")
    assert response.status_code == 200
    history = response.json()
    assert len(history) == 3
    # Check reverse chronological order (most recent first)
    assert history[0]["exercise_type"] == "jumping_jacks"
    assert history[0]["rep_count"] == 50
    assert history[1]["exercise_type"] == "pullups"
    assert history[2]["exercise_type"] == "squats"

def test_clear_workout_history():
    client.post("/api/workouts/log", json={"exercise_type": "squats", "rep_count": 10, "duration_seconds": 30})
    del_res = client.delete("/api/workouts/clear")
    assert del_res.status_code == 200

    history_res = client.get("/api/workouts/history")
    assert history_res.status_code == 200
    assert len(history_res.json()) == 0
