from flask import Flask, render_template, Response, jsonify, request, stream_with_context, has_app_context
import cv2
import base64
import time
import requests
import os
import json
import re
import random
from dotenv import load_dotenv
from deepface import DeepFace
from datetime import datetime, timezone, timedelta
from typing import Optional

# ---------- Load env ----------
load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

SUGGESTION_COOLDOWN_SECONDS = 60 

app = Flask(__name__, static_folder="static", template_folder="templates")

# ---------- Database ----------
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func

app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("DATABASE_URL", "sqlite:///emodash.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

# --- Models ---
class MoodLog(db.Model):
    __tablename__ = "mood_log"
    id = db.Column(db.Integer, primary_key=True)
    ts_utc = db.Column(db.DateTime, nullable=False, index=True, default=lambda: datetime.utcnow())
    ts_iso = db.Column(db.String(40), nullable=False, default=lambda: datetime.now(timezone.utc).isoformat())
    emotion = db.Column(db.String(32), nullable=False, index=True)
    note = db.Column(db.String(255), nullable=False, default="")
    source = db.Column(db.String(16), nullable=False, default="auto")  

class GroqLabel(db.Model):
    __tablename__ = "groq_label"
    id = db.Column(db.Integer, primary_key=True)
    ts_utc = db.Column(db.DateTime, nullable=False, index=True, default=lambda: datetime.utcnow())
    emotion = db.Column(db.String(32), nullable=False, index=True)

class Suggestion(db.Model):
    __tablename__ = "suggestion"
    id = db.Column(db.Integer, primary_key=True)
    ts_utc = db.Column(db.DateTime, nullable=False, index=True, default=lambda: datetime.utcnow())
    emotion = db.Column(db.String(32), nullable=False)
    activity = db.Column(db.String(255), nullable=False, default="")  

class Task(db.Model):
    __tablename__ = "task"
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.String(255), nullable=False)
    done = db.Column(db.Boolean, nullable=False, default=False, index=True)
    priority = db.Column(db.String(16), nullable=False, default="medium")  
    quick = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.utcnow(), index=True)

class EmailMessage(db.Model):
    __tablename__ = "email_message"
    id = db.Column(db.Integer, primary_key=True)
    sender = db.Column(db.String(255), nullable=False)   
    to = db.Column(db.String(255), nullable=True)
    subject = db.Column(db.String(255), nullable=False, default="(no subject)")
    content = db.Column(db.Text, nullable=False, default="")
    folder = db.Column(db.String(32), nullable=False, default="inbox")  
    starred = db.Column(db.Boolean, nullable=False, default=False, index=True)
    read = db.Column(db.Boolean, nullable=False, default=False, index=True)
    date_str = db.Column(db.String(64), nullable=False, default="")
    ts_utc = db.Column(db.DateTime, nullable=False, default=lambda: datetime.utcnow(), index=True)

with app.app_context():
    db.create_all()

    # Seed emails on first run
    if EmailMessage.query.count() == 0:
        seed = [
            dict(sender="SIM <noreply@123.sg>", to="you@local",
                 subject="Welcome to the project collaboration Platform",
                 content="Dear TAN CHONG HAO,\n\nWe are pleased to introduce our new platform.\n\nLogin Here https://project.1233.com\n\nBest regards,\nSIM IT Services",
                 folder="inbox", starred=False, read=False, date_str="Tue, 4 Jun 2025, 3:34 PM"),
            dict(sender="Coursera <no-reply@coursera.org>", to="you@local",
                 subject="Reminder - CM3070 Final Project Deadline",
                 content="Hi TAN CHONG HAO,\n\nThis is a reminder that your final project for CM3070 is due on 7 June 2025, 11:59 PM.\n\nMake sure to upload your report and code before the deadline.\n\nRegards,\nCoursera Academic Team",
                 folder="inbox", starred=True, read=False, date_str="Mon, 3 Jun 2025, 9:29 PM"),
            dict(sender="SIM Admin <noreply@sim.sg>", to="you@local",
                 subject="Midterm Webinar Invitation",
                 content="Dear TAN CHONG HAO,\n\nYou're invited to join the Midterm Project Webinar on Thursday, 6 June at 3 PM via Zoom.\n\nMeeting Link: https://zoom.sim.edu/webinar\n\nBest regards,\nCM3070 Team",
                 folder="inbox", starred=False, read=True, date_str="Mon, 3 Jun 2025, 11:51 AM"),
            dict(sender="Figma Team <team@figma.com>", to="you@local",
                 subject="Project Design Handoff Ready",
                 content="Hello Team,\n\nThe UI handoff for the Emotion-Aware Dashboard is now ready.\n\nClick to review: https://figma.com/file/emodash-handoff\n\nThanks,\nFigma",
                 folder="inbox", starred=False, read=True, date_str="Sun, 2 Jun 2025, 4:12 PM"),
            dict(sender="Zoom <no-reply@zoom.us>", to="you@local",
                 subject="Meeting Invite: Final Sprint Demo",
                 content="You are invited to the Final Sprint Demo presentation.\n\nDate: Sunday, 2 June\nTime: 10:00 AM\nZoom Link: https://zoom.us/j/456789123\n\nSee you there!",
                 folder="inbox", starred=False, read=True, date_str="Sat, 1 Jun 2025, 2:00 PM"),
        ]
        for m in seed:
            db.session.add(EmailMessage(**m))
        db.session.commit()

    # Seed tasks on first run
    if Task.query.count() == 0:
        for t in [
            dict(text="Update Website", done=False, priority="high", quick=True),
            dict(text="Reply HR Email", done=False, priority="medium", quick=True),
            dict(text="Check on Stocks", done=False, priority="low", quick=False),
            dict(text="Meeting With Clients", done=False, priority="high", quick=False),
        ]:
            db.session.add(Task(**t))
        db.session.commit()

