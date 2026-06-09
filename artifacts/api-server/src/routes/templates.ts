import { Router } from "express";

const router = Router();

const templates = [
  {
    id: "nodejs-express",
    name: "Node.js + Express",
    description: "A minimal Express web server with REST API setup",
    language: "javascript",
    icon: null,
    tags: ["backend", "nodejs", "api"],
  },
  {
    id: "react-vite",
    name: "React + Vite",
    description: "Modern React app with Vite bundler and hot reload",
    language: "javascript",
    icon: null,
    tags: ["frontend", "react", "web"],
  },
  {
    id: "typescript-starter",
    name: "TypeScript",
    description: "Clean TypeScript project with strict mode and modern config",
    language: "typescript",
    icon: null,
    tags: ["typescript", "starter"],
  },
  {
    id: "python-flask",
    name: "Python + Flask",
    description: "Python Flask web application with basic routing",
    language: "python",
    icon: null,
    tags: ["backend", "python", "flask"],
  },
  {
    id: "python-fastapi",
    name: "Python + FastAPI",
    description: "Fast async Python API with automatic OpenAPI docs",
    language: "python",
    icon: null,
    tags: ["backend", "python", "api"],
  },
  {
    id: "rust-starter",
    name: "Rust",
    description: "Rust project with Cargo setup and hello world",
    language: "rust",
    icon: null,
    tags: ["systems", "rust"],
  },
  {
    id: "go-starter",
    name: "Go",
    description: "Go module with basic HTTP server setup",
    language: "go",
    icon: null,
    tags: ["backend", "go"],
  },
  {
    id: "html-css-js",
    name: "HTML / CSS / JS",
    description: "Simple static web page — no build tools needed",
    language: "html",
    icon: null,
    tags: ["frontend", "static", "beginner"],
  },
  {
    id: "blank",
    name: "Blank Project",
    description: "Start from scratch with an empty project",
    language: "javascript",
    icon: null,
    tags: ["blank", "starter"],
  },
];

router.get("/templates", (_req, res) => {
  res.json(templates);
});

export default router;
