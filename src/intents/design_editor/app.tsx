import { AppI18nProvider } from "@canva/app-i18n-kit";
import { AppUiProvider } from "@canva/app-ui-kit";
import { ErrorBoundary } from "react-error-boundary";
import { StudioApp } from "../../imai/studio_app";

export const App = () => (
  <AppI18nProvider>
    <AppUiProvider>
      <ErrorBoundary fallback={<div />}>
        <StudioApp />
      </ErrorBoundary>
    </AppUiProvider>
  </AppI18nProvider>
);