# ---------- Camera & CV ----------
def _open_camera():
    cam = cv2.VideoCapture(0)
    if not cam or not cam.isOpened():
        cam = cv2.VideoCapture(0, cv2.CAP_DSHOW)  
    return cam

camera = _open_camera()
if camera and camera.isOpened():
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

# Short, randomized activities per emotion (3–8 words)
RANDOM_ACTIVITIES = {
    "stressed": ["box-breath 1 minute", "stand, stretch 2 minutes", "sip water, slow breaths", "walk 2 minutes", "shoulder rolls, relax jaw"],
    "angry":   ["three slow breaths", "step away 2 minutes", "loosen shoulders & neck", "count back from 30", "sip water, reset"],
    "sad":     ["step outside 3 minutes", "cue a favorite song", "message a friend hello", "look at a happy photo", "list 3 good things"],
    "tired":   ["eye palming 60 seconds", "neck stretch 90 seconds", "look far 20 seconds", "roll wrists & ankles", "sip cool water"],
    "anxious": ["4-7-8 breathing 1 minute", "name 3 things you see", "grounding: 5-4-3-2-1", "slow inhale through nose", "relax tongue & jaw"]
}

LABEL_MAP = {
    "angry":"Angry", "disgust":"Stressed", "fear":"Anxious",
    "happy":"Happy", "sad":"Sad", "surprise":"Focused", "neutral":"Calm"
}

def now_iso_utc():
    return datetime.now(timezone.utc).isoformat()

def encode_frame_to_base64(frame):
    ok, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        return ""
    return base64.b64encode(buffer).decode('utf-8')

def detect_emotion_local(face_img):
    try:
        analysis = DeepFace.analyze(
            face_img,
            actions=['emotion'],
            detector_backend='opencv',
            enforce_detection=False
        )
        payload = analysis[0] if isinstance(analysis, list) else analysis
        emotions = payload.get('emotion') or {}
        if not emotions:
            return "Unknown"
        top = max(emotions, key=emotions.get)
        conf = emotions[top]
        return f"{top.capitalize()} ({conf:.2f})"
    except Exception as e:
        print("Emotion detection error:", str(e))
        return "Unknown"

def parse_groq_json(content: str):
    s = content.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.I | re.S).strip()
    if "{" in s and "}" in s:
        s = s[s.find("{"): s.rfind("}")+1]
    try:
        obj = json.loads(s)
    except Exception as e:
        print("Groq JSON parse failed:", e, "content:", content[:200])
        return {"emotion": "Unknown", "activity": ""}
    return {"emotion": (obj.get("emotion") or "Unknown").strip(),
            "activity": (obj.get("activity") or "").strip()}

def commit_safe(objs):
    if not isinstance(objs, (list, tuple)):
        objs = [objs]
    def _do():
        for o in objs: db.session.add(o)
        db.session.commit()
    if has_app_context():
        _do()
    else:
        with app.app_context():
            _do()

