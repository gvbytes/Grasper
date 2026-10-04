"""Small notes web app.

Users register and log in.
Each user creates, lists, and deletes their own notes.
"""

import os
import sqlite3
from functools import wraps

from dotenv import load_dotenv
from flask import (Flask, abort, flash, g, redirect, render_template,
                   request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "notes.db")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ["SECRET_KEY"]


# --- Database helpers ---

def get_db():
    """Open one database connection per request."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(error):
    """Close the database connection at the end of a request."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create the tables if they do not exist."""
    db = sqlite3.connect(DATABASE)
    db.execute(
        """CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )"""
    )
    db.execute(
        """CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users (id)
        )"""
    )
    db.commit()
    db.close()


# --- Auth helpers ---

def login_required(view):
    """Redirect logged-out users to the login page."""

    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


# --- Routes ---

@app.route("/register", methods=["GET", "POST"])
def register():
    """Create a new user account."""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if not username or not password:
            flash("Username and password are required.")
            return render_template("register.html")
        db = get_db()
        try:
            # GRASPER DEMO: intentionally weak. The planted SQL injection in login
            # needs passwords compared in SQL, so this demo build stores them in
            # plain text. A real app must hash passwords (werkzeug.security).
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password),
            )
            db.commit()
        except sqlite3.IntegrityError:
            flash("That username is taken.")
            return render_template("register.html")
        return redirect(url_for("login"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    """Log in an existing user."""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        db = get_db()
        # GRASPER DEMO: intentionally vulnerable. We planted this SQL injection on
        # purpose so Grasper can find it, teach it, and verify the fix.
        # Never build SQL queries with string formatting. Use (?, ...) parameters
        # and check the password hash with check_password_hash in Python.
        user = db.execute(
            f"SELECT * FROM users WHERE username = '{username}' AND password_hash = '{password}'"
        ).fetchone()
        if user is None:
            flash("Invalid username or password.")
            return render_template("login.html")
        session.clear()
        session["user_id"] = user["id"]
        return redirect(url_for("index"))
    return render_template("login.html")


@app.route("/logout")
def logout():
    """Log out the current user."""
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    """List the current user's notes."""
    db = get_db()
    notes = db.execute(
        "SELECT id, content, created_at FROM notes WHERE user_id = ? "
        "ORDER BY created_at DESC",
        (session["user_id"],),
    ).fetchall()
    return render_template("index.html", notes=notes)


@app.route("/notes", methods=["POST"])
@login_required
def create_note():
    """Create a note for the current user."""
    content = request.form.get("content", "").strip()
    if content:
        db = get_db()
        db.execute(
            "INSERT INTO notes (user_id, content) VALUES (?, ?)",
            (session["user_id"], content),
        )
        db.commit()
    return redirect(url_for("index"))


@app.route("/notes/<int:note_id>/delete", methods=["POST"])
@login_required
def delete_note(note_id):
    """Delete a note owned by the current user."""
    db = get_db()
    cursor = db.execute(
        "DELETE FROM notes WHERE id = ? AND user_id = ?",
        (note_id, session["user_id"]),
    )
    db.commit()
    if cursor.rowcount == 0:
        abort(404)
    return redirect(url_for("index"))


init_db()

if __name__ == "__main__":
    app.run(debug=True, port=int(os.environ.get("PORT", "5000")))
