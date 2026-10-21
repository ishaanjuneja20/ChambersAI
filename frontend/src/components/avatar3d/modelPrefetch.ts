// Warms the HTTP cache with a lawyer's 3D model before the Meet screen asks for it: called when their card is hovered or
// focused on Home and when their profile is opened. Low priority and idle-time only, once per lawyer, and skipped on
// Save-Data / slow connections. Nothing is downloaded on page load.
import { getLawyerModel } from "./lawyerModels";

const requested = new Set<string>();

type Connection = { saveData?: boolean; effectiveType?: string };

export function prefetchLawyerModel(lawyerId: string): void {
  const model = getLawyerModel(lawyerId);
  if (!model || requested.has(model.modelUrl)) return;
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) return;
  requested.add(model.modelUrl);
  const start = () => {
    const controller = new AbortController();
    // The body has to be read for the browser to keep the response in its cache.
    fetch(model.modelUrl, { priority: "low", signal: controller.signal } as RequestInit)
      .then((response) => (response.ok ? response.arrayBuffer() : undefined))
      .catch(() => requested.delete(model.modelUrl));
  };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start, { timeout: 2000 });
  else window.setTimeout(start, 200);
}
