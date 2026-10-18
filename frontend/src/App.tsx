import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import IntroSplash from "./components/IntroSplash";
import ProtectedShellLayout from "./components/ProtectedShellLayout";
import { AuthProvider } from "./context/AuthContext";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Home from "./pages/Home";
import LawyerProfile from "./pages/LawyerProfile";
import NewConsultation from "./pages/NewConsultation";
import MyConsultations from "./pages/MyConsultations";
import Profile from "./pages/Profile";
import Meet from "./pages/Meet";
import Chat from "./pages/Chat";

export default function App() {
  const [introVisible, setIntroVisible] = useState(true);

  useEffect(() => {
    const onVisibility = () => {
      document.body.classList.toggle("tab-hidden", document.hidden);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
        {introVisible && <IntroSplash onDone={() => setIntroVisible(false)} />}
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route element={<ProtectedShellLayout />}>
            <Route path="/home" element={<Home />} />
            <Route path="/lawyers/:id" element={<LawyerProfile />} />
            <Route path="/consultation/new" element={<NewConsultation />} />
            <Route path="/consultation/meet/:id" element={<Meet />} />
            <Route path="/consultation/chat/:id" element={<Chat />} />
            <Route path="/consultations" element={<MyConsultations />} />
            <Route path="/profile" element={<Profile />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
