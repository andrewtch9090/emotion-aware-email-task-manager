// =========================
// Global state
// =========================
let detectionEnabled = true;
let lastEmotion = "";
let negativeMoodActive = false;

let tasks = [];
let emails = [];
let currentTab = "inbox";
let currentOpenEmailId = null;

// 1-minute
let lastSuggestionKey = "";
let lastSuggestionAt = 0;
const SUGGESTION_COOLDOWN_MS = 60 * 1000;

let taskFilter = "all";
let currentEditingDraftId = null;
let newTaskIsQuick = false;

// allow user to override Quick-only in negative mood
let showAllOverride = false;

// =========================
// Utilities
// =========================
function showToast(msg){ const el=document.getElementById("toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),1800); }
function cyclePriority(p){ return p==="high"?"medium":p==="medium"?"low":"high"; }

function extractEmailAddress(str)
{
    const m=str && str.match(/<([^>]+)>/);
    if(m) return m[1].trim(); const s=(str||"").trim();
    if(s.includes("@") && !s.includes("<")) return s;
    return "";
}
function localDateString(d = new Date()){
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// =========================
// API calls
// =========================
async function apiLoadTasks(){ const r = await fetch("/api/tasks"); return await r.json(); }
async function apiCreateTask(payload){ const r = await fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); return await r.json(); }
async function apiUpdateTask(id,payload){ await fetch(`/api/tasks/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); }
async function apiDeleteTask(id){ await fetch(`/api/tasks/${id}`,{method:"DELETE"}); }

async function apiLoadEmails(params={}){ const q = new URLSearchParams(params).toString(); const r = await fetch(`/api/emails${q?`?${q}`:""}`); return await r.json(); }
async function apiSaveDraft(payload){ const r = await fetch("/api/emails/draft",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); return await r.json(); }
async function apiSendEmail(payload){ const r = await fetch("/api/emails/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); return await r.json(); }
async function apiPatchEmail(id,payload){ await fetch(`/api/emails/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}); }
async function apiDeleteEmail(id){ await fetch(`/api/emails/${id}`,{method:"DELETE"}); }

// =========================
// Emails UI
// =========================
function setActiveTab(tab){
    currentTab = tab;
    document.querySelectorAll(".mail-tabs button").forEach(btn => btn.classList.toggle("active-tab", btn.dataset.tab === tab));
    renderEmailList(); clearEmailView();
}
function getFilteredEmails(){
    if (currentTab === "starred") return emails.filter(e => !!e.starred);
    if (currentTab === "inbox")   return emails.filter(e => e.folder === "inbox");
    if (currentTab === "sent")    return emails.filter(e => e.folder === "sent");
    if (currentTab === "draft")   return emails.filter(e => e.folder === "draft");
    return emails;
}
async function toggleStar(id){
    const msg = emails.find(e => e.id === id); if(!msg) return;
    msg.starred = !msg.starred; renderEmailList();
    await apiPatchEmail(id, { starred: msg.starred });
}
async function markRead(id){
    const msg = emails.find(e => e.id === id); if(!msg || msg.read) return;
    msg.read = true; renderEmailList();
    await apiPatchEmail(id, { read: true });
}
function clearEmailView(){
    document.getElementById("emailSender").textContent = "";
    const r = document.getElementById("emailReceiver"); r.style.display = "none"; r.textContent = "";
    document.getElementById("emailSubject").textContent = "";
    document.getElementById("emailDate").textContent = "";
    document.getElementById("emailContent").textContent = "Select an email to read...";
    currentOpenEmailId = null;
    const rb = document.getElementById("replyBtn"); if (rb) rb.disabled = true;
}
function displayEmail(id){
    const email = emails.find(e => e.id === id); if(!email) return;
    markRead(id);
    document.getElementById("emailSender").textContent = email.sender || "";
    if (email.to){
        const receiverDiv = document.getElementById("emailReceiver");
        receiverDiv.textContent = `To: ${email.to}`; receiverDiv.style.display = "block";
    } else document.getElementById("emailReceiver").style.display = "none";
    document.getElementById("emailSubject").textContent = email.subject || "";
    document.getElementById("emailDate").textContent = email.date || "";
    document.getElementById("emailContent").textContent = email.content || "";
    currentOpenEmailId = id;
    const rb = document.getElementById("replyBtn"); if (rb) rb.disabled = false;
    renderEmailList();
}
function renderEmailList(){
    const container = document.getElementById("emailListContainer");
    container.innerHTML = "";
    const group = document.createElement("div");
    group.className = "email-group";
    const label = document.createElement("div");
    label.className = "group-label";
    label.textContent = currentTab.charAt(0).toUpperCase() + currentTab.slice(1);
    group.appendChild(label);

    const list = getFilteredEmails();
    list.forEach(email => {
        const item = document.createElement("div");
        item.className = "email-item";
        if (!email.read && email.folder === "inbox") item.classList.add("unread");
        item.onclick = (e) => {
            if (e.target && (e.target.classList.contains("star-btn") || e.target.classList.contains("list-btn")))
                return;
            if (email.folder === "draft") openComposeWithDraft(email.id);
            else displayEmail(email.id);
        };

        // Star Button
        const star = document.createElement("button");
        star.className = "star-btn"; star.title = email.starred ? "Unstar" : "Star";
        star.textContent = email.starred ? "★" : "☆";
        star.onclick = (ev)=>{ ev.stopPropagation(); toggleStar(email.id); };

        const avatar = document.createElement("div");
        avatar.className = "avatar"; avatar.textContent = (email.sender || "U").charAt(0).toUpperCase();

        const meta = document.createElement("div"); meta.className = "email-meta";
        const senderSubject = document.createElement("div"); senderSubject.className = "sender-subject";
        const sender = document.createElement("strong"); sender.textContent = email.sender;
        const subject = document.createElement("span"); subject.className = "subject"; subject.textContent = email.subject;
        senderSubject.appendChild(sender); senderSubject.appendChild(subject);
        const preview = document.createElement("div"); preview.className = "preview"; preview.textContent = (email.content||"").split("\n")[0];
        meta.appendChild(senderSubject); meta.appendChild(preview);

        const rightSide = document.createElement("div");
        rightSide.style.display = "flex"; rightSide.style.alignItems = "center"; rightSide.style.gap = "6px";
        const time = document.createElement("div"); time.className = "time"; time.textContent = (email.date||"").split(",")[1]?.trim() || email.date || "";
        rightSide.appendChild(time);

        // Draft Edit/Delete
        if (email.folder === "draft") {
            const editBtn = document.createElement("button");
            editBtn.className = "list-btn";
            editBtn.textContent = "Edit";
            editBtn.onclick = (ev)=>{ev.stopPropagation(); openComposeWithDraft(email.id);};

            const delBtn = document.createElement("button");
            delBtn.className = "list-btn danger";
            delBtn.textContent = "Delete";
            delBtn.onclick = async (ev)=>{
                ev.stopPropagation();
                await apiDeleteEmail(email.id);
                emails = await apiLoadEmails();
                renderEmailList();
                clearEmailView();
                showToast("Draft deleted");
            };

            rightSide.appendChild(editBtn);
            rightSide.appendChild(delBtn);
        }

        // Delete for Inbox & Sent
        if (email.folder === "inbox" || email.folder === "sent") {
            const delBtn = document.createElement("button");
            delBtn.className = "list-btn danger";
            delBtn.textContent = "Delete";
            delBtn.onclick = async (ev)=>{
                ev.stopPropagation();
                await apiDeleteEmail(email.id);
                emails = await apiLoadEmails();
                renderEmailList();
                clearEmailView();
                showToast("Email deleted");
            };
            rightSide.appendChild(delBtn);
        }

        item.appendChild(star);
        item.appendChild(avatar);
        item.appendChild(meta);
        item.appendChild(rightSide);
        group.appendChild(item);
    });
    container.appendChild(group);
}

function startReply(email){
    const toAddr = extractEmailAddress(email.sender) || email.to || "";
    openCompose();
    document.getElementById("composeTo").value = toAddr;
    const subj = email.subject || "";
    document.getElementById("composeSubject").value = /^re:/i.test(subj) ? subj : `Re: ${subj}`;
    const quote = `\n\nOn ${email.date}, ${email.sender} wrote:\n> ` + (email.content || "").replace(/\n/g, "\n> ");
    document.getElementById("composeBody").value = quote;
}
function replyToCurrentEmail(){
    const email = emails.find(e => e.id === currentOpenEmailId);
    if (!email) { showToast("No email selected"); return; }
    startReply(email);
}

// =========================
// Compose + Draft/Send 
// =========================
function openCompose(){
    currentEditingDraftId = null;
    const win = document.getElementById("composeWindow");
    win.classList.remove("minimized"); win.style.display = "block";
    document.getElementById("composeTo").value = "";
    document.getElementById("composeSubject").value = "";
    document.getElementById("composeBody").value = "";
    document.getElementById("composeTo").focus();
}
function openComposeWithDraft(id){
    const draft = emails.find(e => e.id === id && e.folder === "draft");
    if (!draft) return;
    currentEditingDraftId = id;
    const win = document.getElementById("composeWindow");
    win.classList.remove("minimized"); win.style.display = "block";
    document.getElementById("composeTo").value = draft.to || "";
    document.getElementById("composeSubject").value = draft.subject || "";
    document.getElementById("composeBody").value = draft.content || "";
    document.getElementById("composeTo").focus();
}
function closeCompose(){ document.getElementById("composeWindow").style.display = "none"; }
function minimizeCompose(){ document.getElementById("composeWindow").classList.toggle("minimized"); }

async function saveDraft(){
    const to = document.getElementById("composeTo").value.trim();
    const subject = document.getElementById("composeSubject").value.trim();
    const body = document.getElementById("composeBody").value.trim();
    const payload = { id: currentEditingDraftId, to, subject: subject || "(no subject)", content: body || "" };
    const out = await apiSaveDraft(payload);
    currentEditingDraftId = out.id;
    emails = await apiLoadEmails();
    setActiveTab("draft");
    renderEmailList();
    showToast("Draft saved");
}

async function sendEmail(){
    const to = document.getElementById("composeTo").value.trim();
    const subject = document.getElementById("composeSubject").value.trim();
    const body = document.getElementById("composeBody").value.trim();
    if (!to){ alert("Please add at least one recipient."); return; }
    const payload = { id: currentEditingDraftId, to, subject: subject || "(no subject)", content: body || "(no content)" };
    await apiSendEmail(payload);
    currentEditingDraftId = null;
    emails = await apiLoadEmails();
    setActiveTab("sent");
    renderEmailList();
    const justSent = emails.find(e => e.folder === "sent");
    if (justSent) displayEmail(justSent.id);
    showToast("Message sent");
    closeCompose();
}

function makeComposeDraggable(){
    const win=document.getElementById("composeWindow"), header=document.getElementById("composeHeader");
    let offsetX=0, offsetY=0, dragging=false;
    header.addEventListener("mousedown",(e)=>{ dragging=true; const r=win.getBoundingClientRect(); offsetX=e.clientX-r.left; offsetY=e.clientY-r.top; document.body.classList.add("dragging"); });
    document.addEventListener("mousemove",(e)=>{ if(!dragging) return; win.style.left=(e.clientX-offsetX)+"px"; win.style.top=(e.clientY-offsetY)+"px"; win.style.right="auto"; win.style.bottom="auto"; });
    document.addEventListener("mouseup",()=>{ dragging=false; document.body.classList.remove("dragging"); });
}

// =========================
// Tasks  
// =========================
function updateCounts(){
    const open = tasks.filter(t=>!t.done).length;
    const completed = tasks.filter(t=>t.done).length;
    document.getElementById("taskCounts").textContent = `Open: ${open} • Completed: ${completed}`;
}
function makePriorityDot(prio, onClick){
    const dot=document.createElement("span");
    dot.className=`priority-dot ${prio}`;
    dot.title=`Priority: ${prio}`;
    dot.onclick=onClick;
    return dot;
}
async function deleteTask(task){ await apiDeleteTask(task.id); tasks = await apiLoadTasks(); showToast("Task deleted"); renderTasks(); }
async function toggleDone(task, checked){ await apiUpdateTask(task.id, {done:checked}); tasks = await apiLoadTasks(); renderTasks(); }
async function updateTaskText(task, newText){ await apiUpdateTask(task.id, {text:newText.trim()||task.text}); tasks = await apiLoadTasks(); showToast("Task updated"); renderTasks(); }
async function updateTaskPriority(task, prio){ await apiUpdateTask(task.id, {priority:prio}); tasks = await apiLoadTasks(); renderTasks(); }
function isQuickTask(t){ return !!t.quick; }

function moveLocalTaskById(id, delta){
    const idx = tasks.findIndex(t => t.id === id);
    if (idx < 0) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= tasks.length) return;
    const [item] = tasks.splice(idx, 1);
    tasks.splice(newIdx, 0, item);
    renderTasks();
}

