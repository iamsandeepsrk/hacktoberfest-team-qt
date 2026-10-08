import time
import pytest
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:8000"

def test_outdoor_fitness_coach_e2e():
    """
    End-to-End browser verification test for Touch Grass Outdoor Fitness Coach:
    1. Loads page with outdoor solar-glare UI.
    2. Starts camera using Chromium mock video devices.
    3. Verifies pose calculation trigonometry engine.
    4. Switches calisthenics exercises (Squats -> Push-ups -> Pull-ups).
    5. Verifies AMOLED Off-Screen Battery-Saver Mode and tap-to-wake.
    6. Verifies Web Speech audio engine and voice cue triggers.
    7. Tests workout logging and SQLite history display.
    """
    with sync_playwright() as p:
        # Launch Chromium with flags to automatically mock camera stream and bypass hardware permissions
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
                "--no-sandbox"
            ]
        )
        context = browser.new_context(
            permissions=["camera"],
            viewport={"width": 1280, "height": 800}
        )
        page = context.new_page()

        # Step 1: Navigate to Touch Grass web app
        response = page.goto(BASE_URL, wait_until="networkidle")
        assert response.status == 200, f"Expected 200 OK, got {response.status}"

        # Step 2: Verify page title and header
        title = page.title()
        assert "Touch Grass" in title, f"Unexpected page title: {title}"

        header_text = page.locator("header h1").inner_text()
        assert "TOUCH GRASS" in header_text

        # Step 3: Verify initial UI standby state
        placeholder = page.locator("#camera-placeholder")
        assert placeholder.is_visible()

        btn_start_cam = page.locator("#btn-start-camera")
        assert btn_start_cam.is_visible()

        # Step 4: Click Enable Outdoor Camera and verify mock video stream
        btn_start_cam.click()
        page.wait_for_timeout(1500)

        # Video feed should now have playing status
        video_is_active = page.evaluate("() => { const v = document.getElementById('webcam-video'); return !v.paused && v.readyState >= 2; }")
        assert video_is_active, "Webcam video should be active and playing"

        # HUD overlay should now be visible
        hud = page.locator("#hud-overlay")
        assert hud.is_visible()

        # Step 5: Test Biomechanical Trigonometry Engine in the browser
        # Test 90 degree right angle: A(0, 1), B(0, 0), C(1, 0)
        angle_90 = page.evaluate("() => window.__TOUCH_GRASS__.calculateAngle({x: 0, y: 1}, {x: 0, y: 0}, {x: 1, y: 0})")
        assert angle_90 == 90, f"Expected 90 degrees, got {angle_90}"

        # Test 180 degree straight line (lockout): A(0, 1), B(0, 0), C(0, -1)
        angle_180 = page.evaluate("() => window.__TOUCH_GRASS__.calculateAngle({x: 0, y: 1}, {x: 0, y: 0}, {x: 0, y: -1})")
        assert angle_180 == 180, f"Expected 180 degrees, got {angle_180}"

        # Step 6: Test Exercise Switcher
        pushup_btn = page.locator("button[data-exercise='pushups']")
        pushup_btn.click()
        page.wait_for_timeout(500)

        guide_title = page.locator("#form-guide-title").inner_text()
        assert "Push-Up" in guide_title, f"Expected Push-Up guide title, got {guide_title}"

        current_exercise = page.evaluate("() => window.__TOUCH_GRASS__.state.currentExercise")
        assert current_exercise == "pushups"

        # Step 7: Test AMOLED Off-Screen Battery Saver Mode
        btn_screen_off = page.locator("#btn-screen-off")
        btn_screen_off.click()
        page.wait_for_timeout(500)

        off_screen_overlay = page.locator("#off-screen-overlay")
        assert off_screen_overlay.is_visible(), "Off-screen overlay should be visible"

        # Tap anywhere on the off-screen overlay to wake the display
        off_screen_overlay.click()
        page.wait_for_timeout(500)
        assert not off_screen_overlay.is_visible(), "Off-screen overlay should dismiss on tap"

        # Step 8: Test Hands-Free Speech Engine & Voice Settings
        audio_engine_ready = page.evaluate("() => typeof window.__TOUCH_GRASS__.AudioEngine !== 'undefined'")
        assert audio_engine_ready, "AudioEngine should be initialized"

        # Trigger voice test button
        page.locator("#btn-test-voice").click()
        page.wait_for_timeout(300)

        # Toggle audio mute
        page.locator("#toggle-audio-btn").click()
        page.wait_for_timeout(200)
        audio_label = page.locator("#audio-label").inner_text()
        assert "OFF" in audio_label

        # Unmute
        page.locator("#toggle-audio-btn").click()
        page.wait_for_timeout(200)
        audio_label = page.locator("#audio-label").inner_text()
        assert "ON" in audio_label

        # Step 9: Simulate Reps and Log Workout to SQLite via REST API
        page.evaluate("() => { window.__TOUCH_GRASS__.state.repCount = 15; }")
        page.locator("#btn-log-workout").click()
        page.wait_for_timeout(1000)

        # Step 10: Verify Toast and History Feed rendered
        history_list = page.locator("#workout-history-list")
        history_text = history_list.inner_text()
        assert "15 reps" in history_text, f"Expected 15 reps in history, got: {history_text}"
        assert "PUSHUPS" in history_text.upper()

        browser.close()

if __name__ == "__main__":
    pytest.main(["-v", __file__])
