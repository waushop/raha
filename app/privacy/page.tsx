import LegalPage from "@/components/LegalPage";

export const metadata = { title: "Privacy · Empty Wallet" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="19 October 2026">
      <section>
        <h2>Who runs it</h2>
        <p>Empty Wallet is a private, invitation-only budgeting app run by its owner for one household. It is not a commercial service and has no public sign-up. The owner who invited you is the controller of your data and the person to contact about it.</p>
      </section>
      <section>
        <h2>What is stored</h2>
        <ul>
          <li><strong>Your account:</strong> name, a salted hash of your PIN (never the PIN itself), and optionally an email address for sign-in codes and digests.</li>
          <li><strong>Your ledger:</strong> the expenses, income, budgets, plans, subscriptions, goals and balances you enter or import.</li>
          <li><strong>Bank data, if you connect a bank:</strong> account names, IBANs, balances and booked transactions (date, amount, description, transaction id), read through Enable Banking.</li>
          <li><strong>Technical data:</strong> a session cookie, a trusted-device cookie if you choose &ldquo;remember this device&rdquo;, push-notification endpoints if you turn push on, and an audit trail of changes to your ledger.</li>
        </ul>
      </section>
      <section>
        <h2>Bank access</h2>
        <p>Bank connections are <strong>read-only</strong> (PSD2 account information). Empty Wallet cannot make payments or move money. You authorise access at your own bank; consent lasts up to 180 days and you can disconnect at any time in Bank sync, which also stops all further reads. Bank connection details are not included in backups or exports.</p>
      </section>
      <section>
        <h2>What it is used for</h2>
        <p>Only to show you your own finances: categorising spending, budgets, forecasts, reminders and reports. Your data is never sold, used for advertising, or shared with anyone outside the household members you add.</p>
      </section>
      <section>
        <h2>Where it lives and who processes it</h2>
        <ul>
          <li><strong>Hosting and backups:</strong> Hetzner data centres in the EU; database backups are kept in Hetzner object storage in Helsinki, Finland.</li>
          <li><strong>Enable Banking</strong> (Finland): the licensed provider that relays read-only bank data, only if you connect a bank.</li>
          <li><strong>Anthropic</strong>: only when you use receipt scanning or &ldquo;Ask your money&rdquo;, the photo or question and the ledger figures needed to answer it are sent to the Claude API. Photos are not stored by Empty Wallet and chats are not saved.</li>
          <li><strong>Email delivery</strong>: sign-in codes and digests go through the configured mail provider, only if you add an email address.</li>
        </ul>
      </section>
      <section>
        <h2>How long it is kept</h2>
        <p>Your data stays while your account exists. Deleted rows are kept in the database as soft-deleted so changes can be undone; backups roll over after 7 days. When the owner removes your account, you can ask for your ledger to be erased as well.</p>
      </section>
      <section>
        <h2>Your rights</h2>
        <p>You can export your ledger as CSV or JSON from Settings at any time, correct anything in the app, disconnect banks, and ask the owner to erase your data. Under the GDPR you may also complain to your data-protection authority (in Estonia, the Andmekaitse Inspektsioon).</p>
      </section>
      <section>
        <h2>Cookies</h2>
        <p>Only the strictly necessary ones: the sign-in session, the optional trusted-device cookie, and the selected household. No analytics or tracking.</p>
      </section>
    </LegalPage>
  );
}
