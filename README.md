HOW TO RUN — Emotion-Aware Email & Task Manager (Flask)

WHAT THIS IS
A local Flask web app that:
• Streams your webcam and detects facial emotion (DeepFace + OpenCV)
• Adapts the UI based on mood (palette/dimming/Quick-tasks)
• Includes simple Email + Task workflows with persistence (SQLite)
• Optionally calls Groq for a normalized label + short suggestion

--------------------------------
Project Structure
--------------------------------
/  (project root)
- app.py
- .env
- haarcascade_frontalface_default.xml
- mood_log.json
- README.md
- requirements.txt
- static/
  - js/
    - app.js
  - style.css

- templates/
  - index.html

- instance/
  - emodash.db

- venv/
  - Include/
  - Lib/
  - Scripts/
  - package_info.json
  - pyvenv.cfg
  - README.md

--------------------------------
SYSTEM REQUIREMENTS
--------------------------------
• Windows 10/11 or macOS 12+ (Intel or Apple Silicon)
• Python 3.10 or 3.11 installed
  - Windows: https://www.python.org/downloads/  (check “Add Python to PATH”)
• A webcam (USB or built-in)
• Internet only for first-time model download and if using Groq

Windows only (if OpenCV/TensorFlow DLL errors): install Visual C++ Redistributable
https://aka.ms/vs/17/release/vc_redist.x64.exe

--------------------------------
PROJECT CONTENTS EXPECTED
--------------------------------
app.py
templates/index.html
static/style.css
static/js/app.js
requirements.txt   
.env               

--------------------------------
FIRST-TIME SETUP
--------------------------------
1) Open a terminal in the project folder
   • Windows (PowerShell): Shift+Right-click in the folder → “Open PowerShell window here”
   • macOS: Open Terminal, cd into the folder

2) Create a virtual environment
   Windows:
     python -m venv venv
     .\venv\Scripts\activate
     (If activation fails, run once: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned)

   macOS:
     python3 -m venv venv
     source venv/bin/activate

3) Upgrade pip and install dependencies
   Windows:
     python -m pip install --upgrade pip
     pip install -r requirements.txt

   macOS:
     python3 -m pip install --upgrade pip
     pip install -r requirements.txt

4) .env file in the project root for Groq
   Open a  text file named: .env
   Add your GROQ API KEY:
     GROQ_API_KEY= your_groq_key_here
   Without the key it unable to run

--------------------------------
RUNNING THE APP
--------------------------------
1) Activate the virtual environment (if not already)
   Windows: .\venv\Scripts\activate
   macOS:   source venv/bin/activate

2) Start the server
   Windows: python app.py
   macOS:   python3 app.py

3) Open your browser to
   http://127.0.0.1:5000/

4) Allow camera permissions in the browser when asked.

5) Use the app
   • Task Manager (left) — create tasks, set priority, toggle Quick ⚡
   • Email (right) — Inbox/Starred/Sent/Draft, Compose/Reply, Draft save/edit/delete
   • Mood panel — “Hide/Show Emotion Status” and “Turn Off Emotion Detection”
   • Mood Journal & Daily Summary — buttons in toolbar for logs and chart

6) Stop the app
   • In the terminal, press Ctrl + C

--------------------------------
TROUBLESHOOTING
--------------------------------
• OpenCV/TensorFlow DLL error (Windows):
  Install the Visual C++ Redistributable (link above), restart terminal, try again.

• TensorFlow install fails:
  Ensure Python 3.10 or 3.11. If needed:
    pip uninstall tensorflow
    pip install tensorflow-cpu==2.15.1

• Camera busy / not detected:
  Close Zoom/Teams/OBS. Unplug/replug webcam. Refresh the page or restart app.

• Port already in use:
  Edit the last line of app.py to:  app.run(debug=True, port=5001)

• Reset to fresh demo data:
  Stop the app and delete emodash.db (SQLite) in the project folder. It will be recreated.



--------------------------------
PRIVACY NOTE
--------------------------------
• No video frames are stored.
• Only a cropped face is sent to Groq (about every 10s) *if* GROQ_API_KEY is provided.


