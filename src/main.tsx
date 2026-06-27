import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

document.addEventListener("contextmenu", event => event.preventDefault());
document.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();
  if (event.ctrlKey && key === "f") {
    event.preventDefault();
    window.dispatchEvent(new Event("minedock-find"));
  }
  if (
    event.key === "F12" ||
    (event.ctrlKey && ["r", "p", "s", "u"].includes(key)) ||
    (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key)) ||
    (event.altKey && ["arrowleft", "arrowright"].includes(key))
  ) {
    event.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