function makeTaskEl(task){
    const wrap = document.createElement("div"); wrap.className = "task pro" + (task.done ? " is-done" : "");
    const check = document.createElement("input"); check.type="checkbox"; check.className="task-check"; check.checked=task.done;
    check.onchange=()=>toggleDone(task, check.checked);

    const mid = document.createElement("div"); mid.className="task-main";
    const rowTop = document.createElement("div"); rowTop.className="task-row-top";

    const dot = makePriorityDot(task.priority, ()=> updateTaskPriority(task, cyclePriority(task.priority)));

    const quick = document.createElement("span");
    if (task.quick){ quick.className="quick-badge"; quick.textContent="⚡"; quick.title="Quick task"; }

    const textEl = document.createElement("div"); textEl.className="task-text"; textEl.textContent=task.text; textEl.title="Double-click to edit";
    textEl.ondblclick=()=>{ textEl.contentEditable="true"; textEl.classList.add("editing"); textEl.focus(); document.execCommand("selectAll", false, null); };
    textEl.onblur=()=>{ textEl.contentEditable="false"; textEl.classList.remove("editing"); updateTaskText(task, textEl.textContent); };

    if (task.quick) rowTop.append(dot, quick, textEl); else rowTop.append(dot, textEl);
    mid.append(rowTop);

    const act = document.createElement("div"); act.className="task-actions";
    const up=document.createElement("button"); up.textContent="↑"; up.title="Move up";   up.onclick=()=>moveLocalTaskById(task.id, -1);
    const dn=document.createElement("button"); dn.textContent="↓"; dn.title="Move down"; dn.onclick=()=>moveLocalTaskById(task.id, +1);
    const del=document.createElement("button"); del.textContent="❌"; del.title="Delete"; del.className="danger"; del.onclick=()=>deleteTask(task);
    act.append(up, dn, del);

    wrap.append(check, mid, act);
    return wrap;
}