def random_activity_for(emotion: str) -> str:
    arr = RANDOM_ACTIVITIES.get((emotion or "").lower(), [])
    return random.choice(arr) if arr else ""

def add_suggestion_with_cooldown(emotion: str, activity: str):
   
    try:
        now = datetime.utcnow()

        # Always persist label & mood
        commit_safe([
            GroqLabel(emotion=emotion),
            MoodLog(emotion=emotion, note="", source="auto")
        ])

        neg_emotions = {"Stressed", "Angry", "Sad", "Tired", "Anxious"}
        if emotion not in neg_emotions or not activity:
            return

        last = (Suggestion.query
                .order_by(Suggestion.ts_utc.desc())
                .with_entities(Suggestion.ts_utc)
                .first())

        if last is not None:
            age = (now - (last[0] or now)).total_seconds()
            if age < SUGGESTION_COOLDOWN_SECONDS:
                return  

        commit_safe(Suggestion(emotion=emotion, activity=activity))

    except Exception as e:
        print("add_suggestion_with_cooldown failed:", e)

def analyse_with_groq(face_b64):
    if not GROQ_API_KEY:
        return "Groq key missing"
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    data = {
        "model": "meta-llama/llama-4-scout-17b-16e-instruct",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": (
                    "Analyze the image and determine the person's emotion. "
                    "Respond strictly as JSON: {\"emotion\":\"<Emotion>\",\"activity\":\"<Short Suggestion>\"}. "
                    "Allowed emotions: Calm, Happy, Focused, Stressed, Angry, Sad, Tired, Anxious. "
                    "If negative (Stressed/Angry/Sad/Tired/Anxious), activity must be concise (3–8 words) and a 1–5 minute action. "
                    "If positive, activity must be empty."
                )},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{face_b64}"}}
            ]
        }],
        "temperature": 0.2,
        "max_tokens": 120
    }

    try:
        resp = requests.post(GROQ_URL, headers=headers, json=data, timeout=20)
        print("Groq response status:", resp.status_code)
        if not resp.ok:
            print("Groq error:", resp.text[:400])
            return "Error from Groq"

        content = resp.json()["choices"][0]["message"]["content"]
        parsed = parse_groq_json(content)
        emotion = parsed["emotion"] or "Unknown"

        # Randomize short activity for negative emotions
        neg = {"Stressed","Angry","Sad","Tired","Anxious"}
        activity = random_activity_for(emotion) if emotion in neg else ""

        add_suggestion_with_cooldown(emotion, activity)
        return emotion
    except Exception as e:
        print("Groq API call failed:", e)
        return "Groq request failed"

def map_local_to_label(text):
    base = (text.split()[0] if text else "").lower()
    return LABEL_MAP.get(base, "Calm")

def gen_frames():
    last_groq_time = 0
    while True:
        if not camera or not camera.isOpened():
            time.sleep(0.1)
            continue

        ok, frame = camera.read()
        if not ok:
            time.sleep(0.05)
            continue

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=3, minSize=(80,80))

        detected = "No face detected"
        if len(faces) > 0:
            x, y, w, h = sorted(faces, key=lambda b: b[2]*b[3], reverse=True)[0]
            face_img = frame[y:y+h, x:x+w]
            try:
                face_img_resized = cv2.resize(face_img, (224,224))
            except Exception:
                face_img_resized = face_img

            detected = detect_emotion_local(face_img_resized)

            # Groq every 10s. 
            if time.time() - last_groq_time > 10:
                wrote = False
                if GROQ_API_KEY:
                    face_b64 = encode_frame_to_base64(face_img_resized)
                    emo = analyse_with_groq(face_b64)
                    wrote = emo not in ("Groq request failed", "Error from Groq", "Groq key missing")
                if not wrote:
                    normalized = map_local_to_label(detected)
                    add_suggestion_with_cooldown(normalized, "")  
                last_groq_time = time.time()

            cv2.rectangle(frame, (x,y), (x+w,y+h), (0,255,0), 2)
            cv2.putText(frame, detected, (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255,255,0), 2, cv2.LINE_AA)

        ok, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            continue
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')

# ---------- LOCAL day window helper ----------
def _day_window_from_local(date_str: str, tz_offset_min: Optional[int]):
    start_local = datetime.strptime(date_str, "%Y-%m-%d")
    if tz_offset_min is None:
        utc_start = start_local
    else:
        utc_start = start_local + timedelta(minutes=tz_offset_min)
    utc_end = utc_start + timedelta(days=1)
    return utc_start, utc_end

