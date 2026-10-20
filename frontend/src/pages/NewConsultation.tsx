import { Navigate } from "react-router-dom";

// "New Consultation" is the same describe-your-problem flow Home already provides.
export default function NewConsultation() {
  return <Navigate to="/home" replace />;
}
