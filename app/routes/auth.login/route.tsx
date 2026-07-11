import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
  AppProvider as PolarisAppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { login } from "~/shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export async function loader({ request }: LoaderFunctionArgs) {
  const errors = await login(request);
  return json({ errors: errors || {}, polarisTranslations });
}

export async function action({ request }: ActionFunctionArgs) {
  const errors = await login(request);
  return json({ errors: errors || {} });
}

export default function Auth() {
  const { errors } = useLoaderData<typeof loader>();
  const [shop, setShop] = useState("");

  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <Page narrowWidth>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingMd" as="h2">
                Log in to WhatsApp Offers
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="e.g. my-shop-name.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="off"
                error={errors.shop}
              />
              <Button submit variant="primary">
                Log in
              </Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}
