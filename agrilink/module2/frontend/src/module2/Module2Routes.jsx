import { Navigate, Route, Routes } from 'react-router-dom'
import { useM2 } from './context.jsx'
import AgreementDetail from './pages/AgreementDetail.jsx'
import DoctorVisits from './pages/DoctorVisits.jsx'
import FarmerProfile from './pages/FarmerProfile.jsx'
import FarmerView from './pages/FarmerView.jsx'
import LotTrace from './pages/LotTrace.jsx'
import Messages from './pages/Messages.jsx'
import QualityChecks from './pages/QualityChecks.jsx'
import Ratings from './pages/Ratings.jsx'
import Recovery from './pages/Recovery.jsx'
import Reviews from './pages/Reviews.jsx'
import Risks from './pages/Risks.jsx'
import SupplyBoard from './pages/SupplyBoard.jsx'

/** Navigation for each role, grouped by workflow stage. A host (Module 1) can render
 *  these in its own menu: `m2NavFor(role)` returns [{group, items:[{path,label}]}]. */
const NAV = [
  { group: 'Supply', items: [{ path: '', label: 'Supply assurance', roles: ['admin', 'fpo', 'buyer'] }] },
  { group: 'Quality', items: [
    { path: 'quality-checks', label: 'Photo checks', roles: ['admin', 'fpo', 'doctor'] },
    { path: 'visits', label: 'Farmer doctor visits', roles: ['admin', 'fpo', 'doctor'] },
    { path: 'reviews', label: 'Reviews & interventions', roles: ['admin', 'fpo', 'doctor'] },
    { path: 'farmer', label: 'My photo checks', roles: ['farmer'] },
  ] },
  { group: 'Risk', items: [
    { path: 'risks', label: 'Risks & scenario lab', roles: ['admin', 'fpo'] },
    { path: 'recovery', label: 'Supply recovery', roles: ['admin', 'fpo', 'buyer'] },
  ] },
  { group: 'Records', items: [
    { path: 'ratings', label: 'Monthly ratings', roles: ['admin', 'fpo', 'buyer', 'farmer'] },
    { path: 'messages', label: 'Messages', roles: ['admin', 'fpo', 'doctor', 'buyer', 'farmer'] },
  ] },
]

export function m2NavFor(role) {
  return NAV.map((g) => ({ group: g.group, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length)
}

export function m2HomeFor(role) {
  return { farmer: 'farmer', doctor: 'visits' }[role] || ''
}

/** Mount under any path, e.g. <Route path="/m2/*" element={<Module2Routes />} /> inside an <M2Provider>. */
export default function Module2Routes() {
  const { auth } = useM2()
  const home = m2HomeFor(auth.role)
  return (
    <div className="m2-root">
      <Routes>
        <Route index element={home ? <Navigate to={home} replace /> : <SupplyBoard />} />
        <Route path="agreements/:id" element={<AgreementDetail />} />
        <Route path="quality-checks" element={<QualityChecks />} />
        <Route path="farmer" element={<FarmerView />} />
        <Route path="visits" element={<DoctorVisits />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="risks" element={<Risks />} />
        <Route path="recovery" element={<Recovery />} />
        <Route path="ratings" element={<Ratings />} />
        <Route path="messages" element={<Messages />} />
        <Route path="farmers/:id" element={<FarmerProfile />} />
        <Route path="trace/:lotId" element={<LotTrace />} />
        <Route path="*" element={<div className="m2-page"><h1>Page not found</h1></div>} />
      </Routes>
    </div>
  )
}
