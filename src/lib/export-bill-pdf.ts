// Turns the bill already on screen into a downloaded PDF — entirely in the
// visitor's own browser, no server involved. jsPDF and html2canvas-pro are
// dynamically imported from inside the caller's click handler rather than
// imported at module scope, so neither library (~500KB combined) ever ships
// in a page's initial bundle; it only loads the moment someone actually
// clicks the button.
//
// html2canvas-pro, not the original html2canvas: this app's Tailwind v4
// setup generates oklch()-based colors, which classic html2canvas can't
// parse and throws on. The -pro fork is a maintained drop-in replacement
// that understands modern CSS color functions.
//
// Both bill layouts (src/app/monthly-bills/monthly-bill-document.tsx,
// compact-bill-document.tsx) are deliberately single-page — globals.css sets
// `@page { size: A4; margin: 6mm }` under @media print and neither has any
// page-break CSS — so this captures one element and places it on one PDF
// page, no pagination logic needed. Both also hardcode a white background
// and dark text directly in their classNames rather than using the app's
// theme variables, so the capture is correct regardless of which theme is
// active on screen.

export class BillPdfExportError extends Error {}

export async function downloadBillAsPdf(filename: string): Promise<void> {
  const target = document.querySelector<HTMLElement>(".bill-document");

  if (!target) {
    throw new BillPdfExportError("Could not find the bill on this page to export.");
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  // 2x scale for crisp text — html2canvas's default (the CSS pixel size) is
  // noticeably soft once printed or zoomed into, the way a non-retina
  // screenshot would be.
  const canvas = await html2canvas(target, { scale: 2, backgroundColor: "#ffffff" });

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 6; // matches the @page margin in globals.css

  const availableWidth = pageWidth - margin * 2;
  const availableHeight = pageHeight - margin * 2;
  const imageAspectRatio = canvas.height / canvas.width;

  // Fit to the page by whichever dimension is the binding constraint, then
  // center the other — the bill is close to A4's own proportions already,
  // so this mostly just removes any leftover margin rounding.
  let renderWidth = availableWidth;
  let renderHeight = renderWidth * imageAspectRatio;

  if (renderHeight > availableHeight) {
    renderHeight = availableHeight;
    renderWidth = renderHeight / imageAspectRatio;
  }

  const offsetX = margin + (availableWidth - renderWidth) / 2;
  const offsetY = margin + (availableHeight - renderHeight) / 2;

  // JPEG, not PNG: the canvas is fully opaque (backgroundColor above), so
  // there's no transparency to lose, and JPEG's lossy compression handles a
  // mostly-white document with fine anti-aliased text far better than PNG's
  // lossless compression does here — the PNG version of this same capture
  // ran past 10MB per bill from pixel-level anti-aliasing noise alone, JPEG
  // at a high quality setting lands under 1MB with no visible difference.
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", offsetX, offsetY, renderWidth, renderHeight);
  pdf.save(filename);
}
