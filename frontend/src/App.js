import "@/App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import Landing from "@/pages/Landing";
import Onboarding from "@/pages/Onboarding";
import Swipe from "@/pages/Swipe";
import Tracker from "@/pages/Tracker";
import Profile from "@/pages/Profile";
import Settings from "@/pages/Settings";
import People from "@/pages/People";
import Emails from "@/pages/Emails";
import Interviews from "@/pages/Interviews";
import Improve from "@/pages/Improve";
import History from "@/pages/History";
import AuthCallback from "@/pages/AuthCallback";
import ProtectedRoute from "@/components/ProtectedRoute";
import BottomNav from "@/components/BottomNav";

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route path="/swipe" element={<ProtectedRoute requireProfile><Swipe /></ProtectedRoute>} />
        <Route path="/interviews" element={<ProtectedRoute requireProfile><Interviews /></ProtectedRoute>} />
        <Route path="/improve" element={<ProtectedRoute requireProfile><Improve /></ProtectedRoute>} />
        <Route path="/people" element={<ProtectedRoute requireProfile><People /></ProtectedRoute>} />
        <Route path="/tracker" element={<ProtectedRoute requireProfile><Tracker /></ProtectedRoute>} />
        <Route path="/emails" element={<ProtectedRoute requireProfile><Emails /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute requireProfile><Profile /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute requireProfile><History /></ProtectedRoute>} />
      </Routes>
      <BottomNav />
    </>
  );
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <AppRouter />
          <Toaster position="top-center" richColors theme="dark" />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
