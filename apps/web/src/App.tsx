import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DailyReport } from "./pages/DailyReport";
import { KanbanBoard } from "./pages/KanbanBoard";
import { GoalDetail } from "./pages/GoalDetail";
import { Agents } from "./pages/Agents";
import { History } from "./pages/History";
import { Executions } from "./pages/Executions";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DailyReport />} />
        <Route path="/kanban" element={<KanbanBoard />} />
        <Route path="/kanban/:goalId" element={<GoalDetail />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/execucoes" element={<Executions />} />
        <Route path="/historico" element={<History />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
