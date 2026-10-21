import "./PagePlaceholder.css";

export default function PagePlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="page-placeholder">
      <h1>{title}</h1>
      <p>{note}</p>
    </div>
  );
}
