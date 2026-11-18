import { createRoot } from "react-dom/client";
import { App } from "./Reader";
import "./style.css";

document.documentElement.classList.toggle("dark", matchMedia("(prefers-color-scheme: dark)").matches);
createRoot(document.getElementById("root")!).render(<App />);
