import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Cloudflare's bundled client transform currently emits classic JSX calls for
// some shared components. Keep the React global available at runtime.
globalThis.React = React;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
