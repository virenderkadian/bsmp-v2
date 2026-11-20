import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy policy · BSMP Driver",
  description: "How the BSMP Driver app handles data.",
};

// Public page (see PUBLIC_PATHS in src/proxy.ts) — linked from the Google Play
// listing of the BSMP Driver app, so it must be readable without signing in.
const CONTACT_EMAIL = "brahmshakti.info@gmail.com";
const UPDATED = "11 November 2026";

export default function PrivacyPage() {
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-5 py-10 text-text-primary">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">BSMP Driver</p>
      <h1 className="mt-1 text-3xl font-bold">Privacy policy</h1>
      <p className="mt-1 text-sm text-text-secondary">Last updated {UPDATED}</p>

      <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-text-secondary">
        <section>
          <h2 className="text-lg font-semibold text-text-primary">Who this is for</h2>
          <p className="mt-2">
            BSMP Driver is a work app for the delivery drivers and office staff of Bhramshakti Milk Product (BSMP). It is used to record daily milk and dairy deliveries,
            stock and payments. It is not offered to the general public, and you need an account created by BSMP to sign in.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">What the app collects</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li><span className="font-medium text-text-primary">Sign-in details.</span> A vehicle code and PIN for drivers, or the work email and password of an office user. Passwords and PINs are stored only in hashed form.</li>
            <li><span className="font-medium text-text-primary">Delivery and payment records.</span> What was delivered to which customer, quantities, notes, stock counts, and payments collected or recorded.</li>
            <li><span className="font-medium text-text-primary">Customer details shown to drivers.</span> Customer name, phone number, address and route, which BSMP already holds to deliver to its customers.</li>
            <li><span className="font-medium text-text-primary">Location.</span> With your permission, the phone&apos;s location is read when you save a customer&apos;s location on the first delivery to them. That customer location is stored so that you can get directions on later visits. The app does not track a driver&apos;s movements in the background.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">How it is used</h2>
          <p className="mt-2">
            Only to run deliveries, billing, payment collection and reconciliation for BSMP. We do not sell data, do not show advertising, and do not use
            the data for profiling.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">Where it is stored and who sees it</h2>
          <p className="mt-2">
            Data is sent over an encrypted (HTTPS) connection to BSMP&apos;s servers and kept in BSMP&apos;s database, hosted with cloud providers
            that act only as BSMP&apos;s processors. It is visible to BSMP staff according to their role. Directions open in the phone&apos;s map app,
            which has its own privacy policy. We do not share data with other third parties, except where the law requires it.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">How long it is kept</h2>
          <p className="mt-2">
            Delivery, billing and payment records are kept for as long as BSMP needs them for its accounts and legal obligations. Older daily records
            may be moved to archive storage.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">Your choices</h2>
          <p className="mt-2">
            You can turn off the location permission in your phone&apos;s settings; the app still works, but customer locations cannot be saved. To
            correct or delete your account or data, contact BSMP using the details below, and we will respond within a reasonable time.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-primary">Contact</h2>
          <p className="mt-2">Questions about this policy: {CONTACT_EMAIL}</p>
        </section>

        <p className="text-sm text-text-muted">We may update this policy; the date at the top shows when it last changed.</p>
      </div>
    </div>
  );
}