async function renderTasks(){
    const list = document.getElementById("taskList"); list.innerHTML = "";
    let active = tasks.filter(t=>!t.done);
    let done   = tasks.filter(t=> t.done);

    const isPriorityFilter = ["high","medium","low"].includes(taskFilter);

    // Determine if Quick-only should apply
    const quickOnlyEffective =
        (negativeMoodActive && !isPriorityFilter && !(taskFilter === "all" && showAllOverride))
        || taskFilter === "quick";

    if (quickOnlyEffective) {
        active = active.filter(isQuickTask);
    } else if (isPriorityFilter) {
        active = active.filter(t => t.priority === taskFilter);
    }

    // Banner only when Quick-only
    const banner = document.getElementById("tmNote");
    banner.style.display = quickOnlyEffective ? "block" : "none";

    active.forEach(t => list.appendChild(makeTaskEl(t)));

    if (done.length){
        const wrap=document.createElement("div"); wrap.className="completed-wrap";
        const head=document.createElement("div"); head.className="completed-header"; head.innerHTML=`<span>Completed (${done.length})</span>`;
        const toggle=document.createElement("button"); toggle.className="chip"; toggle.textContent="Hide/Show"; head.appendChild(toggle);
        const cList=document.createElement("div"); cList.id="completedList"; done.forEach(t=>cList.appendChild(makeTaskEl(t)));
        toggle.onclick=()=>cList.classList.toggle("hidden");
        wrap.append(head, cList); list.appendChild(wrap);
    }
    updateCounts();
}

