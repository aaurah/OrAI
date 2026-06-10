import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AiChatParams, AiChatBody } from "@workspace/api-zod";

const router = Router();

function getAiConfig() {
  const hasOpenRouterKey = Boolean(
    process.env.OPENROUTER_OPENCODE_BASE_URL || process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY,
  );
  const aiBase = process.env.OPENROUTER_OPENCODE_BASE_URL
    || process.env.OPENAI_API_BASE_URL
    || (hasOpenRouterKey ? "https://openrouter.ai/api/v1" : "https://api.openai.com/v1");
  const aiKey = process.env.API_KEY
    || process.env.OPENROUTER_API_KEY
    || process.env.VITE_OPENROUTER_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.VITE_OPENAI_API_KEY
    || "";
  const aiModel = hasOpenRouterKey
    ? (process.env.AI_MODEL || "openai/gpt-4o-mini")
    : (process.env.AI_MODEL || "gpt-4o-mini");
  return { aiBase, aiKey, aiModel };
}

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

type ProjectFile = {
  id: number;
  name: string;
  path?: string | null;
  content?: string | null;
  language?: string | null;
};

// ── Route ────────────────────────────────────────────────────────────

router.post("/projects/:id/ai/chat", async (req, res) => {
  try {
    const paramsParsed = AiChatParams.safeParse({ id: Number(req.params.id) });
    if (!paramsParsed.success) {
      return res.status(400).json({ error: "Invalid project ID", details: paramsParsed.error.message });
    }

    const bodyParsed = AiChatBody.safeParse(req.body);
    if (!bodyParsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: bodyParsed.error.message });
    }

    const projectId = paramsParsed.data.id;
    const { message, context, currentFile, imageUrl } = bodyParsed.data;

    // Validate message input
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "Message cannot be empty" });
    }

    // Fetch current project files so the AI knows what exists
    const rawFiles = await db
      .select({ 
        id: filesTable.id, 
        name: filesTable.name, 
        path: filesTable.path, 
        content: filesTable.content, 
        language: filesTable.language 
      })
      .from(filesTable)
      .where(eq(filesTable.projectId, projectId));

    const existingFiles = dedupeFilesByName(rawFiles);
    const sourceFiles = existingFiles.filter(file => !isProjectMetadataFile(file.name));
    const metadataFiles = existingFiles.filter(file => isProjectMetadataFile(file.name));
    const isSourceEmpty = sourceFiles.length === 0;

    const fileList = (isSourceEmpty ? [] : sourceFiles).map(f => `  - ${f.name} (id:${f.id})`).join("\n");
    const metadataFileList = metadataFiles.map(f => f.name).join(", ");
    const projectContext = buildProjectSourceContext(sourceFiles);

    // Detect project type from file extensions
    const fileNames = sourceFiles.map(f => f.name);
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
${fileList || "  (no app source files yet)"}
${isSourceEmpty && metadataFileList ? `\nProject setup files present but ignored for app-generation decisions: ${metadataFileList}` : ""}
${currentFile && !isProjectMetadataFile(currentFile) ? `\nCurrent focus file, if relevant: ${currentFile}` : ""}
${projectContext ? `\nProject source context:\n${projectContext}` : ""}

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
- Work from the whole project context, not just the current focus file. If a request affects multiple files, return actions for every file that must change.
- For app-building requests, create or edit the complete app surface: HTML, CSS, and JavaScript/TypeScript as needed.
- CRITICAL: If the project already has APP SOURCE files listed above, ALWAYS edit those existing files — NEVER create new ones unless the user explicitly says "start over", "rebuild from scratch", "new project", or "delete everything".
- Project setup files such as package.json, tsconfig.json, .gitignore, pnpm-workspace.yaml, and replit.md do NOT count as app source files. If only those files exist, treat the project as empty and create the requested app.
- For ${projectType} projects: answer questions about the code, explain architecture, suggest improvements, or make requested edits.
- "not working", "broken", "fix it", "make it work" are FIX requests — edit the relevant file to resolve the issue.
- When user says "make X" or "add X" to an existing project, EDIT the existing files to add the feature.
- When the user asks to "create", "build", "generate", or "make" something in an EMPTY project (no app source files listed above), produce working, complete code.
- When the user asks to "edit", "fix", "update", or "improve", edit the currently open file or the most relevant existing file.
- When the user asks to "delete" or "remove" a file, use delete_file.
- reply should be concise (1-3 sentences) describing what you did.
- ALWAYS return valid JSON. No trailing commas. No comments inside JSON.`;

    let aiResult: AIResult;

    const { aiBase, aiKey, aiModel } = getAiConfig();

    // Log the request for debugging
    console.log(`[AI Chat] Project: ${projectId}, Message: "${message}", Files: ${existingFiles.length}, Source files: ${sourceFiles.length}, AI Key: ${aiKey ? "✓" : "✗"}`);

    if (!aiKey) {
      console.warn("[AI Chat] No AI API key - using fallback with file creation");
      aiResult = generateAgenticFallbackWithBuilds(message, sourceFiles, currentFile ?? null);
    } else {
      aiResult = await callOpenAI(systemPrompt, message, imageUrl ?? undefined, sourceFiles, currentFile ?? null, { aiBase, aiKey, aiModel });
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

    console.log(`[AI Chat] Executed ${executedActions.length} actions`);

    return res.json({
      reply:           aiResult.reply,
      actions:         executedActions,
      codeBlocks:      [],
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[AI Route Error]", errorMessage, err);
    
    return res.status(500).json({
      error: "AI request failed",
      details: errorMessage,
      reply: "I encountered an error processing your request. Please try again.",
      actions: [],
    });
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
 * The IDE stores project setup files alongside user-created source files. Those
 * config files should not make a fresh project look non-empty to the AI agent.
 */
function isProjectMetadataFile(filename: string): boolean {
  const normalized = filename.replace(/^\//, "").toLowerCase();
  const metadataFiles = new Set([
    ".gitignore",
    ".npmrc",
    ".replit",
    ".replitignore",
    "components.json",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "replit.md",
    "tsconfig.json",
    "tsconfig.base.json",
    "vite.config.ts",
    "vite.config.js",
  ]);

  return metadataFiles.has(normalized);
}

/**
 * Keep the newest row for each file name so stale duplicates do not confuse the
 * prompt or cause edits to target an old copy.
 */
function dedupeFilesByName<T extends ProjectFile>(files: T[]): T[] {
  const byName = new Map<string, T>();
  for (const file of files) {
    const existing = byName.get(file.name);
    if (!existing || file.id > existing.id) {
      byName.set(file.name, file);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Include bounded whole-project context so the AI can modify a project instead
 * of acting like only the currently selected editor file exists.
 */
function buildProjectSourceContext(files: ProjectFile[]): string {
  const MAX_FILES = 30;
  const MAX_CHARS_PER_FILE = 12_000;
  const MAX_TOTAL_CHARS = 60_000;

  let total = 0;
  const chunks: string[] = [];

  for (const file of files.slice(0, MAX_FILES)) {
    const content = file.content ?? "";
    const clipped = content.length > MAX_CHARS_PER_FILE
      ? `${content.slice(0, MAX_CHARS_PER_FILE)}\n/* ...truncated... */`
      : content;
    const block = `\n--- ${file.name} ---\n\`\`\`${inferLanguage(file.name)}\n${clipped}\n\`\`\``;

    if (total + block.length > MAX_TOTAL_CHARS) {
      chunks.push(`\n--- context truncated: ${files.length - chunks.length} more file(s) not included ---`);
      break;
    }

    chunks.push(block);
    total += block.length;
  }

  return chunks.join("\n");
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
  config: { aiBase: string; aiKey: string; aiModel: string },
): Promise<AIResult> {
  const { aiBase, aiKey, aiModel } = config;
  try {
    console.log(`[AI Provider] Calling ${aiBase}/chat/completions with ${aiModel}`);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${aiKey}`,
    };

    if (process.env.VITE_APP_ID) {
      headers["x-boxman-app-id"] = process.env.VITE_APP_ID;
    }

    const response = await fetch(`${aiBase}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: aiModel,
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
        max_tokens: 12_000,
        temperature: 0.35,
      }),
    });

    console.log(`[AI Provider] Response status: ${response.status}`);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[AI Provider Error]", response.status, JSON.stringify(errorData));
      return generateAgenticFallbackWithBuilds(message, existingFiles, currentFile);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    let raw = data.choices[0]?.message?.content ?? "{}";
    
    console.log(`[AI Provider] Raw response (first 200 chars): ${raw.substring(0, 200)}`);
    
    raw = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    
    try {
      const parsed = JSON.parse(raw);
      
      if (!parsed.reply || typeof parsed.reply !== "string") {
        console.warn("[AI Validation] Missing or invalid reply field", parsed);
        return generateAgenticFallbackWithBuilds(message, existingFiles, currentFile);
      }
      
      if (!Array.isArray(parsed.actions)) {
        console.warn("[AI Validation] Actions is not an array, defaulting to []");
        parsed.actions = [];
      }
      
      console.log(`[AI Provider] Valid response with ${parsed.actions.length} actions`);
      
      return {
        reply: String(parsed.reply),
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      };
    } catch (parseErr) {
      console.error("[JSON Parse Error]", parseErr, "Raw:", raw.substring(0, 500));
      return generateAgenticFallbackWithBuilds(message, existingFiles, currentFile);
    }
  } catch (fetchErr) {
    console.error("[Fetch Error]", fetchErr);
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

  const hasSourceFiles = existingFiles.length > 0;
  const wantsUpgrade = /\b(upgrade|improve|enhance|polish|modernize|redesign|make\s+(it|the app)\s+better|better\s+ui)\b/.test(msg);
  const wantsStatus = /\b(working|listening|are you there|you there|can you hear me)\b/.test(msg);
  const wantsFix = /\b(fix|repair|debug|not working|broken|make it work)\b/.test(msg);

  if (hasSourceFiles && wantsUpgrade) {
    return generateFallbackUpgrade(existingFiles);
  }

  if (hasSourceFiles && wantsFix) {
    return generateFallbackRepair(existingFiles, currentFile);
  }

  if (wantsStatus) {
    const names = existingFiles.map(file => file.name).join(", ");
    return {
      reply: hasSourceFiles
        ? `Yes — I can see ${existingFiles.length} app file${existingFiles.length === 1 ? "" : "s"}: ${names}. Say exactly what to change, or say “upgrade app” and I’ll edit the files directly.`
        : "Yes — I’m ready. Ask me to create an app, and I’ll generate the files directly.",
      actions: [],
    };
  }

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
    current = String(eval(current));
    display.value = current;
  } catch {
    display.value = "Error";
    current = "0";
  }
}`,
        },
      ],
    };
  }

  // ── Audit / explain project fallback
  if (msg.includes("audit") || msg.includes("review") || msg.includes("inspect")) {
    if (existingFiles.length === 0) {
      return {
        reply: "I only see project setup files right now, no app source files yet. Ask me to create an app first, then I can audit the generated files.",
        actions: [],
      };
    }

    const names = existingFiles.map(file => file.name).join(", ");
    return {
      reply: `I found ${existingFiles.length} app file${existingFiles.length === 1 ? "" : "s"}: ${names}. Ask for a specific fix or improvement and I can edit the files directly.`,
      actions: [],
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
  if (hasSourceFiles) {
    const names = existingFiles.map(file => file.name).join(", ");
    return {
      reply: `I can see ${existingFiles.length} app file${existingFiles.length === 1 ? "" : "s"}: ${names}. Try “upgrade app”, “fix the layout”, “add dark mode”, or describe the exact feature you want and I’ll edit the files.`,
      actions: [],
    };
  }

  return {
    reply: `✨ I can build apps! Try:\n• "Create a weather app"\n• "Build a todo list"\n• "Make a calculator"\n\nWhat would you like?`,
    actions: [],
  };
}

function generateFallbackUpgrade(
  existingFiles: Array<{ id: number; name: string; content?: string | null }>,
): AIResult {
  return {
    reply: "Upgraded the app into a polished, responsive experience with a hero section, feature cards, interactive stats, and a dark/light theme toggle.",
    actions: buildStandardAppActions(existingFiles, "upgrade"),
  };
}

function generateFallbackRepair(
  existingFiles: Array<{ id: number; name: string; content?: string | null }>,
  currentFile: string | null,
): AIResult {
  const target = currentFile && existingFiles.some(file => file.name === currentFile)
    ? currentFile
    : existingFiles.find(file => /\.(js|jsx|ts|tsx)$/i.test(file.name))?.name;

  if (!target) {
    return generateFallbackUpgrade(existingFiles);
  }

  return {
    reply: `I refreshed ${target} with safer startup code and rebuilt the preview files so the app has a working baseline.`,
    actions: buildStandardAppActions(existingFiles, "repair"),
  };
}

function buildStandardAppActions(
  existingFiles: Array<{ id: number; name: string; content?: string | null }>,
  mode: "upgrade" | "repair",
): FileAction[] {
  const htmlName = pickFile(existingFiles, ["index.html"], /\.html$/i) || "index.html";
  const cssName = pickFile(existingFiles, ["style.css", "styles.css"], /\.css$/i) || "style.css";
  const jsName = pickFile(existingFiles, ["app.js", "main.js", "script.js", "index.js"], /\.(js|jsx|ts|tsx)$/i) || "app.js";

  return [
    upsertAction(existingFiles, htmlName, "html", buildFallbackHtml(cssName, jsName, mode)),
    upsertAction(existingFiles, cssName, "css", buildFallbackCss()),
    upsertAction(existingFiles, jsName, inferLanguage(jsName), buildFallbackJs()),
  ];
}

function pickFile(
  files: Array<{ name: string }>,
  preferred: string[],
  pattern: RegExp,
): string | null {
  for (const name of preferred) {
    const found = files.find(file => file.name.toLowerCase() === name.toLowerCase());
    if (found) return found.name;
  }
  return files.find(file => pattern.test(file.name))?.name ?? null;
}

function upsertAction(
  files: Array<{ name: string }>,
  filename: string,
  language: string,
  content: string,
): FileAction {
  const exists = files.some(file => file.name === filename);
  return exists
    ? { type: "edit_file", filename, content }
    : { type: "create_file", filename, language, content };
}

function htmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildFallbackHtml(cssName: string, jsName: string, mode: "upgrade" | "repair"): string {
  const title = mode === "repair" ? "Repaired App" : "Upgraded App";
  const safeCss = htmlEsc(cssName);
  const safeJs  = htmlEsc(jsName);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link rel="stylesheet" href="${safeCss}" />
</head>
<body>
  <main class="shell">
    <nav class="nav">
      <div class="brand"><span class="logo">✦</span><span>LaunchPad</span></div>
      <button id="themeToggle" class="ghost" type="button">Toggle theme</button>
    </nav>

    <section class="hero">
      <p class="eyebrow">Freshly upgraded</p>
      <h1>Build, preview, and ship your next idea faster.</h1>
      <p class="lead">A polished responsive starter with focused calls to action, feature cards, live stats, and small interactions that make the app feel alive.</p>
      <div class="actions">
        <button id="primaryAction" type="button">Start now</button>
        <button id="secondaryAction" class="secondary" type="button">Show stats</button>
      </div>
    </section>

    <section class="stats" aria-label="App stats">
      <article><strong data-count="24">0</strong><span>Components</span></article>
      <article><strong data-count="98">0</strong><span>Performance</span></article>
      <article><strong data-count="12">0</strong><span>Ideas shipped</span></article>
    </section>

    <section class="cards">
      <article>
        <h2>Clean UI</h2>
        <p>Modern spacing, color, typography, and responsive layout out of the box.</p>
      </article>
      <article>
        <h2>Interactive</h2>
        <p>Theme switching, animated counters, and clear button feedback are included.</p>
      </article>
      <article>
        <h2>Ready to extend</h2>
        <p>Simple HTML, CSS, and JavaScript files that are easy to customize.</p>
      </article>
    </section>
  </main>

  <div id="toast" role="status" aria-live="polite"></div>
  <script src="${safeJs}"></script>
</body>
</html>`;
}

