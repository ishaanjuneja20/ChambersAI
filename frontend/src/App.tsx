import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Home from "./pages/Home";
import LawyerRecommendation from "./pages/LawyerRecommendation";
import Consultation from "./pages/Consultation";
import MyConsultations from "./pages/MyConsultations";
import CaseSummary from "./pages/CaseSummary";
import Profile from "./pages/Profile";
import DocumentUpload from "./pages/DocumentUpload";

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/recommendation" element={<ProtectedRoute><LawyerRecommendation /></ProtectedRoute>} />
          <Route path="/consultation" element={<ProtectedRoute><Consultation /></ProtectedRoute>} />
          <Route path="/consultations" element={<ProtectedRoute><MyConsultations /></ProtectedRoute>} />
          <Route path="/case-summary" element={<ProtectedRoute><CaseSummary /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
          <Route path="/documents" element={<ProtectedRoute><DocumentUpload /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
