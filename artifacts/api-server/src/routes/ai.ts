import { Router } from "express";
import { db } from "@workspace/db";
import { filesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AiChatParams, AiChatBody } from "@workspace/api-zod";

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
      aiResult = generateAgenticFallback(message, existingFiles, currentFile ?? null);
    } else {
      aiResult = await callOpenAI(systemPrompt, message, imageUrl, existingFiles, currentFile ?? null);
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

    return res.json({
      reply:           aiResult.reply,
      actions:         executedActions,
      codeBlocks:      [],
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[AI Route Error]", errorMessage);
    
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
    // Web
    js: "javascript", jsx: "javascript", mjs: "javascript",
    ts: "typescript", tsx: "typescript", mts: "typescript",
    html: "html", htm: "html",
    css: "css", scss: "scss", sass: "sass", less: "less",
    
    // Backend
    py: "python", pyw: "python",
    rs: "rust",
    go: "go",
    java: "java",
    cpp: "cpp", cc: "cpp", cxx: "cpp",
    c: "c",
    php: "php",
    rb: "ruby",
    sh: "shell", bash: "bash", zsh: "zsh",
    
    // Data & Config
    json: "json", jsonc: "json",
    yaml: "yaml", yml: "yaml",
    xml: "xml",
    toml: "toml",
    ini: "ini",
    csv: "csv",
    
    // Markup & Docs
    md: "markdown", markdown: "markdown",
    mdx: "markdown",
    tex: "latex",
    
    // Other
    sql: "sql",
    graphql: "graphql", gql: "graphql",
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
      console.error("[OpenAI Error]", response.status, errorData);
      return generateAgenticFallback(message, existingFiles, currentFile);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    let raw = data.choices[0]?.message?.content ?? "{}";
    
    // Strip ```json ... ``` or ``` ... ``` fences some models add despite json_object mode
    raw = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    
    try {
      const parsed = JSON.parse(raw);
      
      // Validate response structure
      if (!parsed.reply || typeof parsed.reply !== "string") {
        console.warn("[AI Validation] Missing or invalid reply field");
        return generateAgenticFallback(message, existingFiles, currentFile);
      }
      
      if (!Array.isArray(parsed.actions)) {
        console.warn("[AI Validation] Actions is not an array");
        parsed.actions = [];
      }
      
      // Validate each action
      for (const action of parsed.actions) {
        if (!action.type || !action.filename) {
          console.warn("[AI Validation] Invalid action structure", action);
          continue;
        }
      }
      
      return {
        reply: String(parsed.reply),
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      };
    } catch (parseErr) {
      console.error("[JSON Parse Error]", parseErr);
      return generateAgenticFallback(message, existingFiles, currentFile);
    }
  } catch (fetchErr) {
    console.error("[Fetch Error]", fetchErr);
    return generateAgenticFallback(message, existingFiles, currentFile);
  }
}

/**
 * Smart offline fallback — handles common intents when AI is unavailable
 */
function generateAgenticFallback(
  message: string,
  existingFiles: Array<{ id: number; name: string; content?: string | null }>,
  currentFile: string | null,
): AIResult {
  const msg = message.toLowerCase().trim();

  // ── Greeting / health check
  if (
    /^(hi|hello|hey|yo|sup|howdy|hola|test|ping)[\s!?.,]*$/.test(msg) ||
    /are you (working|there|alive|ok|online|ready)/.test(msg) ||
    msg === "test" || msg === "?" || /^how are you/.test(msg)
  ) {
    return {
      reply: `✅ I'm working! I'm your AI coding assistant. I can create, edit, and delete files in your project. Try asking me to build a weather app, todo list, portfolio site, or anything else!`,
      actions: [],
    };
  }

  // ── Help / capabilities
  if (/what can you (do|make|build|create)|help|capabilities|features/.test(msg)) {
    return {
      reply: `I can create and edit full web projects! Try:\n• "Create a weather app"\n• "Build a todo list"\n• "Make a portfolio website"\n• "Create a landing page"\n• "Build a quiz app"\n\nWhat would you like to build?`,
      actions: [],
    };
  }

  // ── Delete intent
  if (
    /\b(delete|remove)\b/.test(msg) &&
    !/you (deleted|removed)|(was|got|been) (deleted|removed)|already deleted/.test(msg)
  ) {
    for (const f of existingFiles) {
      if (msg.includes(f.name.toLowerCase())) {
        return { 
          reply: `Deleting ${f.name}.`, 
          actions: [{ type: "delete_file", filename: f.name }] 
        };
      }
    }
    return {
      reply: `Which file would you like to delete? I can see: ${existingFiles.map(f => f.name).join(", ") || "no files yet"}.`,
      actions: [],
    };
  }

  // ── Question / help request
  if (/^(what|why|how|when|where|who|is|does|can|will|should|did)\b/.test(msg)) {
    return {
      reply: `I can help! Your project has: ${existingFiles.map(f => f.name).join(", ") || "no files yet"}. What would you like me to do?`,
      actions: [],
    };
  }

  // ── Generic fallback
  if (existingFiles.length > 0) {
    return {
      reply: `Your project has: ${existingFiles.map(f => f.name).join(", ")}. What would you like me to change or add?`,
      actions: [],
    };
  }

  return {
    reply: `I can build web projects! Try: "Create a weather app", "Build a todo list", or "Make a portfolio website". What would you like to build?`,
    actions: [],
  };
}

export default router;
