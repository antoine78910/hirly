import "@/App.css";
import { BrowserRouter, Navigate, Routes, Route, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import { UpgradeModalProvider } from "@/context/UpgradeModalContext";
import { AppLocaleProvider } from "@/context/AppLocaleContext";
import Terms from "@/pages/legal/Terms";
import Privacy from "@/pages/legal/Privacy";
import Landing from "@/pages/Landing";
import { LANDING_CONTRACT_PATH_SLUGS } from "@/lib/landingHeroCopy";
import Blog from "@/pages/seo/Blog";
import BlogPost from "@/pages/seo/BlogPost";
import Compare from "@/pages/seo/Compare";
import ForProfile from "@/pages/seo/ForProfile";
import HowItWorks from "@/pages/seo/HowItWorks";
import UseCases from "@/pages/seo/UseCases";
import Signup from "@/pages/Signup";
import SignIn from "@/pages/SignIn";
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
import Review from "@/pages/Review";
import Feedback from "@/pages/Feedback";
import Billing from "@/pages/Billing";
import Referral from "@/pages/Referral";
import AuthCallback from "@/pages/AuthCallback";
import AdminApplications from "@/pages/AdminApplications";
import AdminApplicationDetail from "@/pages/AdminApplicationDetail";
import AdminOverview from "@/pages/AdminOverview";
import AdminUsers from "@/pages/AdminUsers";
import AdminUserDetail from "@/pages/AdminUserDetail";
import AdminAnalytics from "@/pages/AdminAnalytics";
import AdminInfluencers from "@/pages/AdminInfluencers";
import AdminCreators from "@/pages/AdminCreators";
import AdminTraining from "@/pages/AdminTraining";
import AdminFeatures from "@/pages/AdminFeatures";
import InviteLanding from "@/pages/InviteLanding";
import Training from "@/pages/Training";
import TrainingCourse from "@/pages/TrainingCourse";
import TrainingCreator from "@/pages/TrainingCreator";
import TrainingLayout from "@/components/training/TrainingLayout";
import TrainingLayoutDefault from "@/components/training/TrainingLayoutDefault";
import TrainingLegacyRedirect from "@/components/training/TrainingLegacyRedirect";
import TrainingAccessGate from "@/components/training/TrainingAccessGate";
import TrainingErrorBoundary from "@/components/training/TrainingErrorBoundary";
import ProtectedRoute from "@/components/ProtectedRoute";
import DomainRouter from "@/components/DomainRouter";
import AdminRoute from "@/components/AdminRoute";
import BottomNav from "@/components/BottomNav";
import AppLayout from "@/components/desktop/AppLayout";
import ScrollManager from "@/components/app/ScrollManager";
import RecordTools from "@/pages/RecordTools";
import { devBypassAuth } from "@/lib/dev";
import { isTrainingRoute } from "@/lib/trainingRoutes";
import { needsOAuthCallbackRedirect } from "@/lib/oauthCallback";

function AppRoute({ children, requireProfile = false }) {
  if (devBypassAuth) return children;
  return <ProtectedRoute requireProfile={requireProfile}>{children}</ProtectedRoute>;
}

function TrainingRoute({ children, localized = false }) {
  const layout = localized ? TrainingLayout : TrainingLayoutDefault;
  const Layout = layout;
  return (
    <TrainingErrorBoundary>
      <TrainingAccessGate>
        <Layout>{children}</Layout>
      </TrainingAccessGate>
    </TrainingErrorBoundary>
  );
}

function isTrainingRoutePath(pathname) {
  return isTrainingRoute(pathname);
}

function shouldShowBottomNav(pathname) {
  if (pathname === "/" || pathname === "/auth/callback") return false;
  if (LANDING_CONTRACT_PATH_SLUGS.some((slug) => pathname === `/${slug}`)) return false;
  if (pathname === "/signup" || pathname === "/signin") return false;
  if (pathname.startsWith("/invite/")) return false;
  if (pathname === "/how-it-works" || pathname === "/use-cases") return false;
  if (pathname.startsWith("/blog") || pathname.startsWith("/compare") || pathname.startsWith("/for/")) return false;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return false;
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return false;
  if (pathname === "/terms" || pathname === "/privacy") return false;
  if (pathname === "/billing" || pathname === "/referral") return false;
  if (isTrainingRoutePath(pathname)) return false;
  if (pathname === "/record-tools") return false;
  return true;
}

function AdminPage({ children }) {
  return (
    <AppRoute>
      <AdminRoute>{children}</AdminRoute>
    </AppRoute>
  );
}

function CreditsRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const checkout = params.get("checkout");
  const sessionId = params.get("session_id");
  if (checkout === "success" || checkout === "cancelled") {
    const nextParams = new URLSearchParams({ upgrade: checkout });
    if (sessionId) nextParams.set("session_id", sessionId);
    return <Navigate to={`/swipe?${nextParams.toString()}`} replace />;
  }
  return <Navigate to="/swipe" replace state={location.state} />;
}

