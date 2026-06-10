import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AiChatParams, AiChatBody } from "@workspace/api-zod";
import { actorId, denyIfNoProjectAccess } from "../lib/access";

const router = Router();

const OPENAI_BASE = process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1";
const OPENAI_KEY  = process.env.OPENAI_API_KEY || "";

// ── Types ────────────────────────────────────────────────────────────

type FileAction =
  | { type: "create_file"; filename: string; content: string; language?: string }
  | { type: "edit_file";   filename: string; content: string }
  | { type: "delete_file"; filename: string };

type ExecutedAction =
  | { type: "created";  filename: string; fileId: number }
  | { type: "edited";   filename: string; fileId: number }
  | { type: "deleted";  filename: string }
  | { type: "error";    filename: string; message: string };

type AIResult = {
  reply: string;
  actions: FileAction[];
};

// ── Route ────────────────────────────────────────────────────────────

router.post("/projects/:id/ai/chat", async (req, res): Promise<void> => {
  try {
    const userId = actorId(req);
    const paramsParsed = AiChatParams.safeParse({ id: Number(req.params.id) });
    if (!paramsParsed.success) {
      res.status(400).json({ error: "Invalid project ID", details: paramsParsed.error.message });
      return;
    }

    const bodyParsed = AiChatBody.safeParse(req.body);
    if (!bodyParsed.success) {
      res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.message });
      return;
    }

    const projectId = paramsParsed.data.id;
    const { message, context, currentFile, imageUrl } = bodyParsed.data;

    if (await denyIfNoProjectAccess(res, projectId, userId)) return;

    // Validate message input
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      res.status(400).json({ error: "Message cannot be empty" });
      return;
    }

    // Fetch current project files so the AI knows what exists
    const existingFiles = await db
      .select({ 
        id: filesTable.id, 
        name: filesTable.name, 
        path: filesTable.path, 
        content: filesTable.content, 
        language: filesTable.language 
      })
      .from(filesTable)
      .where(eq(filesTable.projectId, projectId));

    const fileList = existingFiles.map(f => `  - ${f.name} (id:${f.id})`).join("\n");

    // Detect project type from file extensions
    const fileNames = existingFiles.map(f => f.name);
    const isTS = fileNames.some(n => n.endsWith(".ts") || n.endsWith(".tsx"));
    const isPy = fileNames.some(n => n.endsWith(".py"));
    const isRust = fileNames.some(n => n.endsWith(".rs"));
    const isGo = fileNames.some(n => n.endsWith(".go"));
    const hasHtml = fileNames.some(n => n.endsWith(".html"));
    const hasPkg = fileNames.includes("package.json");
    const isNonHtml = !hasHtml && (isTS || isPy || isRust || isGo);
    const projectType = isTS ? "TypeScript" : isPy ? "Python" : isRust ? "Rust" : isGo ? "Go" : hasHtml ? "HTML/CSS/JS" : "code";

    const systemPrompt = `You are an expert AI coding agent embedded in a cloud IDE.
You can read, create, edit, and delete files in the user's project.

Project type: ${projectType}${hasPkg ? " (Node.js / npm project)" : ""}
${isNonHtml ? `This is a ${projectType} source-code project — NOT an HTML web app. The preview tab shows a project overview panel, not a running server. You should help the user understand, navigate, and modify the codebase.` : ""}

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
- CRITICAL: If the project already has files, ALWAYS edit those existing files — NEVER create new ones unless the user explicitly says "start over", "rebuild from scratch", "new project", or "delete everything".
- For ${projectType} projects: answer questions about the code, explain architecture, suggest improvements, or make requested edits.
- "not working", "broken", "fix it", "make it work" are FIX requests — edit the relevant file to resolve the issue.
- When user says "make X" or "add X" to an existing project, EDIT the existing files to add the feature.
- When the user asks to "create", "build", "generate", or "make" something in an EMPTY project (no files listed above), produce working, complete code.
- When the user asks to "edit", "fix", "update", or "improve", edit the currently open file or the most relevant existing file.
- When the user asks to "delete" or "remove" a file, use delete_file.
- reply should be concise (1-3 sentences) describing what you did.
- ALWAYS return valid JSON. No trailing commas. No comments inside JSON.`;

    let aiResult: AIResult;

    if (!OPENAI_KEY) {
      aiResult = generateAgenticFallbackWithBuilds(message, existingFiles, currentFile ?? null);
    } else {
      aiResult = await callOpenAI(systemPrompt, message, imageUrl ?? undefined, existingFiles, currentFile ?? null);
    }

    // ── Execute actions ──────────────────────────────────────────────────────
    const executedActions: ExecutedAction[] = [];

    // Run all file actions in a single transaction so a partial failure doesn't
    // leave the project in a half-modified state.
    await db.transaction(async (tx) => {
      for (const action of aiResult.actions) {
        try {
          if (action.type === "create_file") {
            const existing = existingFiles.find(f => f.name === action.filename);
            if (existing) {
              await tx
                .update(filesTable)
                .set({ content: action.content, updatedAt: new Date() })
                .where(eq(filesTable.id, existing.id));
              executedActions.push({ type: "edited", filename: action.filename, fileId: existing.id });
            } else {
              const lang = action.language ?? inferLanguage(action.filename);
              const [created] = await tx
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
            }

          } else if (action.type === "edit_file") {
            const target = existingFiles.find(f => f.name === action.filename);
            if (!target) {
              const lang = inferLanguage(action.filename);
              const [created] = await tx
                .insert(filesTable)
                .values({ projectId, name: action.filename, path: `/${action.filename}`, content: action.content, type: "file", language: lang })
                .returning();
              executedActions.push({ type: "created", filename: action.filename, fileId: created.id });
            } else {
              await tx
                .update(filesTable)
                .set({ content: action.content, updatedAt: new Date() })
                .where(eq(filesTable.id, target.id));
              executedActions.push({ type: "edited", filename: action.filename, fileId: target.id });
            }

          } else if (action.type === "delete_file") {
            const target = existingFiles.find(f => f.name === action.filename);
            if (target) {
              await tx.delete(filesTable).where(eq(filesTable.id, target.id));
              executedActions.push({ type: "deleted", filename: action.filename });
            } else {
              executedActions.push({ type: "error", filename: action.filename, message: "File not found" });
            }
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          executedActions.push({ 
            type: "error", 
            filename: (action as any).filename ?? "?", 
            message: errorMessage 
          });
        }
      }
    });

    res.json({
      reply:           aiResult.reply,
      actions:         executedActions,
      codeBlocks:      [],
    });
    return;

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[AI Route Error]", errorMessage);
    
    res.status(500).json({
      error: "AI request failed",
      details: errorMessage,
      reply: "I encountered an error processing your request. Please try again.",
      actions: [],
    });
    return;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Infer file language from extension
 */
function inferLanguage(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
    html: "html", css: "css", json: "json", md: "markdown", yaml: "yaml",
    py: "python", rs: "rust", go: "go", java: "java", cpp: "cpp", c: "c",
    php: "php", rb: "ruby", sh: "shell", sql: "sql", graphql: "graphql",
    txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

/**
 * Call OpenAI API with error handling and JSON validation
 */
async function callOpenAI(
  systemPrompt: string,
  message: string,
  imageUrl: string | undefined,
  existingFiles: Array<{ id: number; name: string; content?: string | null }>,
  currentFile: string | null,
): Promise<AIResult> {
  try {
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
          {
            role: "user",
            content: imageUrl
              ? [
                  { type: "text", text: message },
                  { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
                ]
              : message,
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: 4096,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[OpenAI Error]", response.status, typeof errorData === "object" ? "provider_error" : "provider_error_unparseable");
      return generateAgenticFallbackWithBuilds(message, existingFiles, currentFile);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    let raw = data.choices[0]?.message?.content ?? "{}";
    
    raw = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    
    try {
      const parsed = JSON.parse(raw);
      
      if (!parsed.reply || typeof parsed.reply !== "string") {
        console.warn("[AI Validation] Missing or invalid reply field");
        return generateAgenticFallbackWithBuilds(message, existingFiles, currentFile);
      }
      
      if (!Array.isArray(parsed.actions)) {
        console.warn("[AI Validation] Actions is not an array, defaulting to []");
        parsed.actions = [];
      }
      
      return {
        reply: String(parsed.reply),
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      };
    } catch (parseErr) {
      console.error("[JSON Parse Error]", parseErr instanceof Error ? parseErr.message : "Unknown parse error");
      return generateAgenticFallbackWithBuilds(message, existingFiles, currentFile);
    }
  } catch (fetchErr) {
    console.error("[Fetch Error]", fetchErr instanceof Error ? fetchErr.message : "Unknown fetch error");
    return generateAgenticFallbackWithBuilds(message, existingFiles, currentFile);
  }
}

/**
 * Enhanced fallback that BUILDS common projects when API is unavailable
 */
function generateAgenticFallbackWithBuilds(
  message: string,
  existingFiles: Array<{ id: number; name: string; content?: string | null }>,
  currentFile: string | null,
): AIResult {
  const msg = message.toLowerCase().trim();

  // ── Weather app
  if (msg.includes("weather")) {
    const days = msg.match(/(\d+)\s*day/) ? Number(msg.match(/(\d+)\s*day/)![1]) : 7;
    return {
      reply: `🌤️ Created a ${days}-day weather app with forecast cards and mock data. Click Preview to see it!`,
      actions: [
        {
          type: "create_file",
          filename: "index.html",
          language: "html",
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
      <h1>🌤️ Weather</h1>
      <p>San Francisco, CA</p>
    </header>
    <div class="today">
      <div class="temp">72°F</div>
      <p>Partly Cloudy</p>
    </div>
    <h2>${days}-Day Forecast</h2>
    <div class="forecast" id="forecast"></div>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
        },
        {
          type: "create_file",
          filename: "style.css",
          language: "css",
          content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; color: #fff; }
.app { max-width: 480px; margin: 0 auto; padding: 24px; }
header { text-align: center; margin-bottom: 24px; }
h1 { font-size: 2rem; margin-bottom: 4px; }
.today { background: rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; text-align: center; margin-bottom: 24px; }
.temp { font-size: 4rem; font-weight: 200; }
h2 { margin-bottom: 16px; }
.forecast { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; }
.day { background: rgba(255,255,255,0.1); border-radius: 12px; padding: 12px; text-align: center; }
.icon { font-size: 1.5rem; margin: 8px 0; }`,
        },
        {
          type: "create_file",
          filename: "app.js",
          language: "javascript",
          content: `const icons = ["☀️", "⛅", "🌤️", "🌦️", "🌧️"];
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const today = new Date();

for (let i = 0; i < ${days}; i++) {
  const date = new Date(today);
  date.setDate(today.getDate() + i);
  const high = Math.floor(Math.random() * 30) + 60;
  const low = high - Math.floor(Math.random() * 15);
  const icon = icons[Math.floor(Math.random() * icons.length)];
  
  const card = document.createElement("div");
  card.className = "day";
  card.innerHTML = \`
    <div>\${i === 0 ? "Today" : days[date.getDay()]}</div>
    <div class="icon">\${icon}</div>
    <div>\${high}°</div>
    <div style="font-size:0.8rem">\${low}°</div>
  \`;
  document.getElementById("forecast").appendChild(card);
}`,
        },
      ],
    };
  }

  // ── Todo app
  if (msg.includes("todo") || msg.includes("task")) {
    return {
      reply: `✅ Created a todo app with add, complete, and delete. Click Preview!`,
      actions: [
        {
          type: "create_file",
          filename: "index.html",
          language: "html",
          content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Todo App</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="app">
    <h1>✅ My Todos</h1>
    <div class="input-group">
      <input id="input" type="text" placeholder="Add a task..." />
      <button onclick="add()">Add</button>
    </div>
    <ul id="list"></ul>
    <p id="count" class="count"></p>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
        },
        {
          type: "create_file",
          filename: "style.css",
          language: "css",
          content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f0f4f8; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.app { background: #fff; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 4px 24px rgba(0,0,0,0.1); }
h1 { margin-bottom: 20px; }
.input-group { display: flex; gap: 8px; margin-bottom: 20px; }
input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 8px; }
button { padding: 10px 20px; background: #3b82f6; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
ul { list-style: none; }
li { padding: 12px; background: #f8fafc; border-radius: 8px; margin-bottom: 8px; display: flex; align-items: center; }
li.done { opacity: 0.6; text-decoration: line-through; }
li span { flex: 1; cursor: pointer; }
li button { padding: 4px 12px; margin-left: 8px; background: #ef4444; font-size: 0.8rem; }
.count { text-align: center; margin-top: 16px; color: #64748b; }`,
        },
        {
          type: "create_file",
          filename: "app.js",
          language: "javascript",
          content: `let todos = JSON.parse(localStorage.getItem("todos") || "[]");

function render() {
  const list = document.getElementById("list");
  list.innerHTML = todos.map((t, i) => \`
    <li class="\${t.done ? "done" : ""}">
      <span onclick="toggle(\${i})">\${t.text}</span>
      <button onclick="del(\${i})">Delete</button>
    </li>
  \`).join("");
  
  const left = todos.filter(t => !t.done).length;
  document.getElementById("count").textContent = left ? \`\${left} left\` : "All done! 🎉";
}

function add() {
  const input = document.getElementById("input");
  if (!input.value.trim()) return;
  todos.push({ text: input.value, done: false });
  input.value = "";
  save();
  render();
}

function toggle(i) {
  todos[i].done = !todos[i].done;
  save();
  render();
}

function del(i) {
  todos.splice(i, 1);
  save();
  render();
}

function save() {
  localStorage.setItem("todos", JSON.stringify(todos));
}

document.getElementById("input").addEventListener("keypress", (e) => {
  if (e.key === "Enter") add();
});

render();`,
        },
      ],
    };
  }

  // ── Calculator
  if (msg.includes("calculator")) {
    return {
      reply: `🧮 Built a calculator! Click Preview to use it.`,
      actions: [
        {
          type: "create_file",
          filename: "index.html",
          language: "html",
          content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Calculator</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="calc">
    <input id="display" type="text" readonly />
    <div class="buttons">
      <button onclick="clear()">C</button>
      <button onclick="append('/')">/</button>
      <button onclick="append('*')">*</button>
      <button onclick="del()">←</button>
      <button onclick="append('7')">7</button>
      <button onclick="append('8')">8</button>
      <button onclick="append('9')">9</button>
      <button onclick="append('-')">-</button>
      <button onclick="append('4')">4</button>
      <button onclick="append('5')">5</button>
      <button onclick="append('6')">6</button>
      <button onclick="append('+')">+</button>
      <button onclick="append('1')">1</button>
      <button onclick="append('2')">2</button>
      <button onclick="append('3')">3</button>
      <button onclick="append('.')">.</button>
      <button onclick="append('0')" class="wide">0</button>
      <button onclick="calculate()" class="wide">=</button>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
        },
        {
          type: "create_file",
          filename: "style.css",
          language: "css",
          content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #1c1c1e; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
.calc { background: #1c1c1e; border-radius: 20px; padding: 16px; width: 280px; }
#display { width: 100%; padding: 20px; font-size: 2rem; text-align: right; background: #333; color: #fff; border: none; border-radius: 10px; margin-bottom: 16px; }
.buttons { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
button { padding: 20px; border: none; border-radius: 10px; font-size: 1rem; cursor: pointer; background: #333; color: #fff; }
button:active { opacity: 0.8; }
button.wide { grid-column: span 2; }`,
        },
        {
          type: "create_file",
          filename: "app.js",
          language: "javascript",
          content: `let display = document.getElementById("display");
let current = "0";

function append(char) {
  if (current === "0" && char !== ".") current = char;
  else current += char;
  display.value = current;
}

function clear() {
  current = "0";
  display.value = current;
}

function del() {
  current = current.slice(0, -1) || "0";
  display.value = current;
}

function calculate() {
  try {
    current = String(evaluateExpression(current));
    display.value = current;
  } catch {
    display.value = "Error";
    current = "0";
  }
}

function evaluateExpression(expr) {
  if (!/^[0-9+\\-*/. ()]+$/.test(expr)) throw new Error("Invalid expression");
  const tokens = expr.match(/\\d+(?:\\.\\d+)?|[+\\-*/()]/g) || [];
  let i = 0;
  function parseFactor() {
    const token = tokens[i++];
    if (token === "(") {
      const value = parseExpression();
      if (tokens[i++] !== ")") throw new Error("Missing )");
      return value;
    }
    if (token === "-") return -parseFactor();
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("Invalid number");
    return value;
  }
  function parseTerm() {
    let value = parseFactor();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i++];
      const right = parseFactor();
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }
  function parseExpression() {
    let value = parseTerm();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++];
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }
  const result = parseExpression();
  if (i !== tokens.length || !Number.isFinite(result)) throw new Error("Invalid expression");
  return Math.round(result * 1e12) / 1e12;
}`,
        },
      ],
    };
  }

  // ── Greeting
  if (/^(hi|hello|hey)[\s!?.,]*$/.test(msg)) {
    return {
      reply: `👋 Hi! I can build apps for you. Try:\n• "Create a weather app"\n• "Build a todo list"\n• "Make a calculator"`,
      actions: [],
    };
  }

  // ── Default suggestion
  return {
    reply: `✨ I can build apps! Try:\n• "Create a weather app"\n• "Build a todo list"\n• "Make a calculator"\n\nWhat would you like?`,
    actions: [],
  };
}

export default router;
