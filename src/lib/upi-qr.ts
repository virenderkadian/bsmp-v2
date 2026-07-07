import QRCode from "qrcode";

export async function generateUpiQrDataUrl(upiId: string, payeeName: string): Promise<string> {
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&cu=INR`;

  return QRCode.toDataURL(upiUri, { margin: 1, width: 160 });
}
