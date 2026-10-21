export default function HandoffBanner({ fromName, toName }: { fromName: string; toName: string }) {
  return (
    <div className="match-banner" role="status">
      You've been handed off from <strong>{fromName}</strong> to <strong>{toName}</strong>, who specializes in this
      area.
    </div>
  );
}
