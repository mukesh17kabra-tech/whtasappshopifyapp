export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px", fontFamily: "sans-serif", lineHeight: 1.6, color: "#202223" }}>
      <h1>Privacy Policy</h1>
      <p><em>Last updated: 2026-07-14</em></p>

      <h2>1. What this app does</h2>
      <p>
        WhatsApp Offers ("the App") lets Shopify merchants send order
        confirmations, shipping updates, and marketing messages to their
        customers over WhatsApp, and adds a storefront popup and a
        product-finder chatbot to help collect visitor contact details and
        assist shoppers.
      </p>

      <h2>2. Information we collect</h2>
      <p>When a merchant installs and uses the App, we collect and store:</p>
      <ul>
        <li><strong>From merchants:</strong> Shopify shop domain, access token (used only to call Shopify's API on the merchant's behalf), and any templates/settings the merchant creates in the App.</li>
        <li><strong>From the merchant's customers:</strong> name and WhatsApp phone number, submitted via the storefront popup, chatbot, manual entry by the merchant, CSV import, or automatically captured when a customer places an order (for order/shipping notifications only).</li>
        <li><strong>Message logs:</strong> which messages were sent, to which phone number, and their delivery status, for the merchant's own record-keeping inside the App.</li>
      </ul>

      <h2>3. How we use this information</h2>
      <p>
        Customer names and phone numbers are used solely to send the
        WhatsApp messages the merchant configures — order confirmations,
        shipping updates, and (only for customers who explicitly opted in)
        marketing broadcasts. We do not sell, rent, or share this data with
        any third party other than the messaging infrastructure necessary to
        deliver a WhatsApp message.
      </p>

      <h2>4. How messages are sent — important disclosure</h2>
      <p>
        Merchants using this App connect their own WhatsApp number using a
        method equivalent to WhatsApp Web (scanning a QR code to link a
        device), rather than Meta's official WhatsApp Business Platform API.
        This means the App does not go through Meta's official approval
        process for message templates. Merchants are solely responsible for
        how they use this connection and for complying with WhatsApp's own
        Terms of Service.
      </p>

      <h2>5. Data retention</h2>
      <p>
        We retain customer data for as long as the merchant has the App
        installed. If a customer requests deletion of their data, or a
        merchant uninstalls the App, all associated data is deleted within
        48 hours in accordance with Shopify's data protection requirements.
      </p>

      <h2>6. Your rights</h2>
      <p>
        Customers of a merchant using this App can request access to, or
        deletion of, their data by contacting the merchant directly, or by
        using Shopify's standard customer data request process. Merchants
        can also delete a specific subscriber's data at any time from the
        App's Subscribers page.
      </p>

      <h2>7. Data storage and security</h2>
      <p>
        Data is stored in a managed PostgreSQL database (Neon) and processed
        through Vercel's hosting infrastructure. Access is restricted to the
        App's own backend services; we do not provide direct external access
        to this data.
      </p>

      <h2>8. Third-party services used</h2>
      <ul>
        <li><strong>Shopify</strong> — for store data (orders, customers, products) via the Shopify Admin API</li>
        <li><strong>WhatsApp</strong> — for message delivery, via a merchant-linked device connection (see Section 4)</li>
        <li><strong>Upstash QStash</strong> — for reliable background message queuing</li>
        <li><strong>Vercel Blob</strong> — for storing images used in templates and the storefront widgets</li>
      </ul>

      <h2>9. Children's privacy</h2>
      <p>This App is intended for use by Shopify merchants and their adult customers. It is not directed at children.</p>

      <h2>10. Changes to this policy</h2>
      <p>We may update this policy from time to time. Continued use of the App after changes constitutes acceptance of the updated policy.</p>

      <h2>11. Contact</h2>
      <p>
        For questions about this policy or to request data deletion,
        contact us at: <strong>[YOUR SUPPORT EMAIL HERE]</strong>
      </p>
    </div>
  );
}
