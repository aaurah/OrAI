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
  const { message, context, currentFile, imageUrl } = bodyParsed.data as any;

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
          const existing = existingFiles.find(f => f.name === action.filename);
          if (existing) {
            await db
              .update(filesTable)
              .set({ content: action.content, updatedAt: new Date() })
              .where(eq(filesTable.id, existing.id));
            executedActions.push({ type: "edited", filename: action.filename, fileId: existing.id });
          } else {
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
          }

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
  const msg = message.toLowerCase().trim();

  // ── Greeting / health check ────────────────────────────────────────────────
  if (
    /^(hi|hello|hey|yo|sup|howdy|hola|test|ping)[\s!?.,]*$/.test(msg) ||
    /are you (working|there|alive|ok|online|ready)/.test(msg) ||
    msg === "test" || msg === "?" || /^how are you/.test(msg)
  ) {
    return {
      reply: `Yes, I'm working! 👋 I'm your agentic AI coding assistant — I can create, edit, and delete files in your project.\n\nTry asking me to:\n• "Create a weather app with 7 day forecast"\n• "Build a todo list app"\n• "Make a portfolio website"\n• "Create a landing page"\n• "Build a quiz app"`,
      actions: [],
    };
  }

  // ── Help / capabilities ────────────────────────────────────────────────────
  if (/what can you (do|make|build|create)|help|capabilities|features/.test(msg)) {
    return {
      reply: `I can create full web projects for you! Here's what I can build:\n\n🌤 Weather apps\n✅ Todo / task managers\n🧮 Calculators\n🌐 Multi-page websites\n💼 Portfolio sites\n📝 Blogs\n🛒 Shop / e-commerce\n📊 Dashboards\n🔐 Login / sign-up forms\n🎮 Games & quizzes\n🚀 Landing pages\n\nJust describe what you want and I'll build it!`,
      actions: [],
    };
  }

  // ── Complaint / past-tense accusation — NOT a command ─────────────────────
  if (
    /you (deleted|removed|broke|destroyed|ruined|erased|wiped|reset|cleared)|(my|the) (project|files|code|work|app) (is gone|got deleted|was deleted|disappeared|was removed|got removed)|(you|that) (messed|screwed) (up|it)|already (deleted|gone|missing)/.test(msg)
  ) {
    return {
      reply: `Sorry to hear that! I can help you rebuild. Just describe what you had:\n• "Rebuild the weather app with 7-day forecast"\n• "Recreate the todo app"\n• "Start over with a portfolio site"\n\nTell me what to build and I'll create it right away!`,
      actions: [],
    };
  }

  // ── Delete intent (command only, not past-tense complaints) ───────────────
  if (
    /\bdelete\b|\bremove\b/.test(msg) &&
    !/you (deleted|removed)|(was|got|been) (deleted|removed)|already deleted/.test(msg)
  ) {
    for (const f of existingFiles) {
      if (msg.includes(f.name.toLowerCase())) {
        return { reply: `Deleting ${f.name}.`, actions: [{ type: "delete_file", filename: f.name }] };
      }
    }
    return {
      reply: "Which file would you like to delete? I can see: " + (existingFiles.map(f => f.name).join(", ") || "no files yet") + ".",
      actions: [],
    };
  }

  // ── Design / visual improvement intent ───────────────────────────────────
  // Catches: "preview not good", "design not good", "make it look better",
  // "fix design", "redesign", "looks bad", "ugly", "make it pretty", etc.
  const designIntent =
    /redesign|make.*(good|better|nice|pretty|beautiful|modern|professional)|good.*(design|look|ui)|design.*(bad|not|ugly|broken|wrong|fix|improve|properly)|preview.*(bad|not|ugly|broken|wrong|fix|improve|properly|not good)|not.*(good|nice|proper|right).*(design|preview|look|ui)|look.*(bad|ugly|broken|wrong)|fix.*(design|ui|style|look|preview|css)|improve.*(design|ui|style|look)|make.*(ui|design|style|css).*(better|good|nice)|better.*(ui|design|style|look)|preview text|text.*(design|preview)|ugly|bland|boring/.test(msg);

  if (designIntent && existingFiles.length > 0) {
    const cssFile = existingFiles.find(f => f.name === "style.css");
    const htmlFile = existingFiles.find(f => f.name === "index.html");

    // Detect color preference from message
    const wantsBlue   = /blue/.test(msg);
    const wantsGreen  = /green/.test(msg);
    const wantsPurple = /purple|violet/.test(msg);
    const wantsDark   = /dark/.test(msg);

    const primary   = wantsBlue ? "#3b82f6" : wantsGreen ? "#10b981" : wantsPurple ? "#8b5cf6" : "#6366f1";
    const primaryDk = wantsBlue ? "#2563eb" : wantsGreen ? "#059669" : wantsPurple ? "#7c3aed" : "#4f46e5";
    const bg        = wantsDark ? "#0f172a" : "#f8fafc";
    const surface   = wantsDark ? "#1e293b" : "#ffffff";
    const text       = wantsDark ? "#f1f5f9" : "#1e293b";
    const textMuted  = wantsDark ? "#94a3b8" : "#64748b";
    const border     = wantsDark ? "#334155" : "#e2e8f0";

    const newCss = `/* ── Redesigned by AI ────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --primary:   ${primary};
  --primary-dk:${primaryDk};
  --bg:        ${bg};
  --surface:   ${surface};
  --text:      ${text};
  --muted:     ${textMuted};
  --border:    ${border};
  --radius:    12px;
  --shadow:    0 4px 24px rgba(0,0,0,${wantsDark ? ".4" : ".08"});
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  line-height: 1.6;
}

/* ── Layout ── */
.app, main, .container, #app {
  max-width: 680px;
  margin: 0 auto;
  padding: 32px 20px;
}

/* ── Typography ── */
h1 { font-size: clamp(1.6rem, 4vw, 2.2rem); font-weight: 800; letter-spacing: -0.02em; margin-bottom: 8px; color: var(--text); }
h2 { font-size: 1.25rem; font-weight: 700; margin-bottom: 12px; color: var(--text); }
h3 { font-size: 1rem; font-weight: 600; color: var(--text); }
p  { color: var(--muted); margin-bottom: 12px; }

/* ── Cards / panels ── */
.card, .panel, .box, .section, .today, .quiz-box, .result, form,
[class*="-card"], [class*="-box"], [class*="-panel"] {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 24px;
  margin-bottom: 16px;
}

/* ── Buttons ── */
button, .btn, [type="submit"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px 20px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s, box-shadow 0.15s;
  box-shadow: 0 2px 8px ${primary}40;
}
button:hover, .btn:hover { background: var(--primary-dk); transform: translateY(-1px); box-shadow: 0 4px 14px ${primary}50; }
button:active { transform: translateY(0); }
button.secondary, .btn-secondary {
  background: var(--surface);
  color: var(--primary);
  border: 1.5px solid var(--primary);
  box-shadow: none;
}
button.secondary:hover { background: ${primary}10; }

/* ── Inputs ── */
input, textarea, select {
  width: 100%;
  padding: 10px 14px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  font-size: 0.95rem;
  color: var(--text);
  background: var(--surface);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
input:focus, textarea:focus, select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px ${primary}25;
}

/* ── Lists ── */
ul, ol { list-style: none; }
li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  margin-bottom: 8px;
  transition: box-shadow 0.15s;
}
li:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.07); }
li span { flex: 1; color: var(--text); }
li.done span { text-decoration: line-through; color: var(--muted); }

/* ── Header / nav ── */
header, nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  margin-bottom: 32px;
  border-radius: 0 0 var(--radius) var(--radius);
}
header h1, nav h1 { font-size: 1.25rem; margin: 0; }

/* ── Weather specific ── */
.temp-big { font-size: 4.5rem; font-weight: 200; color: var(--primary); line-height: 1; margin: 8px 0; }
.forecast  { display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 10px; }
.day-card  { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 10px; text-align: center; }
.day-icon  { font-size: 1.8rem; margin: 6px 0; }
.day-high  { font-weight: 700; color: var(--text); }
.day-low   { font-size: 0.8rem; color: var(--muted); }

/* ── Calculator specific ── */
.calc      { background: var(--surface); border-radius: 20px; padding: 20px; width: 300px; margin: auto; box-shadow: var(--shadow); }
.display   { text-align: right; padding: 16px; }
.result    { font-size: 3rem; font-weight: 200; color: var(--text); }
.buttons   { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.buttons button { height: 64px; border-radius: 14px; font-size: 1.1rem; }
.buttons button.op { background: var(--primary); }

/* ── Misc utilities ── */
.input-row, .action-row { display: flex; gap: 8px; margin-bottom: 20px; }
.input-row input, .action-row input { flex: 1; width: auto; }
.footer, .hint, .meta { font-size: 0.8rem; color: var(--muted); text-align: center; margin-top: 12px; }
.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; background: ${primary}20; color: var(--primary); }
.divider { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
img { max-width: 100%; border-radius: 8px; }
a   { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Quiz / game specific ── */
.question { font-size: 1.1rem; font-weight: 600; margin-bottom: 16px; color: var(--text); }
.option   { width: 100%; text-align: left; margin-bottom: 8px; background: var(--surface); color: var(--text); border: 1.5px solid var(--border); box-shadow: none; }
.option:hover { border-color: var(--primary); background: ${primary}08; }
.option.correct { background: #dcfce7; border-color: #22c55e; color: #15803d; }
.option.wrong   { background: #fee2e2; border-color: #ef4444; color: #b91c1c; }
.score { font-size: 1.5rem; font-weight: 700; color: var(--primary); text-align: center; }

/* ── Progress bar ── */
.progress { background: var(--border); border-radius: 999px; height: 6px; margin: 12px 0; overflow: hidden; }
.progress-fill { height: 100%; background: var(--primary); border-radius: 999px; transition: width 0.4s; }

/* ── Responsive ── */
@media (max-width: 480px) {
  .app, main, .container, #app { padding: 16px 12px; }
  h1 { font-size: 1.4rem; }
  .temp-big { font-size: 3rem; }
  .forecast { grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); }
}`;

    const actions: FileAction[] = [];
    if (cssFile) {
      actions.push({ type: "edit_file", filename: "style.css", content: newCss });
    } else {
      actions.push({ type: "create_file", filename: "style.css", language: "css", content: newCss });
    }

    // Also update HTML if it's missing charset/viewport/link
    if (htmlFile && htmlFile.content) {
      let html = htmlFile.content;
      let changed = false;
      if (!html.includes('charset')) {
        html = html.replace('<head>', '<head>\n  <meta charset="UTF-8"/>');
        changed = true;
      }
      if (!html.includes('viewport')) {
        html = html.replace('<head>', '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>');
        changed = true;
      }
      if (!html.includes('style.css')) {
        html = html.replace('</head>', '  <link rel="stylesheet" href="style.css"/>\n</head>');
        changed = true;
      }
      if (changed) actions.push({ type: "edit_file", filename: "index.html", content: html });
    }

    const themeName = wantsDark ? "dark" : wantsBlue ? "blue" : wantsGreen ? "green" : wantsPurple ? "purple" : "indigo";
    return {
      reply: `Redesigned the UI with a clean, modern ${themeName} theme — better typography, card layouts, hover effects, and responsive spacing. Hit Preview to see it!`,
      actions,
    };
  }

  // ── Preview intent ────────────────────────────────────────────────────────
  if (/\bpreview\b|show me|see it live|view it|how does it look|open it/.test(msg)) {
    const hasHtml = existingFiles.some(f => f.name.endsWith(".html"));
    if (!hasHtml) {
      return {
        reply: `The Preview tab shows your project's HTML output. This project doesn't have an \`index.html\` yet, so there's nothing to render.\n\nSay **"Create a web app"** and I'll build a full HTML/CSS/JS project you can preview instantly!`,
        actions: [],
      };
    }
    return {
      reply: `Tap the **Preview** tab (monitor icon) to see your project live! It renders \`index.html\` directly in the browser. Hit the refresh icon in that tab to reload after changes.`,
      actions: [],
    };
  }

  // ── Edit / fix intent with existing files ─────────────────────────────────
  // Require the edit verb to be the primary action (start of message, not buried inside "I don't want to change X")
  if (/^(?:please\s+)?(?:fix|edit|improve|update|refactor|change|modify)\b|(?:can you|could you|help me)\s+(?:fix|edit|improve|update|refactor|change|modify)\b/.test(msg) && existingFiles.length > 0) {
    const target = existingFiles.find(f => msg.includes(f.name.toLowerCase()))
                ?? existingFiles.find(f => currentFile && f.name === currentFile)
                ?? existingFiles.find(f => f.name === "style.css");

    if (target && target.content) {
      if (/dark mode|dark theme/.test(msg)) {
        return {
          reply: `Added dark mode to ${target.name}.`,
          actions: [{ type: "edit_file", filename: target.name, content: target.content
            .replace(/background:\s*#(?:fff|white|f8fafc|f0f4f8|f1f5f9|f0f0f0)[^;]*/gi, "background: #0d1117")
            .replace(/color:\s*#(?:000|111|222|333|1e293b|0f172a)[^;]*/gi, "color: #e6edf3") +
            "\n/* Dark mode override */\nbody { background: #0d1117 !important; color: #e6edf3 !important; }"
          }],
        };
      }
    }
    if (currentFile) {
      return {
        reply: `I can see \`${currentFile}\` is open. Tell me exactly what to change — for example:\n• "Add dark mode"\n• "Change color to blue"\n• "Add a submit button"\n• "Add form validation"\n\nI'll edit the file directly.`,
        actions: [],
      };
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

  // ── Multi-page website ────────────────────────────────────────────────────
  const pageCountMatch = msg.match(/(\d+)\s*page/);
  const pageCount = pageCountMatch ? Number(pageCountMatch[1]) : null;
  if (
    (pageCount && pageCount >= 2) ||
    /multi.?page|nav(bar|igation)|multiple pages/.test(msg) ||
    (msg.includes("page") && (msg.includes("html") || msg.includes("website") || msg.includes("site")))
  ) {
    const n = pageCount && pageCount <= 6 ? pageCount : 3;
    const pages = ["Home", "About", "Contact", "Portfolio", "Services", "Blog"].slice(0, n);
    const navLinks = pages.map((p, i) => `<a href="#" class="nav-link${i === 0 ? " active" : ""}" data-page="${p.toLowerCase()}">${p}</a>`).join("\n      ");
    const sections = pages.map((p, i) => `  <section id="${p.toLowerCase()}" class="page${i === 0 ? " active" : ""}">
    <h1>${p}</h1>
    <p>${p === "Home" ? "Welcome to our website! Navigate using the menu above." : p === "About" ? "We are a team of passionate developers building great things." : p === "Contact" ? "Get in touch: <a href='mailto:hello@example.com'>hello@example.com</a>" : p === "Portfolio" ? "Check out our latest projects below." : p === "Services" ? "We offer web design, development, and consulting." : "Read our latest articles and updates."}</p>
  </section>`).join("\n");
    return {
      reply: `Created a ${n}-page website with navigation! Use the nav bar to switch between ${pages.join(", ")} pages. Click Preview to see it live.`,
      actions: [
        { type: "create_file", filename: "index.html", language: "html", content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>My Website</title>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>
  <nav>
    <div class="logo">MyBrand</div>
    <div class="nav-links">
      ${navLinks}
    </div>
    <button class="hamburger" id="hamburger">☰</button>
  </nav>
  <main>
${sections}
  </main>
  <script src="app.js"></script>
</body>
</html>` },
        { type: "create_file", filename: "style.css", language: "css", content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #f8fafc; color: #1e293b; }
nav { background: #1e293b; color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; height: 60px; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
.logo { font-weight: 700; font-size: 1.2rem; letter-spacing: -0.5px; }
.nav-links { display: flex; gap: 4px; }
.nav-link { color: rgba(255,255,255,.7); text-decoration: none; padding: 8px 16px; border-radius: 6px; font-size: 0.9rem; font-weight: 500; transition: all .2s; }
.nav-link:hover, .nav-link.active { color: #fff; background: rgba(255,255,255,.15); }
.hamburger { display: none; background: none; border: none; color: #fff; font-size: 1.3rem; cursor: pointer; }
main { max-width: 900px; margin: 0 auto; padding: 60px 24px; }
.page { display: none; animation: fadeIn .3s ease; }
.page.active { display: block; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
h1 { font-size: 2.5rem; font-weight: 700; margin-bottom: 16px; color: #0f172a; }
p { font-size: 1.1rem; color: #475569; line-height: 1.7; }
a { color: #3b82f6; }
@media (max-width: 600px) { .nav-links { display: none; flex-direction: column; position: absolute; top: 60px; left: 0; right: 0; background: #1e293b; padding: 8px; }
.nav-links.open { display: flex; } .hamburger { display: block; } }` },
        { type: "create_file", filename: "app.js", language: "javascript", content: `const links = document.querySelectorAll(".nav-link");
const pages = document.querySelectorAll(".page");
const hamburger = document.getElementById("hamburger");
const navLinks = document.querySelector(".nav-links");

links.forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    const target = link.dataset.page;
    links.forEach(l => l.classList.remove("active"));
    pages.forEach(p => p.classList.remove("active"));
    link.classList.add("active");
    document.getElementById(target)?.classList.add("active");
    navLinks.classList.remove("open");
  });
});

hamburger.addEventListener("click", () => navLinks.classList.toggle("open"));` },
      ],
    };
  }

  // ── Portfolio website ──────────────────────────────────────────────────────
  if (/portfolio|resume|cv|personal site/.test(msg)) {
    return {
      reply: "Created a professional portfolio website with hero, skills, projects, and contact sections. Click Preview to see it!",
      actions: [
        { type: "create_file", filename: "index.html", language: "html", content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>My Portfolio</title>
  <link rel="stylesheet" href="style.css"/>
</head>
<body>
  <nav><div class="logo">Alex Dev</div><div class="nav-links"><a href="#about">About</a><a href="#skills">Skills</a><a href="#projects">Projects</a><a href="#contact">Contact</a></div></nav>
  <section class="hero" id="about">
    <div class="hero-content">
      <div class="avatar">👨‍💻</div>
      <h1>Hi, I'm <span>Alex</span></h1>
      <p>Full-stack developer building beautiful, fast, and accessible web apps.</p>
      <div class="hero-btns"><a href="#projects" class="btn">View Projects</a><a href="#contact" class="btn btn-outline">Contact Me</a></div>
    </div>
  </section>
  <section id="skills"><h2>Skills</h2><div class="skills-grid" id="skillsGrid"></div></section>
  <section id="projects"><h2>Projects</h2><div class="projects-grid" id="projectsGrid"></div></section>
  <section id="contact"><h2>Get In Touch</h2><p>Open to freelance work and full-time opportunities.</p>
    <form class="contact-form"><input type="text" placeholder="Your name"/><input type="email" placeholder="Your email"/><textarea placeholder="Your message" rows="4"></textarea><button type="submit" class="btn">Send Message</button></form>
  </section>
  <footer><p>© 2024 Alex Dev · Built with ❤️</p></footer>
  <script src="app.js"></script>
</body>
</html>` },
        { type: "create_file", filename: "style.css", language: "css", content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #0f0f23; color: #ccd6f6; scroll-behavior: smooth; }
nav { display: flex; justify-content: space-between; align-items: center; padding: 20px 5%; position: fixed; top: 0; width: 100%; background: rgba(15,15,35,.9); backdrop-filter: blur(8px); z-index: 100; }
.logo { font-weight: 700; color: #64ffda; font-size: 1.2rem; }
.nav-links a { color: #ccd6f6; text-decoration: none; margin-left: 24px; font-size: .9rem; transition: color .2s; }
.nav-links a:hover { color: #64ffda; }
.hero { min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; padding: 80px 24px 40px; }
.avatar { font-size: 5rem; margin-bottom: 16px; }
h1 { font-size: 3rem; font-weight: 700; margin-bottom: 12px; }
h1 span { color: #64ffda; }
.hero p { font-size: 1.2rem; color: #8892b0; max-width: 500px; margin: 0 auto 28px; }
.hero-btns { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
.btn { padding: 12px 28px; background: #64ffda; color: #0f0f23; border: 2px solid #64ffda; border-radius: 6px; font-weight: 600; text-decoration: none; font-size: .95rem; transition: all .2s; cursor: pointer; }
.btn:hover { background: transparent; color: #64ffda; }
.btn-outline { background: transparent; color: #64ffda; }
.btn-outline:hover { background: #64ffda; color: #0f0f23; }
section:not(.hero) { padding: 80px 5%; max-width: 1000px; margin: 0 auto; }
h2 { font-size: 2rem; font-weight: 700; margin-bottom: 40px; color: #ccd6f6; border-bottom: 2px solid #64ffda; padding-bottom: 8px; display: inline-block; }
.skills-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; }
.skill-card { background: #172a45; border: 1px solid #233554; border-radius: 10px; padding: 20px; text-align: center; transition: transform .2s; }
.skill-card:hover { transform: translateY(-4px); border-color: #64ffda; }
.skill-icon { font-size: 2rem; margin-bottom: 8px; }
.skill-name { font-size: .9rem; color: #8892b0; }
.projects-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
.project-card { background: #172a45; border: 1px solid #233554; border-radius: 12px; padding: 24px; transition: transform .2s; }
.project-card:hover { transform: translateY(-4px); border-color: #64ffda; }
.project-card h3 { color: #ccd6f6; margin-bottom: 8px; }
.project-card p { font-size: .9rem; color: #8892b0; margin-bottom: 16px; }
.tags { display: flex; gap: 8px; flex-wrap: wrap; }
.tag { background: rgba(100,255,218,.1); color: #64ffda; border: 1px solid #64ffda; padding: 3px 10px; border-radius: 20px; font-size: .75rem; }
.contact-form { display: flex; flex-direction: column; gap: 16px; max-width: 500px; }
.contact-form input, .contact-form textarea { background: #172a45; border: 1px solid #233554; color: #ccd6f6; padding: 12px 16px; border-radius: 8px; font-family: inherit; font-size: 1rem; }
.contact-form input:focus, .contact-form textarea:focus { outline: none; border-color: #64ffda; }
footer { text-align: center; padding: 40px; color: #8892b0; font-size: .9rem; border-top: 1px solid #233554; margin-top: 60px; }` },
        { type: "create_file", filename: "app.js", language: "javascript", content: `const skills = [
  {icon:"⚛️",name:"React"},{icon:"🟨",name:"JavaScript"},{icon:"🔷",name:"TypeScript"},
  {icon:"🎨",name:"CSS"},{icon:"🐍",name:"Python"},{icon:"🗄️",name:"SQL"},
  {icon:"☁️",name:"AWS"},{icon:"🐙",name:"Git"},{icon:"📱",name:"Mobile"},
];
const projects = [
  {title:"E-Commerce Platform",desc:"Full-stack shop with cart, auth, and payments.",tags:["React","Node","PostgreSQL"]},
  {title:"AI Chat App",desc:"Real-time chat with AI assistant and markdown support.",tags:["TypeScript","OpenAI","WebSockets"]},
  {title:"Portfolio Dashboard",desc:"Analytics dashboard with charts and live data.",tags:["React","D3.js","REST API"]},
];

document.getElementById("skillsGrid").innerHTML = skills.map(s =>
  \`<div class="skill-card"><div class="skill-icon">\${s.icon}</div><div class="skill-name">\${s.name}</div></div>\`
).join("");

document.getElementById("projectsGrid").innerHTML = projects.map(p =>
  \`<div class="project-card"><h3>\${p.title}</h3><p>\${p.desc}</p><div class="tags">\${p.tags.map(t => \`<span class="tag">\${t}</span>\`).join("")}</div></div>\`
).join("");

document.querySelector(".contact-form").addEventListener("submit", e => {
  e.preventDefault();
  alert("Thanks! Message sent. (Connect a backend to handle this for real.)");
});` },
      ],
    };
  }

  // ── Landing page ──────────────────────────────────────────────────────────
  if (/landing|homepage|home page|startup|saas|product page/.test(msg)) {
    return {
      reply: "Created a modern SaaS landing page with hero, features, pricing, and CTA sections. Click Preview!",
      actions: [
        { type: "create_file", filename: "index.html", language: "html", content: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Launch Fast</title><link rel="stylesheet" href="style.css"/></head>
<body>
<nav><span class="logo">🚀 LaunchFast</span><div><a href="#features">Features</a><a href="#pricing">Pricing</a><a class="btn-nav" href="#cta">Get Started</a></div></nav>
<section class="hero">
  <div class="badge">✨ Now in Public Beta</div>
  <h1>Build & Ship <span>10× Faster</span></h1>
  <p>The all-in-one platform that takes your idea from zero to production in hours, not weeks.</p>
  <div class="cta-group"><a href="#cta" class="btn">Start for Free →</a><a href="#features" class="btn-ghost">See how it works</a></div>
  <div class="hero-stats"><div><strong>10k+</strong><span>Users</span></div><div><strong>99.9%</strong><span>Uptime</span></div><div><strong>4.9★</strong><span>Rating</span></div></div>
</section>
<section id="features"><h2>Everything you need</h2><p class="sub">Stop juggling tools. Get everything in one platform.</p>
<div class="features-grid" id="featGrid"></div></section>
<section id="pricing"><h2>Simple pricing</h2><p class="sub">No hidden fees. Cancel anytime.</p>
<div class="plans" id="plansGrid"></div></section>
<section id="cta" class="cta-section"><h2>Ready to launch?</h2><p>Join 10,000+ founders who ship faster with LaunchFast.</p>
<form class="signup"><input type="email" placeholder="Enter your email"/><button type="submit" class="btn">Get Early Access</button></form></section>
<footer><p>© 2024 LaunchFast · <a href="#">Privacy</a> · <a href="#">Terms</a></p></footer>
<script src="app.js"></script></body></html>` },
        { type: "create_file", filename: "style.css", language: "css", content: `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#030712;color:#f1f5f9}
nav{display:flex;justify-content:space-between;align-items:center;padding:18px 6%;position:sticky;top:0;background:rgba(3,7,18,.85);backdrop-filter:blur(12px);z-index:100}
.logo{font-weight:800;font-size:1.1rem}
nav a{color:#94a3b8;text-decoration:none;margin-left:24px;font-size:.9rem;transition:color .2s}
nav a:hover{color:#f1f5f9}
.btn-nav{background:#6366f1;color:#fff!important;padding:8px 18px;border-radius:8px}
.hero{text-align:center;padding:100px 6% 80px;max-width:800px;margin:0 auto}
.badge{display:inline-block;background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.4);color:#818cf8;padding:6px 16px;border-radius:20px;font-size:.8rem;margin-bottom:24px}
h1{font-size:clamp(2.2rem,5vw,3.8rem);font-weight:800;line-height:1.1;margin-bottom:20px}
h1 span{background:linear-gradient(135deg,#6366f1,#8b5cf6,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hero p{font-size:1.15rem;color:#94a3b8;max-width:520px;margin:0 auto 32px;line-height:1.7}
.cta-group{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-bottom:48px}
.btn{background:#6366f1;color:#fff;padding:13px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:.95rem;border:none;cursor:pointer;transition:background .2s}
.btn:hover{background:#4f46e5}
.btn-ghost{color:#94a3b8;padding:13px 28px;border-radius:10px;text-decoration:none;border:1px solid #334155;font-weight:500;font-size:.95rem;transition:all .2s}
.btn-ghost:hover{color:#f1f5f9;border-color:#64748b}
.hero-stats{display:flex;justify-content:center;gap:40px;padding-top:32px;border-top:1px solid #1e293b}
.hero-stats div{text-align:center}
.hero-stats strong{display:block;font-size:1.6rem;font-weight:700;color:#6366f1}
.hero-stats span{font-size:.85rem;color:#64748b}
section:not(.hero):not(.cta-section){padding:80px 6%;max-width:1100px;margin:0 auto}
h2{font-size:2rem;font-weight:700;text-align:center;margin-bottom:12px}
.sub{text-align:center;color:#64748b;margin-bottom:48px}
.features-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}
.feat{background:#0f172a;border:1px solid #1e293b;border-radius:14px;padding:24px;transition:border-color .2s}
.feat:hover{border-color:#6366f1}
.feat-icon{font-size:2rem;margin-bottom:12px}
.feat h3{font-size:1rem;font-weight:600;margin-bottom:6px}
.feat p{font-size:.85rem;color:#64748b;line-height:1.6}
.plans{display:flex;gap:20px;justify-content:center;flex-wrap:wrap}
.plan{background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px;min-width:240px;text-align:center;transition:border-color .2s;position:relative}
.plan.popular{border-color:#6366f1}
.pop-badge{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#6366f1;color:#fff;padding:3px 14px;border-radius:20px;font-size:.75rem;font-weight:600}
.plan h3{font-size:1.1rem;font-weight:700;margin-bottom:8px}
.price{font-size:2.5rem;font-weight:800;margin:12px 0 4px}
.price span{font-size:1rem;color:#64748b}
.plan p{color:#64748b;font-size:.85rem;margin-bottom:20px}
.cta-section{text-align:center;padding:80px 6%;border-top:1px solid #1e293b}
.signup{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:28px}
.signup input{background:#0f172a;border:1px solid #334155;color:#f1f5f9;padding:12px 20px;border-radius:10px;font-size:1rem;width:280px}
.signup input:focus{outline:none;border-color:#6366f1}
footer{text-align:center;padding:32px;color:#475569;font-size:.85rem;border-top:1px solid #1e293b}
footer a{color:#6366f1;text-decoration:none}` },
        { type: "create_file", filename: "app.js", language: "javascript", content: `const features=[
  {icon:"⚡",title:"Instant Deploy",desc:"Push to production in one command. Zero config required."},
  {icon:"🔒",title:"Built-in Auth",desc:"User authentication out of the box. OAuth, magic links, MFA."},
  {icon:"📊",title:"Analytics",desc:"Real-time dashboards to monitor your app's performance."},
  {icon:"🗄️",title:"Database",desc:"Managed PostgreSQL with automatic backups and scaling."},
  {icon:"🤖",title:"AI Assistant",desc:"AI coding assistant to help you ship features faster."},
  {icon:"🌍",title:"Global CDN",desc:"Deploy to 30+ edge locations for blazing fast load times."},
];
const plans=[
  {name:"Free",price:"$0",desc:"Perfect for side projects",badge:null},
  {name:"Pro",price:"$19",desc:"For growing startups",badge:"Most Popular"},
  {name:"Team",price:"$49",desc:"For scaling companies",badge:null},
];
document.getElementById("featGrid").innerHTML=features.map(f=>\`<div class="feat"><div class="feat-icon">\${f.icon}</div><h3>\${f.title}</h3><p>\${f.desc}</p></div>\`).join("");
document.getElementById("plansGrid").innerHTML=plans.map(p=>\`<div class="plan\${p.badge?" popular":""}">\${p.badge?\`<div class="pop-badge">\${p.badge}</div>\`:""}<h3>\${p.name}</h3><div class="price">\${p.price}<span>/mo</span></div><p>\${p.desc}</p></div>\`).join("");
document.querySelector(".signup").addEventListener("submit",e=>{e.preventDefault();alert("🎉 You're on the list!");});` },
      ],
    };
  }

  // ── Blog ───────────────────────────────────────────────────────────────────
  if (/blog|article|post|news/.test(msg)) {
    return {
      reply: "Created a clean blog homepage with featured articles, categories, and a newsletter signup. Click Preview!",
      actions: [
        { type: "create_file", filename: "index.html", language: "html", content: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>The Dev Blog</title><link rel="stylesheet" href="style.css"/></head>
<body><nav><span class="logo">📖 DevBlog</span><div class="nav-cats"><a href="#">All</a><a href="#">Tech</a><a href="#">Design</a><a href="#">Career</a></div></nav>
<header><h1>Stories for curious minds</h1><p>Insights on technology, design, and the craft of building software.</p>
<form class="search"><input type="search" placeholder="Search articles…"/><button>🔍</button></form></header>
<main><section class="featured" id="featured"></section>
<section class="content"><div class="posts" id="posts"></div>
<aside class="sidebar"><h3>Categories</h3><div class="cats" id="cats"></div>
<h3 style="margin-top:28px">Newsletter</h3><p style="font-size:.9rem;color:#64748b;margin-bottom:12px">Get articles in your inbox weekly.</p>
<form class="nl-form"><input type="email" placeholder="your@email.com"/><button class="btn">Subscribe</button></form></aside></section></main>
<footer><p>© 2024 DevBlog · Made with ❤️</p></footer>
<script src="app.js"></script></body></html>` },
        { type: "create_file", filename: "style.css", language: "css", content: `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#f8fafc;color:#1e293b}
nav{display:flex;justify-content:space-between;align-items:center;padding:16px 6%;background:#fff;border-bottom:1px solid #e2e8f0;position:sticky;top:0;z-index:10}
.logo{font-weight:700;font-size:1.1rem}
.nav-cats a{color:#64748b;text-decoration:none;margin-left:20px;font-size:.9rem;transition:color .2s}
.nav-cats a:hover{color:#1e293b}
header{text-align:center;padding:60px 24px 48px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff}
header h1{font-size:2.5rem;font-weight:800;margin-bottom:12px}
header p{font-size:1.1rem;opacity:.85;margin-bottom:28px}
.search{display:flex;gap:8px;justify-content:center}
.search input{padding:12px 20px;border:none;border-radius:10px;font-size:1rem;width:320px;background:rgba(255,255,255,.9)}
.search button{padding:12px 16px;border:none;border-radius:10px;background:rgba(255,255,255,.2);color:#fff;font-size:1rem;cursor:pointer}
main{max-width:1100px;margin:0 auto;padding:48px 24px}
.featured{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:24px;margin-bottom:48px}
.feat-card{background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);transition:transform .2s,box-shadow .2s}
.feat-card:hover{transform:translateY(-4px);box-shadow:0 8px 24px rgba(0,0,0,.12)}
.card-img{height:160px;display:flex;align-items:center;justify-content:center;font-size:3rem}
.card-body{padding:20px}
.tag{background:#ede9fe;color:#7c3aed;padding:3px 10px;border-radius:20px;font-size:.75rem;font-weight:600;margin-bottom:10px;display:inline-block}
.feat-card h3{font-size:1.05rem;font-weight:700;margin-bottom:8px;line-height:1.4}
.feat-card p{font-size:.85rem;color:#64748b;line-height:1.6;margin-bottom:12px}
.meta{font-size:.8rem;color:#94a3b8}
.content{display:grid;grid-template-columns:1fr 300px;gap:32px}
.posts{display:flex;flex-direction:column;gap:20px}
.post{display:flex;gap:16px;background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:box-shadow .2s}
.post:hover{box-shadow:0 4px 12px rgba(0,0,0,.12)}
.post-icon{font-size:2.5rem;width:60px;height:60px;background:#f1f5f9;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.post-body h3{font-size:1rem;font-weight:700;margin-bottom:6px}
.post-body p{font-size:.85rem;color:#64748b;line-height:1.5}
.sidebar h3{font-size:1rem;font-weight:700;margin-bottom:14px}
.cats{display:flex;flex-direction:column;gap:8px}
.cat-item{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#fff;border-radius:8px;font-size:.9rem;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.cat-count{background:#f1f5f9;padding:2px 8px;border-radius:20px;font-size:.75rem;font-weight:600}
.nl-form{display:flex;flex-direction:column;gap:8px}
.nl-form input{padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;font-size:.9rem}
.btn{background:#7c3aed;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:.9rem;cursor:pointer}
footer{text-align:center;padding:32px;color:#94a3b8;font-size:.85rem;border-top:1px solid #e2e8f0;margin-top:48px}
@media(max-width:700px){.content{grid-template-columns:1fr}}` },
        { type: "create_file", filename: "app.js", language: "javascript", content: `const featured=[
  {icon:"🚀",tag:"Tech",title:"10 VS Code Extensions That Boost Productivity",desc:"The must-have extensions every developer should install today.",author:"Sarah K.",date:"Dec 5"},
  {icon:"🎨",tag:"Design",title:"Design Systems in 2024: What Actually Works",desc:"How leading teams build and maintain scalable design systems.",author:"Mike R.",date:"Dec 3"},
  {icon:"💡",tag:"Career",title:"From Junior to Senior in 18 Months",desc:"The mindset shifts and habits that accelerated my career growth.",author:"Alex J.",date:"Nov 30"},
];
const posts=[
  {icon:"⚛️",title:"React Server Components: A Deep Dive",desc:"Understanding RSC from first principles and when to use them.",meta:"Nov 28 · 8 min read"},
  {icon:"🔒",title:"Auth Best Practices for Modern Web Apps",desc:"JWT, sessions, OAuth — which to use and when.",meta:"Nov 25 · 6 min read"},
  {icon:"📊",title:"Database Indexing: The Complete Guide",desc:"Stop guessing and start knowing exactly which indexes to add.",meta:"Nov 22 · 10 min read"},
];
const cats=[{name:"Technology",count:42},{name:"Design",count:28},{name:"Career",count:19},{name:"Tutorials",count:35}];

document.getElementById("featured").innerHTML=featured.map(f=>\`<div class="feat-card"><div class="card-img">\${f.icon}</div><div class="card-body"><span class="tag">\${f.tag}</span><h3>\${f.title}</h3><p>\${f.desc}</p><div class="meta">By \${f.author} · \${f.date}</div></div></div>\`).join("");
document.getElementById("posts").innerHTML=posts.map(p=>\`<div class="post"><div class="post-icon">\${p.icon}</div><div class="post-body"><h3>\${p.title}</h3><p>\${p.desc}</p><div class="meta" style="font-size:.8rem;color:#94a3b8;margin-top:6px">\${p.meta}</div></div></div>\`).join("");
document.getElementById("cats").innerHTML=cats.map(c=>\`<div class="cat-item"><span>\${c.name}</span><span class="cat-count">\${c.count}</span></div>\`).join("");
document.querySelector(".nl-form").addEventListener("submit",e=>{e.preventDefault();alert("🎉 Subscribed! Thanks for joining.");});` },
      ],
    };
  }

  // ── Quiz app ───────────────────────────────────────────────────────────────
  if (/quiz|trivia|test|exam/.test(msg)) {
    return {
      reply: "Created an interactive quiz app with score tracking and results screen. Click Preview to try it!",
      actions: [
        { type: "create_file", filename: "index.html", language: "html", content: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Quiz App</title><link rel="stylesheet" href="style.css"/></head>
<body><div class="app">
  <div id="start-screen" class="screen active"><div class="icon">🧠</div><h1>Knowledge Quiz</h1><p>10 questions · Multiple choice · Track your score</p><button class="btn" id="startBtn">Start Quiz →</button></div>
  <div id="quiz-screen" class="screen"><div class="header"><div class="progress-wrap"><div class="progress-bar" id="progress"></div></div><div class="q-meta"><span id="qNum">1/10</span><span class="score-badge">⭐ <span id="liveScore">0</span></span></div></div>
    <h2 id="question"></h2><div class="options" id="options"></div><button class="btn" id="nextBtn" style="display:none">Next →</button></div>
  <div id="result-screen" class="screen"><div class="icon" id="resultEmoji">🏆</div><h1 id="resultTitle">Amazing!</h1><div class="final-score" id="finalScore"></div><p id="resultMsg"></p><button class="btn" id="restartBtn">Play Again</button></div>
</div><script src="app.js"></script></body></html>` },
        { type: "create_file", filename: "style.css", language: "css", content: `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:linear-gradient(135deg,#1e1b4b 0%,#312e81 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.app{background:#fff;border-radius:24px;padding:40px;max-width:520px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.3)}
.screen{display:none;text-align:center}
.screen.active{display:block}
.icon{font-size:4rem;margin-bottom:16px}
h1{font-size:2rem;font-weight:800;color:#1e1b4b;margin-bottom:12px}
p{color:#64748b;margin-bottom:28px;line-height:1.6}
.btn{background:#6366f1;color:#fff;border:none;padding:14px 32px;border-radius:12px;font-size:1rem;font-weight:600;cursor:pointer;transition:background .2s;width:100%;margin-top:16px}
.btn:hover{background:#4f46e5}
.header{margin-bottom:24px}
.progress-wrap{height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin-bottom:12px}
.progress-bar{height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:4px;transition:width .4s}
.q-meta{display:flex;justify-content:space-between;font-size:.85rem;color:#64748b}
.score-badge{color:#6366f1;font-weight:600}
h2{font-size:1.15rem;font-weight:700;color:#1e1b4b;margin-bottom:20px;text-align:left;line-height:1.5}
.options{display:flex;flex-direction:column;gap:10px}
.option{text-align:left;padding:14px 18px;border:2px solid #e2e8f0;border-radius:12px;font-size:.95rem;cursor:pointer;transition:all .2s;background:#fff;color:#1e293b}
.option:hover:not(:disabled){background:#f0f1ff;border-color:#6366f1}
.option.correct{background:#d1fae5;border-color:#10b981;color:#064e3b}
.option.wrong{background:#fee2e2;border-color:#ef4444;color:#991b1b}
.final-score{font-size:3.5rem;font-weight:800;color:#6366f1;margin:16px 0}` },
        { type: "create_file", filename: "app.js", language: "javascript", content: `const questions=[
  {q:"What does HTML stand for?",opts:["HyperText Markup Language","High Tech Machine Learning","How To Make Links","Hyper Transfer Method Language"],ans:0},
  {q:"Which language runs in a web browser?",opts:["Python","Java","JavaScript","C++"],ans:2},
  {q:"What does CSS stand for?",opts:["Computer Style Sheets","Cascading Style Sheets","Creative Style System","Colorful Style Sheets"],ans:1},
  {q:"Which tag is used for the largest heading in HTML?",opts:["<h6>","<heading>","<h1>","<head>"],ans:2},
  {q:"What is 'null' in JavaScript?",opts:["An undefined variable","An empty string","An intentional absence of value","A number equal to zero"],ans:2},
  {q:"Which CSS property controls text size?",opts:["font-size","text-size","font-style","text-weight"],ans:0},
  {q:"What does API stand for?",opts:["Applied Programming Interface","Application Protocol Internet","Application Programming Interface","Advanced Programming Index"],ans:2},
  {q:"Which of these is NOT a JavaScript framework?",opts:["React","Vue","Angular","Laravel"],ans:3},
  {q:"What symbol denotes comments in JavaScript?",opts:["//","##","--","**"],ans:0},
  {q:"Which HTTP method is used to send form data?",opts:["GET","DELETE","PUT","POST"],ans:3},
];
let cur=0,score=0,answered=false;
const startScreen=document.getElementById("start-screen");
const quizScreen=document.getElementById("quiz-screen");
const resultScreen=document.getElementById("result-screen");
function showQ(){const q=questions[cur];document.getElementById("question").textContent=q.q;document.getElementById("qNum").textContent=\`\${cur+1}/\${questions.length}\`;document.getElementById("progress").style.width=\`\${(cur/questions.length)*100}%\`;document.getElementById("nextBtn").style.display="none";answered=false;const opts=document.getElementById("options");opts.innerHTML=q.opts.map((o,i)=>\`<button class="option" onclick="pick(this,\${i})">\${o}</button>\`).join("");}
function pick(btn,i){if(answered)return;answered=true;const q=questions[cur];if(i===q.ans){btn.classList.add("correct");score++;}else{btn.classList.add("wrong");document.querySelectorAll(".option")[q.ans].classList.add("correct");}document.querySelectorAll(".option").forEach(b=>b.disabled=true);document.getElementById("liveScore").textContent=score;document.getElementById("nextBtn").style.display="block";}
document.getElementById("startBtn").onclick=()=>{startScreen.classList.remove("active");quizScreen.classList.add("active");showQ();};
document.getElementById("nextBtn").onclick=()=>{cur++;if(cur<questions.length)showQ();else showResult();};
function showResult(){quizScreen.classList.remove("active");resultScreen.classList.add("active");const pct=Math.round((score/questions.length)*100);document.getElementById("finalScore").textContent=\`\${score}/\${questions.length}\`;document.getElementById("resultEmoji").textContent=pct>=80?"🏆":pct>=60?"🎉":"💪";document.getElementById("resultTitle").textContent=pct>=80?"Excellent!":pct>=60?"Good Job!":"Keep Practicing!";document.getElementById("resultMsg").textContent=\`You scored \${pct}%. \${pct>=80?"You're a trivia master!":pct>=60?"Solid performance!":"Study up and try again!"}\`;}
document.getElementById("restartBtn").onclick=()=>{cur=0;score=0;resultScreen.classList.remove("active");quizScreen.classList.add("active");showQ();};` },
      ],
    };
  }

  // ── Login / auth form ─────────────────────────────────────────────────────
  if (/login|sign.?in|sign.?up|register|auth|account/.test(msg)) {
    return {
      reply: "Created a polished login/signup page with tabbed form switching. Click Preview to see it!",
      actions: [
        { type: "create_file", filename: "index.html", language: "html", content: `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Sign In</title><link rel="stylesheet" href="style.css"/></head>
<body><div class="container">
<div class="card"><div class="logo">🔐</div><h1>Welcome back</h1>
<div class="tabs"><button class="tab active" data-tab="login">Sign In</button><button class="tab" data-tab="signup">Sign Up</button></div>
<form id="login" class="form active">
  <label>Email<input type="email" placeholder="you@example.com" required/></label>
  <label>Password<input type="password" placeholder="Your password" required/></label>
  <div class="remember"><label><input type="checkbox"/> Remember me</label><a href="#">Forgot password?</a></div>
  <button class="btn" type="submit">Sign In</button>
  <div class="divider"><span>or</span></div>
  <button class="btn btn-github" type="button">🐙 Continue with GitHub</button>
  <button class="btn btn-google" type="button">🔵 Continue with Google</button>
</form>
<form id="signup" class="form">
  <label>Full Name<input type="text" placeholder="John Doe" required/></label>
  <label>Email<input type="email" placeholder="you@example.com" required/></label>
  <label>Password<input type="password" placeholder="Min. 8 characters" required/></label>
  <label>Confirm Password<input type="password" placeholder="Repeat password" required/></label>
  <button class="btn" type="submit">Create Account</button>
</form></div></div>
<script src="app.js"></script></body></html>` },
        { type: "create_file", filename: "style.css", language: "css", content: `*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.container{width:100%;max-width:400px}
.card{background:#fff;border-radius:20px;padding:36px;box-shadow:0 24px 64px rgba(0,0,0,.3)}
.logo{font-size:2.5rem;text-align:center;margin-bottom:8px}
h1{font-size:1.5rem;font-weight:700;text-align:center;margin-bottom:24px;color:#1e1b4b}
.tabs{display:flex;background:#f1f5f9;border-radius:10px;padding:4px;margin-bottom:24px}
.tab{flex:1;padding:9px;border:none;background:none;border-radius:8px;font-size:.9rem;font-weight:500;cursor:pointer;color:#64748b;transition:all .2s}
.tab.active{background:#fff;color:#1e1b4b;box-shadow:0 1px 4px rgba(0,0,0,.12)}
.form{display:none;flex-direction:column;gap:14px}
.form.active{display:flex}
label{font-size:.85rem;font-weight:600;color:#374151;display:flex;flex-direction:column;gap:6px}
input[type=text],input[type=email],input[type=password]{padding:12px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:.95rem;transition:border-color .2s;font-family:inherit}
input:focus{outline:none;border-color:#6366f1}
.remember{display:flex;justify-content:space-between;align-items:center;font-size:.85rem;font-weight:400}
.remember label{flex-direction:row;gap:6px;align-items:center;cursor:pointer}
.remember a{color:#6366f1;text-decoration:none}
.btn{padding:13px;border:none;border-radius:10px;font-size:.95rem;font-weight:600;cursor:pointer;transition:background .2s;background:#6366f1;color:#fff}
.btn:hover{background:#4f46e5}
.divider{display:flex;align-items:center;gap:12px;margin:2px 0}
.divider::before,.divider::after{content:'';flex:1;height:1px;background:#e5e7eb}
.divider span{font-size:.8rem;color:#9ca3af}
.btn-github{background:#24292e;color:#fff}
.btn-github:hover{background:#1a1e22}
.btn-google{background:#fff;color:#374151;border:2px solid #e5e7eb}
.btn-google:hover{background:#f9fafb}` },
        { type: "create_file", filename: "app.js", language: "javascript", content: `document.querySelectorAll(".tab").forEach(tab=>{
  tab.addEventListener("click",()=>{
    document.querySelectorAll(".tab,.form").forEach(el=>el.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.add("active");
  });
});
document.getElementById("login").addEventListener("submit",e=>{e.preventDefault();alert("✅ Logged in! (Connect to a real backend to authenticate users.)");});
document.getElementById("signup").addEventListener("submit",e=>{e.preventDefault();alert("🎉 Account created! (Connect to a real backend to save users.)");});` },
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

  // ── Existing files: add-feature or smart default (BEFORE generic create) ───
  if (existingFiles.length > 0) {
    const fileNames = existingFiles.map(f => f.name).join(", ");
    const hasHtml = existingFiles.some(f => f.name.endsWith(".html"));
    const hasTs   = existingFiles.some(f => f.name.endsWith(".ts") || f.name.endsWith(".tsx"));
    const hasPy   = existingFiles.some(f => f.name.endsWith(".py"));

    // "add/make/give/include X" = add a feature to the existing project
    if (/\b(add|give|include|attach|append|put)\b/.test(msg) ||
        (/\bmake\b/.test(msg) && !/\b(make a|make an|make me a|make me an)\b/.test(msg))) {
      return {
        reply: `Got it — you want to add something to your project (**${fileNames}**). Tell me more specifically, for example:\n• "Add a dark mode toggle"\n• "Add location search to the weather app"\n• "Add a contact form"\n• "Add animations to the buttons"\n\nI'll edit the files directly!`,
        actions: [],
      };
    }

    if (!hasHtml && (hasTs || hasPy)) {
      const lang = hasTs ? "TypeScript" : "Python";
      return {
        reply: `Your project has: **${fileNames}**\n\nThis looks like a **${lang}** project. It can't be previewed directly (no \`index.html\`), but I can:\n• **"Add a function that..."** — write new code\n• **"Create a REST API"** — build Express/Fastify endpoints\n• **"Create a web frontend"** — add HTML/CSS/JS so you can preview it\n• **"Fix the error in..."** — debug issues\n\nWhat would you like me to do?`,
        actions: [],
      };
    }

    return {
      reply: `Your project has: **${fileNames}**\n\nHere's what I can do:\n• **"Redesign"** — improve the look and layout\n• **"Make it dark mode"** — switch to a dark theme\n• **"Add a contact form"** — add a new section\n• **"Change colors to blue"** — restyle with a different palette\n• **"Add animations"** — make it more dynamic\n\nOr describe exactly what you want changed!`,
      actions: [],
    };
  }

  // ── Generic create intent (only when project has no files yet) ─────────────
  const hasCreateVerb = /create|build|make|generate|write|new|start/.test(msg);
  const hasHtmlFile = /\.html/.test(msg);
  const hasWebHint = /website|site|app|page|web/.test(msg);

  if (hasCreateVerb || hasHtmlFile || hasWebHint) {
    return {
      reply: "Created a starter HTML/CSS/JS project. Click **Preview** to see it live, then tell me what to change!",
      actions: [
        { type: "create_file", filename: "index.html", language: "html", content: `<!DOCTYPE html>
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
    <p>Your starter project is ready. Click <strong>Preview</strong> above to see it live.</p>
    <button id="btn">Click me</button>
    <p id="msg"></p>
  </main>
  <script src="app.js"></script>
</body>
</html>` },
        { type: "create_file", filename: "style.css", language: "css", content: `* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }
main { background: #fff; border-radius: 20px; text-align: center; padding: 48px 40px; box-shadow: 0 20px 60px rgba(0,0,0,.2); max-width: 480px; width: 90%; }
h1 { font-size: 2rem; margin-bottom: 12px; color: #1e293b; }
p { color: #64748b; margin-bottom: 24px; line-height: 1.6; }
button { padding: 12px 28px; background: #6366f1; color: #fff; border: none; border-radius: 10px; font-size: 1rem; cursor: pointer; transition: background .2s; }
button:hover { background: #4f46e5; }
#msg { margin-top: 16px; font-weight: 600; color: #6366f1; min-height: 24px; }` },
        { type: "create_file", filename: "app.js", language: "javascript", content: `document.getElementById("btn").addEventListener("click", () => {
  document.getElementById("msg").textContent = "It works! 🚀 Now describe what you want to build.";
});` },
      ],
    };
  }

  // No files yet — suggest building something
  return {
    reply: `I can build full web apps for you! Try:\n• "Create a weather app"\n• "Build a todo list"\n• "Make a portfolio website"\n• "Create a landing page"\n• "Build a quiz app"\n• "Create a login page"\n• "Make a 3-page website"\n• "Build a calculator"\n\nOr describe what you want and I'll build it!`,
    actions: [],
  };
}

export default router;