async function addTaskFromModal(){
    const text=document.getElementById("taskTextInput").value.trim();
    const prio=(document.querySelector('input[name="prio"]:checked')||{}).value||"medium";
    if(!text){ alert("Please enter a task."); return; }
    await apiCreateTask({ text, done:false, priority: prio, quick: newTaskIsQuick });
    tasks = await apiLoadTasks();
    renderTasks();
    showToast("Task added");
    closeTaskModal();
}

function openTaskModal(){
    document.getElementById("taskTextInput").value="";
    document.querySelector('input[name="prio"][value="medium"]').checked=true;
    newTaskIsQuick = false;
    document.getElementById("taskQuickBtn").classList.remove("active");
    document.getElementById("taskModal").style.display="block";
}
function closeTaskModal(){ document.getElementById("taskModal").style.display="none"; }

function setupTaskFilters(){
    const bar = document.getElementById("taskFilterBar");
    bar.innerHTML = "";
    const defs = [
        {key:"all", label:"All"},
        {key:"quick", label:"Quick ⚡"},
        {key:"high", label:"High"},
        {key:"medium", label:"Medium"},
        {key:"low", label:"Low"}
    ];
    defs.forEach(def => {
        const b = document.createElement("button");
        b.className = "chip";
        b.dataset.filter = def.key;
        b.textContent = def.label;
        if (def.key === taskFilter) b.classList.add("active");
        b.onclick = () => setTaskFilter(def.key);
        bar.appendChild(b);
    });
}
function setTaskFilter(key){
    taskFilter = key;

    if (key === "all") {
        showAllOverride = true;
    } else {
        showAllOverride = false;
    }

    document.querySelectorAll("#taskFilterBar .chip").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.filter === key);
    });
    renderTasks();
}