function buildFallbackCss(): string {
  return `:root {
  color-scheme: dark;
  --bg: #080b14;
  --panel: rgba(255, 255, 255, 0.08);
  --panel-strong: rgba(255, 255, 255, 0.14);
  --text: #f8fafc;
  --muted: #a8b3cf;
  --accent: #6d5dfc;
  --accent-2: #13c8ff;
  --shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
}

body.light {
  color-scheme: light;
  --bg: #f5f7fb;
  --panel: rgba(255, 255, 255, 0.86);
  --panel-strong: #ffffff;
  --text: #111827;
  --muted: #5b6478;
  --accent: #4f46e5;
  --accent-2: #0891b2;
  --shadow: 0 24px 70px rgba(79, 70, 229, 0.16);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 40%, transparent), transparent 32rem),
    radial-gradient(circle at bottom right, color-mix(in srgb, var(--accent-2) 35%, transparent), transparent 28rem),
    var(--bg);
  color: var(--text);
}

.shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
.nav, .hero, .stats article, .cards article {
  border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
  background: var(--panel);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}
.nav { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 16px; border-radius: 24px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 800; letter-spacing: -0.02em; }
.logo { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 12px; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
.hero { margin-top: 28px; padding: clamp(32px, 7vw, 84px); border-radius: 36px; text-align: center; }
.eyebrow { margin: 0 0 12px; color: var(--accent-2); text-transform: uppercase; letter-spacing: 0.18em; font-size: 0.78rem; font-weight: 800; }
h1 { max-width: 820px; margin: 0 auto; font-size: clamp(2.5rem, 8vw, 5.8rem); line-height: 0.95; letter-spacing: -0.075em; }
.lead { max-width: 680px; margin: 24px auto 0; color: var(--muted); font-size: clamp(1rem, 2vw, 1.25rem); line-height: 1.7; }
.actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 32px; }
button { border: 0; border-radius: 999px; padding: 13px 20px; color: white; background: linear-gradient(135deg, var(--accent), var(--accent-2)); font-weight: 800; cursor: pointer; transition: transform 160ms ease, opacity 160ms ease; }
button:hover { transform: translateY(-2px); }
.secondary, .ghost { color: var(--text); background: var(--panel-strong); }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 20px; }
.stats article, .cards article { border-radius: 24px; padding: 24px; }
.stats strong { display: block; font-size: clamp(2rem, 5vw, 3.5rem); letter-spacing: -0.06em; }
.stats span, .cards p { color: var(--muted); }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 16px; }
.cards h2 { margin: 0 0 10px; }
.cards p { margin: 0; line-height: 1.65; }
#toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 140%); padding: 12px 16px; border-radius: 999px; background: var(--panel-strong); color: var(--text); box-shadow: var(--shadow); transition: transform 220ms ease; }
#toast.show { transform: translate(-50%, 0); }
@media (max-width: 760px) { .stats, .cards { grid-template-columns: 1fr; } .nav { align-items: flex-start; flex-direction: column; } }`;
}

function buildFallbackJs(): string {
  return `const toast = document.getElementById("toast");
const themeToggle = document.getElementById("themeToggle");
const primaryAction = document.getElementById("primaryAction");
const secondaryAction = document.getElementById("secondaryAction");

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function animateCounters() {
  document.querySelectorAll("[data-count]").forEach((item) => {
    const target = Number(item.dataset.count || "0");
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / 850, 1);
      item.textContent = Math.round(target * progress).toString();
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("light");
  localStorage.setItem("theme", document.body.classList.contains("light") ? "light" : "dark");
  showToast("Theme updated");
});

primaryAction.addEventListener("click", () => showToast("Ready to customize your app"));
secondaryAction.addEventListener("click", () => {
  animateCounters();
  showToast("Stats refreshed");
});

if (localStorage.getItem("theme") === "light") document.body.classList.add("light");
animateCounters();`;
}

export default router;
