"""Grasper demo helper: apply or revert the login fix.

Usage:
  python3 demo-app/fix-demo.py apply   # safe parameterized query + debug off
  python3 demo-app/fix-demo.py revert  # back to the seeded vulnerable version

The strings must match demo-app/app.py exactly.
"""

import os
import sys

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
APP = os.path.join(BASE_DIR, "app.py")

VULNERABLE_QUERY = '''        user = db.execute(
            f"SELECT * FROM users WHERE username = '{username}' AND password_hash = '{password}'"
        ).fetchone()
        if user is None:
'''
SAFE_QUERY = '''        user = db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        if user is None or not check_password_hash(user["password_hash"], password):
'''

VULNERABLE_DEBUG = 'app.run(debug=True, port=int(os.environ.get("PORT", "5000")))'
SAFE_DEBUG = 'app.run(port=int(os.environ.get("PORT", "5000")))'

def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("apply", "revert"):
        print("usage: fix-demo.py apply|revert")
        return 2
    applying = sys.argv[1] == "apply"

    with open(APP) as f:
        text = f.read()

    if applying:
        if VULNERABLE_QUERY not in text:
            print("already fixed (query)")
        else:
            text = text.replace(VULNERABLE_QUERY, SAFE_QUERY)
            print("query fixed")
        if VULNERABLE_DEBUG in text:
            text = text.replace(VULNERABLE_DEBUG, SAFE_DEBUG)
            print("debug off")
    else:
        if SAFE_QUERY not in text:
            print("already vulnerable (query)")
        else:
            text = text.replace(SAFE_QUERY, VULNERABLE_QUERY)
            print("query reverted")
        if SAFE_DEBUG in text:
            text = text.replace(SAFE_DEBUG, VULNERABLE_DEBUG)
            print("debug on")

    with open(APP, "w") as f:
        f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
