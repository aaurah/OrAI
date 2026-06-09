import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply saved theme before first render to prevent flash of wrong theme
(function initTheme() {
  const saved = localStorage.getItem("theme");
  const root = document.documentElement;
  if (saved === "dark") {
    root.classList.add("dark");
  } else if (saved === "light") {
    root.classList.remove("dark");
  } else {
    root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
})();

createRoot(document.getElementById("root")!).render(<App />);
