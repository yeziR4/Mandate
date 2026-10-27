import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section className="shell section" style={{ minHeight: "52vh", display: "flex", alignItems: "center" }}>
      <div>
        <span className="kicker">404</span>
        <h1 className="pagehead__title" style={{ marginTop: 10 }}>
          Nothing at this address
        </h1>
        <p className="pagehead__lede">
          The page does not exist. The board does, and so do the certificates.
        </p>
        <div className="hero__actions">
          <Link className="btn btn--primary" to="/">
            Back to the board
          </Link>
          <Link className="btn" to="/certificates">
            Certificates
          </Link>
        </div>
      </div>
    </section>
  );
}
