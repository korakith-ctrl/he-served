import React from "react";
import ReactDOM from "react-dom/client";
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
const isRecompApp = window.location.pathname === "/recomp" || window.location.pathname.startsWith("/recomp/");
const SelectedApp = React.lazy(() => isRecompApp ? import("./health/HealthApp.jsx") : import("./App.jsx"));

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <SelectedApp />
    </React.Suspense>
  </React.StrictMode>
);
