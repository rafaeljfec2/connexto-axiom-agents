import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DailyReport } from "./pages/DailyReport";
import { KanbanBoard } from "./pages/KanbanBoard";
import { Agents } from "./pages/Agents";
import { History } from "./pages/History";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DailyReport />} />
        <Route path="/kanban" element={<KanbanBoard />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/historico" element={<History />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
