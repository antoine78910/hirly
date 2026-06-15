import "@/App.css";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import Landing from "@/pages/Landing";
import Signup from "@/pages/Signup";
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
import Feedback from "@/pages/Feedback";
import Credits from "@/pages/Credits";
import Referral from "@/pages/Referral";
import AuthCallback from "@/pages/AuthCallback";
import AdminApplications from "@/pages/AdminApplications";
import AdminApplicationDetail from "@/pages/AdminApplicationDetail";
import AdminOverview from "@/pages/AdminOverview";
import AdminUsers from "@/pages/AdminUsers";
import AdminUserDetail from "@/pages/AdminUserDetail";
import AdminAnalytics from "@/pages/AdminAnalytics";
import Training from "@/pages/Training";
import TrainingCourse from "@/pages/TrainingCourse";
import TrainingCreator from "@/pages/TrainingCreator";
import ProtectedRoute from "@/components/ProtectedRoute";
import BottomNav from "@/components/BottomNav";
import AppScrollLock from "@/components/app/AppScrollLock";
import { demoMode, devBypassAuth } from "@/lib/dev";

function AppRoute({ children, requireProfile = false }) {
  if (devBypassAuth) return children;
  return <ProtectedRoute requireProfile={requireProfile}>{children}</ProtectedRoute>;
}

function shouldShowBottomNav(pathname) {
  if (pathname === "/" || pathname === "/auth/callback") return false;
  if (pathname === "/signup") return false;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return false;
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return false;
  if (pathname === "/credits" || pathname === "/referral") return false;
  if (pathname.startsWith("/training/creator")) return false;
  return true;
}

function AppRouter() {
  const location = useLocation();
  const showBottomNav = shouldShowBottomNav(location.pathname);
  const showDemoBanner = demoMode && location.pathname !== "/" && location.pathname !== "/auth/callback";

  return (
    <>
      {showDemoBanner ? (
        <div className="fixed inset-x-0 top-0 z-[100] bg-amber-400 px-4 py-2 text-center text-xs font-bold text-zinc-950 shadow-md">
          Demo mode active — backend API calls are mocked
        </div>
      ) : null}
      {showBottomNav ? <AppScrollLock /> : null}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/admin" element={<AppRoute><Navigate to="/admin/overview" replace /></AppRoute>} />
        <Route path="/admin/overview" element={<AppRoute><AdminOverview /></AppRoute>} />
        <Route path="/admin/applications" element={<AppRoute><AdminApplications /></AppRoute>} />
        <Route path="/admin/applications/:id" element={<AppRoute><AdminApplicationDetail /></AppRoute>} />
        <Route path="/admin/users" element={<AppRoute><AdminUsers /></AppRoute>} />
        <Route path="/admin/users/:userId" element={<AppRoute><AdminUserDetail /></AppRoute>} />
        <Route path="/admin/analytics" element={<AppRoute><AdminAnalytics /></AppRoute>} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/swipe" element={<AppRoute requireProfile><Swipe /></AppRoute>} />
        <Route path="/feedback" element={<AppRoute><Feedback /></AppRoute>} />
        <Route path="/interviews" element={<AppRoute requireProfile><Interviews /></AppRoute>} />
        <Route path="/improve" element={<AppRoute requireProfile><Improve /></AppRoute>} />
        <Route path="/people" element={<AppRoute requireProfile><People /></AppRoute>} />
        <Route path="/tracker" element={<AppRoute requireProfile><Tracker /></AppRoute>} />
        <Route path="/emails" element={<AppRoute requireProfile><Emails /></AppRoute>} />
        <Route path="/profile" element={<AppRoute><Profile /></AppRoute>} />
        <Route path="/credits" element={<AppRoute><Credits /></AppRoute>} />
        <Route path="/referral" element={<AppRoute><Referral /></AppRoute>} />
        <Route path="/settings" element={<AppRoute><Settings /></AppRoute>} />
        <Route path="/history" element={<AppRoute requireProfile><History /></AppRoute>} />
        <Route path="/training" element={<AppRoute><Training /></AppRoute>} />
        <Route path="/training/creator" element={<AppRoute><TrainingCreator /></AppRoute>} />
        <Route path="/training/:courseId" element={<AppRoute><TrainingCourse /></AppRoute>} />
      </Routes>
      {showBottomNav ? <BottomNav /> : null}
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
