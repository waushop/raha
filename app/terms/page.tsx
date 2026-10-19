import LegalPage from "@/components/LegalPage";

export const metadata = { title: "Terms · Empty Wallet" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="19 October 2026">
      <section>
        <h2>The service</h2>
        <p>Empty Wallet is a private budgeting tool its owner runs for themselves and the people they invite. Access is by invitation only and free of charge.</p>
      </section>
      <section>
        <h2>Your account</h2>
        <p>Keep your PIN to yourself, and switch on the email check in Settings for extra protection. You are responsible for what is entered under your account. The owner can remove accounts and reset PINs.</p>
      </section>
      <section>
        <h2>Bank connections</h2>
        <p>Connecting a bank is optional and read-only. You authorise it at your bank through Enable Banking, can revoke it at any time in Bank sync or at your bank, and only connect accounts you are entitled to access.</p>
      </section>
      <section>
        <h2>No financial advice</h2>
        <p>Forecasts, safe-to-spend figures, nudges and AI answers are estimates from your own data. They can be wrong or incomplete and are not financial advice. Check important numbers against your bank.</p>
      </section>
      <section>
        <h2>Availability and liability</h2>
        <p>The app is provided as is, without warranties. It is backed up continuously, but it may be unavailable or change at any time. To the extent the law allows, the owner is not liable for losses arising from its use. Keep your own exports if the data matters to you.</p>
      </section>
      <section>
        <h2>Privacy</h2>
        <p>How data is handled is described in the <a href="/privacy" className="text-white underline underline-offset-2">privacy policy</a>.</p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>These terms may be updated; the date above shows the current version. Estonian law applies.</p>
      </section>
    </LegalPage>
  );
}
