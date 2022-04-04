import { test, expect } from "@playwright/test";

import { createAppFixture, createFixture, js } from "./helpers/create-fixture";
import type { Fixture, AppFixture } from "./helpers/create-fixture";

let fixture: Fixture;
let app: AppFixture;

let BANNER_MESSAGE = "you do not have permission to view /protected";

test.beforeAll(async () => {
  fixture = await createFixture({
    files: {
      "app/session.server.js": js`
        import { createCookieSessionStorage } from "remix";

        export let MESSAGE_KEY = "message";

        export let sessionStorage = createCookieSessionStorage({
          cookie: {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            secrets: ["cookie-secret"],
          }
        })
      `,

      "app/root.jsx": js`
        import { json, Links, Meta, Outlet, Scripts, useLoaderData } from "remix";

        import { sessionStorage, MESSAGE_KEY } from "~/session.server";

        export const loader = async ({ request }) => {
          let session = await sessionStorage.getSession(request.headers.get("Cookie"));
          let message = session.get(MESSAGE_KEY) || null;

          return json(message, {
            headers: {
              "Set-Cookie": await sessionStorage.commitSession(session),
            },
          });
        };

        export default function Root() {
          const message = useLoaderData();

          return (
            <html lang="en">
              <head>
                <Meta />
                <Links />
              </head>
              <body>
                {!!message && <p id="message">{message}</p>}
                <Outlet />
                <Scripts />
              </body>
            </html>
          );
        }
      `,

      "app/routes/index.jsx": js`
        import { Link } from "remix";

        export default function Index() {
          return (
            <p>
              <Link to="/protected">protected</Link>
            </p>
          );
        }
      `,

      "app/routes/login.jsx": js`
        export default function Login() {
          return <p>login</p>;
        }
      `,

      "app/routes/protected.jsx": js`
        import { redirect } from "remix";

        import { sessionStorage, MESSAGE_KEY } from "~/session.server";

        export let loader = async ({ request }) => {
          let session = await sessionStorage.getSession(request.headers.get("Cookie"));

          session.flash(MESSAGE_KEY, "${BANNER_MESSAGE}");

          return redirect("/login", {
            headers: {
              "Set-Cookie": await sessionStorage.commitSession(session),
            },
          });
        };

        export default function Protected() {
          return <p>protected</p>;
        }
      `,
    },
  });

  // This creates an interactive app using puppeteer.
  app = await createAppFixture(fixture);
});

test.afterAll(() => app.close());

test("should revalidate when cookie is set on redirect from loader", async ({
  page,
}) => {
  await app.goto(page, "/");
  await app.clickLink(page, "/protected");
  expect(await app.getHtml(page)).toMatch(BANNER_MESSAGE);
});