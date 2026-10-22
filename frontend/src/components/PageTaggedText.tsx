import { splitPageTags } from "../lib/pageTags";
import "./PageTaggedText.css";

// An answer's text with its "(page N)" markers shown as subtle inline tags. Screen readers get the marker as written.
export default function PageTaggedText({ text }: { text: string }) {
  const parts = splitPageTags(text);
  if (parts.length === 1 && !parts[0].tag) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        part.tag ? (
          <span key={i} className="page-tag" title={part.text.slice(1, -1)}>
            <span className="sr-only">{part.text}</span>
            <span aria-hidden="true">{part.tag}</span>
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
