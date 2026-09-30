import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./browser";
import App from "./App";
import "./desktop.css";
import "./components/WorkflowUI.css";
import { WorkspaceErrorBoundary } from "./components/WorkspaceRecovery";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceErrorBoundary>
      <App />
    </WorkspaceErrorBoundary>
  </React.StrictMode>,
);
