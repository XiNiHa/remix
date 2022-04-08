import { createFixture, createAppFixture, js } from "./helpers/create-fixture";
import type { Fixture, AppFixture } from "./helpers/create-fixture";

describe("compiler", () => {
  let fixture: Fixture;
  let app: AppFixture;

  beforeAll(async () => {
    fixture = await createFixture({
      files: {
        "app/fake.server.js": js`
          export const hello = "server";
        `,
        "app/fake.client.js": js`
          export const hello = "client";
        `,
        "app/fake.js": js`
          import { hello as clientHello } from "./fake.client.js";
          import { hello as serverHello } from "./fake.server.js";
          export default clientHello || serverHello;
        `,

        "app/routes/index.jsx": js`
          import fake from "~/fake.js";

          export default function Index() {
            let hasRightModule = fake === (typeof document === "undefined" ? "server" : "client");
            return <div id="index">{String(hasRightModule)}</div>
          }
        `,
        "app/routes/built-ins.jsx": js`
          import { useLoaderData } from "@remix-run/react";
          import * as path from "path";

          export let loader = () => {
            return path.join("test", "file.txt");
          }

          export default function BuiltIns() {
            return <div id="built-ins">{useLoaderData()}</div>
          }
        `,
        "app/routes/built-ins-polyfill.jsx": js`
          import { useLoaderData } from "@remix-run/react";
          import * as path from "path";

          export default function BuiltIns() {
            return <div id="built-ins-polyfill">{path.join("test", "file.txt")}</div>;
          }
        `,
        "app/routes/esm-only-pkg.jsx": js`
          import esmOnlyPkg from "esm-only-pkg";

          export default function EsmOnlyPkg() {
            return <div id="esm-only-pkg">{esmOnlyPkg}</div>;
          }
        `,
        "app/routes/esm-only-exports-pkg.jsx": js`
          import esmOnlyPkg from "esm-only-exports-pkg";

          export default function EsmOnlyPkg() {
            return <div id="esm-only-exports-pkg">{esmOnlyPkg}</div>;
          }
        `,
        "app/routes/esm-only-single-export.jsx": js`
          import esmOnlyPkg from "esm-only-single-export";

          export default function EsmOnlyPkg() {
            return <div id="esm-only-single-export">{esmOnlyPkg}</div>;
          }
        `,
        "remix.config.js": js`
          let { getDependenciesToBundle } = require("@remix-run/dev");
          module.exports = {
            serverDependenciesToBundle: [
              "esm-only-pkg",
              "esm-only-single-export",
              ...getDependenciesToBundle("esm-only-exports-pkg"),
            ],
          };
        `,
        "node_modules/esm-only-pkg/package.json": `{
          "name": "esm-only-pkg",
          "version": "1.0.0",
          "type": "module",
          "main": "./esm-only-pkg.js"
        }`,
        "node_modules/esm-only-pkg/esm-only-pkg.js": js`
          export default "esm-only-pkg";
        `,
        "node_modules/esm-only-exports-pkg/package.json": `{
          "name": "esm-only-exports-pkg",
          "version": "1.0.0",
          "type": "module",
          "exports": {
            ".": "./esm-only-exports-pkg.js"
          }
        }`,
        "node_modules/esm-only-exports-pkg/esm-only-exports-pkg.js": js`
          export default "esm-only-exports-pkg";
        `,

        "node_modules/esm-only-single-export/package.json": `{
          "name": "esm-only-exports-pkg",
          "version": "1.0.0",
          "type": "module",
          "exports": "./esm-only-single-export.js"
        }`,
        "node_modules/esm-only-single-export/esm-only-single-export.js": js`
          export default "esm-only-exports-pkg";
        `,
      },
    });

    app = await createAppFixture(fixture);
  });

  afterAll(async () => {
    await app.close();
  });

  it("removes server code with `*.server` files", async () => {
    let res = await app.goto("/", true);
    expect(res.status()).toBe(200); // server rendered fine

    // rendered the page instead of the error boundary
    expect(await app.getHtml("#index")).toMatchInlineSnapshot(
      `"<div id=\\"index\\">true</div>"`
    );
  });
  it("removes server code with `*.client` files", async () => {
    await app.disableJavaScript();
    let res = await app.goto("/", true);
    expect(res.status()).toBe(200); // server rendered fine

    // rendered the page instead of the error boundary
    expect(await app.getHtml("#index")).toMatchInlineSnapshot(
      `"<div id=\\"index\\">true</div>"`
    );
  });

  it("removes node built-ins from client bundle when used in just loader", async () => {
    let res = await app.goto("/built-ins", true);
    expect(res.status()).toBe(200); // server rendered fine

    // rendered the page instead of the error boundary
    expect(await app.getHtml("#built-ins")).toMatchInlineSnapshot(
      `"<div id=\\"built-ins\\">test/file.txt</div>"`
    );

    let routeModule = await fixture.getBrowserAsset(
      fixture.build.assets.routes["routes/built-ins"].module
    );
    // does not include `import bla from "path"` in the output bundle
    expect(routeModule).not.toMatch(/from\s*"path/);
  });

  it("bundles node built-ins polyfill for client bundle when used in client code", async () => {
    let res = await app.goto("/built-ins-polyfill", true);
    expect(res.status()).toBe(200); // server rendered fine

    // rendered the page instead of the error boundary
    expect(await app.getHtml("#built-ins-polyfill")).toMatchInlineSnapshot(
      `"<div id=\\"built-ins-polyfill\\">test/file.txt</div>"`
    );

    let routeModule = await fixture.getBrowserAsset(
      fixture.build.assets.routes["routes/built-ins-polyfill"].module
    );
    // does not include `import bla from "path"` in the output bundle
    expect(routeModule).not.toMatch(/from\s*"path/);
  });

  it("allows consumption of ESM modules in CJS builds with `serverDependenciesToBundle`", async () => {
    let res = await app.goto("/esm-only-pkg", true);
    expect(res.status()).toBe(200); // server rendered fine
    // rendered the page instead of the error boundary
    expect(await app.getHtml("#esm-only-pkg")).toMatchInlineSnapshot(
      `"<div id=\\"esm-only-pkg\\">esm-only-pkg</div>"`
    );
  });

  it("allows consumption of ESM modules in CJS builds with `serverDependenciesToBundle` when the package only exports a single file", async () => {
    let res = await app.goto("/esm-only-single-export", true);
    expect(res.status()).toBe(200); // server rendered fine
    // rendered the page instead of the error boundary
    expect(await app.getHtml("#esm-only-single-export")).toMatchInlineSnapshot(
      `"<div id=\\"esm-only-single-export\\">esm-only-single-export</div>"`
    );
  });

  it("allows consumption of ESM modules with exports in CJS builds with `serverDependenciesToBundle` and `getDependenciesToBundle`", async () => {
    let res = await app.goto("/esm-only-exports-pkg", true);
    expect(res.status()).toBe(200); // server rendered fine
    // rendered the page instead of the error boundary
    expect(await app.getHtml("#esm-only-exports-pkg")).toMatchInlineSnapshot(
      `"<div id=\\"esm-only-exports-pkg\\">esm-only-exports-pkg</div>"`
    );
  });
});
