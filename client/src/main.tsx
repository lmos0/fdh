import { createRoot } from "react-dom/client";
import App from "./App";
import { CardsPage } from "./screens/CardsPage";
import { initializeTheme } from "./theme";
import { initializeSound } from "./audio/player";
import "./styles.css";

initializeTheme();
initializeSound();
createRoot(document.getElementById("root")!).render(location.pathname.replace(/\/$/, "") === "/cards" ? <CardsPage /> : <App />);
