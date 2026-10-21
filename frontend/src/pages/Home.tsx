import { useEffect, useState } from "react";
import LawyerCard from "../components/LawyerCard";
import Decorations from "../components/Decorations";
import Reveal from "../components/Reveal";
import { getLawyers } from "../lib/lawyersApi";
import type { Lawyer } from "../lib/demoLawyers";
import "./Home.css";

export default function Home() {
  const [lawyers, setLawyers] = useState<Lawyer[]>([]);

  useEffect(() => {
    getLawyers().then(setLawyers);
  }, []);

  return (
    <div className="home-page">
      <Decorations />
      <Reveal as="header" className="home-hero">
        <h1 className="home-page__title">Visit a Chamber</h1>
        <div className="divider-gold divider-gold--shimmer" aria-hidden="true">
          <span />
        </div>
        <p className="home-hero__sub">Six specialist advocates, each ready to listen. Choose the one who practises in your area of law.</p>
      </Reveal>

      <div className="lawyer-grid">
        {lawyers.map((lawyer, i) => (
          <Reveal key={lawyer.id} delay={Math.min(i, 6) * 70}>
            <LawyerCard lawyer={lawyer} matched={false} />
          </Reveal>
        ))}
      </div>
    </div>
  );
}
