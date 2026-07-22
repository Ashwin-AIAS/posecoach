import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import App from "./App"
import { getRecoveryRoute } from "./components/RecoveryRoutes"
import "./index.css"

const rootEl = document.getElementById("root")
if (rootEl === null) {
  throw new Error("Missing #root element")
}
// P33: the standalone recovery pages own their real URLs; every other path
// renders the normal app, byte-for-byte unchanged.
const recoveryPage = getRecoveryRoute(window.location.pathname)
createRoot(rootEl).render(<StrictMode>{recoveryPage ?? <App />}</StrictMode>)
