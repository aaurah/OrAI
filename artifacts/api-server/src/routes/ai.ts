import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AiChatParams, AiChatBody } from "@workspace/api-zod";

const router = Router();

const OPENAI_BASE = process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1";
const OPENAI_KEY  = process.env.OPENAI_API_KEY || "";

// ── Types ────────────────────────────────────────────────────────────────────

type FileAction =
  | { type: "create_file"; filename: string; content: string; language?: string }
  | { type: "edit_file";   filename: string; content: string }
  | { type: "delete_file"; filename: string };

type ExecutedAction =
  | { type: "created";  filename: string; fileId: number }
  | { type: "edited";   filename: string; fileId: number }
  | { type: "deleted";  filename: string }
  | { type: "error";    filename: string; message: string };

// ── Route ────────────────────────────────────────────────────────────────────

router.post("/projects/:id/ai/chat", async (req, res) => {
  const paramsParsed = AiChatParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });
  const bodyParsed = AiChatBody.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.message });

  const projectId = paramsParsed.data.id;
  const { message, context, currentFile } = bodyParsed.data;

  // Fetch current project files so the AI knows what exists
  const existingFiles = await db
    .select({ id: filesTable.id, name: filesTable.name, path: filesTable.path, content: filesTable.content, language: filesTable.language })
    .from(filesTable)
    .where(eq(filesTable.projectId, projectId));

  const fileList = existingFiles.map(f => `  - ${f.name} (id:${f.id})`).join("\n");

  const systemPrompt = `You are an expert AI coding agent embedded in a cloud IDE.
You can read, create, edit, and delete files in the user's project.

Current project files:
${fileList || "  (no files yet)"}
${currentFile ? `\nCurrently open file: ${currentFile}` : ""}
${context ? `\nContent of open file:\n\`\`\`\n${context}\n\`\`\`` : ""}

You MUST respond with a JSON object (no markdown wrapper) in this exact format:
{
  "reply": "Short explanation of what you did or are doing.",
  "actions": [
    { "type": "create_file", "filename": "index.html", "content": "<full file content>", "language": "html" },
    { "type": "edit_file",   "filename": "main.py",    "content": "<full updated content>" },
    { "type": "delete_file", "filename": "old.js" }
  ]
}

