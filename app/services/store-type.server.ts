// Determines whether the current shop is a Partner-created development
// store — these have no real payment method and Shopify requires
// isTest: true for any billing operation on them. Real merchant stores need
// isTest: false to actually charge. Used consistently everywhere billing is
// requested or checked, so a dev-store subscription (created with
// isTest: true) is correctly recognized as active later, and a real store
// is never accidentally billed as a test charge.
export async function isDevelopmentStore(admin: any): Promise<boolean> {
  try {
    const response = await admin.graphql(`query { shop { plan { partnerDevelopment } } }`);
    const data = await response.json();
    return Boolean(data?.data?.shop?.plan?.partnerDevelopment);
  } catch (err) {
    console.error("Couldn't determine store type, defaulting to isTest: false", err);
    return false;
  }
}
