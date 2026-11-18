import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/reader.css";

document.documentElement.classList.toggle(
  "dark",
  matchMedia("(prefers-color-scheme: dark)").matches,
);
const root = document.getElementById("root");
if (!root) throw new Error("리더 화면을 초기화하지 못했습니다.");

createRoot(root).render(<App />);