Rules:
- "actions" may be an empty array [] if no file changes are needed.
- For create_file: always provide the complete file content, never partial.
- For edit_file: always provide the COMPLETE new file content (not a diff).
- Use the exact filename from the file list when editing or deleting.
- When the user asks to "create", "build", "generate", or "make" something, produce working, complete code.
- When the user asks to "edit", "fix", "update", or "improve", edit the currently open file.
- When the user asks to "delete" or "remove" a file, use delete_file.
- reply should be concise (1-3 sentences) describing what you did.
- ALWAYS return valid JSON. No trailing commas. No comments inside JSON.`;

  try {
    let aiResult: { reply: string; actions: FileAction[] };

    if (!OPENAI_KEY) {
      aiResult = generateAgenticFallback(message, existingFiles, currentFile ?? null);
    } else {
      const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: message },
          ],
          response_format: { type: "json_object" },
          max_tokens: 4096,
        }),
      });

      if (!response.ok) {
        aiResult = generateAgenticFallback(message, existingFiles, currentFile ?? null);
      } else {
        const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
        const raw = data.choices[0]?.message?.content ?? "{}";
        try {
          const parsed = JSON.parse(raw);
          aiResult = {
            reply:   String(parsed.reply ?? "Done."),
            actions: Array.isArray(parsed.actions) ? parsed.actions : [],
          };
        } catch {
          aiResult = { reply: raw, actions: [] };
        }
      }
    }

    // ── Execute actions ──────────────────────────────────────────────────────
    const executedActions: ExecutedAction[] = [];

    for (const action of aiResult.actions) {
      try {
        if (action.type === "create_file") {
          const lang = action.language ?? inferLanguage(action.filename);
          const [created] = await db
            .insert(filesTable)
            .values({
              projectId,
              name:     action.filename,
              path:     `/${action.filename}`,
              content:  action.content,
              type:     "file",
              language: lang,
            })
            .returning();
          executedActions.push({ type: "created", filename: action.filename, fileId: created.id });

        } else if (action.type === "edit_file") {
          const target = existingFiles.find(f => f.name === action.filename);
          if (!target) {
            // Create it instead
            const lang = inferLanguage(action.filename);
            const [created] = await db
              .insert(filesTable)
              .values({ projectId, name: action.filename, path: `/${action.filename}`, content: action.content, type: "file", language: lang })
              .returning();
            executedActions.push({ type: "created", filename: action.filename, fileId: created.id });
          } else {
            await db
              .update(filesTable)
              .set({ content: action.content, updatedAt: new Date() })
              .where(eq(filesTable.id, target.id));
            executedActions.push({ type: "edited", filename: action.filename, fileId: target.id });
          }

        } else if (action.type === "delete_file") {
          const target = existingFiles.find(f => f.name === action.filename);
          if (target) {
            await db.delete(filesTable).where(eq(filesTable.id, target.id));
            executedActions.push({ type: "deleted", filename: action.filename });
          } else {
            executedActions.push({ type: "error", filename: action.filename, message: "File not found" });
          }
        }
      } catch (err) {
        executedActions.push({ type: "error", filename: (action as any).filename ?? "?", message: String(err) });
      }
    }

    return res.json({
      reply:           aiResult.reply,
      actions:         executedActions,
      codeBlocks:      [], // actions replace code blocks in agentic mode
    });

  } catch (err) {
    const fallback = generateAgenticFallback(message, existingFiles, currentFile ?? null);
    return res.json({ reply: fallback.reply, actions: [], codeBlocks: [] });
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    py: "python", rs: "rust", go: "go", html: "html", css: "css",
    json: "json", md: "markdown", yaml: "yaml", yml: "yaml", sh: "shell",
    toml: "toml", txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

// ── Smart offline fallback ────────────────────────────────────────────────────

function generateAgenticFallback(
  message: string,
  existingFiles: Array<{ id: number; name: string; content?: string | null }>,
  currentFile: string | null,
): { reply: string; actions: FileAction[] } {
  const msg = message.toLowerCase();

  // ── Delete intent ──────────────────────────────────────────────────────────
  const deleteMatch = msg.match(/delete|remove/);
  if (deleteMatch) {
    // Try to find the file they mean
    for (const f of existingFiles) {
      if (msg.includes(f.name.toLowerCase())) {
        return { reply: `Deleting ${f.name}.`, actions: [{ type: "delete_file", filename: f.name }] };
      }
    }
  }

  // ── Weather app ───────────────────────────────────────────────────────────
  if (msg.includes("weather")) {
    const days = msg.match(/(\d+)\s*day/) ? Number(msg.match(/(\d+)\s*day/)![1]) : 7;
    return {
      reply: `Created a ${days}-day weather forecast app with mock data and a clean card layout.`,
      actions: [
        {
          type: "create_file", filename: "index.html", language: "html",
          content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Weather Forecast</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="app">
    <header>
      <h1>🌤 Weather Forecast</h1>
      <p class="location">San Francisco, CA</p>
    </header>
    <div class="today">
      <div class="temp-big">72°F</div>
      <div class="condition">Partly Cloudy</div>
      <div class="details">
        <span>💧 Humidity: 58%</span>
        <span>💨 Wind: 12 mph</span>
        <span>👁 Visibility: 10 mi</span>
      </div>
    </div>
    <h2>${days}-Day Forecast</h2>
    <div class="forecast" id="forecast"></div>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
        },
        {
          type: "create_file", filename: "style.css", language: "css",
          content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: linear-gradient(135deg, #1e3a5f 0%, #2d6a9f 100%); min-height: 100vh; color: #fff; }
.app { max-width: 480px; margin: 0 auto; padding: 24px 16px; }
header { text-align: center; margin-bottom: 24px; }
h1 { font-size: 2rem; font-weight: 700; margin-bottom: 4px; }
.location { opacity: 0.75; font-size: 1rem; }
.today { background: rgba(255,255,255,0.15); backdrop-filter: blur(10px); border-radius: 20px; padding: 28px; text-align: center; margin-bottom: 24px; }
.temp-big { font-size: 5rem; font-weight: 200; line-height: 1; }
.condition { font-size: 1.2rem; opacity: 0.85; margin: 8px 0 20px; }
.details { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; font-size: 0.85rem; opacity: 0.8; }
h2 { font-size: 1rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.7; margin-bottom: 12px; }
.forecast { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
.day-card { background: rgba(255,255,255,0.12); border-radius: 14px; padding: 16px 10px; text-align: center; }
.day-name { font-weight: 600; font-size: 0.85rem; margin-bottom: 8px; }
.day-icon { font-size: 1.8rem; margin: 4px 0; }
.day-high { font-size: 1.1rem; font-weight: 700; }
.day-low  { font-size: 0.85rem; opacity: 0.65; }`,
        },
        {
          type: "create_file", filename: "app.js", language: "javascript",
          content: `const icons  = ["☀️","⛅","🌤","🌦","🌧","⛈","🌩","🌨","❄️","🌫"];
const days   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const today  = new Date();

function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function buildForecast() {
  const container = document.getElementById("forecast");
  for (let i = 0; i < ${days}; i++) {
    const date = new Date(today); date.setDate(today.getDate() + i);
    const high = randomBetween(58, 85);
    const low  = randomBetween(45, high - 8);
    const icon = icons[randomBetween(0, 4)];
    const card = document.createElement("div");
    card.className = "day-card";
    card.innerHTML = \`
      <div class="day-name">\${i === 0 ? "Today" : days[date.getDay()]}</div>
      <div class="day-icon">\${icon}</div>
      <div class="day-high">\${high}°</div>
      <div class="day-low">\${low}°</div>
    \`;
    container.appendChild(card);
  }
}
buildForecast();`,
        },
      ],
    };
  }

  // ── Todo app ──────────────────────────────────────────────────────────────
  if (msg.includes("todo") || msg.includes("task list")) {
    return {
      reply: "Created a fully functional to-do app with add, complete, and delete features.",
      actions: [
        { type: "create_file", filename: "index.html", language: "html",
          content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Todo App</title>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>
  <div class="app">
    <h1>✅ Todo List</h1>
    <div class="input-row">
      <input id="taskInput" type="text" placeholder="What needs to be done?" />
      <button onclick="addTask()">Add</button>
    </div>
    <ul id="taskList"></ul>
    <p class="footer" id="footer"></p>
  </div>
  <script src="app.js"></script>
</body>
</html>` },
        { type: "create_file", filename: "style.css", language: "css",
          content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f0f4f8; min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; padding: 40px 16px; }
.app { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 32px; width: 100%; max-width: 460px; }
h1 { font-size: 1.5rem; margin-bottom: 20px; color: #1a202c; }
.input-row { display: flex; gap: 8px; margin-bottom: 20px; }
input { flex: 1; padding: 10px 14px; border: 1.5px solid #e2e8f0; border-radius: 8px; font-size: 0.95rem; outline: none; }
input:focus { border-color: #3b82f6; }
button { padding: 10px 18px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
button:hover { background: #2563eb; }
ul { list-style: none; space-y: 8px; }
li { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; background: #f8fafc; margin-bottom: 6px; transition: opacity 0.2s; }
li.done span { text-decoration: line-through; color: #94a3b8; }
li.done { opacity: 0.7; }
li span { flex: 1; font-size: 0.95rem; color: #334155; cursor: pointer; user-select: none; }
.del { background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1rem; padding: 2px 6px; border-radius: 4px; }
.del:hover { background: #fee2e2; }
.footer { text-align: center; font-size: 0.8rem; color: #94a3b8; margin-top: 16px; }` },
        { type: "create_file", filename: "app.js", language: "javascript",
          content: `let tasks = JSON.parse(localStorage.getItem("tasks") || "[]");
function save() { localStorage.setItem("tasks", JSON.stringify(tasks)); }
function render() {
  const list = document.getElementById("taskList");
  list.innerHTML = "";
  tasks.forEach((t, i) => {
    const li = document.createElement("li");
    li.className = t.done ? "done" : "";
    li.innerHTML = \`<span onclick="toggle(\${i})">\${t.text}</span><button class="del" onclick="remove(\${i})">✕</button>\`;
    list.appendChild(li);
  });
  const left = tasks.filter(t => !t.done).length;
  document.getElementById("footer").textContent = left === 0 ? "All done! 🎉" : \`\${left} item\${left > 1 ? "s" : ""} remaining\`;
}
function addTask() {
  const input = document.getElementById("taskInput");
  const text = input.value.trim();
  if (!text) return;
  tasks.push({ text, done: false });
  save(); render();
  input.value = "";
  input.focus();
}
function toggle(i) { tasks[i].done = !tasks[i].done; save(); render(); }
function remove(i) { tasks.splice(i, 1); save(); render(); }
document.getElementById("taskInput").addEventListener("keydown", e => { if (e.key === "Enter") addTask(); });
render();` },
      ],
    };
  }

  // ── Calculator ────────────────────────────────────────────────────────────
  if (msg.includes("calculator") || msg.includes("calc")) {
    return {
      reply: "Created a working calculator with standard arithmetic operations.",
      actions: [
        { type: "create_file", filename: "index.html", language: "html",
          content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Calculator</title>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>
  <div class="calc">
    <div class="display">
      <div class="expr" id="expr"></div>
      <div class="result" id="result">0</div>
    </div>
    <div class="buttons">
      <button class="span2 secondary" onclick="clearAll()">AC</button>
      <button class="secondary" onclick="toggleSign()">+/−</button>
      <button class="secondary" onclick="percent()">%</button>
      <button class="op" onclick="op('/')">÷</button>
      <button onclick="num(7)">7</button><button onclick="num(8)">8</button><button onclick="num(9)">9</button>
      <button class="op" onclick="op('*')">×</button>
      <button onclick="num(4)">4</button><button onclick="num(5)">5</button><button onclick="num(6)">6</button>
      <button class="op" onclick="op('-')">−</button>
      <button onclick="num(1)">1</button><button onclick="num(2)">2</button><button onclick="num(3)">3</button>
      <button class="op" onclick="op('+')">+</button>
      <button class="span2" onclick="num(0)">0</button>
      <button onclick="dot()">.</button>
      <button class="op" onclick="calculate()">=</button>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>` },
        { type: "create_file", filename: "style.css", language: "css",
          content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #1c1c1e; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.calc { background: #1c1c1e; border-radius: 20px; padding: 16px; width: 280px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
.display { padding: 12px 16px 8px; text-align: right; }
.expr { color: #888; font-size: 0.9rem; min-height: 20px; }
.result { color: #fff; font-size: 3rem; font-weight: 200; line-height: 1.1; word-break: break-all; }
.buttons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
button { height: 60px; border: none; border-radius: 50%; font-size: 1.2rem; cursor: pointer; color: #fff; background: #333; transition: filter 0.1s; }
button:active { filter: brightness(0.8); }
button.op { background: #ff9f0a; }
button.secondary { background: #636366; }
button.span2 { grid-column: span 2; border-radius: 30px; }` },
        { type: "create_file", filename: "app.js", language: "javascript",
          content: `let current = "0", prev = "", operator = null, reset = false;
const display = id => document.getElementById(id);
function update() { display("result").textContent = current; display("expr").textContent = prev + (operator ? " " + {"/":"÷","*":"×","+":"+","-":"−"}[operator] : ""); }
function num(d) {
  if (reset) { current = String(d); reset = false; }
  else current = current === "0" ? String(d) : current + d;
  update();
}
function dot() { if (!current.includes(".")) current += "."; update(); }
function clearAll() { current = "0"; prev = ""; operator = null; update(); }
function toggleSign() { current = String(parseFloat(current) * -1); update(); }
function percent() { current = String(parseFloat(current) / 100); update(); }
function op(o) {
  if (operator && !reset) calculate();
  prev = current; operator = o; reset = true; update();
}
function calculate() {
  if (!operator || !prev) return;
  const a = parseFloat(prev), b = parseFloat(current);
  const res = { "+": a+b, "-": a-b, "*": a*b, "/": b !== 0 ? a/b : "Error" }[operator];
  prev = ""; operator = null; current = String(res); reset = true; update();
}` },
      ],
    };
  }

  // ── Edit / fix current file ───────────────────────────────────────────────
  if ((msg.includes("fix") || msg.includes("edit") || msg.includes("improve") || msg.includes("update") || msg.includes("refactor")) && currentFile) {
    return {
      reply: `I can see ${currentFile} in the editor. To make specific edits, please describe what change you want (e.g. "add dark mode", "fix the fetch error", "add a button"). I'll apply it directly.`,
      actions: [],
    };
  }

  // ── Generic create intent ─────────────────────────────────────────────────
  if (msg.includes("create") || msg.includes("build") || msg.includes("make") || msg.includes("generate") || msg.includes("write")) {
    // Simple landing page as default
    return {
      reply: "Created a starter HTML/CSS/JS project. Open index.html to preview it, then tell me what to build!",
      actions: [
        { type: "create_file", filename: "index.html", language: "html",
          content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>My App</title>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>
  <main>
    <h1>👋 Hello!</h1>
    <p>Start building something awesome. Edit this file or ask the AI to help.</p>
    <button id="btn">Click me</button>
    <p id="msg"></p>
  </main>
  <script src="app.js"></script>
</body>
</html>` },
        { type: "create_file", filename: "style.css", language: "css",
          content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f8fafc; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
main { text-align: center; padding: 40px; }
h1 { font-size: 2.5rem; margin-bottom: 12px; color: #1e293b; }
p { color: #64748b; margin-bottom: 24px; }
button { padding: 12px 28px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
button:hover { background: #2563eb; }
#msg { margin-top: 16px; font-weight: 600; color: #3b82f6; }` },
        { type: "create_file", filename: "app.js", language: "javascript",
          content: `document.getElementById("btn").addEventListener("click", () => {
  document.getElementById("msg").textContent = "It works! Now ask the AI to build something. 🚀";
});` },
      ],
    };
  }

  // ── Default helpful reply ─────────────────────────────────────────────────
  return {
    reply: `I'm your agentic coding assistant. I can create, edit, and delete files in your project. Try asking me to:
• "Create a weather app with 7 day forecast"
• "Build a todo list app"
• "Make a calculator"
• "Edit ${currentFile ?? "index.html"} to add dark mode"
• "Delete old.js"`,
    actions: [],
  };
}

export default router;
