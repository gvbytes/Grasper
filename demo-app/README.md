# Notes app

A small notes web app. Users register and log in. Each user creates, lists, and deletes their own notes.

## Stack

- Python 3 with Flask.
- SQLite through the sqlite3 standard library module.
- Passwords hashed with werkzeug.security.
- Session auth. The secret key comes from a `.env` file.

## Setup

```sh
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in this folder:

```
SECRET_KEY=change-me-to-a-random-string
```

## Run

```sh
python app.py
```

Open http://127.0.0.1:5000 in a browser.