function AppRouter() {
  const location = useLocation();
  const showBottomNav = shouldShowBottomNav(location.pathname);

  if (needsOAuthCallbackRedirect(location)) {
    return (
      <Navigate
        to={`/auth/callback${location.search}${location.hash}`}
        replace
      />
    );
  }

  if (location.pathname.length > 1 && location.pathname.endsWith("/")) {
    return (
      <Navigate
        to={`${location.pathname.replace(/\/+$/, "")}${location.search}${location.hash}`}
        replace
      />
    );
  }

  return (
    <DomainRouter>
      <ScrollManager />
      <Routes>
        <Route path="/en" element={<Navigate to="/" replace />} />
        <Route path="/" element={<Landing />} />
        {LANDING_CONTRACT_PATH_SLUGS.map((slug) => (
          <Route key={`landing-${slug}`} path={`/${slug}`} element={<Landing />} />
        ))}
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/use-cases" element={<UseCases />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/compare/:slug" element={<Compare />} />
        <Route path="/for/:slug" element={<ForProfile />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/invite/:code" element={<InviteLanding />} />
        <Route path="/admin" element={<AdminPage><Navigate to="/admin/overview" replace /></AdminPage>} />
        <Route path="/admin/overview" element={<AdminPage><AdminOverview /></AdminPage>} />
        <Route path="/admin/applications" element={<AdminPage><AdminApplications /></AdminPage>} />
        <Route path="/admin/applications/:id" element={<AdminPage><AdminApplicationDetail /></AdminPage>} />
        <Route path="/admin/users" element={<AdminPage><AdminUsers /></AdminPage>} />
        <Route path="/admin/users/:userId" element={<AdminPage><AdminUserDetail /></AdminPage>} />
        <Route path="/admin/influencers" element={<AdminPage><AdminInfluencers /></AdminPage>} />
        <Route path="/admin/creators" element={<AdminPage><AdminCreators /></AdminPage>} />
        <Route path="/admin/training" element={<AdminPage><AdminTraining /></AdminPage>} />
        <Route path="/admin/features" element={<AdminPage><AdminFeatures /></AdminPage>} />
        <Route path="/admin/analytics" element={<AdminPage><AdminAnalytics /></AdminPage>} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<AppLayout />}>
        <Route path="/app" element={<AppRoute requireProfile><Swipe /></AppRoute>} />
        <Route path="/swipe" element={<AppRoute requireProfile><Swipe /></AppRoute>} />
        <Route path="/review" element={<AppRoute requireProfile><Review /></AppRoute>} />
        <Route path="/feedback" element={<AppRoute><Feedback /></AppRoute>} />
        <Route path="/interviews" element={<AppRoute requireProfile><Interviews /></AppRoute>} />
        <Route path="/improve" element={<AppRoute requireProfile><Improve /></AppRoute>} />
        <Route path="/people" element={<AppRoute requireProfile><People /></AppRoute>} />
        <Route path="/tracker" element={<AppRoute requireProfile><Tracker /></AppRoute>} />
        <Route path="/emails" element={<AppRoute requireProfile><Emails /></AppRoute>} />
        <Route path="/profile" element={<AppRoute><Profile /></AppRoute>} />
        <Route path="/credits" element={<CreditsRedirect />} />
        <Route path="/billing" element={<AppRoute><Billing /></AppRoute>} />
        <Route path="/referral" element={<AppRoute><Referral /></AppRoute>} />
        <Route path="/settings" element={<AppRoute><Settings /></AppRoute>} />
        <Route path="/history" element={<AppRoute requireProfile><History /></AppRoute>} />
        </Route>
        <Route path="/record-tools" element={<AppRoute><RecordTools /></AppRoute>} />
        <Route path="/training" element={<TrainingRoute><Training /></TrainingRoute>} />
        <Route path="/training/creator" element={<TrainingLegacyRedirect />} />
        <Route path="/training/:courseId" element={<TrainingRoute><TrainingCourse /></TrainingRoute>} />
        <Route path="/:locale/training" element={<TrainingRoute localized><Training /></TrainingRoute>} />
        <Route path="/:locale/training/creator" element={<TrainingRoute localized><TrainingCreator /></TrainingRoute>} />
        <Route path="/:locale/training/:courseId" element={<TrainingRoute localized><TrainingCourse /></TrainingRoute>} />
      </Routes>
      {showBottomNav ? <BottomNav /> : null}
    </DomainRouter>
  );
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <AppLocaleProvider>
            <UpgradeModalProvider>
              <AppRouter />
            </UpgradeModalProvider>
          </AppLocaleProvider>
          <Toaster position="top-center" richColors theme="dark" />
        </BrowserRouter>
      </AuthProvider>
    </div>
  );
}

export default App;
