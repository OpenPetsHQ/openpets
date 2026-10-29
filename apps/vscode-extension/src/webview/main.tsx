import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { WebviewBackend } from "./backend.js";
import "./main.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing OpenPets root.");
createRoot(root).render(<App backend={new WebviewBackend()} />);