// =========================
// Emotion polling + UI
// =========================
function showSuggestionModal(emotion, activity){
    document.getElementById("modalEmotion").textContent = `🧠 Emotion Detected: ${emotion}`;
    document.getElementById("modalSuggestion").textContent = activity ? `💡 Suggested Activity: ${activity}` : "";
    document.getElementById("suggestionModal").style.display = "block";
}

// Render status log with local time
function fetchGroqResults(){
    if (!detectionEnabled) return;
    fetch('/groq_results').then(res => res.json()).then(data => {
        const list = document.getElementById("groqList");
        const sidebar = document.querySelector(".sidebar");
        const emailBox = document.querySelector(".email-box");
        list.innerHTML = '';
        if (!data.length) return;

        const first = data[0];
        let recentEmotionText = "";
        if (typeof first === "string") {
            recentEmotionText = first.toLowerCase();
            data.forEach(item => { const li=document.createElement("li"); li.textContent=item; list.appendChild(li); });
        } else {
            recentEmotionText = (first.emotion || "").toLowerCase();
            data.forEach(it => {
                const timeStr = new Date(it.ts).toLocaleTimeString();
                const li = document.createElement("li");
                li.textContent = `[${timeStr}] ${it.emotion}`;
                list.appendChild(li);
            });
        }

        lastEmotion = recentEmotionText;
        const positive = ["happy", "calm", "focused"];
        const negative = ["sad", "angry", "stressed", "anxious", "tired"];
        const isPositive = positive.some(w => recentEmotionText.includes(w));
        const isNegative = negative.some(w => recentEmotionText.includes(w));

        if (isPositive) {
            negativeMoodActive = false;
            showAllOverride = false;
            document.body.style.backgroundColor = "#ededed";
            sidebar.style.backgroundColor = "#40126b";
            document.querySelectorAll(".task").forEach(el => { el.style.backgroundColor = "rgba(255,255,255,0.08)"; el.style.color = "#ffffff"; });
            emailBox.classList.remove("dimmed");
            sidebar.classList.remove("hidden");
        } else if (isNegative) {
            negativeMoodActive = true;
            document.body.style.backgroundColor = "#EAF2FF";
            sidebar.style.backgroundColor = "#0F2A52";
            sidebar.classList.remove("hidden");
            emailBox.classList.add("dimmed");
        } else {
            negativeMoodActive = false;
            showAllOverride = false;
            document.body.style.backgroundColor = "#ffffff";
            sidebar.style.backgroundColor = "#193868";
            sidebar.classList.remove("hidden");
            emailBox.classList.remove("dimmed");
        }

        renderTasks();
    });
}

