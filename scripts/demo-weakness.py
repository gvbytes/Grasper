"""Grasper demo: prove the login weakness, then prove the fix.

Starts the app, registers a victim user, then attacks the login with a
SQL injection payload. Prints LOGIN BYPASSED when the attack works and
LOGIN BLOCKED when the query is safe.

Usage: python3 scripts/demo-weakness.py   (uses demo-app/venv if present)
"""

import subprocess
import sys
import time
import urllib.request
import urllib.parse
import http.cookiejar
import os

# The demo app lives one folder up, in demo-app/.
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DEMO_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "demo-app"))
PORT = 5055
BASE = f"http://127.0.0.1:{PORT}"

VICTIM = ("alice", "wonderland123")
PAYLOAD = ("' OR '1'='1' -- ", "anything")


def post(path, data, opener):
    body = urllib.parse.urlencode({"username": data[0], "password": data[1]}).encode()
    req = urllib.request.Request(BASE + path, data=body)
    return opener.open(req)


def main():
    venv_python = os.path.join(DEMO_DIR, "venv", "bin", "python")
    python = venv_python if os.path.exists(venv_python) else sys.executable

    env = dict(os.environ, FLASK_RUN_PORT=str(PORT))
    proc = subprocess.Popen(
        [python, os.path.join(DEMO_DIR, "app.py")],
        env={**env, "PORT": str(PORT)},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        # The app must read the port. Pass it through the environment in app.py.
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE + "/login", timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        else:
            print("APP DID NOT START")
            return 2

        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

        # Register the victim. Ignore failure when the user already exists.
        try:
            post("/register", VICTIM, opener)
        except Exception:
            pass

        # Attack: log in as someone without knowing any password.
        response = post("/login", PAYLOAD, opener)
        # A successful login redirects to the notes page. urllib follows the redirect.
        # The base template shows "Log out" only to logged-in users.
        body = response.read().decode()
        if "Log out" in body:
            print("LOGIN BYPASSED")
            return 0
        print("LOGIN BLOCKED")
        return 1
    finally:
        proc.terminate()


if __name__ == "__main__":
    sys.exit(main())
