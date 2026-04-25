# Publish to Canva

Use this checklist before submitting IMAI.Studio for Canva review.

## 1. Run Local Checks

From the project root, run:

```bash
npm run lint:types
npm run lint
npm test -- --runInBand --watchman=false
npm run build
```

Confirm `dist/app.js` exists after the build. Canva requires the app to be
uploaded as a standalone JavaScript bundle, and the bundle must stay under 5 MB.

## 2. Preview the App

Start the local development server:

```bash
npm start
```

In the Canva Developer Portal:

1. Open the app.
2. Go to **App source**.
3. Set the development URL to the local dev server URL.
4. Click **Preview**.
5. Test the app in the Canva editor.

Before submitting, manually verify:

- API key setup works with and without a saved key.
- Marketing upload accepts common browser-supported image files.
- Catalogue upload accepts common browser-supported image files.
- Marketing slider values from 1 to 5 generate the expected hidden request text.
- Marketing generated images are added directly to the Canva canvas.
- Catalogue generated images are added directly while catalogue details remain visible.
- Library images still add to the Canva canvas when clicked.
- External links, buttons, light theme, and dark theme all work.

## 3. Prepare Review Details

Canva reviewers need enough information to test the complete app flow:

- Provide a working IMAI.Studio test account or API key.
- Explain where the reviewer gets or enters the API key.
- Explain that generated images are added directly to the Canva design.
- Confirm production API endpoints are hosted on reliable infrastructure.
- Do not submit with localhost, ngrok, or free/sleeping servers as production dependencies.

## 4. Upload the Bundle

After `npm run build` succeeds:

1. Go to the Canva Developer Portal.
2. Open the app from **Your apps**.
3. Open **App source** or **Code upload**.
4. Upload `dist/app.js` to the JavaScript file field.
5. Complete the listing details and required visual assets.
6. Add testing instructions and credentials.
7. Go to the submit page, accept the required terms, and submit the app.

## 5. Review Checklist

Before submitting, check Canva's requirements:

- App UI uses Canva App UI Kit components where practical.
- Required scopes in `canva-app.json` match the features used.
- UI strings are ready for Canva localization upload.
- The app is complete, functional, and not a copy of an existing Canva app.
- Written listing copy is typo-free and does not include unnecessary external links.
- App behavior is tested in light and dark themes.
- Core endpoints, links, buttons, and authentication flows have been tested.

## References

- [Bundling apps](https://www.canva.dev/docs/apps/bundling-apps/)
- [Submitting apps](https://www.canva.dev/docs/apps/submitting-apps/)
- [Submission checklist](https://www.canva.dev/docs/apps/submission-checklist/)
- [App UI Kit quickstart](https://www.canva.dev/docs/apps/app-ui-kit/quickstart/)