function fetchSuggestion(){
    if (!detectionEnabled) return;
    fetch('/groq_suggestion')
        .then(res => res.json())
        .then(data => {
            const emotion = (data.emotion || "").toLowerCase();
            const activity = data.activity || "";
            const negativeEmotions = ["stressed", "angry", "sad", "tired", "anxious"];
            if (!emotion || !negativeEmotions.includes(emotion) || !activity) return;

            const key = `${emotion}|${activity}`;
            const now = Date.now();
            const cooledDown = (now - lastSuggestionAt) > SUGGESTION_COOLDOWN_MS;
            if (key !== lastSuggestionKey || cooledDown) {
                lastSuggestionKey = key;
                lastSuggestionAt = now;
                showSuggestionModal(data.emotion, activity);
            }
        })
        .catch(err => console.error("Failed to fetch suggestion:", err));
}

// =========================
// Mood Journal + Summary
// =========================
function openMoodJournal(){
    document.getElementById("journalModal").style.display="block";
    document.getElementById("journalDate").value = localDateString();
    loadMoodEntries();
}
function closeMoodJournal(){ document.getElementById("journalModal").style.display="none"; }
function loadMoodEntries(){
    const date = document.getElementById("journalDate").value || localDateString();
    const tz = new Date().getTimezoneOffset();
    fetch(`/mood_entries?date=${encodeURIComponent(date)}&tz_offset_min=${tz}`)
        .then(r=>r.json())
        .then(entries=>{
            const list=document.getElementById("journalList"); list.innerHTML="";
            if(!entries.length){ list.innerHTML="<li>No entries for this date.</li>"; return; }
            entries.sort((a,b)=>a.ts.localeCompare(b.ts));
            entries.forEach(e=>{
                const li=document.createElement("li");
                const timeStr=new Date(e.ts).toLocaleTimeString();
                li.textContent = `${timeStr} — ${e.emotion}${e.note ? " — " + e.note : ""}`;
                list.appendChild(li);
            });
        });
}
function addManualMood(){
    const emo=document.getElementById("journalEmotion").value.trim()||"Unknown";
    const note=document.getElementById("journalNote").value.trim();
    fetch("/log_mood",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({emotion: emo, note, source:"manual"}) })
        .then(()=>{ document.getElementById("journalNote").value=""; loadMoodEntries(); showToast("Mood logged"); });
}