# ---------- Routes ----------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/video_feed")
def video_feed():
    return Response(stream_with_context(gen_frames()),
                    mimetype="multipart/x-mixed-replace; boundary=frame")

# Status log: return ISO timestamps; frontend renders local times
@app.route("/groq_results")
def get_groq_results():
    rows = GroqLabel.query.order_by(GroqLabel.ts_utc.desc()).limit(10).all()
    out = []
    for r in rows:
        ts_iso = (r.ts_utc.replace(tzinfo=timezone.utc).isoformat()) if r.ts_utc else datetime.now(timezone.utc).isoformat()
        out.append({"ts": ts_iso, "emotion": r.emotion})
    return jsonify(out)

@app.route("/groq_suggestion")
def get_groq_suggestion():
    s = Suggestion.query.order_by(Suggestion.ts_utc.desc()).first()
    if not s:
        return jsonify({"emotion": "", "activity": ""})
    return jsonify({"emotion": s.emotion, "activity": s.activity})

# Mood journal APIs 
@app.route("/log_mood", methods=["POST"])
def log_mood():
    try:
        data = request.get_json(force=True)
        entry = MoodLog(
            emotion=data.get("emotion", "Unknown"),
            note=data.get("note", ""),
            source=data.get("source", "manual")
        )
        db.session.add(entry)
        db.session.commit()
        return jsonify({"ok": True})
    except Exception as e:
        db.session.rollback()
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/mood_entries")
def mood_entries():
    """
    ?date=YYYY-MM-DD (LOCAL); optional ?tz_offset_min=<int, JS getTimezoneOffset()>
    """
    date_str = request.args.get("date")
    if not date_str:
        return jsonify([])

    try:
        tz_offset_min = request.get_json(silent=True) or request.args.get("tz_offset_min", type=int)
        if isinstance(tz_offset_min, dict):
            tz_offset_min = tz_offset_min.get("tz_offset_min")
        start, end = _day_window_from_local(date_str, tz_offset_min)
    except Exception:
        return jsonify([])

    rows = (MoodLog.query
            .filter(MoodLog.ts_utc >= start, MoodLog.ts_utc < end)
            .order_by(MoodLog.ts_utc.asc())
            .all())

    out = []
    for r in rows:
        out.append({
            "ts": (r.ts_iso or r.ts_utc.replace(tzinfo=timezone.utc).isoformat()),
            "emotion": r.emotion,
            "note": r.note,
            "source": r.source
        })
    return jsonify(out)

@app.route("/mood_summary")
def mood_summary():
    """
    ?date=YYYY-MM-DD (LOCAL); optional ?tz_offset_min=<int, JS getTimezoneOffset()>
    """
    date_str = request.args.get("date")
    if not date_str:
        return jsonify({"counts": {}, "top_emotion": None})

    try:
        tz_offset_min = request.get_json(silent=True) or request.args.get("tz_offset_min", type=int)
        if isinstance(tz_offset_min, dict):
            tz_offset_min = tz_offset_min.get("tz_offset_min")
        start, end = _day_window_from_local(date_str, tz_offset_min)
    except Exception:
        return jsonify({"counts": {}, "top_emotion": None})

    rows = (db.session.query(MoodLog.emotion, func.count(MoodLog.id))
            .filter(MoodLog.ts_utc >= start, MoodLog.ts_utc < end)
            .group_by(MoodLog.emotion)
            .all())

    counts = {emo: int(n) for (emo, n) in rows}
    top_emotion = max(counts, key=counts.get) if counts else None
    return jsonify({"counts": counts, "top_emotion": top_emotion})

# ---------- Tasks ----------
@app.route("/api/tasks", methods=["GET"])
def api_tasks_list():
    rows = Task.query.order_by(Task.created_at.desc()).all()
    return jsonify([{
        "id": t.id, "text": t.text, "done": t.done,
        "priority": t.priority, "quick": t.quick
    } for t in rows])

@app.route("/api/tasks", methods=["POST"])
def api_tasks_create():
    data = request.get_json(force=True)
    t = Task(
        text=(data.get("text") or "").strip() or "Untitled Task",
        done=bool(data.get("done", False)),
        priority=(data.get("priority") or "medium"),
        quick=bool(data.get("quick", False))
    )
    db.session.add(t)
    db.session.commit()
    return jsonify({"id": t.id}), 201

