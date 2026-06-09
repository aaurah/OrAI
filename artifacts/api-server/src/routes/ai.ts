import { Router } from "express";
import { AiChatParams, AiChatBody } from "@workspace/api-zod";

const router = Router();

const OPENAI_BASE = process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

router.post("/projects/:id/ai/chat", async (req, res) => {
  const paramsParsed = AiChatParams.safeParse({ id: Number(req.params.id) });
  if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });
  const bodyParsed = AiChatBody.safeParse(req.body);
  if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.message });

  const { message, context, currentFile } = bodyParsed.data;

  const systemPrompt = [
    "You are an expert programming assistant embedded in a cloud IDE.",
    "Help the user write, debug, and improve their code.",
    "When providing code examples, always use fenced code blocks with the language specified.",
    "Format: ```language\ncode here\n```",
    "Be concise, practical, and direct.",
    currentFile ? `The user is currently editing: ${currentFile}` : "",
  ].filter(Boolean).join("\n");

  const userContent = context
    ? `Context from file:\n\`\`\`\n${context}\n\`\`\`\n\nUser question: ${message}`
    : message;

  try {
    if (!OPENAI_KEY) {
      const fallback = generateFallbackResponse(message);
      return res.json(fallback);
    }

    const response = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const fallback = generateFallbackResponse(message);
      return res.json(fallback);
    }

    const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
    const reply = data.choices[0]?.message?.content ?? "";
    const codeBlocks = extractCodeBlocks(reply);
    return res.json({ reply, codeBlocks });
  } catch {
    const fallback = generateFallbackResponse(message);
    return res.json(fallback);
  }
});

function extractCodeBlocks(text: string): Array<{ language: string; code: string; filename: string | null }> {
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  const blocks: Array<{ language: string; code: string; filename: string | null }> = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1] || "plaintext",
      code: match[2].trim(),
      filename: null,
    });
  }
  return blocks;
}

function generateFallbackResponse(message: string): { reply: string; codeBlocks: Array<{ language: string; code: string; filename: string | null }> } {
  const lower = message.toLowerCase();

  if (lower.includes("hello") || lower.includes("hi")) {
    return {
      reply: "Hello! I'm your AI coding assistant. I can help you write code, debug issues, explain concepts, or suggest improvements. What would you like to work on?",
      codeBlocks: [],
    };
  }

  if (lower.includes("sort") || lower.includes("algorithm")) {
    return {
      reply: "Here's an efficient sorting example using QuickSort:",
      codeBlocks: [{
        language: "javascript",
        code: `function quickSort(arr) {\n  if (arr.length <= 1) return arr;\n  const pivot = arr[Math.floor(arr.length / 2)];\n  const left = arr.filter(x => x < pivot);\n  const middle = arr.filter(x => x === pivot);\n  const right = arr.filter(x => x > pivot);\n  return [...quickSort(left), ...middle, ...quickSort(right)];\n}\n\nconsole.log(quickSort([3, 1, 4, 1, 5, 9, 2, 6]));`,
        filename: null,
      }],
    };
  }

  if (lower.includes("function") || lower.includes("example")) {
    return {
      reply: "Here's a practical example to get you started:",
      codeBlocks: [{
        language: "javascript",
        code: `async function fetchData(url) {\n  try {\n    const response = await fetch(url);\n    if (!response.ok) throw new Error(\`HTTP error: \${response.status}\`);\n    return await response.json();\n  } catch (error) {\n    console.error('Fetch failed:', error);\n    throw error;\n  }\n}`,
        filename: null,
      }],
    };
  }

  return {
    reply: `I understand you're asking about: "${message}". To provide the most helpful response, could you share the code you're working with? You can paste it directly in the chat and I'll help you analyze, debug, or improve it.`,
    codeBlocks: [],
  };
}

export default router;