function openDailySummary(){
    document.getElementById("summaryModal").style.display="block";
    document.getElementById("summaryDate").value = localDateString();
    loadDailySummary();
}
function closeDailySummary(){ document.getElementById("summaryModal").style.display="none"; }
function loadDailySummary(){
    const date = document.getElementById("summaryDate").value || localDateString();
    const tz = new Date().getTimezoneOffset();
    fetch(`/mood_summary?date=${encodeURIComponent(date)}&tz_offset_min=${tz}`)
        .then(r=>r.json())
        .then(data=>{
            const { counts={}, top_emotion } = data || {};
            const list=document.getElementById("summaryList"); list.innerHTML="";
            if(!Object.keys(counts).length){ list.innerHTML="<li>No data for this date.</li>"; }
            else { Object.entries(counts).forEach(([emo,n])=>{ const li=document.createElement("li"); li.textContent=`${emo}: ${n}`; list.appendChild(li); }); }
            document.getElementById("summaryTop").textContent = top_emotion ? `Top emotion: ${top_emotion}` : "Top emotion: —";
            drawBarChart(counts);
        });
}
function drawBarChart(counts){
    const canvas=document.getElementById("summaryChart"), ctx=canvas.getContext("2d"); ctx.clearRect(0,0,canvas.width,canvas.height);
    const keys=Object.keys(counts); if(!keys.length) return; const values=keys.map(k=>counts[k]);
    const W=canvas.width, H=canvas.height, pad=24, gap=12; const barW=(W-pad*2-gap*(keys.length-1))/keys.length; const maxV=Math.max(...values)||1;
    ctx.font="12px Segoe UI"; ctx.textAlign="center";
    values.forEach((v,i)=>{ const x=pad+i*(barW+gap); const h=Math.round((v/maxV)*(H-pad*2)); const y=H-pad-h; ctx.fillStyle="#1479FF"; ctx.fillRect(x,y,barW,h); ctx.fillStyle="#193868"; ctx.fillText(keys[i], x+barW/2, H-6); ctx.fillText(String(v), x+barW/2, y-4); });
}

// =========================
// Init
// =========================
window.onload = async () => {
    tasks = await apiLoadTasks();
    emails = await apiLoadEmails();

    document.querySelectorAll(".mail-tabs button").forEach(btn => btn.addEventListener("click", () => setActiveTab(btn.dataset.tab)));
    setActiveTab("inbox");

    document.getElementById("toggleEmotionSectionBtn").onclick = ()=> document.querySelector('.groq-results').classList.toggle('hidden');
    document.getElementById("toggleDetectionBtn").onclick = ()=> { detectionEnabled = !detectionEnabled; document.getElementById("toggleDetectionBtn").textContent = detectionEnabled ? "Turn Off Emotion Detection" : "Turn On Emotion Detection"; };

    fetchGroqResults();
    fetchSuggestion();
    setInterval(fetchGroqResults, 3000);
    setInterval(fetchSuggestion, 5000);

    document.getElementById("suggestionClose").onclick = ()=> document.getElementById("suggestionModal").style.display="none";

    document.getElementById("composeOpenBtn").onclick = openCompose;
    document.getElementById("composeMinimizeBtn").onclick = minimizeCompose;
    document.getElementById("composeCloseBtn").onclick = closeCompose;
    document.getElementById("composeCloseBtn2").onclick = closeCompose;
    document.getElementById("composeSaveDraftBtn").onclick = saveDraft;
    document.getElementById("composeSendBtn").onclick = sendEmail;
    makeComposeDraggable();

    document.getElementById("replyBtn").onclick = replyToCurrentEmail;

    document.getElementById("newTaskBtn").onclick = openTaskModal;
    document.getElementById("taskModalClose").onclick = closeTaskModal;
    document.getElementById("taskModalCancel").onclick = closeTaskModal;
    document.getElementById("taskModalAdd").onclick = addTaskFromModal;
    document.getElementById("taskTextInput").addEventListener("keydown", (e)=>{ if(e.key==="Enter") addTaskFromModal(); });
    document.getElementById("taskQuickBtn").onclick = () => {
        newTaskIsQuick = !newTaskIsQuick;
        document.getElementById("taskQuickBtn").classList.toggle("active", newTaskIsQuick);
    };

    setupTaskFilters();
    renderTasks();

    document.getElementById("openJournalBtn").onclick = openMoodJournal;
    document.getElementById("openSummaryBtn").onclick = openDailySummary;
    document.getElementById("journalClose").onclick = closeMoodJournal;
    document.getElementById("journalRefresh").onclick = loadMoodEntries;
    document.getElementById("journalAdd").onclick = addManualMood;
    document.getElementById("summaryClose").onclick = closeDailySummary;
    document.getElementById("summaryRefresh").onclick = loadDailySummary;
};