@app.route("/api/tasks/<int:tid>", methods=["PATCH"])
def api_tasks_update(tid):
    t = Task.query.get_or_404(tid)
    data = request.get_json(force=True)
    if "text" in data: t.text = (data["text"] or t.text)
    if "done" in data: t.done = bool(data["done"])
    if "priority" in data: t.priority = (data["priority"] or t.priority)
    if "quick" in data: t.quick = bool(data["quick"])
    db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/tasks/<int:tid>", methods=["DELETE"])
def api_tasks_delete(tid):
    t = Task.query.get_or_404(tid)
    db.session.delete(t)
    db.session.commit()
    return jsonify({"ok": True})

# ---------- Emails ----------
def _format_email(m: EmailMessage):
    return {
        "id": m.id,
        "sender": m.sender,
        "to": m.to,
        "subject": m.subject,
        "content": m.content,
        "folder": m.folder,
        "starred": m.starred,
        "read": m.read,
        "date": m.date_str
    }

@app.route("/api/emails", methods=["GET"])
def api_emails_list():
    folder = request.args.get("folder")
    starred = request.args.get("starred")
    q = EmailMessage.query
    if folder:
        q = q.filter(EmailMessage.folder == folder)
    if starred is not None:
        want = starred in ("1","true","True")
        q = q.filter(EmailMessage.starred == want)
    rows = q.order_by(EmailMessage.ts_utc.desc()).all()
    return jsonify([_format_email(m) for m in rows])

@app.route("/api/emails/draft", methods=["POST"])
def api_emails_save_draft():
    data = request.get_json(force=True)
    now = datetime.now()
    date_str = now.strftime("%a, %d %b %Y, %I:%M %p")
    eid = data.get("id")
    if eid:
        m = EmailMessage.query.get_or_404(int(eid))
        m.to = data.get("to") or m.to
        m.subject = data.get("subject") or "(no subject)"
        m.content = data.get("content") or ""
        m.folder = "draft"
        m.date_str = date_str
        db.session.commit()
        return jsonify({"id": m.id})
    else:
        m = EmailMessage(
            sender="You <me@local>",
            to=data.get("to"),
            subject=data.get("subject") or "(no subject)",
            content=data.get("content") or "",
            folder="draft",
            starred=False,
            read=True,
            date_str=date_str
        )
        db.session.add(m)
        db.session.commit()
        return jsonify({"id": m.id}), 201

@app.route("/api/emails/send", methods=["POST"])
def api_emails_send():
    data = request.get_json(force=True)
    now = datetime.now()
    date_str = now.strftime("%a, %d %b %Y, %I:%M %p")
    eid = data.get("id")
    if eid:
        m = EmailMessage.query.get_or_404(int(eid))
        m.to = data.get("to") or m.to
        m.subject = data.get("subject") or "(no subject)"
        m.content = data.get("content") or "(no content)"
        m.folder = "sent"
        m.read = True
        m.date_str = date_str
        db.session.commit()
        return jsonify({"id": m.id})
    else:
        m = EmailMessage(
            sender="You <me@local>",
            to=data.get("to"),
            subject=data.get("subject") or "(no subject)",
            content=data.get("content") or "(no content)",
            folder="sent",
            starred=False,
            read=True,
            date_str=date_str
        )
        db.session.add(m)
        db.session.commit()
        return jsonify({"id": m.id}), 201

@app.route("/api/emails/<int:eid>", methods=["PATCH"])
def api_emails_update(eid):
    m = EmailMessage.query.get_or_404(eid)
    data = request.get_json(force=True)
    if "starred" in data: m.starred = bool(data["starred"])
    if "read" in data: m.read = bool(data["read"])
    if "folder" in data and data["folder"] in ("inbox","sent","draft"):
        m.folder = data["folder"]
    db.session.commit()
    return jsonify({"ok": True})

@app.route("/api/emails/<int:eid>", methods=["DELETE"])
def api_emails_delete(eid):
    m = EmailMessage.query.get_or_404(eid)
    db.session.delete(m)
    db.session.commit()
    return jsonify({"ok": True})

# ---------- Main ----------
if __name__ == "__main__":
    print("GROQ_API_KEY loaded:", bool(GROQ_API_KEY))
    print("DB URL:", app.config["SQLALCHEMY_DATABASE_URI"])
    app.run(debug=True)
