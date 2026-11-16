import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { Shell } from "./components/Layout.jsx";
import { Loading } from "./components/ui.jsx";
import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import Onboarding from "./pages/Onboarding.jsx";
import Home from "./pages/farmer/Home.jsx";
import Offers from "./pages/farmer/Offers.jsx";
import Demand from "./pages/farmer/Demand.jsx";
import Price from "./pages/farmer/Price.jsx";
import Profit from "./pages/farmer/Profit.jsx";
import Agreements from "./pages/farmer/Agreements.jsx";
import Profile from "./pages/farmer/Profile.jsx";
import BuyerDashboard from "./pages/buyer/BuyerDashboard.jsx";
import TrustShell from "./components/trust/TrustShell.jsx";
import ContractsDashboard from "./pages/contracts/Dashboard.jsx";
import ContractDetail from "./pages/contracts/Detail.jsx";
import ContractEdit from "./pages/contracts/Edit.jsx";
import ContractSign from "./pages/contracts/Sign.jsx";
import ContractVerify from "./pages/contracts/Verify.jsx";
import ContractNetwork from "./pages/contracts/Network.jsx";
import FarmOpsPage from "./pages/m2/FarmOps.jsx";
import Decisions from "./pages/Decisions.jsx";
import Certificates from "./pages/certificates/Certificates.jsx";
import CertificateDetail from "./pages/certificates/CertificateDetail.jsx";
import IssueCertificates from "./pages/certificates/IssueCertificates.jsx";
import VerifyCertificate from "./pages/public/VerifyCertificate.jsx";
import PublicTrace from "./pages/public/PublicTrace.jsx";
import CropStages, { CropList } from "./pages/stages/CropStages.jsx";
import AssistantPage from "./pages/assistant/Assistant.jsx";
import Advice, { FarmerMessages, RecommendationDetail } from "./pages/advisory/Advice.jsx";
import { AgronomistFarmer, AgronomistHome, AgronomistItem, MessageLog } from "./pages/advisory/Agronomist.jsx";
import { StageReviewDetail, StageReviewQueue, StageSettings } from "./pages/stages/StageReviews.jsx";

export const HOME = { farmer: "/farmer/home", buyer: "/buyer", operations: "/ops/decisions" };

/** Any signed-in user (farmers must have completed their farm profile). */
function GuardAny() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role === "farmer" && !user.farm) return <Navigate to="/farmer/onboarding" replace />;
  return <Outlet />;
}

/** Gate a route tree by role; farmers without a farm profile are sent to onboarding. */
function Guard({ role }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== role) return <Navigate to={HOME[user.role] || "/"} replace />;
  if (role === "farmer" && !user.farm) return <Navigate to="/farmer/onboarding" replace />;
  return <Outlet />;
}

function RedirectM2() {
  const { user } = useAuth();
  const base = { farmer: "/farmer/ops", buyer: "/buyer/ops", operations: "/ops/farm" }[user.role];
  return <Navigate to={base + window.location.pathname.slice(3)} replace />;
}

export default function App() {
  const { ready } = useAuth();
  if (!ready) return <div className="content"><Loading /></div>;
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login/:role" element={<Login />} />
      {/* public, no login: certificate verification and the lot QR trace page */}
      <Route path="/verify" element={<VerifyCertificate />} />
      <Route path="/verify/:id" element={<VerifyCertificate />} />
      <Route path="/trace/:lotId" element={<PublicTrace />} />
      <Route path="/m2/trace/:lotId" element={<PublicTrace />} />
      <Route path="/farmer/onboarding" element={<Onboarding />} />
      <Route element={<Guard role="farmer" />}>
        <Route path="/farmer" element={<Shell role="farmer" />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="home" element={<Home />} />
          <Route path="offers" element={<Offers />} />
          <Route path="demand" element={<Demand />} />
          <Route path="price" element={<Price />} />
          <Route path="profit" element={<Profit />} />
          <Route path="agreements" element={<Agreements />} />
          <Route path="profile" element={<Profile />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="certificates" element={<Certificates />} />
          <Route path="certificates/:id" element={<CertificateDetail />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="advice" element={<Advice />} />
          <Route path="advice/:itemId" element={<RecommendationDetail />} />
          <Route path="messages" element={<FarmerMessages />} />
          <Route path="stages" element={<CropList />} />
          <Route path="stages/:cropId" element={<CropStages />} />
          <Route path="ops/*" element={<FarmOpsPage />} />
        </Route>
      </Route>
      <Route element={<Guard role="buyer" />}>
        <Route path="/buyer" element={<Shell role="buyer" />}>
          <Route index element={<BuyerDashboard />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="certificates" element={<Certificates />} />
          <Route path="certificates/:id" element={<CertificateDetail />} />
          <Route path="ops/*" element={<FarmOpsPage />} />
        </Route>
      </Route>
      <Route element={<Guard role="operations" />}>
        <Route path="/ops" element={<Shell role="operations" />}>
          <Route index element={<Navigate to="decisions" replace />} />
          <Route path="decisions" element={<Decisions />} />
          <Route path="certificates" element={<Certificates />} />
          <Route path="certificates/issue" element={<IssueCertificates />} />
          <Route path="agronomist" element={<AgronomistHome />} />
          <Route path="agronomist/farmers/:id" element={<AgronomistFarmer />} />
          <Route path="agronomist/farmers/:id/items/:itemId" element={<AgronomistItem />} />
          <Route path="advisory/*" element={<Navigate to="/ops/agronomist" replace />} />
          <Route path="messages" element={<MessageLog />} />
          <Route path="stage-reviews" element={<StageReviewQueue />} />
          <Route path="stage-reviews/:id" element={<StageReviewDetail />} />
          <Route path="stage-settings" element={<StageSettings />} />
          <Route path="certificates/:id" element={<CertificateDetail />} />
          <Route path="farm/*" element={<FarmOpsPage />} />
        </Route>
      </Route>
      <Route element={<GuardAny />}>
        <Route path="/contracts" element={<TrustShell />}>
          <Route index element={<ContractsDashboard />} />
          <Route path="verify" element={<ContractVerify />} />
          <Route path="network" element={<ContractNetwork />} />
          <Route path=":id" element={<ContractDetail />} />
          <Route path=":id/edit" element={<ContractEdit />} />
          <Route path=":id/sign" element={<ContractSign />} />
        </Route>
      </Route>
      {/* old separate Module 2 frame: now part of each portal */}
      <Route element={<GuardAny />}><Route path="/m2/*" element={<RedirectM2 />} /></Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
